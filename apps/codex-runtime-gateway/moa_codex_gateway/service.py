"""인증·모델·schema·evidence·thread 정책을 강제하는 Gateway 서비스."""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError

from moa_agents.privacy import assert_no_forbidden_context_keys
from moa_agents.registry import get_agent_definition

from .backend import AuthSnapshot, BackendResult, CatalogEntry, CodexBackend
from .models import AgentRunRequest, AgentRunResult, AuthContext, ModelContext, RunUsage, SafeError
from .settings import GatewaySettings
from .store import GatewayStore


class ModelNotAvailableError(RuntimeError):
    pass


class InvalidOutputError(RuntimeError):
    pass


class GatewayService:
    def __init__(self, settings: GatewaySettings, backend: CodexBackend, store: GatewayStore) -> None:
        self.settings = settings
        self.backend = backend
        self.store = store
        self._catalog: list[CatalogEntry] = []
        self._catalog_fetched_monotonic = 0.0
        self._catalog_fetched_at = ""
        self._catalog_lock = asyncio.Lock()
        self._run_lock = asyncio.Lock()

    async def close(self) -> None:
        await self.backend.close()
        self.store.close()

    async def ready(self) -> dict[str, object]:
        try:
            auth = await self.backend.auth()
            catalog = await self._get_catalog()
            return {"ready": auth.ready and bool(catalog), "authMode": auth.mode, "modelCount": len(catalog)}
        except Exception:
            return {"ready": False, "authMode": "unknown", "modelCount": 0}

    async def list_models(self) -> dict[str, object]:
        catalog = await self._get_catalog()
        return {
            "fetchedAt": self._catalog_fetched_at,
            "models": [
                {"model": item.model, "isDefault": item.is_default, "supportedEfforts": list(item.supported_efforts)}
                for item in catalog
            ],
        }

    async def run(self, request: AgentRunRequest) -> AgentRunResult:
        async with self._run_lock:
            cached = self.store.get_cached(request)
            if cached is not None:
                return cached
            self.store.validate_continuation(request)
            result = await self._run_uncached(request)
            if result.error is None or not result.error.retryable:
                self.store.save_result(request, result)
            return result

    async def _run_uncached(self, request: AgentRunRequest) -> AgentRunResult:
        auth = await self._safe_auth()
        auth_context = self._auth_context(auth)
        if not auth.ready:
            return self._failure(request, auth_context, "AUTH_REQUIRED", "AUTH_REQUIRED", False, "Codex 로그인이 필요합니다.")

        definition = get_agent_definition(request.agent.role)
        if request.agent.instanceId != definition.spec.spec_id:
            return self._failure(request, auth_context, "FAILED", "AGENT_SPEC_MISMATCH", False, "AgentSpec ID가 registry와 일치하지 않습니다.")
        if request.agent.promptVersion != definition.prompt.version or request.agent.outputSchemaVersion != definition.spec.contracts.output_schema_version:
            return self._failure(request, auth_context, "FAILED", "CONTRACT_VERSION_MISMATCH", False, "프롬프트 또는 출력 계약 버전이 일치하지 않습니다.")
        if request.modelProfile != definition.spec.model.profile:
            return self._failure(request, auth_context, "FAILED", "MODEL_PROFILE_MISMATCH", False, "AgentSpec의 모델 profile과 요청이 일치하지 않습니다.")
        if request.reasoningEffort != definition.spec.model.preferred_reasoning_effort:
            return self._failure(request, auth_context, "FAILED", "REASONING_EFFORT_MISMATCH", False, "AgentSpec의 reasoning effort와 요청이 일치하지 않습니다.")
        try:
            assert_no_forbidden_context_keys(request.input.context)
            parsed_input = definition.input_model.model_validate(request.input.context)
            if parsed_input.trip_id != request.tripId or parsed_input.plan_version != request.planVersion or parsed_input.run_id != request.runId:
                raise ValueError("envelope와 context의 tripId/planVersion/runId가 일치하지 않습니다.")
            model = await self._resolve_model(request.modelProfile, request.reasoningEffort)
            model_context = ModelContext(
                model=model.model,
                reasoningEffort=request.reasoningEffort,
                catalogFetchedAt=self._catalog_fetched_at,
            )
            persistent = definition.spec.thread.mode == "PERSISTENT"
            backend_result, output = await asyncio.wait_for(
                self._execute_with_repair(request, definition, model.model, persistent),
                timeout=request.limits.timeoutMs / 1000,
            )
            self.store.bind_thread(request, backend_result.thread_id)
            return AgentRunResult(
                runId=request.runId,
                status="SUCCEEDED",
                authContext=auth_context,
                modelContext=model_context,
                threadId=backend_result.thread_id,
                output=output,
                usage=RunUsage(
                    inputTokens=backend_result.input_tokens,
                    cachedInputTokens=backend_result.cached_input_tokens,
                    outputTokens=backend_result.output_tokens,
                ),
            )
        except ModelNotAvailableError as error:
            return self._failure(request, auth_context, "MODEL_NOT_AVAILABLE", "MODEL_PROFILE_UNSATISFIED", False, str(error))
        except asyncio.TimeoutError:
            return self._failure(request, auth_context, "TIMED_OUT", "AGENT_RUN_TIMEOUT", True, "Agent 실행 시간이 초과되었습니다.")
        except (InvalidOutputError, ValidationError, ValueError) as error:
            return self._failure(request, auth_context, "INVALID_OUTPUT", "OUTPUT_CONTRACT_VIOLATION", False, str(error))
        except Exception as error:
            status, code, retryable, message = _classify_runtime_error(error)
            return self._failure(request, auth_context, status, code, retryable, message)

    async def _execute_with_repair(
        self,
        request: AgentRunRequest,
        definition: Any,
        model: str,
        persistent: bool,
    ) -> tuple[BackendResult, dict[str, Any]]:
        schema = definition.output_model.model_json_schema(by_alias=True)
        first = await self.backend.run(
            thread_id=request.thread.threadId,
            model=model,
            effort=request.reasoningEffort,
            developer_instructions=request.input.instruction,
            context=request.input.context,
            output_schema=schema,
            persistent=persistent,
            workspace=self.settings.workspace,
        )
        try:
            return first, self._validate_output(request, definition, first)
        except (InvalidOutputError, ValidationError) as first_error:
            if definition.spec.contracts.output_repair_attempts != 1:
                raise InvalidOutputError(str(first_error)) from first_error
            repaired = await self.backend.run(
                thread_id=first.thread_id,
                model=model,
                effort=request.reasoningEffort,
                developer_instructions=(
                    request.input.instruction
                    + "\n직전 출력이 계약을 통과하지 못했다. 오류를 수정하여 JSON 객체만 다시 반환한다."
                ),
                context={
                    "originalInput": request.input.context,
                    "schemaIssues": str(first_error)[:4_000],
                },
                output_schema=schema,
                persistent=persistent,
                workspace=self.settings.workspace,
            )
            output = self._validate_output(request, definition, repaired)
            return BackendResult(
                thread_id=repaired.thread_id,
                final_response=repaired.final_response,
                input_tokens=first.input_tokens + repaired.input_tokens,
                cached_input_tokens=first.cached_input_tokens + repaired.cached_input_tokens,
                output_tokens=first.output_tokens + repaired.output_tokens,
            ), output

    @staticmethod
    def _validate_output(request: AgentRunRequest, definition: Any, result: BackendResult) -> dict[str, Any]:
        if result.output_tokens > request.limits.maxOutputTokens:
            raise InvalidOutputError("출력이 허용된 토큰 한도를 초과했습니다.")
        try:
            raw_output = json.loads(result.final_response)
        except json.JSONDecodeError as error:
            raise InvalidOutputError("Codex 출력이 JSON 객체가 아닙니다.") from error
        output = definition.output_model.model_validate(raw_output).model_dump(mode="json", by_alias=True)
        unexpected_evidence = set(_collect_evidence_ids(output)) - set(request.input.evidenceIds)
        if unexpected_evidence:
            raise InvalidOutputError("입력에 없는 evidence ID가 출력에 포함되었습니다.")
        return output

    async def _safe_auth(self) -> AuthSnapshot:
        try:
            return await self.backend.auth()
        except Exception as error:
            status, _, _, _ = _classify_runtime_error(error)
            if status == "AUTH_REQUIRED":
                return AuthSnapshot(mode="unknown", ready=False)
            raise

    async def _get_catalog(self) -> list[CatalogEntry]:
        fresh = time.monotonic() - self._catalog_fetched_monotonic < self.settings.catalog_ttl_seconds
        if self._catalog and fresh:
            return self._catalog
        async with self._catalog_lock:
            fresh = time.monotonic() - self._catalog_fetched_monotonic < self.settings.catalog_ttl_seconds
            if self._catalog and fresh:
                return self._catalog
            self._catalog = [item for item in await self.backend.catalog() if not item.hidden]
            self._catalog_fetched_monotonic = time.monotonic()
            self._catalog_fetched_at = datetime.now(UTC).isoformat()
            return self._catalog

    async def _resolve_model(self, profile: str, effort: str) -> CatalogEntry:
        allowed = self.settings.model_profiles.get(profile, ())
        if not allowed:
            raise ModelNotAvailableError(f"{profile} profile의 운영 allowlist가 비어 있습니다.")
        by_name = {item.model: item for item in await self._get_catalog()}
        for model_name in allowed:
            candidate = by_name.get(model_name)
            if candidate is not None and effort in candidate.supported_efforts:
                return candidate
        raise ModelNotAvailableError(f"{profile} profile과 {effort} effort를 만족하는 허용 모델이 없습니다.")

    def _auth_context(self, auth: AuthSnapshot) -> AuthContext:
        method = "CHATGPT" if "chatgpt" in auth.mode.lower() else "EXTERNAL_PROVIDER" if auth.mode == "external" else "CODEX_ACCESS_TOKEN"
        fingerprint = hashlib.sha256(f"{self.settings.auth_boundary_id}:{auth.mode}".encode()).hexdigest()[:24]
        workspace_hash = (
            hashlib.sha256(self.settings.workspace_id.encode()).hexdigest()[:24]
            if self.settings.workspace_id else None
        )
        return AuthContext(loginMethod=method, workspaceIdHash=workspace_hash, authFingerprint=fingerprint)

    @staticmethod
    def _failure(
        request: AgentRunRequest,
        auth: AuthContext,
        status: str,
        code: str,
        retryable: bool,
        message: str,
    ) -> AgentRunResult:
        return AgentRunResult(
            runId=request.runId,
            status=status,  # type: ignore[arg-type]
            authContext=auth,
            error=SafeError(code=code, retryable=retryable, safeMessage=message),
        )


