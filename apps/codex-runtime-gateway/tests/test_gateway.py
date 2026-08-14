from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from moa_codex_gateway.app import create_app
from moa_codex_gateway.backend import AuthSnapshot, BackendResult, CatalogEntry
from moa_codex_gateway.redaction import redact
from moa_codex_gateway.models import AgentRef
from moa_codex_gateway.service import GatewayService
from moa_codex_gateway.settings import GatewaySettings
from moa_codex_gateway.store import GatewayStore


GOLDEN_REQUEST_PATH = (
    Path(__file__).parents[3]
    / "packages"
    / "contracts"
    / "fixtures"
    / "codex-gateway"
    / "user-proxy-run.v1.json"
)

class FakeBackend:
    def __init__(
        self,
        *,
        extra_evidence: bool = False,
        invalid_first: bool = False,
        auth_ready: bool = True,
    ) -> None:
        self.calls = 0
        self.extra_evidence = extra_evidence
        self.invalid_first = invalid_first
        self.auth_ready = auth_ready

    async def catalog(self) -> list[CatalogEntry]:
        return [CatalogEntry("fake-balanced", True, False, ("medium",))]

    async def auth(self) -> AuthSnapshot:
        return AuthSnapshot("chatgpt", self.auth_ready)

    async def run(self, **kwargs: Any) -> BackendResult:
        self.calls += 1
        if self.invalid_first and self.calls == 1:
            output: dict[str, Any] = {"invalid": True}
        else:
            output = {
                "role": "USER_PROXY",
                "vote": {
                    "proposalId": "stay-b",
                    "evidenceIds": ["ev.hotel.price", "ev.hotel.location"],
                },
            }
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
        return None


def settings(tmp_path: Path, *, with_model: bool = True) -> GatewaySettings:
    return GatewaySettings(
        host="127.0.0.1",
        port=4600,
        database_path=str(tmp_path / "gateway.sqlite3"),
        workspace=tmp_path / "sandbox",
        model_profiles={"BALANCED": ("fake-balanced",) if with_model else ()},
        catalog_ttl_seconds=300,
        auth_boundary_id="test-boundary",
        workspace_id="workspace-secret-id",
    )


def payload() -> dict[str, Any]:
    return json.loads(GOLDEN_REQUEST_PATH.read_text(encoding="utf-8"))


def agent_ref(**overrides: object) -> dict[str, object]:
    return {
        "role": "USER_PROXY",
        "instanceId": "agent.v1",
        "participantId": "u1",
        "category": "stay",
        "promptVersion": "v1",
        "inputContractVersion": "v1",
        "outputContractVersion": "v1",
        **overrides,
    }


def test_agent_ref_accepts_only_the_five_official_roles() -> None:
    valid = [
        agent_ref(),
        agent_ref(role="CANDIDATE_EVIDENCE", participantId=None),
        agent_ref(role="CATEGORY_ARBITER", participantId=None),
        agent_ref(role="TRIP_ORCHESTRATOR", participantId=None, category=None),
        agent_ref(role="PLAN_FINALIZER", participantId=None, category=None),
    ]
    assert [AgentRef.model_validate(value).role for value in valid] == [
        "USER_PROXY",
        "CANDIDATE_EVIDENCE",
        "CATEGORY_ARBITER",
        "TRIP_ORCHESTRATOR",
        "PLAN_FINALIZER",
    ]
    for legacy_role in ["STAY_ARBITER", "TRIP_SUPERVISOR"]:
        with pytest.raises(ValidationError):
            AgentRef.model_validate(agent_ref(role=legacy_role))


def test_agent_run_is_validated_and_idempotent(tmp_path: Path) -> None:
    backend = FakeBackend()
    config = settings(tmp_path)
    service = GatewayService(config, backend, GatewayStore(config.database_path))
    with TestClient(create_app(service=service)) as client:
        first = client.post("/internal/v1/agent-runs", json=payload())
        second = client.post("/internal/v1/agent-runs", json=payload())
    assert first.status_code == 200
    assert first.json()["status"] == "SUCCEEDED"
    assert first.json()["output"]["role"] == "USER_PROXY"
    assert first.json()["authContext"]["authFingerprint"]
    assert "workspace-secret-id" not in first.text
    assert second.json() == first.json()
    assert backend.calls == 1


