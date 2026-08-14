"""Agent 간에 전달되는 strict Pydantic 계약."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

AgentRole = Literal[
    "PARTICIPANT_PROXY",
    "DEBATE_SUPERVISOR",
    "CATEGORY_WATCHER",
    "CANDIDATE_SEARCH",
    "LOGIC_AUDITOR",
    "RESULT_FINALIZER",
]
Category = Literal["flight", "transport", "accommodation", "activity", "dining", "scheduler", "budget"]
Importance = Literal[1, 3, 5]
JsonScalar = str | int | float | bool | None


def _to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class StrictModel(BaseModel):
    """Python에서는 snake_case, TypeScript/JSON 경계에서는 camelCase를 사용한다."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        alias_generator=_to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
    )


class AgentInputMeta(StrictModel):
    trip_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    plan_version: int = Field(ge=0)


class EvidenceRef(StrictModel):
    evidence_id: str = Field(min_length=1)
    fact_summary: str = Field(min_length=1)
    verification_status: Literal["VERIFIED", "UNVERIFIED", "STALE", "CONTRADICTED"]
    authority_tier: int = Field(ge=0, le=3)
    valid_until: datetime | None

    @model_validator(mode="after")
    def verified_evidence_has_expiry(self) -> Self:
        if self.verification_status == "VERIFIED" and self.valid_until is None:
            raise ValueError("VERIFIED evidence must include validUntil.")
        return self


class CandidateCard(StrictModel):
    candidate_id: str = Field(min_length=1)
    category: Category
    headline: str = Field(min_length=1)
    attributes: dict[str, JsonScalar]
    evidence_ids: list[str]
    confidence: Literal["HIGH", "MEDIUM", "LOW", "UNKNOWN"]
    disqualified: bool
    disqualify_reason: str | None

    @model_validator(mode="after")
    def disqualification_is_explained(self) -> Self:
        if self.disqualified and not self.disqualify_reason:
            raise ValueError("A disqualified candidate must include disqualifyReason.")
        if not self.disqualified and self.disqualify_reason is not None:
            raise ValueError("A qualified candidate cannot include disqualifyReason.")
        return self


class Preference(StrictModel):
    preference_id: str = Field(min_length=1)
    category: Category
    importance: Importance
    rank_within_tier: int = Field(gt=0)
    statement: str = Field(min_length=1)


class PlanOption(StrictModel):
    proposal_id: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    candidate_ids: list[str] = Field(min_length=1)
    participant_satisfaction_bp: dict[str, Annotated[int, Field(ge=0, le=10_000)]] = Field(min_length=1)
    hard_constraints_satisfied: bool
    protected_objective_ids_satisfied: list[str]
    cost_amount: float = Field(ge=0)
    currency: str = Field(min_length=3, max_length=3)
    daily_travel_minutes: int = Field(ge=0)
    evidence_ids: list[str] = Field(min_length=1)
    validation_status: Literal["VERIFIED", "PARTIAL", "INVALID"]

    @model_validator(mode="after")
    def verified_plan_is_executable(self) -> Self:
        if self.validation_status == "VERIFIED" and not self.hard_constraints_satisfied:
            raise ValueError("A VERIFIED plan must satisfy hard constraints.")
        if len(set(self.candidate_ids)) != len(self.candidate_ids):
            raise ValueError("candidateIds must be unique within a plan.")
        if len(set(self.evidence_ids)) != len(self.evidence_ids):
            raise ValueError("evidenceIds must be unique within a plan.")
        return self


class ProofArgument(StrictModel):
    argument_id: str = Field(min_length=1)
    actor_agent_run_id: str = Field(min_length=1)
    premise_fact_ids: list[str] = Field(min_length=1)
    rule_id: str = Field(min_length=1)
    claimed_participant_id: str = Field(min_length=1)
    claimed_proposal_id: str = Field(min_length=1)
    claimed_decision: Literal["SUPPORT", "ACCEPTABLE", "OPPOSE", "USER_CONFIRMATION_REQUIRED"]
    conclusion: str = Field(min_length=1)
    evidence_ids: list[str]


IssueCode = Literal[
    "NONE",
    "MISSING_FACT",
    "MISSING_EVIDENCE",
    "STALE_EVIDENCE",
    "CONTRADICTED_EVIDENCE",
    "UNKNOWN_RULE",
    "CONCLUSION_NOT_DERIVED",
]


