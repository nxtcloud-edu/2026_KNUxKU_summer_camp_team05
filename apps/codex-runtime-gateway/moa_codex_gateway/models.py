from __future__ import annotations

from typing import Any, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, model_validator


AgentRole: TypeAlias = Literal["USER_PROXY", "STAY_ARBITER", "TRIP_SUPERVISOR"]
ModelProfile: TypeAlias = Literal["FAST", "BALANCED", "DEEP_REASONING"]
ReasoningEffort: TypeAlias = Literal["low", "medium", "high"]
RunStatus: TypeAlias = Literal[
    "SUCCEEDED",
    "AUTH_REQUIRED",
    "MODEL_NOT_AVAILABLE",
    "RATE_LIMITED",
    "TIMED_OUT",
    "INVALID_OUTPUT",
    "FAILED",
]


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class AgentRef(ApiModel):
    role: AgentRole
    instanceId: str = Field(min_length=1)
    participantId: str | None = None
    category: Literal["stay"] | None = None
    promptVersion: str = Field(min_length=1)
    inputContractVersion: str = Field(min_length=1)
    outputContractVersion: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_scope(self) -> "AgentRef":
        if self.role == "USER_PROXY" and not self.participantId:
            raise ValueError("USER_PROXY에는 participantId가 필요합니다.")
        if self.role != "USER_PROXY" and self.participantId is not None:
            raise ValueError("USER_PROXY 외 역할에는 participantId를 전달할 수 없습니다.")
        if self.role == "STAY_ARBITER" and self.category != "stay":
            raise ValueError("STAY_ARBITER category는 stay여야 합니다.")
        if self.role != "STAY_ARBITER" and self.category is not None:
            raise ValueError("STAY_ARBITER 외 역할에는 category를 전달할 수 없습니다.")
        return self


class ThreadRef(ApiModel):
    mode: Literal["NEW", "CONTINUE"]
    threadId: str | None = None

    @model_validator(mode="after")
    def validate_thread(self) -> "ThreadRef":
        if self.mode == "CONTINUE" and not self.threadId:
            raise ValueError("CONTINUE에는 threadId가 필요합니다.")
        if self.mode == "NEW" and self.threadId is not None:
            raise ValueError("NEW에는 threadId를 전달할 수 없습니다.")
        return self


class RunInput(ApiModel):
    instruction: str = Field(min_length=1, max_length=20_000)
    context: dict[str, Any]
    evidenceIds: list[str] = Field(default_factory=list)


class RunLimits(ApiModel):
    timeoutMs: int = Field(ge=1_000, le=300_000)
    maxOutputTokens: int = Field(ge=128, le=32_768)


class AgentRunRequest(ApiModel):
    schemaVersion: Literal[1]
    runId: str = Field(min_length=1)
    tripId: str = Field(min_length=1)
    planVersion: int = Field(ge=0)
    agent: AgentRef
    thread: ThreadRef
    modelProfile: ModelProfile
    reasoningEffort: ReasoningEffort
    input: RunInput
    outputSchema: dict[str, Any]
    limits: RunLimits


class AuthContext(ApiModel):
    loginMethod: Literal["CHATGPT", "CODEX_ACCESS_TOKEN", "EXTERNAL_PROVIDER", "UNKNOWN"]
    workspaceIdHash: str | None = None
    authFingerprint: str


class ModelContext(ApiModel):
    model: str
    reasoningEffort: ReasoningEffort
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
    status: RunStatus
    authContext: AuthContext
    modelContext: ModelContext | None = None
    threadId: str | None = None
    output: dict[str, Any] | None = None
    usage: RunUsage | None = None
    repairUsed: bool = False
    error: SafeError | None = None
