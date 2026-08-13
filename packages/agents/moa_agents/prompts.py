"""버전된 실행 프롬프트 registry."""

from dataclasses import dataclass

from .models import AgentRole


@dataclass(frozen=True, slots=True)
class PromptDefinition:
    prompt_id: str
    version: str
    role: AgentRole
    text: str


_SHARED = "입력에 없는 사실을 만들지 않는다. 내부 사고 과정은 출력하지 않고 계약된 JSON만 반환한다. 사실 주장은 근거 ID로 추적 가능해야 하며 사용자 동의가 필요한 변경은 결정하지 않는다."

PROMPTS_BY_ROLE: dict[AgentRole, PromptDefinition] = {
    "PARTICIPANT_PROXY": PromptDefinition("participant-proxy.system", "v1", "PARTICIPANT_PROXY", f"한 참가자의 목적·5/3/1 선호·양보 범위만 대변하고 타인의 원본 프로필을 추측하지 않는다. {_SHARED}"),
    "DEBATE_SUPERVISOR": PromptDefinition("debate-supervisor.system", "v1", "DEBATE_SUPERVISOR", f"허용된 다음 행동만 선택하고 점수나 최종 일정을 만들지 않는다. {_SHARED}"),
    "CATEGORY_WATCHER": PromptDefinition("category-watcher.system", "v1", "CATEGORY_WATCHER", f"기계 검증과 논리 감사에 따라 PASS/REVISE/BLOCK만 판단하며 후보를 고르지 않는다. {_SHARED}"),
    "CANDIDATE_SEARCH": PromptDefinition("candidate-search.system", "v1", "CANDIDATE_SEARCH", f"외부 API를 호출하지 않고 Data Gateway가 실행할 검색 계획만 만든다. {_SHARED}"),
    "LOGIC_AUDITOR": PromptDefinition("logic-auditor.system", "v1", "LOGIC_AUDITOR", f"전제·규칙·결론·근거의 연결만 검사하고 새 사실이나 규칙을 만들지 않는다. {_SHARED}"),
    "RESULT_FINALIZER": PromptDefinition("result-finalizer.system", "v1", "RESULT_FINALIZER", f"검증된 계획만 설명하고 새 후보·가격·예약 가능성을 만들지 않는다. {_SHARED}"),
}
