"""Worker와 Gateway 사이의 strict HTTP 계약."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from moa_agents.models import AgentRole


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class AgentRef(ApiModel):
    role: AgentRole
    instanceId: str = Field(min_length=1)
    participantId: str | None = None
    debateIssueId: str | None = None
    category: str | None = None
    promptVersion: str = Field(min_length=1)
    outputSchemaVersion: str = Field(min_length=1)


class ThreadRef(ApiModel):
    mode: Literal["NEW", "CONTINUE"]
    threadId: str | None = None

    @model_validator(mode="after")
    def require_thread_for_continue(self) -> "ThreadRef":
        if self.mode == "CONTINUE" and not self.threadId:
            raise ValueError("CONTINUE에는 threadId가 필요합니다.")
        if self.mode == "NEW" and self.threadId is not None:
            raise ValueError("NEW에는 threadId를 전달할 수 없습니다.")
        return self


class RunInput(ApiModel):
    instruction: str = Field(min_length=1)
    context: dict[str, Any]
    evidenceIds: list[str] = []


class RunLimits(ApiModel):
    timeoutMs: int = Field(ge=1_000, le=300_000)
    maxOutputTokens: int = Field(ge=128, le=32_768)


class AgentRunRequest(ApiModel):
    runId: str = Field(min_length=1)
    tripId: str = Field(min_length=1)
    planVersion: int = Field(ge=0)
    agent: AgentRef
    thread: ThreadRef
    modelProfile: Literal["FAST", "BALANCED", "DEEP_REASONING"]
    reasoningEffort: Literal["low", "medium", "high"]
    input: RunInput
    limits: RunLimits


class AuthContext(ApiModel):
    loginMethod: Literal["CHATGPT", "CODEX_ACCESS_TOKEN", "EXTERNAL_PROVIDER"]
    workspaceIdHash: str | None = None
    authFingerprint: str


class ModelContext(ApiModel):
    model: str
    reasoningEffort: str
    catalogFetchedAt: str


class RunUsage(ApiModel):
    inputTokens: int = 0
    cachedInputTokens: int = 0
    outputTokens: int = 0


class SafeError(ApiModel):
    code: str
    retryable: bool
    safeMessage: str


class AgentRunResult(ApiModel):
    runId: str
    status: Literal[
        "SUCCEEDED", "AUTH_REQUIRED", "MODEL_NOT_AVAILABLE", "RATE_LIMITED",
        "TIMED_OUT", "INVALID_OUTPUT", "FAILED",
    ]
    authContext: AuthContext
    modelContext: ModelContext | None = None
    threadId: str | None = None
    output: dict[str, Any] | None = None
    usage: RunUsage | None = None
    error: SafeError | None = None
