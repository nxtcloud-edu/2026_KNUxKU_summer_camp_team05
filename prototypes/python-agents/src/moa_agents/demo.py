from __future__ import annotations

import asyncio
import json
from datetime import date
from decimal import Decimal

from .arbitrators import StayArbiterAgent
from .backend import ScriptedLLMBackend, to_jsonable
from .contracts import (
    CapacityAllocation,
    CapacityPlan,
    Category,
    CategoryProposal,
    DeterministicSelection,
    ProfileFact,
    TripCharter,
    UserProfileView,
    VerificationReceipt,
    VerificationStatus,
)
from .proxy import UserProxyAgent
from .runtime import run_category_draft
from .supervisor import TripSupervisorAgent


def _proposal(proposal_id: str, summary: str, cost: str) -> CategoryProposal:
    participants = ("u1", "u2", "u3")
    evidence_ref = f"evidence:{proposal_id}"
    return CategoryProposal(
        proposal_id=proposal_id,
        category=Category.STAY,
        proposal_set_version="stay-v1",
        summary=summary,
        cost_by_user={user_id: Decimal(cost) for user_id in participants},
        evidence_refs=(evidence_ref,),
        capacity_plan=CapacityPlan(
            requested_party_size=3,
            confirmed_capacity=3,
            allocations=(
                CapacityAllocation(
                    resource_unit_id=f"room:{proposal_id}",
                    confirmed_capacity=3,
                    assigned_user_ids=participants,
                ),
            ),
            evidence_refs=(evidence_ref,),
        ),
    )


def _receipts(proposal_id: str, rule_ids: tuple[str, ...]) -> tuple[VerificationReceipt, ...]:
    return tuple(
        VerificationReceipt(
            receipt_id=f"receipt:{proposal_id}:{rule_id}",
            proposal_id=proposal_id,
            rule_id=rule_id,
            status=VerificationStatus.PASS,
            evidence_refs=(f"evidence:{proposal_id}",),
            explanation="fixture PASS",
        )
        for rule_id in rule_ids
    )


async def main() -> None:
    charter = TripCharter(
        version="charter-v1",
        destination="osaka",
        start_date=date(2026, 9, 10),
        end_date=date(2026, 9, 13),
        participants=("u1", "u2", "u3"),
        party_size=3,
        pace="balanced",
        budget_max_by_user={
            "u1": Decimal("30000"),
            "u2": Decimal("45000"),
            "u3": Decimal("36000"),
        },
    )
    profiles = (
        UserProfileView(
            user_id="u1",
            facts=(ProfileFact("u1-area", "난바 접근을 선호", 5),),
        ),
        UserProfileView(
            user_id="u2",
            facts=(ProfileFact("u2-quiet", "조용한 객실을 선호", 5),),
        ),
        UserProfileView(
            user_id="u3",
            facts=(ProfileFact("u3-breakfast", "조식 포함을 선호", 5),),
        ),
    )
    proposals = (
        _proposal("stay-a", "난바 중심의 합리적 숙소", "25000"),
        _proposal("stay-b", "역 접근과 객실 품질의 균형안", "29000"),
    )
    backend = ScriptedLLMBackend(
        {
            "user-proxy:u1": [
                {
                    "rankedProposalIds": ["stay-a", "stay-b"],
                    "stances": {"stay-a": "support", "stay-b": "conditional"},
                    "profileFactRefs": ["u1-area"],
                    "conditionalTerms": [],
                    "rationale": "난바 접근을 우선합니다.",
                }
            ],
            "user-proxy:u2": [
                {
                    "rankedProposalIds": ["stay-b", "stay-a"],
                    "stances": {"stay-a": "conditional", "stay-b": "support"},
                    "profileFactRefs": ["u2-quiet"],
                    "conditionalTerms": [],
                    "rationale": "객실 품질을 우선합니다.",
                }
            ],
            "user-proxy:u3": [
                {
                    "rankedProposalIds": ["stay-b", "stay-a"],
                    "stances": {"stay-a": "conditional", "stay-b": "support"},
                    "profileFactRefs": ["u3-breakfast"],
                    "conditionalTerms": [],
                    "rationale": "조식과 역 접근을 우선합니다.",
                }
            ],
            "stay-arbiter": [
                {
                    "outcome": "CONCLUDED",
                    "selectedProposalId": "stay-b",
                    "summary": "세 사용자의 하드 제약을 지키는 균형안입니다.",
                    "unresolvedIssues": [],
                    "obligationsForNextCategory": ["일정은 stay-b를 출발점으로 사용"],
                    "blockReason": None,
                }
            ],
            "trip-supervisor": [
                {
                    "guardStatus": "CLEAR",
                    "observedSelectedProposalId": "stay-b",
                    "findings": [],
                    "recheckTargets": [],
                    "summary": "헌장, 예산, 정원과 근거를 지켰습니다.",
                }
            ],
        }
    )
    arbiter = StayArbiterAgent(backend)
    receipts = _receipts("stay-a", arbiter.policy.required_receipt_rule_ids) + _receipts(
        "stay-b", arbiter.policy.required_receipt_rule_ids
    )
    proxies = {
        profile.user_id: UserProxyAgent(profile, backend) for profile in profiles
    }
    result = await run_category_draft(
        charter=charter,
        profiles=profiles,
        proposals=proposals,
        receipts=receipts,
        selection=DeterministicSelection(
            selected_proposal_id="stay-b",
            satisfaction_by_proposal={
                "stay-a": (0.9, 0.6, 0.6),
                "stay-b": (0.75, 0.9, 0.9),
            },
            trace=("leximin selected stay-b",),
        ),
        proxies=proxies,
        arbiter=arbiter,
        supervisor=TripSupervisorAgent(backend),
    )
    print(json.dumps(to_jsonable(result), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
