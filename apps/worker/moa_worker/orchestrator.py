"""LLM에게 권한을 넘기지 않는 결정론적 Agent workflow 상태 머신."""

from __future__ import annotations

import asyncio
from typing import Any

from pydantic import BaseModel

from moa_agents.models import (
    CategoryWatcherInput, CategoryWatcherOutput, DebateSupervisorInput,
    DebateSupervisorOutput, Fact, LogicAuditorInput, LogicAuditorOutput,
    ParticipantProxyOutput, ResultFinalizerOutput,
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
                final = await require_agent_output(self.runtime, AgentRunRequest("RESULT_FINALIZER", job.finalizer))
                assert isinstance(final, ResultFinalizerOutput)
                _assert_output_evidence(final, _input_evidence_ids(job.finalizer))
                result = dict(current.result or {})
                result["userApproval"] = {"approved": True, "note": decision.user_note}
                result["final"] = final.model_dump(mode="json", by_alias=True)
                return self.store.transition(job_id, "SUCCEEDED", result=result)
            except Exception as error:
                return self.store.transition(job_id, "FAILED", result=current.result, error={
                    "code": "FINALIZATION_FAILED", "safeMessage": str(error),
                })

    async def _run_debate(self, job: WorkflowJob) -> dict[str, object]:
        search = await require_agent_output(self.runtime, AgentRunRequest("CANDIDATE_SEARCH", job.candidate_search))
        history: list[dict[str, object]] = []
        first = job.participant_proxies[0]

        for iteration in range(job.max_iterations):
            proxy_inputs = [
                item.model_copy(update={
                    "iteration": iteration,
                    "run_id": item.run_id if iteration == 0 else f"{item.run_id}.i{iteration}",
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
            )
            audit = await require_agent_output(self.runtime, AgentRunRequest("LOGIC_AUDITOR", audit_input))
            assert isinstance(audit, LogicAuditorOutput)
            _assert_output_evidence(audit, _input_evidence_ids(audit_input))

            watcher_input = CategoryWatcherInput(
                trip_id=first.trip_id,
                run_id=f"{job.job_id}.watcher.{iteration}",
                plan_version=first.plan_version,
                category=first.category,
                rule_pack_version=job.rule_pack_version,
                options=first.options,
                proof_reviews=audit.reviews,
                mechanical_checks=job.mechanical_checks,
            )
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
                options=first.options,
                votes=[item.vote for item in proxies],
                watcher_verdict=watcher,
                legal_moves=job.legal_moves,
            )
            supervisor = await require_agent_output(self.runtime, AgentRunRequest("DEBATE_SUPERVISOR", supervisor_input))
            assert isinstance(supervisor, DebateSupervisorOutput)
            if supervisor.next_action not in job.legal_moves:
                raise RuntimeError("Supervisor가 legalMoves 밖의 행동을 선택했습니다.")

            round_result: dict[str, object] = {
                "iteration": iteration,
                "proxies": [_dump(item) for item in proxies],
                "audit": _dump(audit),
                "watcher": _dump(watcher),
                "supervisor": _dump(supervisor),
            }
            history.append(round_result)
            base: dict[str, object] = {"search": _dump(search), "rounds": history}

            if supervisor.next_action == "END_DEBATE":
                if watcher.verdict != "PASS":
                    raise RuntimeError("Watcher PASS 없이 토론을 종료할 수 없습니다.")
                final = await require_agent_output(self.runtime, AgentRunRequest("RESULT_FINALIZER", job.finalizer))
                assert isinstance(final, ResultFinalizerOutput)
                _assert_output_evidence(final, _input_evidence_ids(job.finalizer))
                base.update({"workflowStatus": "SUCCEEDED", "final": _dump(final)})
                return base
            if supervisor.next_action == "WAIT_FOR_USER":
                base.update({
                    "workflowStatus": "AWAITING_USER",
                    "pendingAction": {
                        "type": "USER_CONFIRMATION_REQUIRED",
                        "reasonCode": supervisor.reason_code,
                        "rationale": supervisor.rationale,
                        "proposalIds": supervisor.referenced_proposal_ids,
                    },
                })
                return base
            if supervisor.next_action == "BLOCK" or watcher.verdict == "BLOCK":
                base.update({"workflowStatus": "BLOCKED"})
                return base

        return {"workflowStatus": "BLOCKED", "search": _dump(search), "rounds": history}


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
