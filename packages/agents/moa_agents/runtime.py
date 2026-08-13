"""Fixture 실행과 ECS Codex Gateway 실행의 공통 경계."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, replace
from typing import Any, Protocol

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