class ProofReview(StrictModel):
    argument_id: str
    verdict: Literal["VALID", "INVALID", "NEEDS_EVIDENCE"]
    issue_codes: list[IssueCode]
    explanation: str

    @model_validator(mode="after")
    def verdict_and_issues_are_consistent(self) -> Self:
        if self.verdict == "VALID" and self.issue_codes != ["NONE"]:
            raise ValueError("A VALID review must use issueCodes [NONE].")
        if self.verdict != "VALID" and (not self.issue_codes or "NONE" in self.issue_codes):
            raise ValueError("A non-VALID review requires non-NONE issue codes.")
        return self


class ProxyParticipant(StrictModel):
    participant_id: str
    goal_mode: Literal["TRAVEL_IS_GOAL", "CONTENT_IS_GOAL"]
    protected_objective_ids: list[str] = Field(max_length=2)
    preferences: list[Preference]
    hard_constraint_summaries: list[str]
    current_satisfaction_bp: Annotated[int, Field(ge=0, le=10_000)] | None


class ParticipantProxyInput(AgentInputMeta):
    debate_issue_id: str
    category: Category
    iteration: int = Field(ge=0, le=3)
    participant: ProxyParticipant
    options: list[PlanOption] = Field(min_length=1)
    evidence: list[EvidenceRef]


class ProxyVote(StrictModel):
    participant_id: str
    proposal_id: str
    decision: Literal["SUPPORT", "ACCEPTABLE", "OPPOSE", "USER_CONFIRMATION_REQUIRED"]
    reason_code: Literal[
        "NONE",
        "HARD_CONSTRAINT",
        "PROTECTED_OBJECTIVE",
        "MIN_SATISFACTION",
        "FIVE_POINT_PREFERENCE",
        "SOFT_PREFERENCE",
        "ALTERNATIVE_PREFERENCE",
    ]
    affected_preference_ids: list[str]
    evidence_ids: list[str]
    explanation: str

    @model_validator(mode="after")
    def decision_and_reason_are_consistent(self) -> Self:
        accepting = self.decision in {"SUPPORT", "ACCEPTABLE"}
        if accepting and self.reason_code != "NONE":
            raise ValueError("An accepting vote must use reasonCode NONE.")
        if not accepting and self.reason_code == "NONE":
            raise ValueError("An opposing or confirmation vote requires a reasonCode.")
        if self.decision == "USER_CONFIRMATION_REQUIRED" and self.reason_code not in {
            "PROTECTED_OBJECTIVE", "MIN_SATISFACTION", "FIVE_POINT_PREFERENCE",
        }:
            raise ValueError("USER_CONFIRMATION_REQUIRED requires a protected reason.")
        return self


class Concession(StrictModel):
    allowed: bool
    preference_ids: list[str]
    condition: str | None


class ParticipantProxyOutput(StrictModel):
    role: Literal["PARTICIPANT_PROXY"]
    vote: ProxyVote
    preferred_proposal_id: str
    concession: Concession
    argument: ProofArgument

    @model_validator(mode="after")
    def preferred_proposal_matches_vote(self) -> Self:
        if self.preferred_proposal_id != self.vote.proposal_id:
            raise ValueError("preferredProposalId must match vote.proposalId.")
        accepting = self.vote.decision in {"SUPPORT", "ACCEPTABLE"}
        if self.concession.allowed != accepting:
            raise ValueError("concession.allowed must match whether the vote accepts the proposal.")
        if (
            self.argument.claimed_participant_id != self.vote.participant_id
            or self.argument.claimed_proposal_id != self.vote.proposal_id
            or self.argument.claimed_decision != self.vote.decision
        ):
            raise ValueError("The structured argument claim must match the vote.")
        return self


class CandidateSearchInput(AgentInputMeta):
    category: Category
    unresolved_free_text: list[str]
    shortage_reason: Literal["NO_CANDIDATES", "ALL_DISQUALIFIED", "LOW_CONFIDENCE", "UNSTRUCTURED_REQUEST"]
    canonical_constraints: dict[str, str | int | float | bool]
    allowed_relaxations: list[str]
    current_candidates: list[CandidateCard]


class SearchQueryPlan(StrictModel):
    query_id: str
    keywords: list[str] = Field(min_length=1)
    filters: dict[str, str | int | float | bool]
    relaxation_changes: list[str]
    rationale: str


class CandidateSearchOutput(StrictModel):
    role: Literal["CANDIDATE_SEARCH"]
    status: Literal["QUERY_PLAN_PROPOSED", "NO_SAFE_QUERY"]
    query_plans: list[SearchQueryPlan]
    warning: str | None

    @model_validator(mode="after")
    def status_matches_query_plans(self) -> Self:
        if self.status == "QUERY_PLAN_PROPOSED" and not self.query_plans:
            raise ValueError("QUERY_PLAN_PROPOSED requires at least one query plan.")
        if self.status == "NO_SAFE_QUERY" and self.query_plans:
            raise ValueError("NO_SAFE_QUERY cannot include query plans.")
        if self.status == "NO_SAFE_QUERY" and not self.warning:
            raise ValueError("NO_SAFE_QUERY requires a warning.")
        return self


