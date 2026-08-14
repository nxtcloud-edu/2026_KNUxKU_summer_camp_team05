from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from enum import StrEnum
from types import MappingProxyType
from typing import TypeVar
from collections.abc import Mapping


class AgentContractError(ValueError):
    pass


class Category(StrEnum):
    LONG_DISTANCE = "long_distance"
    STAY = "stay"
    ACTIVITY = "activity"
    DINING = "dining"
    SCHEDULE = "schedule"


class VerificationStatus(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    UNKNOWN = "UNKNOWN"
    STALE = "STALE"
    CONTRADICTED = "CONTRADICTED"


class Stance(StrEnum):
    SUPPORT = "support"
    CONDITIONAL = "conditional"
    OPPOSE = "oppose"


class ArbiterOutcome(StrEnum):
    CONCLUDED = "CONCLUDED"
    CONTINUE = "CONTINUE"
    NO_SAFE_DECISION = "NO_SAFE_DECISION"


class GuardStatus(StrEnum):
    CLEAR = "CLEAR"
    RECHECK = "RECHECK"
    HOLD = "HOLD"


class FindingSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


K = TypeVar("K")
V = TypeVar("V")


def frozen_mapping(values: Mapping[K, V]) -> Mapping[K, V]:
    return MappingProxyType(dict(values))


def _require_unique(label: str, values: tuple[str, ...]) -> None:
    if len(values) != len(set(values)):
        raise AgentContractError(f"{label} contains duplicate values")


@dataclass(frozen=True, slots=True)
class ProfileFact:
    fact_id: str
    statement: str
    importance: int = 3
    hard: bool = False

    def __post_init__(self) -> None:
        if not self.fact_id or not self.statement:
            raise AgentContractError("profile facts require an id and statement")
        if self.importance not in {1, 3, 5}:
            raise AgentContractError("profile fact importance must be 1, 3, or 5")


@dataclass(frozen=True, slots=True)
class UserProfileView:
    user_id: str
    facts: tuple[ProfileFact, ...]

    def __post_init__(self) -> None:
        if not self.user_id:
            raise AgentContractError("profile view requires user_id")
        object.__setattr__(self, "facts", tuple(self.facts))
        _require_unique("profile fact ids", tuple(fact.fact_id for fact in self.facts))

    @property
    def fact_ids(self) -> frozenset[str]:
        return frozenset(fact.fact_id for fact in self.facts)


@dataclass(frozen=True, slots=True)
class TripCharter:
    version: str
    destination: str
    start_date: date
    end_date: date
    participants: tuple[str, ...]
    party_size: int
    pace: str
    budget_max_by_user: Mapping[str, Decimal]

    def __post_init__(self) -> None:
        object.__setattr__(self, "participants", tuple(self.participants))
        object.__setattr__(
            self,
            "budget_max_by_user",
            frozen_mapping(
                {user_id: Decimal(str(amount)) for user_id, amount in self.budget_max_by_user.items()}
            ),
        )
        if not self.version or not self.destination:
            raise AgentContractError("trip charter requires version and destination")
        _require_unique("participants", self.participants)
        if self.party_size != len(self.participants) or self.party_size <= 0:
            raise AgentContractError("party_size must equal the number of participants")
        if set(self.budget_max_by_user) != set(self.participants):
            raise AgentContractError("budget maxima must exist for every participant and nobody else")
        if self.end_date <= self.start_date:
            raise AgentContractError("end_date must be after start_date")


@dataclass(frozen=True, slots=True)
class CapacityAllocation:
    resource_unit_id: str
    confirmed_capacity: int
    assigned_user_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "assigned_user_ids", tuple(self.assigned_user_ids))
        if not self.resource_unit_id or self.confirmed_capacity < 0:
            raise AgentContractError("capacity allocation requires a resource and non-negative capacity")
        _require_unique("assigned users within a capacity unit", self.assigned_user_ids)


