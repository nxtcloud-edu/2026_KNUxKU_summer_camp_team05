import asyncio
from pathlib import Path

from fastapi.testclient import TestClient

from moa_agents.fixtures import (
    DEMO_CANDIDATE_SEARCH_INPUT, DEMO_FINALIZER_INPUT, DEMO_PLAN_OPTIONS, DEMO_PROXY_INPUTS,
)
from moa_agents.models import (
    CandidateSearchOutput, DebateSupervisorOutput, ItineraryInputItem, MechanicalChecks, ParticipantSummary,
    ParticipantProxyOutput, PlanOption, ResultFinalizerOutput,
)
from moa_agents.runtime import AgentRunRequest, AgentRunResult, AgentRuntime, FixtureAgentRuntime

from moa_worker.app import create_app
from moa_worker.models import WorkflowJob
from moa_worker.orchestrator import WorkflowOrchestrator
from moa_worker.store import WorkerStore


def job() -> WorkflowJob:
    return WorkflowJob(
        job_id="job.demo",
        candidate_search=DEMO_CANDIDATE_SEARCH_INPUT,
        participant_proxies=DEMO_PROXY_INPUTS,
        mechanical_checks=MechanicalChecks(
            hard_constraint_failures=[],
            budget_valid=True,
            schedule_valid=True,
            evidence_coverage_bp=10_000,
        ),
        finalizer=DEMO_FINALIZER_INPUT,
    )


def test_fixture_workflow_runs_all_six_agents(tmp_path: Path) -> None:
    store = WorkerStore(tmp_path / "worker.sqlite3")
    orchestrator = WorkflowOrchestrator(FixtureAgentRuntime(), store)
    record = asyncio.run(orchestrator.submit(job()))
    assert record.status == "SUCCEEDED"
    assert record.result["search"]["role"] == "CANDIDATE_SEARCH"
    assert len(record.result["rounds"][0]["proxies"]) == 2
    assert record.result["rounds"][0]["audit"]["role"] == "LOGIC_AUDITOR"
    assert record.result["rounds"][0]["watcher"]["role"] == "CATEGORY_WATCHER"
    assert record.result["rounds"][0]["supervisor"]["role"] == "DEBATE_SUPERVISOR"
    assert record.result["final"]["role"] == "RESULT_FINALIZER"


class WaitingRuntime(AgentRuntime):
    def __init__(self) -> None:
        self.fixture = FixtureAgentRuntime()

    async def run(self, request: AgentRunRequest) -> AgentRunResult:
        result = await self.fixture.run(request)
        if (
            request.role == "PARTICIPANT_PROXY"
            and isinstance(result.output, ParticipantProxyOutput)
            and result.output.vote.participant_id == "alice"
        ):
            vote = result.output.vote.model_copy(update={
                "decision": "USER_CONFIRMATION_REQUIRED",
                "reason_code": "PROTECTED_OBJECTIVE",
                "affected_preference_ids": ["objective.alice.food"],
            })
            output = result.output.model_copy(update={
                "vote": vote,
                "concession": result.output.concession.model_copy(update={
                    "allowed": False, "condition": None,
                }),
                "argument": result.output.argument.model_copy(update={
                    "claimed_decision": "USER_CONFIRMATION_REQUIRED",
                    "conclusion": result.output.argument.conclusion.replace(
                        "SUPPORT", "USER_CONFIRMATION_REQUIRED",
                    ),
                }),
            })
            return AgentRunResult(
                status="SUCCESS",
                role=result.role,
                spec_id=result.spec_id,
                output=output,
                runtime="FIXTURE",
            )
        return result


