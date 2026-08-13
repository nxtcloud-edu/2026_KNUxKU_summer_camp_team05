"""6개 Agent의 전달 순서를 실행하는 종단 시뮬레이터."""

from __future__ import annotations

import asyncio

from .fixtures import DEMO_CANDIDATE_SEARCH_INPUT, DEMO_EVIDENCE, DEMO_FINALIZER_INPUT, DEMO_PLAN_OPTIONS, DEMO_PROXY_INPUTS
from .models import (
    CandidateSearchOutput, CategoryWatcherInput, CategoryWatcherOutput,
    DebateSupervisorInput, DebateSupervisorOutput, Fact, LogicAuditorInput,
    LogicAuditorOutput, MechanicalChecks, ParticipantProxyOutput, ResultFinalizerOutput, Rule,
)
from .runtime import AgentRunRequest, AgentRuntime, FixtureAgentRuntime, require_agent_output


async def run_demo_debate(runtime: AgentRuntime | None = None) -> dict[str, object]:
    runtime = runtime or FixtureAgentRuntime()
    search = await require_agent_output(runtime, AgentRunRequest("CANDIDATE_SEARCH", DEMO_CANDIDATE_SEARCH_INPUT))
    assert isinstance(search, CandidateSearchOutput)

    proxy_results = await asyncio.gather(*[
        require_agent_output(runtime, AgentRunRequest("PARTICIPANT_PROXY", item)) for item in DEMO_PROXY_INPUTS
    ])
    proxies = [item for item in proxy_results if isinstance(item, ParticipantProxyOutput)]
    audit = await require_agent_output(runtime, AgentRunRequest("LOGIC_AUDITOR", LogicAuditorInput(
        trip_id="trip.demo", run_id="run.auditor.1", plan_version=1,
        arguments=[item.argument for item in proxies],
        facts=[Fact(fact_id=f"fact:{item.evidence_id}", statement=item.fact_summary, evidence_ids=[item.evidence_id]) for item in DEMO_EVIDENCE],
        rules=[
            Rule(rule_id="rule.hard-constraint", description="필수조건 실패는 반대를 요구한다."),
            Rule(rule_id="rule.protected-objective", description="보호 목적 변경은 사용자 확인이 필요하다."),
            Rule(rule_id="rule.preference-score", description="검증된 만족도로 수용성을 설명한다."),
        ], evidence=DEMO_EVIDENCE,
    )))
    assert isinstance(audit, LogicAuditorOutput)

    watcher = await require_agent_output(runtime, AgentRunRequest("CATEGORY_WATCHER", CategoryWatcherInput(
        trip_id="trip.demo", run_id="run.watcher.1", plan_version=1,
        category="accommodation", rule_pack_version="v1", options=[DEMO_PLAN_OPTIONS[0]],
        proof_reviews=audit.reviews,
        mechanical_checks=MechanicalChecks(hard_constraint_failures=[], budget_valid=True, schedule_valid=True, evidence_coverage_bp=10_000),
    )))
    assert isinstance(watcher, CategoryWatcherOutput)

    supervisor = await require_agent_output(runtime, AgentRunRequest("DEBATE_SUPERVISOR", DebateSupervisorInput(
        trip_id="trip.demo", run_id="run.supervisor.1", plan_version=1,
        debate_issue_id="issue.accommodation.1", category="accommodation", iteration=0, max_iterations=3,
        options=[DEMO_PLAN_OPTIONS[0]], votes=[item.vote for item in proxies], watcher_verdict=watcher,
        legal_moves=["REQUEST_REBUTTAL", "PROPOSE_COMPROMISE", "END_DEBATE", "WAIT_FOR_USER", "BLOCK"],
    )))
    assert isinstance(supervisor, DebateSupervisorOutput)
    final = await require_agent_output(runtime, AgentRunRequest("RESULT_FINALIZER", DEMO_FINALIZER_INPUT))
    assert isinstance(final, ResultFinalizerOutput)
    return {"search": search, "proxies": proxies, "audit": audit, "watcher": watcher, "supervisor": supervisor, "final": final}
