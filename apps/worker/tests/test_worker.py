import asyncio
from pathlib import Path

from fastapi.testclient import TestClient

from moa_agents.fixtures import DEMO_CANDIDATE_SEARCH_INPUT, DEMO_FINALIZER_INPUT, DEMO_PROXY_INPUTS
from moa_agents.models import DebateSupervisorOutput, MechanicalChecks
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
        if request.role == "DEBATE_SUPERVISOR" and isinstance(result.output, DebateSupervisorOutput):
            output = result.output.model_copy(update={
                "next_action": "WAIT_FOR_USER",
                "reason_code": "USER_AUTHORITY_REQUIRED",
                "rationale": "사용자 승인이 필요합니다.",
            })
            return AgentRunResult(
                status="SUCCESS",
                role=result.role,
                spec_id=result.spec_id,
                output=output,
                runtime="FIXTURE",
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