def _collect_evidence_ids(value: Any) -> list[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if key in {"evidenceId", "evidenceIds"}:
                if isinstance(child, str):
                    found.add(child)
                elif isinstance(child, list):
                    found.update(item for item in child if isinstance(item, str))
            found.update(_collect_evidence_ids(child))
    elif isinstance(value, list):
        for child in value:
            found.update(_collect_evidence_ids(child))
    return sorted(found)


def _classify_runtime_error(error: Exception) -> tuple[str, str, bool, str]:
    text = str(error).lower()
    if any(token in text for token in ("unauthorized", "authentication", "login required", "not logged")):
        return "AUTH_REQUIRED", "AUTH_REQUIRED", False, "Codex 인증을 확인할 수 없습니다."
    if any(token in text for token in ("rate limit", "too many requests", "quota")):
        return "RATE_LIMITED", "RATE_LIMITED", True, "Codex 사용량 제한에 도달했습니다."
    if any(token in text for token in ("model not", "unknown model", "unsupported model")):
        return "MODEL_NOT_AVAILABLE", "MODEL_NOT_AVAILABLE", False, "요청한 모델을 현재 인증에서 사용할 수 없습니다."
    return "FAILED", "CODEX_RUNTIME_ERROR", True, "Codex Runtime 실행에 실패했습니다."
