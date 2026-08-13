"""Agent 간에 전달되는 strict Pydantic 계약."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

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


class CandidateCard(StrictModel):
    candidate_id: str = Field(min_length=1)
    category: Category
    headline: str = Field(min_length=1)
    attributes: dict[str, JsonScalar]
    evidence_ids: list[str]
    confidence: Literal["HIGH", "MEDIUM", "LOW", "UNKNOWN"]
    disqualified: bool
    disqualify_reason: str | None


class Preference(StrictModel):
    preference_id: str = Field(min_length=1)
    category: Category
    importance: Importance
    rank_within_tier: int = Field(gt=0)
    statement: str = Field(min_length=1)


class PlanOption(StrictModel):
    proposal_id: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    candidate_ids: list[str]
    participant_satisfaction_bp: dict[str, Annotated[int, Field(ge=0, le=10_000)]]
    hard_constraints_satisfied: bool
    protected_objective_ids_satisfied: list[str]
    cost_amount: float = Field(ge=0)
    currency: str = Field(min_length=3, max_length=3)
    daily_travel_minutes: int = Field(ge=0)
    evidence_ids: list[str]
    validation_status: Literal["VERIFIED", "PARTIAL", "INVALID"]


class ProofArgument(StrictModel):
    argument_id: str = Field(min_length=1)
    actor_agent_run_id: str = Field(min_length=1)
    premise_fact_ids: list[str] = Field(min_length=1)
    rule_id: str = Field(min_length=1)
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


class LogicAuditorOutput(StrictModel):
    role: Literal["LOGIC_AUDITOR"]
    reviews: list[ProofReview] = Field(min_length=1)
    accepted_argument_ids: list[str]
    rejected_argument_ids: list[str]
    requested_evidence_ids: list[str]


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
    itinerary: list[ItineraryInputItem]
    participant_summaries: list[ParticipantSummary]
    evidence: list[EvidenceRef]
    unresolved_issues: list[str]
    previous_plan_version: int | None = Field(ge=0)
    change_summary: list[str]


class ItineraryOutputItem(StrictModel):
    day: int
    title: str
    candidate_ids: list[str]
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
    itinerary: list[ItineraryOutputItem]
    participant_outcomes: list[ParticipantOutcome]
    warnings: list[str]
    next_actions: list[str]
    evidence_ids: list[str]


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