class Fact(StrictModel):
    fact_id: str
    statement: str
    evidence_ids: list[str]


class Rule(StrictModel):
    rule_id: str
    description: str


class LogicAuditorInput(AgentInputMeta):
    arguments: list[ProofArgument] = Field(min_length=1)
    facts: list[Fact]
    rules: list[Rule]
    evidence: list[EvidenceRef]
    expected_votes: list[ProxyVote] = Field(min_length=1)


class LogicAuditorOutput(StrictModel):
    role: Literal["LOGIC_AUDITOR"]
    reviews: list[ProofReview] = Field(min_length=1)
    accepted_argument_ids: list[str]
    rejected_argument_ids: list[str]
    requested_evidence_ids: list[str]

    @model_validator(mode="after")
    def review_indexes_are_consistent(self) -> Self:
        ids = [review.argument_id for review in self.reviews]
        if len(ids) != len(set(ids)):
            raise ValueError("Logic Auditor reviews must have unique argumentIds.")
        accepted = {review.argument_id for review in self.reviews if review.verdict == "VALID"}
        rejected = {review.argument_id for review in self.reviews if review.verdict == "INVALID"}
        if set(self.accepted_argument_ids) != accepted:
            raise ValueError("acceptedArgumentIds must match VALID reviews.")
        if set(self.rejected_argument_ids) != rejected:
            raise ValueError("rejectedArgumentIds must match INVALID reviews.")
        return self


class MechanicalChecks(StrictModel):
    hard_constraint_failures: list[str]
    budget_valid: bool
    schedule_valid: bool
    evidence_coverage_bp: int = Field(ge=0, le=10_000)


class CategoryWatcherInput(AgentInputMeta):
    category: Category
    rule_pack_version: str
    options: list[PlanOption] = Field(min_length=1)
    proof_reviews: list[ProofReview]
    mechanical_checks: MechanicalChecks


WatcherReasonCode = Literal["NONE", "HARD_CONSTRAINT", "BUDGET", "SCHEDULE", "EVIDENCE", "INVALID_ARGUMENT"]


class CategoryWatcherOutput(StrictModel):
    role: Literal["CATEGORY_WATCHER"]
    verdict: Literal["PASS", "REVISE", "BLOCK"]
    affected_proposal_ids: list[str]
    reason_codes: list[WatcherReasonCode]
    requested_changes: list[str]
    evidence_ids: list[str]
    explanation: str

    @model_validator(mode="after")
    def verdict_and_reasons_are_consistent(self) -> Self:
        if self.verdict == "PASS":
            if self.reason_codes != ["NONE"] or self.affected_proposal_ids or self.requested_changes:
                raise ValueError("PASS cannot include affected proposals or requested changes.")
        elif not self.reason_codes or "NONE" in self.reason_codes:
            raise ValueError("REVISE/BLOCK requires non-NONE reason codes.")
        return self


DebateAction = Literal[
    "REQUEST_POSITION",
    "REQUEST_REBUTTAL",
    "PROPOSE_COMPROMISE",
    "CALL_VOTE",
    "END_DEBATE",
    "WAIT_FOR_USER",
    "BLOCK",
]


class DebateSupervisorInput(AgentInputMeta):
    debate_issue_id: str
    category: Category
    iteration: int = Field(ge=0, le=3)
    max_iterations: int = Field(ge=1, le=3)
    options: list[PlanOption] = Field(min_length=1)
    votes: list[ProxyVote] = Field(min_length=1)
    watcher_verdict: CategoryWatcherOutput
    legal_moves: list[DebateAction]


class DebateSupervisorOutput(StrictModel):
    role: Literal["DEBATE_SUPERVISOR"]
    next_action: DebateAction
    target_participant_ids: list[str]
    referenced_proposal_ids: list[str]
    reason_code: Literal[
        "CONSENSUS", "OPPOSITION_REMAINS", "USER_AUTHORITY_REQUIRED", "WATCHER_BLOCK", "ITERATION_LIMIT"
    ]
    rationale: str

    @model_validator(mode="after")
    def action_and_reason_are_consistent(self) -> Self:
        expected_actions = {
            "CONSENSUS": {"END_DEBATE"},
            "USER_AUTHORITY_REQUIRED": {"WAIT_FOR_USER"},
            "WATCHER_BLOCK": {"BLOCK"},
            "OPPOSITION_REMAINS": {"REQUEST_REBUTTAL", "PROPOSE_COMPROMISE", "CALL_VOTE"},
            "ITERATION_LIMIT": {"END_DEBATE", "WAIT_FOR_USER", "BLOCK"},
        }
        if self.next_action not in expected_actions[self.reason_code]:
            raise ValueError("Supervisor nextAction is inconsistent with reasonCode.")
        return self


