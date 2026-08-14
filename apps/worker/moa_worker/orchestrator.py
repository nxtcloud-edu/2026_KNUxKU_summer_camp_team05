"""LLM에게 권한을 넘기지 않는 결정론적 Agent workflow 상태 머신."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel

from moa_agents.models import (
    CandidateSearchOutput, CategoryWatcherInput, CategoryWatcherOutput,
    DebateSupervisorInput, DebateSupervisorOutput, EvidenceRef, Fact,
    ItineraryInputItem, LogicAuditorInput, LogicAuditorOutput, ParticipantProxyOutput,
    ParticipantSummary, PlanOption, ProofReview, ResultFinalizerInput,
    ResultFinalizerOutput,
)
from moa_agents.runtime import AgentRunRequest, AgentRuntime, require_agent_output

from .models import ResumeRequest, WorkflowJob, WorkflowRecord
from .store import WorkerStore


class WorkflowOrchestrator:
    def __init__(self, runtime: AgentRuntime, store: WorkerStore) -> None:
        self.runtime = runtime
        self.store = store
        self._locks: dict[str, asyncio.Lock] = {}

    async def submit(self, job: WorkflowJob) -> WorkflowRecord:
        record = self.store.create(job)
        if record.status in {"SUCCEEDED", "BLOCKED", "AWAITING_USER", "RUNNING"}:
            return record
        return await self.process(job.job_id)

    async def process(self, job_id: str) -> WorkflowRecord:
        lock = self._locks.setdefault(job_id, asyncio.Lock())
        async with lock:
            current = self.store.get(job_id)
            if current.status in {"SUCCEEDED", "BLOCKED", "AWAITING_USER"}:
                return current
            job = self.store.get_job(job_id)
            self.store.transition(job_id, "RUNNING")
            try:
                result = await self._run_debate(job)
                status = result.pop("workflowStatus")
                pending = result.pop("pendingAction", None)
                return self.store.transition(job_id, status, result=result, pending_action=pending)
            except Exception as error:
                return self.store.transition(
                    job_id,
                    "FAILED",
                    error={"code": "WORKFLOW_EXECUTION_FAILED", "safeMessage": str(error)},
                )

    async def resume(self, job_id: str, decision: ResumeRequest) -> WorkflowRecord:
        lock = self._locks.setdefault(job_id, asyncio.Lock())
        async with lock:
            current = self.store.get(job_id)
            if current.status != "AWAITING_USER":
                raise ValueError("AWAITING_USER 상태의 Job만 재개할 수 있습니다.")
            if not decision.approved:
                return self.store.transition(
                    job_id,
                    "BLOCKED",
                    result=current.result,
                    error={"code": "USER_REJECTED", "safeMessage": "사용자가 계획 변경을 승인하지 않았습니다."},
                )
            job = self.store.get_job(job_id)
            self.store.transition(job_id, "RUNNING", result=current.result)
            try:
                pending = current.pending_action or {}
                selected_id = pending.get("selectedProposalId")
                if not isinstance(selected_id, str):
                    raise RuntimeError("승인 대기 레코드에 selectedProposalId가 없습니다.")
                last_round = ((current.result or {}).get("rounds") or [])[-1]
                if last_round["watcher"]["verdict"] != "PASS":
                    raise RuntimeError("Watcher PASS가 아닌 계획은 사용자 승인으로 확정할 수 없습니다.")
                selected = _find_eligible_option(job, selected_id)
                reviews = [ProofReview.model_validate(item) for item in last_round["audit"]["reviews"]]
                watcher_input = _watcher_input(job, selected, reviews, "resume")
                watcher = await require_agent_output(self.runtime, AgentRunRequest("CATEGORY_WATCHER", watcher_input))
                if not isinstance(watcher, CategoryWatcherOutput) or watcher.verdict != "PASS":
                    raise RuntimeError("사용자 승인 후 재검증이 PASS하지 않았습니다.")
                finalizer_input = _build_finalizer_input(job, selected)
                final = await require_agent_output(self.runtime, AgentRunRequest("RESULT_FINALIZER", finalizer_input))
                assert isinstance(final, ResultFinalizerOutput)
                _assert_final_output(final, finalizer_input)
                result = dict(current.result or {})
                result["userApproval"] = {"approved": True, "note": decision.user_note}
                result["resumeWatcher"] = _dump(watcher)
                result["final"] = final.model_dump(mode="json", by_alias=True)
                return self.store.transition(job_id, "SUCCEEDED", result=result)
            except Exception as error:
                return self.store.transition(job_id, "FAILED", result=current.result, error={
                    "code": "FINALIZATION_FAILED", "safeMessage": str(error),
                })

    async def _run_debate(self, job: WorkflowJob) -> dict[str, object]:
        search = await require_agent_output(self.runtime, AgentRunRequest("CANDIDATE_SEARCH", job.candidate_search))
        assert isinstance(search, CandidateSearchOutput)
        _assert_search_plan_safe(search, job)
        history: list[dict[str, object]] = []
        first = job.participant_proxies[0]
        eligible = _rank_eligible_options(job)
        resolution = {
            "mode": "PRELOADED_NORMALIZED_OPTIONS",
            "queryIds": [plan.query_id for plan in search.query_plans],
            "eligibleProposalIds": [option.proposal_id for option in eligible],
        }
        if search.status == "NO_SAFE_QUERY" or not eligible:
            return {
                "workflowStatus": "BLOCKED", "search": _dump(search),
                "candidateResolution": resolution, "rounds": history,
                "blockReason": "NO_SAFE_QUERY" if search.status == "NO_SAFE_QUERY" else "NO_VERIFIED_PLAN",
            }

        for iteration, selected in enumerate(eligible[:job.max_iterations]):
            proxy_inputs = [
                item.model_copy(update={
                    "iteration": iteration,
                    "run_id": item.run_id if iteration == 0 else f"{item.run_id}.i{iteration}",
                    "options": [selected],
                })
                for item in job.participant_proxies
            ]
            proxy_values = await asyncio.gather(*[
                require_agent_output(self.runtime, AgentRunRequest("PARTICIPANT_PROXY", item))
                for item in proxy_inputs
            ])
            proxies = [item for item in proxy_values if isinstance(item, ParticipantProxyOutput)]
            if len(proxies) != len(proxy_inputs):
                raise RuntimeError("Participant Proxy 출력 수가 입력 참가자 수와 일치하지 않습니다.")
            for output, source in zip(proxies, proxy_inputs, strict=True):
                _assert_output_evidence(output, _input_evidence_ids(source))

            evidence = _unique_evidence(proxy_inputs)
            audit_input = LogicAuditorInput(
                trip_id=first.trip_id,
                run_id=f"{job.job_id}.audit.{iteration}",
                plan_version=first.plan_version,
                arguments=[item.argument for item in proxies],
                facts=[
                    Fact(fact_id=f"fact:{item.evidence_id}", statement=item.fact_summary, evidence_ids=[item.evidence_id])
                    for item in evidence
                ],
                rules=job.rules,
                evidence=evidence,
                expected_votes=[item.vote for item in proxies],
            )
            audit = await require_agent_output(self.runtime, AgentRunRequest("LOGIC_AUDITOR", audit_input))
            assert isinstance(audit, LogicAuditorOutput)
            _assert_output_evidence(audit, _input_evidence_ids(audit_input))

            watcher_input = _watcher_input(job, selected, audit.reviews, str(iteration))
            watcher = await require_agent_output(self.runtime, AgentRunRequest("CATEGORY_WATCHER", watcher_input))
            assert isinstance(watcher, CategoryWatcherOutput)

            supervisor_input = DebateSupervisorInput(
                trip_id=first.trip_id,
                run_id=f"{job.job_id}.supervisor.{iteration}",
                plan_version=first.plan_version,
                debate_issue_id=first.debate_issue_id,
                category=first.category,
                iteration=iteration,
                max_iterations=job.max_iterations,
                options=[selected],
                votes=[item.vote for item in proxies],
                watcher_verdict=watcher,
                legal_moves=job.legal_moves,
            )
            supervisor = await require_agent_output(self.runtime, AgentRunRequest("DEBATE_SUPERVISOR", supervisor_input))
            assert isinstance(supervisor, DebateSupervisorOutput)
            if supervisor.next_action not in job.legal_moves:
                raise RuntimeError("Supervisor가 legalMoves 밖의 행동을 선택했습니다.")
            _assert_supervisor_output(supervisor, supervisor_input)

            round_result: dict[str, object] = {
                "iteration": iteration,
                "selectedProposalId": selected.proposal_id,
                "proxies": [_dump(item) for item in proxies],
                "audit": _dump(audit),
                "watcher": _dump(watcher),
                "supervisor": _dump(supervisor),
            }
            history.append(round_result)
            base: dict[str, object] = {
                "search": _dump(search), "candidateResolution": resolution, "rounds": history,
            }

            if watcher.verdict == "BLOCK" or supervisor.next_action == "BLOCK":
                base.update({
                    "workflowStatus": "BLOCKED",
                    "blockReason": "WATCHER_BLOCK" if watcher.verdict == "BLOCK" else "SUPERVISOR_BLOCK",
                })
                return base
            if watcher.verdict == "REVISE":
                if iteration + 1 < min(len(eligible), job.max_iterations):
                    continue
                base.update({"workflowStatus": "BLOCKED", "blockReason": "NO_VERIFIED_REVISION"})
                return base
            if supervisor.next_action == "WAIT_FOR_USER":
                base.update({
                    "workflowStatus": "AWAITING_USER",
                    "pendingAction": {
                        "type": "USER_CONFIRMATION_REQUIRED",
                        "reasonCode": supervisor.reason_code,
                        "rationale": supervisor.rationale,
                        "proposalIds": supervisor.referenced_proposal_ids,
                        "selectedProposalId": selected.proposal_id,
                    },
                })
                return base
            if supervisor.next_action == "END_DEBATE":
                accepting = all(item.vote.decision in {"SUPPORT", "ACCEPTABLE"} for item in proxies)
                soft_fallback = supervisor.reason_code == "ITERATION_LIMIT" and all(
                    item.vote.reason_code in {"SOFT_PREFERENCE", "ALTERNATIVE_PREFERENCE"}
                    for item in proxies if item.vote.decision == "OPPOSE"
                )
                if not accepting and not soft_fallback:
                    raise RuntimeError("합의 또는 허용된 일반 선호 fallback 없이 토론을 종료할 수 없습니다.")
                finalizer_input = _build_finalizer_input(
                    job, selected,
                    ["일반 선호 양보가 해결되지 않아 결정론적 fallback을 적용했습니다."] if soft_fallback else [],
                )
                final = await require_agent_output(self.runtime, AgentRunRequest("RESULT_FINALIZER", finalizer_input))
                assert isinstance(final, ResultFinalizerOutput)
                _assert_final_output(final, finalizer_input)
                base.update({"workflowStatus": "SUCCEEDED", "final": _dump(final)})
                return base
            if supervisor.next_action in {"REQUEST_REBUTTAL", "PROPOSE_COMPROMISE", "CALL_VOTE"}:
                if iteration + 1 < min(len(eligible), job.max_iterations):
                    continue
                protected = any(
                    item.vote.reason_code in {"PROTECTED_OBJECTIVE", "MIN_SATISFACTION", "FIVE_POINT_PREFERENCE"}
                    for item in proxies if item.vote.decision == "OPPOSE"
                )
                if protected:
                    base.update({
                        "workflowStatus": "AWAITING_USER",
                        "pendingAction": {
                            "type": "USER_CONFIRMATION_REQUIRED",
                            "reasonCode": "NO_MORE_VERIFIED_COMPROMISES",
                            "rationale": "검증된 대체안 안에서 보호 목적 또는 최소 만족도를 해결하지 못했습니다.",
                            "proposalIds": [selected.proposal_id],
                            "selectedProposalId": selected.proposal_id,
                        },
                    })
                    return base
                base.update({"workflowStatus": "BLOCKED", "blockReason": "NO_MORE_VERIFIED_COMPROMISES"})
                return base

        return {
            "workflowStatus": "BLOCKED", "search": _dump(search),
            "candidateResolution": resolution, "rounds": history,
            "blockReason": "ITERATION_LIMIT",
        }


def _all_evidence(job: WorkflowJob) -> dict[str, EvidenceRef]:
    by_id: dict[str, EvidenceRef] = {}
    for source in job.participant_proxies:
        for evidence in source.evidence:
            by_id[evidence.evidence_id] = evidence
    for evidence in job.finalizer.evidence:
        by_id[evidence.evidence_id] = evidence
    return by_id


def _evidence_is_usable(evidence: EvidenceRef, *, at: datetime | None = None) -> bool:
    if evidence.verification_status != "VERIFIED" or evidence.valid_until is None:
        return False
    comparison = at or datetime.now(timezone.utc)
    expiry = evidence.valid_until
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    return expiry > comparison


def _rank_eligible_options(job: WorkflowJob) -> list[PlanOption]:
    evidence = _all_evidence(job)
    options = job.participant_proxies[0].options
    eligible = [
        option for option in options
        if option.validation_status == "VERIFIED"
        and option.hard_constraints_satisfied
        and all(item_id in evidence and _evidence_is_usable(evidence[item_id]) for item_id in option.evidence_ids)
    ]

    def rank_key(option: PlanOption) -> tuple[object, ...]:
        leximin = tuple(-score for score in sorted(option.participant_satisfaction_bp.values()))
        return (*leximin, option.cost_amount, option.daily_travel_minutes, option.proposal_id)

    return sorted(eligible, key=rank_key)


def _find_eligible_option(job: WorkflowJob, proposal_id: str) -> PlanOption:
    for option in _rank_eligible_options(job):
        if option.proposal_id == proposal_id:
            return option
    raise RuntimeError("승인 대상 계획이 더 이상 VERIFIED·fresh 상태가 아닙니다.")


def _watcher_input(
    job: WorkflowJob,
    selected: PlanOption,
    reviews: list[ProofReview],
    suffix: str,
) -> CategoryWatcherInput:
    first = job.participant_proxies[0]
    return CategoryWatcherInput(
        trip_id=first.trip_id,
        run_id=f"{job.job_id}.watcher.{suffix}",
        plan_version=first.plan_version,
        category=first.category,
        rule_pack_version=job.rule_pack_version,
        options=[selected],
        proof_reviews=reviews,
        mechanical_checks=job.mechanical_checks,
    )


def _build_finalizer_input(
    job: WorkflowJob,
    selected: PlanOption,
    unresolved_issues: list[str] | None = None,
) -> ResultFinalizerInput:
    template = job.finalizer
    allowed = set(selected.candidate_ids)
    if template.selected_plan.proposal_id == selected.proposal_id and all(
        set(item.candidate_ids) <= allowed for item in template.itinerary
    ):
        itinerary = template.itinerary
    else:
        itinerary = [ItineraryInputItem(
            day=1,
            title=selected.summary,
            candidate_ids=selected.candidate_ids,
            note="토론에서 선택된 검증 계획의 후보만 포함합니다.",
        )]

    template_summaries = {item.participant_id: item for item in template.participant_summaries}
    summaries: list[ParticipantSummary] = []
    for participant_id, satisfaction in sorted(selected.participant_satisfaction_bp.items()):
        existing = template_summaries.get(participant_id)
        if existing is None:
            summaries.append(ParticipantSummary(
                participant_id=participant_id,
                satisfaction_bp=satisfaction,
                fulfilled_preference_ids=[],
                concession_summary=None,
            ))
        else:
            summaries.append(existing.model_copy(update={"satisfaction_bp": satisfaction}))

    evidence_by_id = _all_evidence(job)
    evidence = [evidence_by_id[item_id] for item_id in selected.evidence_ids]
    return template.model_copy(update={
        "run_id": f"{template.run_id}.{selected.proposal_id}",
        "selected_plan": selected,
        "itinerary": itinerary,
        "participant_summaries": summaries,
        "evidence": evidence,
        "unresolved_issues": list(unresolved_issues or []),
        "change_summary": [*template.change_summary, f"토론 선택안: {selected.proposal_id}"],
    })


def _assert_search_plan_safe(search: CandidateSearchOutput, job: WorkflowJob) -> None:
    allowed_relaxations = set(job.candidate_search.allowed_relaxations)
    unsafe_terms = (
        "allergy", "allergen", "health", "safety", "accessibility", "wheelchair",
        "mandatory", "hard constraint", "\uc54c\ub808\ub974\uae30", "\uac74\uac15", "\uc548\uc804",
        "\uc811\uadfc\uc131", "\ud720\uccb4\uc5b4", "\uc720\ubaa8\ucc28", "\ud544\uc218", "\uc808\ub300 \uc870\uac74",
    )
    for plan in search.query_plans:
        if not set(plan.relaxation_changes) <= allowed_relaxations:
            raise RuntimeError("Candidate Search가 허용되지 않은 완화 조건을 제안했습니다.")
        if any(
            term in change.casefold()
            for change in plan.relaxation_changes
            for term in unsafe_terms
        ):
            raise RuntimeError("Candidate Search가 안전·필수 조건 완화를 제안했습니다.")
        if any(
            key not in plan.filters or plan.filters[key] != value
            for key, value in job.candidate_search.canonical_constraints.items()
        ):
            raise RuntimeError("Candidate Search가 canonical constraint filter를 누락하거나 변경했습니다.")


def _assert_supervisor_output(
    output: DebateSupervisorOutput,
    source: DebateSupervisorInput,
) -> None:
    participant_ids = {vote.participant_id for vote in source.votes}
    proposal_ids = {vote.proposal_id for vote in source.votes}
    if not set(output.target_participant_ids) <= participant_ids:
        raise RuntimeError("Supervisor가 입력에 없는 participantId를 참조했습니다.")
    if set(output.referenced_proposal_ids) != proposal_ids:
        raise RuntimeError("Supervisor의 referencedProposalIds가 실제 투표 대상과 다릅니다.")
    if output.next_action == "WAIT_FOR_USER" and source.watcher_verdict.verdict != "BLOCK":
        has_authority_reason = any(
            vote.decision == "USER_CONFIRMATION_REQUIRED"
            or (
                vote.decision == "OPPOSE"
                and vote.reason_code in {
                    "PROTECTED_OBJECTIVE", "MIN_SATISFACTION", "FIVE_POINT_PREFERENCE",
                }
            )
            for vote in source.votes
        )
        if not has_authority_reason:
            raise RuntimeError("Supervisor가 사용자 권한 사유 없이 WAIT_FOR_USER를 요청했습니다.")
    if output.next_action == "BLOCK" and source.watcher_verdict.verdict != "BLOCK":
        if not any(
            vote.decision == "OPPOSE" and vote.reason_code == "HARD_CONSTRAINT"
            for vote in source.votes
        ):
            raise RuntimeError("Supervisor가 차단 사유 없이 BLOCK을 요청했습니다.")


def _assert_final_output(final: ResultFinalizerOutput, source: ResultFinalizerInput) -> None:
    _assert_output_evidence(final, _input_evidence_ids(source))
    if final.status == "BLOCKED":
        raise RuntimeError("검증된 계획의 Finalizer가 BLOCKED를 반환했습니다.")
    if final.selected_proposal_id != source.selected_plan.proposal_id:
        raise RuntimeError("Finalizer selectedProposalId가 토론 선택안과 다릅니다.")
    allowed_candidates = set(source.selected_plan.candidate_ids)
    returned_candidates = {
        candidate_id for item in final.itinerary for candidate_id in item.candidate_ids
    }
    if returned_candidates != allowed_candidates:
        raise RuntimeError("Finalizer itinerary candidate ID가 선택 계획과 정확히 일치하지 않습니다.")
    expected_satisfaction = source.selected_plan.participant_satisfaction_bp
    returned_outcomes = {item.participant_id: item.satisfaction_bp for item in final.participant_outcomes}
    if returned_outcomes != expected_satisfaction:
        raise RuntimeError("Finalizer 참가자 결과가 선택 계획의 만족도와 다릅니다.")
    if not set(final.evidence_ids) <= set(source.selected_plan.evidence_ids):
        raise RuntimeError("Finalizer가 선택 계획에 없는 evidence ID를 출력했습니다.")


def _dump(value: BaseModel) -> dict[str, Any]:
    return value.model_dump(mode="json", by_alias=True)


def _input_evidence_ids(value: BaseModel) -> set[str]:
    return set(_collect_evidence_ids(value.model_dump(mode="json", by_alias=True)))


def _assert_output_evidence(value: BaseModel, allowed: set[str]) -> None:
    unexpected = set(_collect_evidence_ids(_dump(value))) - allowed
    if unexpected:
        raise RuntimeError("Agent 출력이 입력에 없는 evidence ID를 참조했습니다.")


def _collect_evidence_ids(value: Any) -> list[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if key in {"evidenceId", "evidenceIds"}:
                if isinstance(child, str):
                    found.add(child)
                elif isinstance(child, list):
                    found.update(item for item in child if isinstance(item, str))
            found.update(_collect_evidence_ids(child))
    elif isinstance(value, list):
        for child in value:
            found.update(_collect_evidence_ids(child))
    return sorted(found)


def _unique_evidence(proxy_inputs: list[Any]) -> list[Any]:
    by_id = {}
    for source in proxy_inputs:
        for evidence in source.evidence:
            by_id[evidence.evidence_id] = evidence
    return list(by_id.values())
