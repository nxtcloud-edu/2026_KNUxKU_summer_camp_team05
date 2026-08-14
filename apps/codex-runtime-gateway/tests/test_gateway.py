import json
import asyncio
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from moa_agents.fixtures import DEMO_PROXY_INPUTS
from moa_agents.registry import get_agent_definition
from moa_agents.runtime import AgentRunRequest, CodexAgentRuntime, HttpCodexGatewayClient

from moa_codex_gateway.app import create_app
from moa_codex_gateway.backend import AuthSnapshot, BackendResult, CatalogEntry
from moa_codex_gateway.redaction import redact
from moa_codex_gateway.service import GatewayService
from moa_codex_gateway.settings import GatewaySettings
from moa_codex_gateway.store import GatewayStore


class FakeBackend:
    def __init__(self, *, extra_evidence: bool = False, invalid_first: bool = False) -> None:
        self.calls = 0
        self.extra_evidence = extra_evidence
        self.invalid_first = invalid_first

    async def catalog(self) -> list[CatalogEntry]:
        return [CatalogEntry("fake-balanced", True, False, ("medium",))]

    async def auth(self) -> AuthSnapshot:
        return AuthSnapshot("chatgpt", True)

    async def run(self, **kwargs) -> BackendResult:
        self.calls += 1
        context = kwargs["context"]
        if self.invalid_first and self.calls == 1:
            return BackendResult(
                kwargs["thread_id"] or "thread.proxy.alice",
                json.dumps({"invalid": True}),
                10,
                0,
                5,
            )
        if "originalInput" in context:
            context = context["originalInput"]
        definition = get_agent_definition("PARTICIPANT_PROXY")
        parsed = definition.input_model.model_validate(context)
        output = definition.fixture_handler(parsed).model_dump(mode="json", by_alias=True)
        if self.extra_evidence:
            output["vote"]["evidenceIds"].append("ev.not-allowed")
        return BackendResult(
            kwargs["thread_id"] or "thread.proxy.alice",
            json.dumps(output, ensure_ascii=False),
            100,
            10,
            50,
        )

    async def close(self) -> None:
        pass


def settings(tmp_path: Path, *, with_model: bool = True) -> GatewaySettings:
    return GatewaySettings(
        host="127.0.0.1",
        port=4600,
        database_path=tmp_path / "gateway.sqlite3",
        workspace=tmp_path / "sandbox",
        model_profiles={"BALANCED": ("fake-balanced",) if with_model else ()},
        catalog_ttl_seconds=300,
        auth_boundary_id="test-boundary",
        workspace_id="workspace-secret-id",
    )


def payload() -> dict:
    context = DEMO_PROXY_INPUTS[0].model_dump(mode="json", by_alias=True)
    return {
        "runId": context["runId"],
        "tripId": context["tripId"],
        "planVersion": context["planVersion"],
        "agent": {
            "role": "PARTICIPANT_PROXY",
            "instanceId": "participant-proxy.v1",
            "participantId": "alice",
            "debateIssueId": context["debateIssueId"],
            "category": context["category"],
            "promptVersion": "v1",
            "outputSchemaVersion": "v1",
        },
        "thread": {"mode": "NEW"},
        "modelProfile": "BALANCED",
        "reasoningEffort": "medium",
        "input": {
            "instruction": "계약된 JSON만 반환한다.",
            "context": context,
            "evidenceIds": ["ev.hotel.price", "ev.hotel.location"],
        },
        "limits": {"timeoutMs": 60_000, "maxOutputTokens": 2_048},
    }


def test_agent_run_is_validated_and_idempotent(tmp_path: Path) -> None:
    backend = FakeBackend()
    config = settings(tmp_path)
    service = GatewayService(config, backend, GatewayStore(config.database_path))
    with TestClient(create_app(service=service)) as client:
        first = client.post("/internal/v1/agent-runs", json=payload())
        second = client.post("/internal/v1/agent-runs", json=payload())
    assert first.status_code == 200
    assert first.json()["status"] == "SUCCEEDED"
    assert first.json()["output"]["role"] == "PARTICIPANT_PROXY"
    assert first.json()["authContext"]["authFingerprint"]
    assert "workspace-secret-id" not in first.text
    assert second.json() == first.json()
    assert backend.calls == 1


def test_model_profile_is_fail_closed(tmp_path: Path) -> None:
    config = settings(tmp_path, with_model=False)
    service = GatewayService(config, FakeBackend(), GatewayStore(config.database_path))
    with TestClient(create_app(service=service)) as client:
        response = client.post("/internal/v1/agent-runs", json=payload())
    assert response.json()["status"] == "MODEL_NOT_AVAILABLE"
    assert response.json()["error"]["code"] == "MODEL_PROFILE_UNSATISFIED"


def test_thread_cannot_cross_isolation_key(tmp_path: Path) -> None:
    config = settings(tmp_path)
    service = GatewayService(config, FakeBackend(), GatewayStore(config.database_path))
    request = payload()
    request["thread"] = {"mode": "CONTINUE", "threadId": "thread.other-participant"}
    with TestClient(create_app(service=service)) as client:
        response = client.post("/internal/v1/agent-runs", json=request)
    assert response.status_code == 409


def test_untrusted_evidence_is_rejected(tmp_path: Path) -> None:
    config = settings(tmp_path)
    service = GatewayService(config, FakeBackend(extra_evidence=True), GatewayStore(config.database_path))
    with TestClient(create_app(service=service)) as client:
        response = client.post("/internal/v1/agent-runs", json=payload())
    assert response.json()["status"] == "INVALID_OUTPUT"
    assert response.json()["error"]["code"] == "OUTPUT_CONTRACT_VIOLATION"


def test_invalid_output_is_repaired_once_on_same_thread(tmp_path: Path) -> None:
    backend = FakeBackend(invalid_first=True)
    config = settings(tmp_path)
    service = GatewayService(config, backend, GatewayStore(config.database_path))
    with TestClient(create_app(service=service)) as client:
        response = client.post("/internal/v1/agent-runs", json=payload())
    assert response.json()["status"] == "SUCCEEDED"
    assert response.json()["threadId"] == "thread.proxy.alice"
    assert backend.calls == 2
    assert response.json()["usage"]["inputTokens"] == 110


def test_worker_runtime_calls_gateway_over_http_contract(tmp_path: Path) -> None:
    backend = FakeBackend()
    config = settings(tmp_path)
    service = GatewayService(config, backend, GatewayStore(config.database_path))
    application = create_app(service=service)
    application.state.gateway = service
    client = HttpCodexGatewayClient(transport=httpx.ASGITransport(app=application))

    async def run():
        try:
            return await CodexAgentRuntime(client).run(
                AgentRunRequest("PARTICIPANT_PROXY", DEMO_PROXY_INPUTS[0])
            )
        finally:
            await client.aclose()

    result = asyncio.run(run())
    assert result.status == "SUCCESS"
    assert result.runtime == "CODEX_GATEWAY"
    assert result.model == "fake-balanced"
    assert backend.calls == 1


def test_log_redaction_hides_tokens() -> None:
    value = redact("Authorization: Bearer secret.token access_token=abc123 sk-example123456")
    assert "secret.token" not in value
    assert "abc123" not in value
    assert "sk-example123456" not in value
