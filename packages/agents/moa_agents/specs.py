"""정적 AgentSpec. 실제 모델명과 Auth는 ECS Gateway가 결정한다."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from .models import AgentRole, StrictModel


class PromptRef(StrictModel):
    prompt_id: str
    version: str


class ContractRef(StrictModel):
    input_schema_id: str
    input_schema_version: str = "v1"
    output_schema_id: str
    output_schema_version: str = "v1"
    strict_output: Literal[True] = True
    output_repair_attempts: int = Field(ge=0, le=1)


class ModelPolicy(StrictModel):
    profile: Literal["FAST", "BALANCED", "DEEP_REASONING"]
    preferred_reasoning_effort: Literal["low", "medium", "high"]
    unavailable_policy: Literal["FAIL_CLOSED"] = "FAIL_CLOSED"


class ExecutionPolicy(StrictModel):
    sandbox: Literal["READ_ONLY"] = "READ_ONLY"
    approval_policy: Literal["NEVER"] = "NEVER"
    side_effect_policy: Literal["PROPOSE_ONLY"] = "PROPOSE_ONLY"
    allowed_tool_ids: list[str] = []
    max_tool_calls_per_run: int = 0
    timeout_ms: int = 60_000
    max_output_tokens: int = 2_048


class PrivacyPolicy(StrictModel):
    scope: Literal["PARTICIPANT", "CATEGORY", "TRIP"]
    context_projection_id: str
    cross_participant_raw_profile_access: Literal[False] = False
    credentials_access: Literal["NONE"] = "NONE"
    direct_database_access: Literal["NONE"] = "NONE"


class ThreadPolicy(StrictModel):
    mode: Literal["PERSISTENT", "EPHEMERAL"]
    key_dimensions: list[str]
    stale_on_plan_version_change: Literal[True] = True
    retention_days: int = Field(ge=0, le=30)


class AgentSpec(StrictModel):
    schema_version: Literal[1] = 1
    spec_id: str
    role: AgentRole
    display_name: str
    description: str
    enabled: bool = True
    prompt: PromptRef
    contracts: ContractRef
    model: ModelPolicy
    execution: ExecutionPolicy
    privacy: PrivacyPolicy
    thread: ThreadPolicy

    @model_validator(mode="after")
    def validate_boundaries(self) -> "AgentSpec":
        if self.thread.mode == "EPHEMERAL" and (self.thread.key_dimensions or self.thread.retention_days != 0):
            raise ValueError("EPHEMERAL thread에는 key와 retention을 둘 수 없습니다.")
        if self.thread.mode == "PERSISTENT":
            required = {"trip_id", "plan_version", "role"}
            if not required.issubset(self.thread.key_dimensions) or self.thread.retention_days < 1:
                raise ValueError("PERSISTENT thread 필수 key 또는 retention이 없습니다.")
        if self.role == "PARTICIPANT_PROXY":
            required = {"participant_id", "debate_issue_id"}
            if self.privacy.scope != "PARTICIPANT" or self.thread.mode != "PERSISTENT" or not required.issubset(self.thread.key_dimensions):
                raise ValueError("Participant Proxy 격리 규칙을 위반했습니다.")
        if self.role in {"CATEGORY_WATCHER", "CANDIDATE_SEARCH"} and self.privacy.scope != "CATEGORY":
            raise ValueError("분야 Agent는 CATEGORY scope여야 합니다.")
        if self.role not in {"PARTICIPANT_PROXY", "CATEGORY_WATCHER", "CANDIDATE_SEARCH"} and self.privacy.scope != "TRIP":
            raise ValueError("전역 Agent는 TRIP scope여야 합니다.")
        return self


def _spec(
    role: AgentRole,
    slug: str,
    display_name: str,
    description: str,
    profile: Literal["FAST", "BALANCED", "DEEP_REASONING"],
    effort: Literal["low", "medium", "high"],
    scope: Literal["PARTICIPANT", "CATEGORY", "TRIP"],
    *,
    persistent: bool = False,
    output_tokens: int = 2_048,
) -> AgentSpec:
    return AgentSpec(
        spec_id=f"{slug}.v1",
        role=role,
        display_name=display_name,
        description=description,
        prompt=PromptRef(prompt_id=f"{slug}.system", version="v1"),
        contracts=ContractRef(
            input_schema_id=f"{slug}.input",
            output_schema_id=f"{slug}.output",
            output_repair_attempts=1,
        ),
        model=ModelPolicy(profile=profile, preferred_reasoning_effort=effort),
        execution=ExecutionPolicy(max_output_tokens=output_tokens),
        privacy=PrivacyPolicy(scope=scope, context_projection_id=f"{slug}.projection"),
        thread=ThreadPolicy(
            mode="PERSISTENT" if persistent else "EPHEMERAL",
            key_dimensions=["trip_id", "plan_version", "role", "participant_id", "debate_issue_id"] if persistent else [],
            retention_days=7 if persistent else 0,
        ),
    )


ALL_AGENT_SPECS = (
    _spec("PARTICIPANT_PROXY", "participant-proxy", "참가자 대리 Agent", "한 참가자의 목적·선호·양보 범위만 대변한다.", "BALANCED", "medium", "PARTICIPANT", persistent=True),
    _spec("DEBATE_SUPERVISOR", "debate-supervisor", "토론 진행 Agent", "쟁점·순서·반복 한도와 사용자 결정권을 관리한다.", "DEEP_REASONING", "high", "TRIP"),
    _spec("CATEGORY_WATCHER", "category-watcher", "카테고리 감시자 Agent", "분야 규칙과 검증 결과를 감시한다.", "BALANCED", "medium", "CATEGORY"),
    _spec("CANDIDATE_SEARCH", "candidate-search", "후보 탐색 Agent", "비정형 요구를 Data Gateway 검색 계획으로 변환한다.", "FAST", "low", "CATEGORY"),
    _spec("LOGIC_AUDITOR", "logic-auditor", "논리 검증 Agent", "사실·근거·규칙·결론의 연결을 검증한다.", "DEEP_REASONING", "high", "TRIP", output_tokens=3_072),
    _spec("RESULT_FINALIZER", "result-finalizer", "결과 설명 Agent", "검증 완료 계획을 사용자 결과로 표현한다.", "FAST", "low", "TRIP", output_tokens=3_072),
)
