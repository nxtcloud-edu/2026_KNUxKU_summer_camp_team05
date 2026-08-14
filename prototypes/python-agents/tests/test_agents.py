from __future__ import annotations

import unittest
from datetime import date
from decimal import Decimal

from moa_agents.arbitrators import (
    ArbiterContext,
    BaseCategoryArbiterAgent,
    StayArbiterAgent,
    build_category_arbiters,
)
from moa_agents.backend import ScriptedLLMBackend
from moa_agents.contracts import (
    AgentContractError,
    ArbiterOutcome,
    CapacityAllocation,
    CapacityPlan,
    Category,
    CategoryDecisionDraft,
    CategoryProposal,
    DeterministicSelection,
    GuardStatus,
    ProfileFact,
    ProxyBallot,
    Stance,
    TripCharter,
    UserProfileView,
    VerificationReceipt,
    VerificationStatus,
)
from moa_agents.proxy import (
    ProxyContext,
    ProxyProposalView,
    ProxyTripView,
    UserProxyAgent,
)
from moa_agents.runtime import run_category_draft
from moa_agents.supervisor import SupervisorContext, TripSupervisorAgent


USERS = ("u1", "u2", "u3")


def make_charter() -> TripCharter:
    return TripCharter(
        version="charter-v1",
        destination="osaka",
        start_date=date(2026, 9, 10),
        end_date=date(2026, 9, 13),
        participants=USERS,
        party_size=3,
        pace="balanced",
        budget_max_by_user={user_id: Decimal("40000") for user_id in USERS},
    )


def make_profile(user_id: str) -> UserProfileView:
    return UserProfileView(
        user_id=user_id,
        facts=(ProfileFact(f"{user_id}-fact", f"preference for {user_id}", 5),),
    )


def make_proposal(
    proposal_id: str,
    *,
    category: Category = Category.STAY,
    cost: str = "25000",
    assigned_users: tuple[str, ...] = USERS,
    unassigned_users: tuple[str, ...] = (),
    confirmed_capacity: int = 3,
    unit_capacity: int | None = None,
) -> CategoryProposal:
    evidence_ref = f"evidence:{proposal_id}"
    return CategoryProposal(
        proposal_id=proposal_id,
        category=category,
        proposal_set_version="set-v1",
        summary=f"summary for {proposal_id}",
        cost_by_user={user_id: Decimal(cost) for user_id in USERS},
        evidence_refs=(evidence_ref,),
        capacity_plan=CapacityPlan(
            requested_party_size=3,
            confirmed_capacity=confirmed_capacity,
            allocations=(
                CapacityAllocation(
                    resource_unit_id=f"unit:{proposal_id}",
                    confirmed_capacity=(
                        confirmed_capacity if unit_capacity is None else unit_capacity
                    ),
                    assigned_user_ids=assigned_users,
                ),
            ),
            unassigned_user_ids=unassigned_users,
            evidence_refs=(evidence_ref,),
        ),
    )


def make_receipts(
    proposal_id: str,
    rule_ids: tuple[str, ...],
    status: VerificationStatus = VerificationStatus.PASS,
    *,
    with_evidence: bool = True,
) -> tuple[VerificationReceipt, ...]:
    return tuple(
        VerificationReceipt(
            receipt_id=f"receipt:{proposal_id}:{rule_id}",
            proposal_id=proposal_id,
            rule_id=rule_id,
            status=status,
            evidence_refs=((f"evidence:{proposal_id}",) if with_evidence else ()),
            explanation=status.value,
        )
        for rule_id in rule_ids
    )


def make_ballot(user_id: str, ranked: tuple[str, ...]) -> ProxyBallot:
    return ProxyBallot(
        ballot_id=f"ballot:{user_id}",
        user_id=user_id,
        category=Category.STAY,
        proposal_set_version="set-v1",
        ranked_proposal_ids=ranked,
        stances={proposal_id: Stance.SUPPORT for proposal_id in ranked},
        profile_fact_refs=(f"{user_id}-fact",),
        conditional_terms=(),
        rationale="fixture",
    )