def test_readiness_requires_auth_and_allowlisted_catalog_match(tmp_path: Path) -> None:
    config = settings(tmp_path, with_model=False)
    service = GatewayService(config, FakeBackend(), GatewayStore(config.database_path))
    with TestClient(create_app(service=service)) as client:
        response = client.get("/readyz")
        models = client.get("/internal/v1/models")
    assert response.status_code == 503
    assert response.json()["detail"]["allowlistConfigured"] is False
    assert models.json()["models"][0]["allowedProfiles"] == []


def test_model_profile_is_fail_closed(tmp_path: Path) -> None:
    config = settings(tmp_path, with_model=False)
    service = GatewayService(config, FakeBackend(), GatewayStore(config.database_path))
    with TestClient(create_app(service=service)) as client:
        response = client.post("/internal/v1/agent-runs", json=payload())
    assert response.json()["status"] == "MODEL_NOT_AVAILABLE"
    assert response.json()["error"]["code"] == "MODEL_PROFILE_UNSATISFIED"


def test_auth_is_fail_closed_without_model_call(tmp_path: Path) -> None:
    backend = FakeBackend(auth_ready=False)
    config = settings(tmp_path)
    service = GatewayService(config, backend, GatewayStore(config.database_path))
    with TestClient(create_app(service=service)) as client:
        response = client.post("/internal/v1/agent-runs", json=payload())
    assert response.json()["status"] == "AUTH_REQUIRED"
    assert backend.calls == 0


def test_thread_cannot_cross_agent_scope(tmp_path: Path) -> None:
    config = settings(tmp_path)
    service = GatewayService(config, FakeBackend(), GatewayStore(config.database_path))
    request = payload()
    request["thread"] = {"mode": "CONTINUE", "threadId": "thread.other-participant"}
    with TestClient(create_app(service=service)) as client:
        response = client.post("/internal/v1/agent-runs", json=request)
    assert response.status_code == 409


def test_untrusted_evidence_is_rejected(tmp_path: Path) -> None:
    config = settings(tmp_path)
    service = GatewayService(
        config,
        FakeBackend(extra_evidence=True),
        GatewayStore(config.database_path),
    )
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
    assert response.json()["repairUsed"] is True
    assert response.json()["usage"]["inputTokens"] == 200
    assert backend.calls == 2


def test_envelope_mismatch_and_remote_schema_are_rejected(tmp_path: Path) -> None:
    backend = FakeBackend()
    config = settings(tmp_path)
    service = GatewayService(config, backend, GatewayStore(config.database_path))
    mismatch = payload()
    mismatch["input"]["context"]["tripId"] = "other-trip"
    with TestClient(create_app(service=service)) as client:
        mismatch_response = client.post("/internal/v1/agent-runs", json=mismatch)
    assert mismatch_response.json()["status"] == "INVALID_OUTPUT"

    remote = payload()
    remote["runId"] = "run-2"
    remote["input"]["context"]["runId"] = "run-2"
    remote["outputSchema"] = {"$ref": "https://example.com/schema.json"}
    with TestClient(create_app(service=service)) as client:
        remote_response = client.post("/internal/v1/agent-runs", json=remote)
    assert remote_response.json()["status"] == "INVALID_OUTPUT"
    assert backend.calls == 0


def test_credentials_and_raw_profiles_are_rejected_before_model_call(tmp_path: Path) -> None:
    backend = FakeBackend()
    config = settings(tmp_path)
    service = GatewayService(config, backend, GatewayStore(config.database_path))
    request = payload()
    request["input"]["context"]["apiKey"] = "not-a-real-secret"
    with TestClient(create_app(service=service)) as client:
        response = client.post("/internal/v1/agent-runs", json=request)
    assert response.json()["status"] == "INVALID_OUTPUT"
    assert backend.calls == 0


def test_settings_reject_non_loopback_host(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MOA_GATEWAY_HOST", "0.0.0.0")
    with pytest.raises(ValueError, match="loopback"):
        GatewaySettings.from_env()


def test_log_redaction_hides_tokens() -> None:
    api_token = "sk" + "-example123456"
    value = redact(f"Authorization: Bearer secret.token access_token=abc123 {api_token}")
    assert "secret.token" not in value
    assert "abc123" not in value
    assert api_token not in value