@dataclass(frozen=True, slots=True)
class CapacityPlan:
    requested_party_size: int
    confirmed_capacity: int
    allocations: tuple[CapacityAllocation, ...]
    unassigned_user_ids: tuple[str, ...] = ()
    evidence_refs: tuple[str, ...] = ()
    split_authority_ref: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "allocations", tuple(self.allocations))
        object.__setattr__(self, "unassigned_user_ids", tuple(self.unassigned_user_ids))
        object.__setattr__(self, "evidence_refs", tuple(self.evidence_refs))
        if self.requested_party_size <= 0 or self.confirmed_capacity < 0:
            raise AgentContractError("capacity plan sizes must be positive or zero as appropriate")
        _require_unique("unassigned users", self.unassigned_user_ids)

    @property
    def assigned_user_ids(self) -> tuple[str, ...]:
        return tuple(
            user_id for allocation in self.allocations for user_id in allocation.assigned_user_ids
        )


@dataclass(frozen=True, slots=True)
class CategoryProposal:
    proposal_id: str
    category: Category
    proposal_set_version: str
    summary: str
    cost_by_user: Mapping[str, Decimal]
    evidence_refs: tuple[str, ...]
    capacity_plan: CapacityPlan

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "cost_by_user",
            frozen_mapping(
                {user_id: Decimal(str(amount)) for user_id, amount in self.cost_by_user.items()}
            ),
        )
        object.__setattr__(self, "evidence_refs", tuple(self.evidence_refs))
        if not self.proposal_id or not self.proposal_set_version or not self.summary:
            raise AgentContractError("proposal requires id, version, and summary")


@dataclass(frozen=True, slots=True)
class VerificationReceipt:
    receipt_id: str
    proposal_id: str
    rule_id: str
    status: VerificationStatus
    evidence_refs: tuple[str, ...]
    explanation: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "evidence_refs", tuple(self.evidence_refs))
        if not self.receipt_id or not self.proposal_id or not self.rule_id:
            raise AgentContractError("verification receipt requires stable identifiers")


@dataclass(frozen=True, slots=True)
class ProxyBallot:
    ballot_id: str
    user_id: str
    category: Category
    proposal_set_version: str
    ranked_proposal_ids: tuple[str, ...]
    stances: Mapping[str, Stance]
    profile_fact_refs: tuple[str, ...]
    conditional_terms: tuple[str, ...]
    rationale: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "ranked_proposal_ids", tuple(self.ranked_proposal_ids))
        object.__setattr__(self, "stances", frozen_mapping(self.stances))
        object.__setattr__(self, "profile_fact_refs", tuple(self.profile_fact_refs))
        object.__setattr__(self, "conditional_terms", tuple(self.conditional_terms))
        _require_unique("ranked proposal ids", self.ranked_proposal_ids)
        _require_unique("profile fact refs", self.profile_fact_refs)


@dataclass(frozen=True, slots=True)
class DeterministicSelection:
    selected_proposal_id: str | None
    satisfaction_by_proposal: Mapping[str, tuple[float, ...]] = field(default_factory=dict)
    trace: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "satisfaction_by_proposal",
            frozen_mapping(
                {
                    proposal_id: tuple(scores)
                    for proposal_id, scores in self.satisfaction_by_proposal.items()
                }
            ),
        )
        object.__setattr__(self, "trace", tuple(self.trace))


@dataclass(frozen=True, slots=True)
class CategoryDecisionDraft:
    arbiter_name: str
    category: Category
    charter_version: str
    proposal_set_version: str
    outcome: ArbiterOutcome
    selected_proposal_id: str | None
    rejected_proposal_ids: tuple[str, ...]
    ballot_ids: tuple[str, ...]
    required_receipt_rule_ids: tuple[str, ...]
    summary: str
    unresolved_issues: tuple[str, ...]
    obligations_for_next_category: tuple[str, ...]
    block_reason: str | None = None


@dataclass(frozen=True, slots=True)
class SupervisorFinding:
    code: str
    severity: FindingSeverity
    message: str
    refs: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class SupervisorReport:
    guard_status: GuardStatus
    observed_selected_proposal_id: str | None
    findings: tuple[SupervisorFinding, ...]
    recheck_targets: tuple[str, ...]
    summary: str


@dataclass(frozen=True, slots=True)
class CategoryRunResult:
    ballots: tuple[ProxyBallot, ...]
    draft: CategoryDecisionDraft
    supervisor_report: SupervisorReport