class AdversarialRuntime(AgentRuntime):
    def __init__(self, mode: str) -> None:
        self.fixture = FixtureAgentRuntime()
        self.mode = mode

    async def run(self, request: AgentRunRequest) -> AgentRunResult:
        result = await self.fixture.run(request)
        if self.mode == "wait_on_block" and request.role == "DEBATE_SUPERVISOR" and isinstance(result.output, DebateSupervisorOutput):
            return AgentRunResult(
                status="SUCCESS", role=result.role, spec_id=result.spec_id, runtime="TEST",
                output=result.output.model_copy(update={
                    "next_action": "WAIT_FOR_USER",
                    "reason_code": "USER_AUTHORITY_REQUIRED",
                    "rationale": "차단을 승인으로 우회하려는 출력",
                }),
            )
        if self.mode == "wait_without_authority" and request.role == "DEBATE_SUPERVISOR" and isinstance(result.output, DebateSupervisorOutput):
            return AgentRunResult(
                status="SUCCESS", role=result.role, spec_id=result.spec_id, runtime="TEST",
                output=result.output.model_copy(update={
                    "next_action": "WAIT_FOR_USER",
                    "reason_code": "USER_AUTHORITY_REQUIRED",
                    "rationale": "권한 사유가 없지만 대기하도록 조작한 출력",
                }),
            )
        if self.mode == "drop_search_filter" and request.role == "CANDIDATE_SEARCH" and isinstance(result.output, CandidateSearchOutput):
            plans = [plan.model_copy(update={"filters": {}}) for plan in result.output.query_plans]
            return AgentRunResult(
                status="SUCCESS", role=result.role, spec_id=result.spec_id, runtime="TEST",
                output=result.output.model_copy(update={"query_plans": plans}),
            )
        if self.mode == "invent_candidate" and request.role == "RESULT_FINALIZER" and isinstance(result.output, ResultFinalizerOutput):
            itinerary = [
                item.model_copy(update={"candidate_ids": ["candidate.not-in-selected-plan"]})
                for item in result.output.itinerary
            ]
            return AgentRunResult(
                status="SUCCESS", role=result.role, spec_id=result.spec_id, runtime="TEST",
                output=result.output.model_copy(update={"itinerary": itinerary}),
            )
        return result


def test_waiting_workflow_can_resume_after_user_approval(tmp_path: Path) -> None:
    store = WorkerStore(tmp_path / "worker.sqlite3")
    orchestrator = WorkflowOrchestrator(WaitingRuntime(), store)
    with TestClient(create_app(orchestrator=orchestrator)) as client:
        response = client.post("/internal/v1/jobs?wait=true", json=job().model_dump(mode="json", by_alias=True))
        assert response.json()["status"] == "AWAITING_USER"
        resumed = client.post(
            "/internal/v1/jobs/job.demo/resume",
            json={"approved": True, "userNote": "균형안 승인"},
        )
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "SUCCEEDED"
    assert resumed.json()["result"]["userApproval"]["approved"] is True


def test_same_job_id_with_different_payload_is_rejected(tmp_path: Path) -> None:
    store = WorkerStore(tmp_path / "worker.sqlite3")
    original = job()
    store.create(original)
    changed = original.model_copy(update={"max_iterations": 2})
    try:
        store.create(changed)
    except ValueError:
        pass
    else:
        raise AssertionError("jobId idempotency conflict가 거부되지 않았습니다.")


def test_watcher_block_cannot_be_converted_to_user_approval(tmp_path: Path) -> None:
    blocked_job = job().model_copy(update={
        "job_id": "job.block-bypass",
        "mechanical_checks": MechanicalChecks(
            hard_constraint_failures=["unsafe"], budget_valid=True,
            schedule_valid=True, evidence_coverage_bp=10_000,
        ),
    })
    orchestrator = WorkflowOrchestrator(
        AdversarialRuntime("wait_on_block"), WorkerStore(tmp_path / "blocked.sqlite3"),
    )
    record = asyncio.run(orchestrator.submit(blocked_job))
    assert record.status == "BLOCKED"
    assert record.result["blockReason"] == "WATCHER_BLOCK"


def test_finalizer_invented_candidate_id_fails_closed(tmp_path: Path) -> None:
    unsafe_job = job().model_copy(update={"job_id": "job.invent-candidate"})
    orchestrator = WorkflowOrchestrator(
        AdversarialRuntime("invent_candidate"), WorkerStore(tmp_path / "invent.sqlite3"),
    )
    record = asyncio.run(orchestrator.submit(unsafe_job))
    assert record.status == "FAILED"
    assert "candidate ID" in record.error["safeMessage"]


def test_invalid_high_score_option_is_removed_before_voting(tmp_path: Path) -> None:
    invalid = PlanOption(
        proposal_id="proposal.invalid-high-score",
        summary="검증 실패지만 점수가 높은 안",
        candidate_ids=["candidate.invalid"],
        participant_satisfaction_bp={"alice": 9_900, "bob": 9_900},
        hard_constraints_satisfied=True,
        protected_objective_ids_satisfied=["objective.alice.food", "objective.bob.view"],
        cost_amount=1, currency="KRW", daily_travel_minutes=1,
        evidence_ids=["ev.hotel.price"], validation_status="INVALID",
    )
    proxies = [
        item.model_copy(update={"options": [invalid, *DEMO_PLAN_OPTIONS]})
        for item in DEMO_PROXY_INPUTS
    ]
    safe_job = job().model_copy(update={
        "job_id": "job.filter-invalid",
        "participant_proxies": proxies,
    })
    record = asyncio.run(WorkflowOrchestrator(
        FixtureAgentRuntime(), WorkerStore(tmp_path / "filter.sqlite3"),
    ).submit(safe_job))
    assert record.status == "SUCCEEDED"
    votes = [item["vote"]["proposalId"] for item in record.result["rounds"][0]["proxies"]]
    assert votes == ["proposal.balanced", "proposal.balanced"]
    assert "proposal.invalid-high-score" not in record.result["candidateResolution"]["eligibleProposalIds"]


