from __future__ import annotations

import asyncio
import hashlib
import json
import time
from datetime import UTC, datetime
from typing import Any, Literal

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError, ValidationError

from .backend import AuthSnapshot, BackendResult, CatalogEntry, CodexBackend
from .models import (
    AgentRunRequest,
    AgentRunResult,
    AuthContext,
    ModelContext,
    RunStatus,
    RunUsage,
    SafeError,
)
from .settings import GatewaySettings
from .store import GatewayStore


class ModelNotAvailableError(RuntimeError):
    pass


class InvalidOutputError(RuntimeError):
    pass


class InvalidInputError(ValueError):
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
            allowed = self._allowed_profiles_by_model()
            usable = [item for item in catalog if item.model in allowed]
            return {
                "ready": auth.ready and bool(usable),
                "authMode": auth.mode,
                "modelCount": len(catalog),
                "allowedModelCount": len(usable),
                "allowlistConfigured": bool(allowed),
            }
        except Exception:
            return {
                "ready": False,
                "authMode": "unknown",
                "modelCount": 0,
                "allowedModelCount": 0,
                "allowlistConfigured": bool(self._allowed_profiles_by_model()),
            }

    async def list_models(self) -> dict[str, object]:
        catalog = await self._get_catalog()
        allowed = self._allowed_profiles_by_model()
        return {
            "fetchedAt": self._catalog_fetched_at,
            "models": [
                {
                    "model": item.model,
                    "isDefault": item.is_default,
                    "supportedEfforts": list(item.supported_efforts),
                    "allowedProfiles": allowed.get(item.model, []),
                }
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
            return self._failure(
                request,
                auth_context,
                "AUTH_REQUIRED",
                "AUTH_REQUIRED",
                False,
                "Codex 로그인이 필요합니다.",
            )

        try:
            _validate_input_context(request)
            _validate_output_schema(request.outputSchema)
            model = await self._resolve_model(request.modelProfile, request.reasoningEffort)
            model_context = ModelContext(
                model=model.model,
                reasoningEffort=request.reasoningEffort,
                catalogFetchedAt=self._catalog_fetched_at,
            )
            backend_result, output, repair_used = await asyncio.wait_for(
                self._execute_with_repair(request, model.model),
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
                repairUsed=repair_used,
            )
        except ModelNotAvailableError as error:
            return self._failure(
                request,
                auth_context,
                "MODEL_NOT_AVAILABLE",
                "MODEL_PROFILE_UNSATISFIED",
                False,
                str(error),
            )
        except TimeoutError:
            return self._failure(
                request,
                auth_context,
                "TIMED_OUT",
                "AGENT_RUN_TIMEOUT",
                True,
                "Agent 실행 시간이 초과되었습니다.",
            )
        except (InvalidOutputError, InvalidInputError, SchemaError, ValidationError) as error:
            return self._failure(
                request,
                auth_context,
                "INVALID_OUTPUT",
                "OUTPUT_CONTRACT_VIOLATION",
                False,
                str(error),
            )
        except Exception as error:
            status, code, retryable, message = _classify_runtime_error(error)
            return self._failure(request, auth_context, status, code, retryable, message)

    async def _execute_with_repair(
        self,
        request: AgentRunRequest,
        model: str,
    ) -> tuple[BackendResult, dict[str, Any], bool]:
        first = await self.backend.run(
            thread_id=request.thread.threadId,
            model=model,
            effort=request.reasoningEffort,
            developer_instructions=request.input.instruction,
            context=request.input.context,
            output_schema=request.outputSchema,
            workspace=self.settings.workspace,
        )
        try:
            return first, self._validate_output(request, first), False
        except (InvalidOutputError, ValidationError) as first_error:
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
                output_schema=request.outputSchema,
                workspace=self.settings.workspace,
            )
            output = self._validate_output(request, repaired)
            return (
                BackendResult(
                    thread_id=repaired.thread_id,
                    final_response=repaired.final_response,
                    input_tokens=first.input_tokens + repaired.input_tokens,
                    cached_input_tokens=first.cached_input_tokens + repaired.cached_input_tokens,
                    output_tokens=first.output_tokens + repaired.output_tokens,
                ),
                output,
                True,
            )

    @staticmethod
    def _validate_output(request: AgentRunRequest, result: BackendResult) -> dict[str, Any]:
        if result.output_tokens > request.limits.maxOutputTokens:
            raise InvalidOutputError("출력이 허용된 토큰 한도를 초과했습니다.")
        try:
            raw_output: Any = json.loads(result.final_response)
        except json.JSONDecodeError as error:
            raise InvalidOutputError("Codex 출력이 JSON 객체가 아닙니다.") from error
        if not isinstance(raw_output, dict):
            raise InvalidOutputError("Codex 출력의 최상위 값은 JSON 객체여야 합니다.")
        Draft202012Validator(request.outputSchema).validate(raw_output)
        unexpected_evidence = set(_collect_evidence_ids(raw_output)) - set(request.input.evidenceIds)
        if unexpected_evidence:
            raise InvalidOutputError("입력에 없는 Evidence ID가 출력에 포함되었습니다.")
        return raw_output

    async def _safe_auth(self) -> AuthSnapshot:
        try:
            auth = await self.backend.auth()
            if "chatgpt" not in auth.mode.lower():
                return AuthSnapshot(mode=auth.mode, ready=False)
            return auth
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
            fresh = (
                time.monotonic() - self._catalog_fetched_monotonic
                < self.settings.catalog_ttl_seconds
            )
            if self._catalog and fresh:
                return self._catalog
            self._catalog = [item for item in await self.backend.catalog() if not item.hidden]
            self._catalog_fetched_monotonic = time.monotonic()
            self._catalog_fetched_at = datetime.now(UTC).isoformat()
            return self._catalog

    async def _resolve_model(self, profile: str, effort: str) -> CatalogEntry:
        allowed = self.settings.model_profiles.get(profile, ())
        if not allowed:
            raise ModelNotAvailableError(f"{profile} profile의 allowlist가 비어 있습니다.")
        by_name = {item.model: item for item in await self._get_catalog()}
        for model_name in allowed:
            candidate = by_name.get(model_name)
            if candidate is not None and effort in candidate.supported_efforts:
                return candidate
        raise ModelNotAvailableError(
            f"{profile} profile과 {effort} effort를 만족하는 허용 모델이 없습니다."
        )

    def _allowed_profiles_by_model(self) -> dict[str, list[str]]:
        result: dict[str, list[str]] = {}
        for profile, models in self.settings.model_profiles.items():
            for model in models:
                result.setdefault(model, []).append(profile)
        return result

    def _auth_context(self, auth: AuthSnapshot) -> AuthContext:
        lowered = auth.mode.lower()
        method: Literal["CHATGPT", "CODEX_ACCESS_TOKEN", "EXTERNAL_PROVIDER", "UNKNOWN"]
        if "chatgpt" in lowered:
            method = "CHATGPT"
        elif auth.mode == "external":
            method = "EXTERNAL_PROVIDER"
        elif auth.mode == "unknown":
            method = "UNKNOWN"
        else:
            method = "CODEX_ACCESS_TOKEN"
        fingerprint = hashlib.sha256(
            f"{self.settings.auth_boundary_id}:{auth.mode}".encode()
        ).hexdigest()[:24]
        workspace_hash = (
            hashlib.sha256(self.settings.workspace_id.encode()).hexdigest()[:24]
            if self.settings.workspace_id
            else None
        )
        return AuthContext(
            loginMethod=method,
            workspaceIdHash=workspace_hash,
            authFingerprint=fingerprint,
        )

    @staticmethod
    def _failure(
        request: AgentRunRequest,
        auth: AuthContext,
        status: RunStatus,
        code: str,
        retryable: bool,
        message: str,
    ) -> AgentRunResult:
        return AgentRunResult(
            runId=request.runId,
            status=status,
            authContext=auth,
            error=SafeError(code=code, retryable=retryable, safeMessage=message),
        )


_FORBIDDEN_CONTEXT_KEYS = {
    "accesstoken",
    "refreshtoken",
    "apikey",
    "authorization",
    "password",
    "oauthcredential",
    "rawprofile",
    "rawsurvey",
    "otherprofiles",
    "allprofiles",
}


def _normalized_key(key: str) -> str:
    return "".join(char for char in key.lower() if char.isalnum())


def _validate_input_context(request: AgentRunRequest) -> None:
    expected = {
        "runId": request.runId,
        "tripId": request.tripId,
        "planVersion": request.planVersion,
    }
    for key, value in expected.items():
        if request.input.context.get(key) != value:
            raise InvalidInputError(f"envelope와 context의 {key}가 일치하지 않습니다.")

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if _normalized_key(str(key)) in _FORBIDDEN_CONTEXT_KEYS:
                    raise InvalidInputError("Gateway 입력에 금지된 credential 또는 원본 프로필 필드가 있습니다.")
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(request.input.context)


def _validate_output_schema(schema: dict[str, Any]) -> None:
    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if key == "$ref" and isinstance(child, str) and not child.startswith("#"):
                    raise InvalidInputError("외부 JSON Schema 참조는 허용하지 않습니다.")
                if key == "$id" and isinstance(child, str) and "://" in child:
                    raise InvalidInputError("원격 JSON Schema ID는 허용하지 않습니다.")
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(schema)
    Draft202012Validator.check_schema(schema)


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


def _classify_runtime_error(error: Exception) -> tuple[RunStatus, str, bool, str]:
    text = str(error).lower()
    if any(token in text for token in ("unauthorized", "authentication", "login required", "not logged")):
        return "AUTH_REQUIRED", "AUTH_REQUIRED", False, "Codex 인증을 확인할 수 없습니다."
    if any(token in text for token in ("rate limit", "too many requests", "quota")):
        return "RATE_LIMITED", "RATE_LIMITED", True, "Codex 사용량 제한에 도달했습니다."
    if any(token in text for token in ("model not", "unknown model", "unsupported model")):
        return (
            "MODEL_NOT_AVAILABLE",
            "MODEL_NOT_AVAILABLE",
            False,
            "요청한 모델을 현재 인증에서 사용할 수 없습니다.",
        )
    return "FAILED", "CODEX_RUNTIME_ERROR", True, "Codex Runtime 실행에 실패했습니다."