class ItineraryInputItem(StrictModel):
    day: int = Field(gt=0)
    title: str
    candidate_ids: list[str]
    note: str


class ParticipantSummary(StrictModel):
    participant_id: str
    satisfaction_bp: int = Field(ge=0, le=10_000)
    fulfilled_preference_ids: list[str]
    concession_summary: str | None


class ResultFinalizerInput(AgentInputMeta):
    selected_plan: PlanOption
    itinerary: list[ItineraryInputItem] = Field(min_length=1)
    participant_summaries: list[ParticipantSummary]
    evidence: list[EvidenceRef]
    unresolved_issues: list[str]
    previous_plan_version: int | None = Field(ge=0)
    change_summary: list[str]

    @model_validator(mode="after")
    def references_belong_to_selected_plan(self) -> Self:
        allowed_candidates = set(self.selected_plan.candidate_ids)
        itinerary_candidates = {
            candidate_id for item in self.itinerary for candidate_id in item.candidate_ids
        }
        if itinerary_candidates != allowed_candidates:
            raise ValueError("Itinerary candidateIds must match selectedPlan candidates exactly.")
        participants = set(self.selected_plan.participant_satisfaction_bp)
        summary_ids = [item.participant_id for item in self.participant_summaries]
        if len(summary_ids) != len(set(summary_ids)) or set(summary_ids) != participants:
            raise ValueError("Participant summaries must match selectedPlan participants exactly.")
        summary_scores = {
            item.participant_id: item.satisfaction_bp for item in self.participant_summaries
        }
        if summary_scores != self.selected_plan.participant_satisfaction_bp:
            raise ValueError("Participant summary scores must match selectedPlan satisfaction scores.")
        evidence_ids = [item.evidence_id for item in self.evidence]
        if len(evidence_ids) != len(set(evidence_ids)):
            raise ValueError("Finalizer evidenceIds must be unique.")
        evidence_by_id = {item.evidence_id: item for item in self.evidence}
        if not set(self.selected_plan.evidence_ids) <= set(evidence_ids):
            raise ValueError("Selected plan evidenceIds must exist in input evidence.")
        if any(
            evidence_by_id[evidence_id].verification_status != "VERIFIED"
            for evidence_id in self.selected_plan.evidence_ids
        ):
            raise ValueError("Selected plan evidence must be VERIFIED.")
        return self


class ItineraryOutputItem(StrictModel):
    day: int
    title: str
    candidate_ids: list[str] = Field(min_length=1)
    explanation: str


class ParticipantOutcome(StrictModel):
    participant_id: str
    satisfaction_bp: int
    summary: str


class ResultFinalizerOutput(StrictModel):
    role: Literal["RESULT_FINALIZER"]
    status: Literal["READY", "READY_WITH_WARNINGS", "BLOCKED"]
    overview: str
    selected_proposal_id: str
    itinerary: list[ItineraryOutputItem] = Field(min_length=1)
    participant_outcomes: list[ParticipantOutcome] = Field(min_length=1)
    warnings: list[str]
    next_actions: list[str]
    evidence_ids: list[str]

    @model_validator(mode="after")
    def status_and_warnings_are_consistent(self) -> Self:
        if self.status == "READY" and self.warnings:
            raise ValueError("READY output cannot contain warnings.")
        if self.status == "READY_WITH_WARNINGS" and not self.warnings:
            raise ValueError("READY_WITH_WARNINGS output requires warnings.")
        if len({item.participant_id for item in self.participant_outcomes}) != len(self.participant_outcomes):
            raise ValueError("participantOutcomes must contain unique participantIds.")
        return self


InputModel = (
    ParticipantProxyInput
    | CandidateSearchInput
    | LogicAuditorInput
    | CategoryWatcherInput
    | DebateSupervisorInput
    | ResultFinalizerInput
)
OutputModel = (
    ParticipantProxyOutput
    | CandidateSearchOutput
    | LogicAuditorOutput
    | CategoryWatcherOutput
    | DebateSupervisorOutput
    | ResultFinalizerOutput
)
ModelType = type[BaseModel]
JsonObject = dict[str, Any]