def test_compromise_moves_to_a_distinct_verified_plan_and_finalizes_that_plan(tmp_path: Path) -> None:
    first = PlanOption(
        proposal_id="proposal.first-opposed", summary="첫 안은 최소 만족도 기준으로 반대됩니다.",
        candidate_ids=["candidate.first"],
        participant_satisfaction_bp={"alice": 4_000, "bob": 9_000},
        hard_constraints_satisfied=True,
        protected_objective_ids_satisfied=["objective.alice.food", "objective.bob.view"],
        cost_amount=500_000, currency="KRW", daily_travel_minutes=40,
        evidence_ids=["ev.hotel.price"], validation_status="VERIFIED",
    )
    compromise = PlanOption(
        proposal_id="proposal.distinct-compromise", summary="두 번째 검증 안은 절충안입니다.",
        candidate_ids=["candidate.compromise"],
        participant_satisfaction_bp={"alice": 6_000, "bob": 3_000},
        hard_constraints_satisfied=True,
        protected_objective_ids_satisfied=["objective.alice.food", "objective.bob.view"],
        cost_amount=600_000, currency="KRW", daily_travel_minutes=50,
        evidence_ids=["ev.hotel.price"], validation_status="VERIFIED",
    )
    proxies = [item.model_copy(update={"options": [first, compromise]}) for item in DEMO_PROXY_INPUTS]
    finalizer = DEMO_FINALIZER_INPUT.model_copy(update={
        "selected_plan": first,
        "itinerary": [
            ItineraryInputItem(
                day=1, title="첫 안", candidate_ids=first.candidate_ids, note="초기 템플릿",
            ),
        ],
        "participant_summaries": [
            ParticipantSummary(
                participant_id=participant_id, satisfaction_bp=score,
                fulfilled_preference_ids=[], concession_summary=None,
            )
            for participant_id, score in first.participant_satisfaction_bp.items()
        ],
    })
    compromise_job = job().model_copy(update={
        "job_id": "job.distinct-compromise",
        "participant_proxies": proxies,
        "finalizer": finalizer,
    })

    record = asyncio.run(WorkflowOrchestrator(
        FixtureAgentRuntime(), WorkerStore(tmp_path / "compromise.sqlite3"),
    ).submit(compromise_job))

    assert record.status == "SUCCEEDED"
    assert [item["selectedProposalId"] for item in record.result["rounds"]] == [
        "proposal.first-opposed", "proposal.distinct-compromise",
    ]
    assert record.result["final"]["selectedProposalId"] == "proposal.distinct-compromise"
    outcomes = {
        item["participantId"]: item["satisfactionBp"]
        for item in record.result["final"]["participantOutcomes"]
    }
    assert outcomes == compromise.participant_satisfaction_bp


def test_supervisor_cannot_request_user_approval_without_an_authority_reason(tmp_path: Path) -> None:
    manipulated = job().model_copy(update={"job_id": "job.wait-without-authority"})
    record = asyncio.run(WorkflowOrchestrator(
        AdversarialRuntime("wait_without_authority"), WorkerStore(tmp_path / "wait-invalid.sqlite3"),
    ).submit(manipulated))
    assert record.status == "FAILED"
    assert "사용자 권한 사유 없이" in record.error["safeMessage"]


def test_candidate_search_cannot_drop_canonical_filters(tmp_path: Path) -> None:
    manipulated = job().model_copy(update={"job_id": "job.drop-search-filter"})
    record = asyncio.run(WorkflowOrchestrator(
        AdversarialRuntime("drop_search_filter"), WorkerStore(tmp_path / "filter-drop.sqlite3"),
    ).submit(manipulated))
    assert record.status == "FAILED"
    assert "canonical constraint filter" in record.error["safeMessage"]


def test_conflicting_evidence_payloads_are_rejected_at_the_job_boundary() -> None:
    raw = job().model_dump(mode="json")
    raw["participantProxies"][1]["evidence"][0]["factSummary"] = "conflicting fact"
    try:
        WorkflowJob.model_validate(raw)
    except ValueError:
        pass
    else:
        raise AssertionError("The same evidenceId cannot carry conflicting facts across agents.")
