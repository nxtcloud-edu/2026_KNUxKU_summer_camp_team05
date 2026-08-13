import asyncio

from pydantic import ValidationError

from moa_agents.fixtures import DEMO_PLAN_OPTIONS, DEMO_PROXY_INPUTS
from moa_agents.models import CandidateSearchInput, CandidateSearchOutput, ParticipantProxyInput, ParticipantProxyOutput
from moa_agents.privacy import assert_no_forbidden_context_keys
from moa_agents.projections import project_participant_proxy_context
from moa_agents.registry import AGENT_DEFINITIONS
from moa_agents.runtime import (
    AgentRunRequest, AgentUsage, CodexAgentRuntime, CodexGatewayRequest,
    CodexGatewayResponse, FixtureAgentRuntime, require_agent_output,
)
from moa_agents.simulator import run_demo_debate
from moa_agents.specs import ALL_AGENT_SPECS, AgentSpec


def test_six_specs_follow_least_privilege_policy() -> None:
    assert len(ALL_AGENT_SPECS) == 6
    assert len({spec.role for spec in ALL_AGENT_SPECS}) == 6
    for spec in ALL_AGENT_SPECS:
        AgentSpec.model_validate(spec)
        assert spec.execution.allowed_tool_ids == []
        assert spec.execution.max_tool_calls_per_run == 0
        assert spec.execution.side_effect_policy == "PROPOSE_ONLY"
        assert spec.privacy.credentials_access == "NONE"
        assert spec.privacy.direct_database_access == "NONE"


def test_full_fixture_debate_uses_all_agents() -> None:
    result = asyncio.run(run_demo_debate())
    assert result["search"].status == "QUERY_PLAN_PROPOSED"
    assert len(result["proxies"]) == 2
    assert all(review.verdict == "VALID" for review in result["audit"].reviews)
    assert result["watcher"].verdict == "PASS"
    assert result["supervisor"].next_action == "END_DEBATE"
    assert result["final"].status == "READY"
    assert set(AGENT_DEFINITIONS) == {
        "PARTICIPANT_PROXY", "CANDIDATE_SEARCH", "LOGIC_AUDITOR",
        "CATEGORY_WATCHER", "DEBATE_SUPERVISOR", "RESULT_FINALIZER",
    }


def test_proxy_projection_drops_other_raw_profiles_and_secrets() -> None:
    original = DEMO_PROXY_INPUTS[0]
    projected = project_participant_proxy_context({
        "meta": {
            "trip_id": original.trip_id, "run_id": original.run_id,
            "plan_version": original.plan_version, "debate_issue_id": original.debate_issue_id,
            "category": original.category, "iteration": original.iteration,
        },
        "own_profile": original.participant,
        "options": original.options,
        "evidence": original.evidence,
        "other_participant_raw_profiles": [{"health_details": "secret"}],
        "provider_raw": {"secret": True},
        "credentials": {"access_token": "secret"},
    })
    payload = projected.model_dump_json()
    assert "other_participant_raw_profiles" not in payload
    assert "access_token" not in payload
    assert "provider_raw" not in payload


def test_runtime_rejects_forbidden_context_key() -> None:
    raw = DEMO_PROXY_INPUTS[0].model_dump(mode="json")
    raw["credentials"] = {"api_key": "must-not-pass"}
    result = asyncio.run(FixtureAgentRuntime().run(AgentRunRequest("PARTICIPANT_PROXY", raw)))
    assert result.status == "INPUT_SCHEMA_ERROR"


def test_strict_models_reject_unknown_fields() -> None:
    raw = DEMO_PROXY_INPUTS[0].model_dump(mode="json")
    raw["unknown"] = True
    try:
        ParticipantProxyInput.model_validate(raw)
    except ValidationError:
        pass
    else:
        raise AssertionError("unknown field가 거부되지 않았습니다.")


def test_json_boundary_uses_typescript_compatible_camel_case() -> None:
    payload = DEMO_PROXY_INPUTS[0].model_dump(mode="json")
    assert "tripId" in payload
    assert "planVersion" in payload
    assert "trip_id" not in payload
    assert ParticipantProxyInput.model_validate(payload).trip_id == "trip.demo"


def test_candidate_search_never_relaxes_safety_constraint() -> None:
    data = CandidateSearchInput(
        trip_id="trip.1", run_id="run.1", plan_version=1, category="dining",
        unresolved_free_text=["맛집"], shortage_reason="NO_CANDIDATES",
        canonical_constraints={}, allowed_relaxations=["알레르기 필수 조건 완화"], current_candidates=[],
    )
    output = asyncio.run(require_agent_output(FixtureAgentRuntime(), AgentRunRequest("CANDIDATE_SEARCH", data)))
    assert isinstance(output, CandidateSearchOutput)
    assert output.status == "NO_SAFE_QUERY"
    assert output.query_plans == []


def test_missing_protected_objective_requires_user_confirmation() -> None:
    source = DEMO_PROXY_INPUTS[1]
    data = source.model_copy(update={"options": [DEMO_PLAN_OPTIONS[1]]})
    output = asyncio.run(require_agent_output(FixtureAgentRuntime(), AgentRunRequest("PARTICIPANT_PROXY", data)))
    assert isinstance(output, ParticipantProxyOutput)
    assert output.vote.decision == "USER_CONFIRMATION_REQUIRED"
    assert output.vote.reason_code == "PROTECTED_OBJECTIVE"


class RepairingGateway:
    def __init__(self, valid_output: dict) -> None:
        self.valid_output = valid_output
        self.calls = 0

    async def run(self, request: CodexGatewayRequest) -> CodexGatewayResponse:
        self.calls += 1
        if self.calls == 1:
            output = {"invalid": True}
        else:
            assert request.repair is not None
            output = self.valid_output
        return CodexGatewayResponse(output=output, model="fixture-model", thread_id="thread.1", usage=AgentUsage(2, 2))


def test_codex_runtime_repairs_schema_once() -> None:
    fixture_output = asyncio.run(require_agent_output(
        FixtureAgentRuntime(), AgentRunRequest("PARTICIPANT_PROXY", DEMO_PROXY_INPUTS[0])
    ))
    gateway = RepairingGateway(fixture_output.model_dump(mode="json"))
    result = asyncio.run(CodexAgentRuntime(gateway).run(AgentRunRequest("PARTICIPANT_PROXY", DEMO_PROXY_INPUTS[0])))
    assert result.status == "SUCCESS"
    assert result.repaired is True
    assert gateway.calls == 2


def test_finalizer_does_not_invent_candidate_ids() -> None:
    result = asyncio.run(run_demo_debate())
    allowed = set(DEMO_PLAN_OPTIONS[0].candidate_ids)
    for item in result["final"].itinerary:
        assert set(item.candidate_ids) <= allowed


def test_privacy_guard_checks_nested_values() -> None:
    try:
        assert_no_forbidden_context_keys({"nested": [{"auth": "secret"}]})
    except ValueError:
        pass
    else:
        raise AssertionError("nested auth가 거부되지 않았습니다.")