def proxy_response(user_id: str, ranked: list[str]) -> dict[str, object]:
    return {
        "rankedProposalIds": ranked,
        "stances": {proposal_id: "support" for proposal_id in ranked},
        "profileFactRefs": [f"{user_id}-fact"],
        "conditionalTerms": [],
        "rationale": "fixture rationale",
    }


class AgentDraftTests(unittest.IsolatedAsyncioTestCase):
    def test_five_arbiters_share_one_base(self) -> None:
        agents = build_category_arbiters(ScriptedLLMBackend({}))
        self.assertEqual(set(agents), set(Category))
        self.assertEqual(len(agents), 5)
        self.assertTrue(
            all(isinstance(agent, BaseCategoryArbiterAgent) for agent in agents.values())
        )

    async def test_every_arbiter_runs_shared_no_safe_path(self) -> None:
        charter = make_charter()
        agents = build_category_arbiters(ScriptedLLMBackend({}))
        for category, agent in agents.items():
            proposal = make_proposal("candidate", category=category)
            draft = await agent.decide(
                ArbiterContext(
                    charter=charter,
                    proposals=(proposal,),
                    receipts=(),
                    ballots=(),
                    selection=DeterministicSelection(None),
                )
            )
            self.assertEqual(draft.category, category)
            self.assertEqual(draft.outcome, ArbiterOutcome.NO_SAFE_DECISION)
            self.assertIsNone(draft.selected_proposal_id)

    async def test_proxy_rejects_foreign_profile_reference(self) -> None:
        proposal = make_proposal("stay-a")
        backend = ScriptedLLMBackend(
            {
                "user-proxy:u1": [
                    {
                        "rankedProposalIds": ["stay-a"],
                        "stances": {"stay-a": "support"},
                        "profileFactRefs": ["u2-fact"],
                        "conditionalTerms": [],
                        "rationale": "invalid foreign reference",
                    }
                ]
            }
        )
        proxy = UserProxyAgent(make_profile("u1"), backend)
        with self.assertRaises(AgentContractError):
            await proxy.create_ballot(
                ProxyContext(
                    ProxyTripView.from_charter(make_charter(), "u1"),
                    Category.STAY,
                    (ProxyProposalView.from_proposal(proposal, "u1"),),
                )
            )
        payload = backend.requests[0].payload
        self.assertEqual(payload["profile"]["user_id"], "u1")
        self.assertNotIn("profiles", payload)
        self.assertNotIn("u2", str(payload))
        self.assertNotIn("u3", str(payload))

    async def test_arbiter_cannot_change_deterministic_selection(self) -> None:
        backend = ScriptedLLMBackend(
            {
                "stay-arbiter": [
                    {
                        "outcome": "CONCLUDED",
                        "selectedProposalId": "stay-a",
                        "summary": "attempted mutation",
                        "unresolvedIssues": [],
                        "obligationsForNextCategory": [],
                        "blockReason": None,
                    }
                ]
            }
        )
        arbiter = StayArbiterAgent(backend)
        proposals = (make_proposal("stay-a"), make_proposal("stay-b"))
        receipts = tuple(
            item
            for proposal in proposals
            for item in make_receipts(
                proposal.proposal_id, arbiter.policy.required_receipt_rule_ids
            )
        )
        with self.assertRaises(AgentContractError):
            await arbiter.decide(
                ArbiterContext(
                    charter=make_charter(),
                    proposals=proposals,
                    receipts=receipts,
                    ballots=tuple(make_ballot(user_id, ("stay-a", "stay-b")) for user_id in USERS),
                    selection=DeterministicSelection("stay-b"),
                )
            )

    def test_capacity_overassignment_is_not_selectable(self) -> None:
        backend = ScriptedLLMBackend({})
        arbiter = StayArbiterAgent(backend)
        proposal = make_proposal(
            "stay-a",
            confirmed_capacity=3,
            unit_capacity=2,
            assigned_users=USERS,
        )
        selectable = arbiter.selectable_proposals(
            make_charter(),
            (proposal,),
            make_receipts("stay-a", arbiter.policy.required_receipt_rule_ids),
        )
        self.assertEqual(selectable, ())

    def test_pass_receipt_without_evidence_is_not_selectable(self) -> None:
        arbiter = StayArbiterAgent(ScriptedLLMBackend({}))
        proposal = make_proposal("stay-a")
        selectable = arbiter.selectable_proposals(
            make_charter(),
            (proposal,),
            make_receipts(
                "stay-a",
                arbiter.policy.required_receipt_rule_ids,
                with_evidence=False,
            ),
        )
        self.assertEqual(selectable, ())

    def test_duplicate_proposal_ids_are_rejected_at_context_boundary(self) -> None:
        proposal = make_proposal("stay-a")
        with self.assertRaises(AgentContractError):
            ArbiterContext(
                charter=make_charter(),
                proposals=(proposal, proposal),
                receipts=(),
                ballots=(),
                selection=DeterministicSelection(None),
            )

    async def test_supervisor_rechecks_proposal_set_version_mismatch(self) -> None:
        backend = ScriptedLLMBackend(
            {
                "trip-supervisor": [
                    {
                        "guardStatus": "CLEAR",
                        "observedSelectedProposalId": "stay-a",
                        "findings": [],
                        "recheckTargets": [],
                        "summary": "model tried to clear",
                    }
                ]
            }
        )
        arbiter = StayArbiterAgent(backend)
        proposal = make_proposal("stay-a")
        draft = CategoryDecisionDraft(
            arbiter_name="stay-arbiter",
            category=Category.STAY,
            charter_version="charter-v1",
            proposal_set_version="stale-set-v0",
            outcome=ArbiterOutcome.CONCLUDED,
            selected_proposal_id="stay-a",
            rejected_proposal_ids=(),
            ballot_ids=(),
            required_receipt_rule_ids=arbiter.policy.required_receipt_rule_ids,
            summary="fixture",
            unresolved_issues=(),
            obligations_for_next_category=(),
        )
        report = await TripSupervisorAgent(backend).audit(
            SupervisorContext(
                charter=make_charter(),
                draft=draft,
                proposals=(proposal,),
                receipts=make_receipts(
                    "stay-a", arbiter.policy.required_receipt_rule_ids
                ),
            )
        )
        self.assertEqual(report.guard_status, GuardStatus.RECHECK)
        self.assertIn(
            "PROPOSAL_SET_VERSION_MISMATCH",
            {finding.code for finding in report.findings},
        )

    async def test_supervisor_holds_over_budget_selection(self) -> None:
        backend = ScriptedLLMBackend(
            {
                "trip-supervisor": [
                    {
                        "guardStatus": "CLEAR",
                        "observedSelectedProposalId": "stay-a",
                        "findings": [],
                        "recheckTargets": [],
                        "summary": "model tried to clear",
                    }
                ]
            }
        )
        arbiter = StayArbiterAgent(backend)
        proposal = make_proposal("stay-a", cost="50000")
        draft = CategoryDecisionDraft(
            arbiter_name="stay-arbiter",
            category=Category.STAY,
            charter_version="charter-v1",
            proposal_set_version="set-v1",
            outcome=ArbiterOutcome.CONCLUDED,
            selected_proposal_id="stay-a",
            rejected_proposal_ids=(),
            ballot_ids=(),
            required_receipt_rule_ids=arbiter.policy.required_receipt_rule_ids,
            summary="fixture",
            unresolved_issues=(),
            obligations_for_next_category=(),
        )
        report = await TripSupervisorAgent(backend).audit(
            SupervisorContext(
                charter=make_charter(),
                draft=draft,
                proposals=(proposal,),
                receipts=make_receipts(
                    "stay-a", arbiter.policy.required_receipt_rule_ids
                ),
            )
        )
        self.assertEqual(report.guard_status, GuardStatus.HOLD)
        self.assertIn(
            "BUDGET_OR_ASSIGNMENT_INVALID",
            {finding.code for finding in report.findings},
        )
        self.assertEqual(report.observed_selected_proposal_id, "stay-a")

    async def test_supervisor_cannot_replace_selected_proposal(self) -> None:
        backend = ScriptedLLMBackend(
            {
                "trip-supervisor": [
                    {
                        "guardStatus": "CLEAR",
                        "observedSelectedProposalId": "stay-b",
                        "findings": [],
                        "recheckTargets": [],
                        "summary": "attempted replacement",
                    }
                ]
            }
        )
        arbiter = StayArbiterAgent(backend)
        proposal = make_proposal("stay-a")
        draft = CategoryDecisionDraft(
            arbiter_name="stay-arbiter",
            category=Category.STAY,
            charter_version="charter-v1",
            proposal_set_version="set-v1",
            outcome=ArbiterOutcome.CONCLUDED,
            selected_proposal_id="stay-a",
            rejected_proposal_ids=(),
            ballot_ids=(),
            required_receipt_rule_ids=arbiter.policy.required_receipt_rule_ids,
            summary="fixture",
            unresolved_issues=(),
            obligations_for_next_category=(),
        )
        report = await TripSupervisorAgent(backend).audit(
            SupervisorContext(
                charter=make_charter(),
                draft=draft,
                proposals=(proposal,),
                receipts=make_receipts(
                    "stay-a", arbiter.policy.required_receipt_rule_ids
                ),
            )
        )
        self.assertEqual(report.guard_status, GuardStatus.RECHECK)
        self.assertEqual(report.observed_selected_proposal_id, "stay-a")
        self.assertIn(
            "SUPERVISOR_SELECTION_MUTATION",
            {finding.code for finding in report.findings},
        )

    async def test_three_proxies_to_stay_arbiter_to_supervisor(self) -> None:
        responses: dict[str, list[dict[str, object]]] = {
            f"user-proxy:{user_id}": [
                proxy_response(
                    user_id,
                    ["stay-b", "stay-a"] if user_id != "u1" else ["stay-a", "stay-b"],
                )
            ]
            for user_id in USERS
        }
        responses["stay-arbiter"] = [
            {
                "outcome": "CONCLUDED",
                "selectedProposalId": "stay-b",
                "summary": "balanced result",
                "unresolvedIssues": [],
                "obligationsForNextCategory": ["use stay-b as schedule origin"],
                "blockReason": None,
            }
        ]
        responses["trip-supervisor"] = [
            {
                "guardStatus": "CLEAR",
                "observedSelectedProposalId": "stay-b",
                "findings": [],
                "recheckTargets": [],
                "summary": "clear",
            }
        ]
        backend = ScriptedLLMBackend(responses)
        profiles = tuple(make_profile(user_id) for user_id in USERS)
        proxies = {
            profile.user_id: UserProxyAgent(profile, backend) for profile in profiles
        }
        arbiter = StayArbiterAgent(backend)
        proposals = (make_proposal("stay-a"), make_proposal("stay-b"))
        receipts = tuple(
            item
            for proposal in proposals
            for item in make_receipts(
                proposal.proposal_id, arbiter.policy.required_receipt_rule_ids
            )
        )
        result = await run_category_draft(
            charter=make_charter(),
            profiles=profiles,
            proposals=proposals,
            receipts=receipts,
            selection=DeterministicSelection(
                selected_proposal_id="stay-b",
                satisfaction_by_proposal={
                    "stay-a": (0.9, 0.6, 0.6),
                    "stay-b": (0.75, 0.9, 0.9),
                },
            ),
            proxies=proxies,
            arbiter=arbiter,
            supervisor=TripSupervisorAgent(backend),
        )
        self.assertEqual(len(result.ballots), 3)
        self.assertEqual(result.draft.selected_proposal_id, "stay-b")
        self.assertEqual(result.supervisor_report.guard_status, GuardStatus.CLEAR)
        self.assertEqual(len(backend.requests), 5)


if __name__ == "__main__":
    unittest.main()
