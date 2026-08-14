"""공식 openai-codex SDK를 감싸는 얇은 어댑터."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from openai_codex import ApprovalMode, AsyncCodex, CodexConfig, Sandbox
from openai_codex.generated.v2_all import ReasoningEffort


@dataclass(frozen=True, slots=True)
class CatalogEntry:
    model: str
    is_default: bool
    hidden: bool
    supported_efforts: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AuthSnapshot:
    mode: str
    ready: bool


@dataclass(frozen=True, slots=True)
class BackendResult:
    thread_id: str
    final_response: str
    input_tokens: int
    cached_input_tokens: int
    output_tokens: int


class CodexBackend(Protocol):
    async def catalog(self) -> list[CatalogEntry]: ...
    async def auth(self) -> AuthSnapshot: ...
    async def run(
        self,
        *,
        thread_id: str | None,
        model: str,
        effort: str,
        developer_instructions: str,
        context: dict[str, Any],
        output_schema: dict[str, Any],
        persistent: bool,
        workspace: Path,
    ) -> BackendResult: ...
    async def close(self) -> None: ...


class SdkCodexBackend:
    def __init__(self) -> None:
        self._codex = AsyncCodex(CodexConfig(
            client_name="moa_runtime_gateway",
            client_title="MOA Codex Runtime Gateway",
            experimental_api=False,
        ))
        self._entered = False

    async def start(self) -> None:
        if not self._entered:
            await self._codex.__aenter__()
            self._entered = True

    async def catalog(self) -> list[CatalogEntry]:
        await self.start()
        response = await self._codex.models(include_hidden=False)
        return [
            CatalogEntry(
                model=item.model,
                is_default=item.is_default,
                hidden=item.hidden,
                supported_efforts=tuple(option.reasoning_effort.value for option in item.supported_reasoning_efforts),
            )
            for item in response.data
        ]

    async def auth(self) -> AuthSnapshot:
        await self.start()
        response = await self._codex.account(refresh_token=False)
        if response.account is None:
            return AuthSnapshot(mode="external", ready=not response.requires_openai_auth)
        return AuthSnapshot(mode=str(response.account.type), ready=True)

    async def run(
        self,
        *,
        thread_id: str | None,
        model: str,
        effort: str,
        developer_instructions: str,
        context: dict[str, Any],
        output_schema: dict[str, Any],
        persistent: bool,
        workspace: Path,
    ) -> BackendResult:
        await self.start()
        workspace.mkdir(parents=True, exist_ok=True)
        if thread_id:
            thread = await self._codex.thread_resume(
                thread_id,
                approval_mode=ApprovalMode.deny_all,
                developer_instructions=developer_instructions,
                model=model,
                sandbox=Sandbox.read_only,
                cwd=str(workspace),
            )
        else:
            thread = await self._codex.thread_start(
                approval_mode=ApprovalMode.deny_all,
                developer_instructions=developer_instructions,
                ephemeral=not persistent,
                model=model,
                sandbox=Sandbox.read_only,
                cwd=str(workspace),
                service_name="moa-agent-runtime",
            )
        result = await thread.run(
            "다음 입력 JSON만 근거로 판단하고 출력 JSON Schema에 맞는 객체만 반환한다.\n"
            + json.dumps(context, ensure_ascii=False, separators=(",", ":")),
            effort=ReasoningEffort(effort),
            output_schema=output_schema,
            sandbox=Sandbox.read_only,
        )
        if result.final_response is None:
            raise RuntimeError(f"Codex turn이 응답 없이 종료되었습니다: {result.status}")
        usage = result.usage.last if result.usage is not None else None
        return BackendResult(
            thread_id=thread.id,
            final_response=result.final_response,
            input_tokens=usage.input_tokens if usage else 0,
            cached_input_tokens=usage.cached_input_tokens if usage else 0,
            output_tokens=usage.output_tokens if usage else 0,
        )

    async def close(self) -> None:
        if self._entered:
            await self._codex.close()
            self._entered = False
