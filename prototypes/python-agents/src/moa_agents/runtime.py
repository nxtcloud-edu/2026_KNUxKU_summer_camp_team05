from __future__ import annotations

import asyncio
from collections.abc import Mapping

from .arbitrators import ArbiterContext, BaseCategoryArbiterAgent
from .contracts import (
    AgentContractError,
    CategoryProposal,
    CategoryRunResult,
    DeterministicSelection,
    ProxyBallot,
    TripCharter,
    UserProfileView,
    VerificationReceipt,
)
from .proxy import (
    ProxyContext,
    ProxyProposalView,
    ProxyTripView,
    UserProxyAgent,
    profile_by_user,
)
from .supervisor import SupervisorContext, TripSupervisorAgent


async def run_category_draft(
    *,
    charter: TripCharter,
    profiles: tuple[UserProfileView, ...],
    proposals: tuple[CategoryProposal, ...],
    receipts: tuple[VerificationReceipt, ...],
    selection: DeterministicSelection,
    proxies: Mapping[str, UserProxyAgent],
    arbiter: BaseCategoryArbiterAgent,
    supervisor: TripSupervisorAgent,
    prior_obligations: tuple[str, ...] = (),
) -> CategoryRunResult:
    profiles_by_user = profile_by_user(profiles)
    expected_users = set(charter.participants)
    if set(profiles_by_user) != expected_users or set(proxies) != expected_users:
        raise AgentContractError("profiles and proxies must match TripCharter participants")
    for user_id, proxy in proxies.items():
        if proxy.profile.user_id != user_id or proxy.profile != profiles_by_user[user_id]:
            raise AgentContractError("proxy ownership does not match isolated profile")

    selectable = arbiter.selectable_proposals(charter, proposals, receipts)
    ballots: tuple[ProxyBallot, ...] = ()
    if selectable:
        ballots = tuple(
            await asyncio.gather(
                *(
                    proxies[user_id].create_ballot(
                        ProxyContext(
                            trip=ProxyTripView.from_charter(charter, user_id),
                            category=arbiter.policy.category,
                            proposals=tuple(
                                ProxyProposalView.from_proposal(proposal, user_id)
                                for proposal in selectable
                            ),
                        )
                    )
                    for user_id in charter.participants
                )
            )
        )

    draft = await arbiter.decide(
        ArbiterContext(
            charter=charter,
            proposals=proposals,
            receipts=receipts,
            ballots=ballots,
            selection=selection,
            prior_obligations=prior_obligations,
        )
    )
    report = await supervisor.audit(
        SupervisorContext(
            charter=charter,
            draft=draft,
            proposals=proposals,
            receipts=receipts,
            prior_obligations=prior_obligations,
        )
    )
    return CategoryRunResult(
        ballots=ballots,
        draft=draft,
        supervisor_report=report,
    )
