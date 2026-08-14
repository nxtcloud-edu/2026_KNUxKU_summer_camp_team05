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
        if self.candidate_search.category != first.category:
            raise ValueError("Candidate Search와 토론 category가 일치해야 합니다.")
        if any(item.debate_issue_id != first.debate_issue_id or item.category != first.category for item in self.participant_proxies):
            raise ValueError("한 Job에는 하나의 debate issue와 category만 허용됩니다.")
        participant_ids = [item.participant.participant_id for item in self.participant_proxies]
        if len(participant_ids) != len(set(participant_ids)):
            raise ValueError("participantProxies에는 중복 participantId를 사용할 수 없습니다.")
        canonical_options = [item.model_dump(mode="json") for item in first.options]
        if any(
            [option.model_dump(mode="json") for option in item.options] != canonical_options
            for item in self.participant_proxies[1:]
        ):
            raise ValueError("모든 Participant Proxy는 동일한 계획안 집합을 평가해야 합니다.")
        proposal_ids = [option.proposal_id for option in first.options]
        if len(proposal_ids) != len(set(proposal_ids)):
            raise ValueError("계획안 proposalId는 Job 안에서 중복될 수 없습니다.")
        participant_set = set(participant_ids)
        if any(set(option.participant_satisfaction_bp) != participant_set for option in first.options):
            raise ValueError("모든 계획안은 참가자 전원의 만족도를 포함해야 합니다.")
        if not {"END_DEBATE", "WAIT_FOR_USER", "BLOCK"} <= set(self.legal_moves):
            raise ValueError("legalMoves에는 END_DEBATE, WAIT_FOR_USER, BLOCK이 필요합니다.")
        if len({rule.rule_id for rule in self.rules}) != len(self.rules):
            raise ValueError("ruleId는 Job 안에서 중복될 수 없습니다.")
        evidence_by_id = {}
        for source in self.participant_proxies:
            source_ids = [evidence.evidence_id for evidence in source.evidence]
            if len(source_ids) != len(set(source_ids)):
                raise ValueError("한 Participant Proxy 입력에서 evidenceId를 중복할 수 없습니다.")
            for evidence in source.evidence:
                existing = evidence_by_id.get(evidence.evidence_id)
                if existing is not None and existing != evidence:
                    raise ValueError("동일 evidenceId는 모든 Agent 입력에서 같은 내용을 가져야 합니다.")
                evidence_by_id[evidence.evidence_id] = evidence
        for evidence in self.finalizer.evidence:
            existing = evidence_by_id.get(evidence.evidence_id)
            if existing is not None and existing != evidence:
                raise ValueError("동일 evidenceId는 Finalizer 입력에서도 같은 내용을 가져야 합니다.")
            evidence_by_id[evidence.evidence_id] = evidence
        if self.finalizer.trip_id != trip_id or self.finalizer.plan_version != version:
            raise ValueError("Finalizer 입력의 tripId와 planVersion이 일치하지 않습니다.")
        allowed = {option.proposal_id for option in first.options}
        if self.finalizer.selected_plan.proposal_id not in allowed:
            raise ValueError("Finalizer selected plan은 토론 후보 중 하나여야 합니다.")
        if not self.finalizer.selected_plan.hard_constraints_satisfied:
            raise ValueError("필수조건을 통과하지 못한 계획은 Finalizer에 전달할 수 없습니다.")
        if self.finalizer.selected_plan.validation_status != "VERIFIED":
            raise ValueError("VERIFIED 계획만 Finalizer에 전달할 수 있습니다.")
        canonical_selected = next(
            option for option in first.options
            if option.proposal_id == self.finalizer.selected_plan.proposal_id
        )
        if canonical_selected != self.finalizer.selected_plan:
            raise ValueError("Finalizer selectedPlan은 토론 계획안의 전체 내용과 일치해야 합니다.")
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
