"""Worker Job과 상태 계약."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from moa_agents.models import (
    CandidateSearchInput, DebateAction, MechanicalChecks, ParticipantProxyInput,
    ResultFinalizerInput, Rule, StrictModel,
)


WorkflowStatus = Literal["QUEUED", "RUNNING", "AWAITING_USER", "SUCCEEDED", "BLOCKED", "FAILED"]


class WorkflowJob(StrictModel):
    job_id: str = Field(min_length=1)
    candidate_search: CandidateSearchInput
    participant_proxies: list[ParticipantProxyInput] = Field(min_length=1)
    mechanical_checks: MechanicalChecks
    rule_pack_version: str = "v1"
    rules: list[Rule] = [
        Rule(rule_id="rule.hard-constraint", description="필수조건 실패는 반대를 요구한다."),
        Rule(rule_id="rule.protected-objective", description="보호 목적 변경은 사용자 확인이 필요하다."),
        Rule(rule_id="rule.preference-score", description="검증된 만족도로 수용성을 설명한다."),
    ]
    legal_moves: list[DebateAction] = [
        "REQUEST_REBUTTAL", "PROPOSE_COMPROMISE", "CALL_VOTE", "END_DEBATE", "WAIT_FOR_USER", "BLOCK",
    ]
    max_iterations: int = Field(default=3, ge=1, le=3)
    finalizer: ResultFinalizerInput

    @model_validator(mode="after")
    def validate_single_workflow_boundary(self) -> "WorkflowJob":
        trip_id = self.candidate_search.trip_id
        version = self.candidate_search.plan_version
        if any(item.trip_id != trip_id or item.plan_version != version for item in self.participant_proxies):
            raise ValueError("모든 Agent 입력은 같은 tripId와 planVersion이어야 합니다.")
        first = self.participant_proxies[0]
        if any(item.debate_issue_id != first.debate_issue_id or item.category != first.category for item in self.participant_proxies):
            raise ValueError("한 Job에는 하나의 debate issue와 category만 허용됩니다.")
        if self.finalizer.trip_id != trip_id or self.finalizer.plan_version != version:
            raise ValueError("Finalizer 입력의 tripId와 planVersion이 일치하지 않습니다.")
        allowed = {option.proposal_id for option in first.options}
        if self.finalizer.selected_plan.proposal_id not in allowed:
            raise ValueError("Finalizer selected plan은 토론 후보 중 하나여야 합니다.")
        if not self.finalizer.selected_plan.hard_constraints_satisfied:
            raise ValueError("필수조건을 통과하지 못한 계획은 Finalizer에 전달할 수 없습니다.")
        if self.finalizer.selected_plan.validation_status != "VERIFIED":
            raise ValueError("VERIFIED 계획만 Finalizer에 전달할 수 있습니다.")
        return self


class ResumeRequest(StrictModel):
    approved: bool
    user_note: str = ""


class WorkflowRecord(StrictModel):
    job_id: str
    status: WorkflowStatus
    result: dict[str, object] | None = None
    pending_action: dict[str, object] | None = None
    error: dict[str, object] | None = None
