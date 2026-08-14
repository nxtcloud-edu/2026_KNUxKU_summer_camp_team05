"""Fixture 실행과 ECS Codex Gateway 실행의 공통 경계."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, replace
from typing import Any, Protocol

import httpx
from pydantic import BaseModel, ValidationError

from .models import AgentRole
from .privacy import PrivacyBoundaryError, assert_no_forbidden_context_keys
from .registry import get_agent_definition


@dataclass(frozen=True, slots=True)
class AgentRunRequest:
    role: AgentRole
    input: dict[str, Any] | BaseModel


@dataclass(frozen=True, slots=True)
class AgentUsage:
    input_tokens: int
    output_tokens: int


@dataclass(frozen=True, slots=True)
class AgentRunResult:
    status: str
    role: AgentRole
    spec_id: str
    output: BaseModel | None = None
    message: str | None = None
    issues: tuple[dict[str, Any], ...] = ()
    runtime: str | None = None
    model: str | None = None
    thread_id: str | None = None
    usage: AgentUsage | None = None
    repaired: bool = False


class AgentRuntime(ABC):
    @abstractmethod
    async def run(self, request: AgentRunRequest) -> AgentRunResult: ...


def _as_raw(value: dict[str, Any] | BaseModel) -> dict[str, Any]:
    return value.model_dump(mode="json") if isinstance(value, BaseModel) else value


class FixtureAgentRuntime(AgentRuntime):
    async def run(self, request: AgentRunRequest) -> AgentRunResult:
        definition = get_agent_definition(request.role)
        raw = _as_raw(request.input)
        try:
            assert_no_forbidden_context_keys(raw)
            parsed_input = definition.input_model.model_validate(raw)
        except (PrivacyBoundaryError, ValidationError) as error:
            issues = tuple(error.errors()) if isinstance(error, ValidationError) else ()
            return AgentRunResult("INPUT_SCHEMA_ERROR", request.role, definition.spec.spec_id, message=str(error), issues=issues)
        try:
            raw_output = definition.fixture_handler(parsed_input)
            output = definition.output_model.model_validate(raw_output, from_attributes=True)
        except (ValidationError, Exception) as error:
            issues = tuple(error.errors()) if isinstance(error, ValidationError) else ()
            return AgentRunResult("OUTPUT_SCHEMA_ERROR", request.role, definition.spec.spec_id, message=str(error), issues=issues)
        return AgentRunResult(
            "SUCCESS", request.role, definition.spec.spec_id, output=output,
            runtime="FIXTURE", repaired=False,
        )


@dataclass(frozen=True, slots=True)
class CodexGatewayRequest:
    agent_run_id: str
    spec_id: str
    role: AgentRole
    prompt: dict[str, str]
    input: dict[str, Any]
    model_profile: str
    reasoning_effort: str
    max_output_tokens: int
    timeout_ms: int
    thread: dict[str, Any]
    repair: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class CodexGatewayResponse:
    output: dict[str, Any]
    model: str
    thread_id: str | None
    usage: AgentUsage


class CodexGatewayClient(Protocol):
    """ECS에서 Auth와 실제 모델을 소유하는 Gateway가 구현할 포트."""

    async def run(self, request: CodexGatewayRequest) -> CodexGatewayResponse: ...


class HttpCodexGatewayClient:
    """Gateway의 localhost AgentRun API를 호출하고 persistent thread를 격리한다."""

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:4600",
        *,
        timeout_seconds: float = 70.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=timeout_seconds,
            transport=transport,
        )
        self._thread_ids: dict[tuple[object, ...], str] = {}

    async def __aenter__(self) -> "HttpCodexGatewayClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def ready(self) -> bool:
        try:
            response = await self._client.get("/readyz")
            return response.status_code == 200 and bool(response.json().get("ready"))
        except httpx.HTTPError:
            return False

    @staticmethod
    def _thread_key(request: CodexGatewayRequest) -> tuple[object, ...]:
        data = request.input
        participant = data.get("participant")
        participant_id = participant.get("participantId") if isinstance(participant, dict) else None
        return (
            data.get("tripId"), data.get("planVersion"), request.role,
            participant_id, data.get("debateIssueId"), data.get("category"),
        )

    async def run(self, request: CodexGatewayRequest) -> CodexGatewayResponse:
        key = self._thread_key(request)
        persistent = request.thread.get("mode") == "PERSISTENT"
        thread_id = self._thread_ids.get(key) if persistent else None
        instruction = request.prompt["text"]
        if request.repair is not None:
            instruction += (
                "\n직전 출력이 JSON Schema를 통과하지 못했다. schemaIssues를 반영해 "
                "계약된 JSON 객체만 다시 반환한다."
            )

        data = request.input
        participant = data.get("participant")
        payload = {
            "runId": request.agent_run_id,
            "tripId": data["tripId"],
            "planVersion": data["planVersion"],
            "agent": {
                "role": request.role,
                "instanceId": request.spec_id,
                "participantId": participant.get("participantId") if isinstance(participant, dict) else None,
                "debateIssueId": data.get("debateIssueId"),
                "category": data.get("category"),
                "promptVersion": request.prompt["version"],
                "outputSchemaVersion": "v1",
            },
            "thread": {"mode": "CONTINUE" if thread_id else "NEW", "threadId": thread_id},
            "modelProfile": request.model_profile,
            "reasoningEffort": request.reasoning_effort,
            "input": {
                "instruction": instruction,
                "context": data,
                "evidenceIds": _collect_evidence_ids(data),
            },
            "limits": {
                "timeoutMs": request.timeout_ms,
                "maxOutputTokens": request.max_output_tokens,
            },
        }
        if request.repair is not None:
            payload["input"]["context"] = {  # type: ignore[index]
                "originalInput": data,
                "repair": request.repair,
            }

        response = await self._client.post("/internal/v1/agent-runs", json=payload)
        response.raise_for_status()
        body = response.json()
        if body.get("status") != "SUCCEEDED":
            error = body.get("error") or {}
            raise RuntimeError(f"{body.get('status', 'FAILED')}: {error.get('safeMessage', 'Gateway run failed')}")
        returned_thread_id = body.get("threadId")
        if persistent and returned_thread_id:
            self._thread_ids[key] = returned_thread_id
        usage = body.get("usage") or {}
        return CodexGatewayResponse(
            output=body["output"],
            model=body["modelContext"]["model"],
            thread_id=returned_thread_id,
            usage=AgentUsage(
                input_tokens=int(usage.get("inputTokens") or 0),
                output_tokens=int(usage.get("outputTokens") or 0),
            ),
        )


def _collect_evidence_ids(value: Any) -> list[str]:
    found: set[str] = set()

    def visit(item: Any) -> None:
        if isinstance(item, dict):
            for key, child in item.items():
                if key in {"evidenceId", "evidenceIds"}:
                    if isinstance(child, str):
                        found.add(child)
                    elif isinstance(child, list):
                        found.update(value for value in child if isinstance(value, str))
                visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)

    visit(value)
    return sorted(found)


class CodexAgentRuntime(AgentRuntime):
    def __init__(self, gateway: CodexGatewayClient) -> None:
        self._gateway = gateway

    async def run(self, request: AgentRunRequest) -> AgentRunResult:
        definition = get_agent_definition(request.role)
        raw = _as_raw(request.input)
        try:
            assert_no_forbidden_context_keys(raw)
            parsed = definition.input_model.model_validate(raw)
        except (PrivacyBoundaryError, ValidationError) as error:
            issues = tuple(error.errors()) if isinstance(error, ValidationError) else ()
            return AgentRunResult("INPUT_SCHEMA_ERROR", request.role, definition.spec.spec_id, message=str(error), issues=issues)

        gateway_request = CodexGatewayRequest(
            agent_run_id=str(parsed.run_id),
            spec_id=definition.spec.spec_id,
            role=request.role,
            prompt={"id": definition.prompt.prompt_id, "version": definition.prompt.version, "text": definition.prompt.text},
            input=parsed.model_dump(mode="json"),
            model_profile=definition.spec.model.profile,
            reasoning_effort=definition.spec.model.preferred_reasoning_effort,
            max_output_tokens=definition.spec.execution.max_output_tokens,
            timeout_ms=definition.spec.execution.timeout_ms,
            thread={"mode": definition.spec.thread.mode, "key_dimensions": definition.spec.thread.key_dimensions},
        )
        try:
            response = await self._gateway.run(gateway_request)
            repaired = False
            try:
                output = definition.output_model.model_validate(response.output)
            except ValidationError as first_error:
                if definition.spec.contracts.output_repair_attempts != 1:
                    raise
                repaired = True
                response = await self._gateway.run(replace(
                    gateway_request,
                    repair={"previous_output": response.output, "schema_issues": first_error.errors()},
                ))
                output = definition.output_model.model_validate(response.output)
            return AgentRunResult(
                "SUCCESS", request.role, definition.spec.spec_id, output=output,
                runtime="CODEX_GATEWAY", model=response.model, thread_id=response.thread_id,
                usage=response.usage, repaired=repaired,
            )
        except ValidationError as error:
            return AgentRunResult("OUTPUT_SCHEMA_ERROR", request.role, definition.spec.spec_id, message="Codex 출력이 repair 후에도 계약에 맞지 않습니다.", issues=tuple(error.errors()))
        except Exception as error:
            return AgentRunResult("RUNTIME_ERROR", request.role, definition.spec.spec_id, message=str(error))


async def require_agent_output(runtime: AgentRuntime, request: AgentRunRequest) -> BaseModel:
    result = await runtime.run(request)
    if result.status != "SUCCESS" or result.output is None:
        raise RuntimeError(f"{result.status}: {result.message}")
    return result.output
