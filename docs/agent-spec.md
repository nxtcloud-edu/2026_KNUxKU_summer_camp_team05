# 공통 AgentSpec 명세

- **문서 버전**: v1.0 / 2026-08-14
- **정식 스키마**: [`packages/contracts/src/agent-spec.ts`](../packages/contracts/src/agent-spec.ts)
- **연계 문서**: [에이전트 아키텍처](agent-architecture.md) · [ECS 기반 Codex Auth 런타임](ecs-codex-auth-agent-architecture.md)
- **범위**: MOA의 모든 LLM Agent가 배포 시 등록해야 하는 공통 정적 계약

---

## 1. 목적

`AgentSpec`은 “이 Agent가 누구이며, 무엇을 볼 수 있고, 어떤 한도 안에서 어떤 형식으로 답해야 하는가”를 정의한다.

다음 값은 `AgentSpec`에 넣지 않는다.

- `tripId`, `runId`, `participantId`, 현재 계획처럼 실행마다 달라지는 값
- Codex Auth token, account email, `auth.json`
- 실제 Codex model 이름과 thread ID
- 설문 원문이나 일정 원문

이 값들은 실행 시 `AgentRunRequest`와 `CodexRuntimeGateway`가 결합한다.

```text
AgentSpec(정적 역할 계약)
        + AgentRunRequest(여행별 입력)
        + Runtime Model Resolution(Auth별 모델)
        = 실제 Agent 실행
```

---

## 2. 역할 목록

```ts
type AgentRole =
  | "PARTICIPANT_PROXY"
  | "DEBATE_SUPERVISOR"
  | "CATEGORY_WATCHER"
  | "CANDIDATE_SEARCH"
  | "LOGIC_AUDITOR"
  | "RESULT_FINALIZER";
```

새 역할을 추가하려면 enum만 늘리지 않고 입력·출력 스키마, 개인정보 projection, 평가 데이터까지 함께 추가해야 한다.

---

## 3. 정식 구조

```ts
type AgentSpec = {
  schemaVersion: 1;
  specId: string;
  role: AgentRole;
  displayName: string;
  description: string;
  enabled: boolean;

  prompt: {
    promptId: string;
    version: `v${number}`;
  };

  contracts: {
    inputSchemaId: string;
    inputSchemaVersion: string;
    outputSchemaId: string;
    outputSchemaVersion: string;
    strictOutput: true;
    outputRepairAttempts: 0 | 1;
  };

  model: {
    profile: "FAST" | "BALANCED" | "DEEP_REASONING";
    preferredReasoningEffort: string;
    unavailablePolicy: "FAIL_CLOSED";
  };

  execution: {
    sandbox: "READ_ONLY";
    approvalPolicy: "NEVER";
    sideEffectPolicy: "PROPOSE_ONLY";
    allowedToolIds: string[];
    maxToolCallsPerRun: number;
    timeoutMs: number;
    maxOutputTokens: number;
    maxThreadTurns: number;
  };

  privacy: {
    scope: "PARTICIPANT" | "CATEGORY" | "TRIP";
    contextProjectionId: string;
    crossParticipantRawProfileAccess: false;
    credentialsAccess: "NONE";
    directDatabaseAccess: "NONE";
  };

  thread: {
    mode: "PERSISTENT" | "EPHEMERAL";
    keyDimensions: Array<
      "tripId" | "planVersion" | "role" | "participantId" | "debateIssueId" | "category"
    >;
    staleOnPlanVersionChange: true;
    retentionDays: number;
  };

  retry: {
    maxAttempts: 1 | 2 | 3;
    retryableErrorCodes: Array<
      "RATE_LIMITED" | "TIMED_OUT" | "RUNTIME_UNAVAILABLE"
    >;
    backoff: {
      strategy: "EXPONENTIAL_JITTER";
      initialDelayMs: number;
      maxDelayMs: number;
    };
  };
};
```

---

## 4. 필드 결정

### 4.1 식별자와 버전

| 필드 | 의미 |
| --- | --- |
| `schemaVersion` | `AgentSpec` 자체 구조의 버전 |
| `specId` | Agent 정의의 안정적인 식별자 |
| `prompt.version` | 프롬프트 변경 추적 |
| `inputSchemaVersion` | 입력 계약 변경 추적 |
| `outputSchemaVersion` | 출력 계약 변경 추적 |

프롬프트와 입출력 스키마는 독립적으로 버전 관리한다. 문구만 바뀐 것과 데이터 계약이 바뀐 것을 구분해야 회귀 원인을 찾을 수 있기 때문이다.

### 4.2 모델

`model.profile`은 모델 이름이 아니라 실행 의도다.

| Profile | 의미 |
| --- | --- |
| `FAST` | 검색 질의 생성처럼 짧고 반복적인 작업 |
| `BALANCED` | Proxy·Watcher·Finalizer의 일반 판단 |
| `DEEP_REASONING` | Supervisor·Logic Auditor의 복합 판단 |

실제 모델은 Gateway가 다음 교집합에서 고른다.

```text
현재 Codex Auth의 model/list
∩ 운영 allowlist
∩ AgentSpec.model.profile
```

`preferredReasoningEffort`는 Codex의 `model/list`가 반환한 지원 목록과 실행 전에 대조한다. 지원되지 않으면 명시적으로 실패하며 임의로 낮추지 않는다.

### 4.3 출력 계약

- 모든 Agent 출력은 역할별 JSON Schema를 사용한다.
- `strictOutput`은 항상 `true`다.
- 출력이 스키마에 맞지 않으면 같은 thread에서 최대 1회만 repair한다.
- repair도 실패하면 결과를 폐기하고 `INVALID_OUTPUT`으로 기록한다.
- 자유 형식 설명은 JSON의 설명 필드 안에서만 허용한다.

### 4.4 실행 권한

모든 LLM Agent의 기본 권한은 다음과 같다.

```text
READ_ONLY
NEVER approval
PROPOSE_ONLY
DB 직접 접근 금지
Codex 인증 접근 금지
```

Agent가 제안한 변경은 Orchestrator와 결정론적 검증기를 거쳐야만 DB와 일정에 반영된다.

`allowedToolIds`는 allowlist다. 빈 배열은 모든 도구를 거부한다. Candidate Search도 여행 API를 직접 호출하지 않고 검색 요청 구조만 만들며, 실제 호출은 Orchestrator가 결정론적 Data Gateway에 맡긴다. 표준 설문 검색은 `SearchPlanner` 코드가 처리하고, Candidate Search는 자유 입력을 구조화하지 못했거나 검증 후보가 부족한 경우에만 호출한다.

### 4.5 개인정보 범위

| 역할 | `privacy.scope` | 원본 데이터 접근 범위 |
| --- | --- | --- |
| `PARTICIPANT_PROXY` | `PARTICIPANT` | 자신의 projection만 |
| `CATEGORY_WATCHER` | `CATEGORY` | 해당 분야에 필요한 최소 projection |
| `CANDIDATE_SEARCH` | `CATEGORY` | 익명화된 검색 조건 |
| `DEBATE_SUPERVISOR` | `TRIP` | 공개 가능한 구조화 주장과 집계값 |
| `LOGIC_AUDITOR` | `TRIP` | 주장·근거·규칙 ID |
| `RESULT_FINALIZER` | `TRIP` | 검증된 최종 결과와 공개 설명 데이터 |

`TRIP`은 모든 원본 설문을 볼 수 있다는 뜻이 아니다. 해당 역할의 `contextProjectionId`가 허용한 필드만 볼 수 있다.

`CATEGORY_WATCHER`는 공통 역할 하나를 사용한다. Flight·Transport·Accommodation·Activity·Dining·Schedule·Budget 실행 인스턴스는 `category`와 `rulePackVersion`으로 분리하며, AgentSpec과 출력 계약을 복제하지 않는다.

MVP에서는 다른 참가자의 정확한 알레르기 항목과 당사자를 Participant Proxy에 주입하지 않는다. 알레르기는 결정론적 안전 검증 코드가 처리하고 Proxy에는 `GROUP_SAFETY_CONSTRAINT` 결과만 공개한다. 참가자 간 상세 공개·동의 관리 기능은 후속 범위로 보류한다.

### 4.6 Thread

지속형 thread의 최소 key는 다음과 같다.

```text
tripId + planVersion + role
```

Proxy Agent는 여기에 `participantId`와 `debateIssueId`가 반드시 포함된다.

```text
tripId + planVersion + PARTICIPANT_PROXY + participantId + debateIssueId
```

각 논의 쟁점은 독립 thread를 사용한다. 숙소 위치 충돌에서 나눈 대화가 식사 예산 충돌에 그대로 섞이지 않게 하기 위해서다. 이전 쟁점에서 확정된 취향 미반영은 thread 기억으로 전달하지 않고 Orchestrator가 관리하는 `PreferenceLossLedger`에서 현재 쟁점과 관련된 항목만 projection한다.

```ts
type PreferenceLossLedgerEntry = {
  participantId: string;
  debateIssueId: string;
  planVersion: number;
  preferenceId: string;
  importance: 5 | 3 | 1;
  originalRequest: string;
  finalDecision: string;
  status: "NOT_REFLECTED" | "PARTIALLY_REFLECTED" | "REPLACED" | "DEFERRED";
  acceptedBy: "AUTO_POLICY" | "PROXY_DELEGATION" | "USER_CONFIRMATION";
  receivedCompensation?: {
    type: "ALTERNATIVE" | "BUDGET" | "TIME" | "NEXT_CHOICE";
    description: string;
  };
};
```

양보 권한은 점수로 제한한다. 5점·목적급 콘텐츠의 미반영은 `USER_CONFIRMATION` 없이는 확정할 수 없고, 3점은 Proxy가 조건부로 양보한 뒤 사용자에게 알리며, 1점은 자동 정책으로 조정할 수 있다. 개인은 자신의 양보 내역을 보고, 그룹에는 합의 결과만 공개한다.

Proxy의 협상안 투표는 `SUPPORT | ACCEPTABLE | OPPOSE | USER_CONFIRMATION_REQUIRED`로 제한한다. 반대 또는 사용자 확인 요청에는 `HARD_CONSTRAINT | PROTECTED_OBJECTIVE | MIN_SATISFACTION | FIVE_POINT_PREFERENCE | SOFT_PREFERENCE | ALTERNATIVE_PREFERENCE` 중 사유 코드와 영향받는 preference ID를 함께 반환해야 한다. 전원 `SUPPORT` 또는 `ACCEPTABLE`일 때만 Agent 합의이며 다수결은 사용하지 않는다. 최초 안을 포함한 투표는 최대 3회, 수정은 최대 2회다.

`planVersion`이 바뀌면 기존 thread는 항상 `STALE`이다. 대화 기억은 검증된 DB 사실을 대체하지 않는다.

`EPHEMERAL`은 key와 보존 기간이 모두 없어야 한다. `PERSISTENT`는 1~30일 범위의 보존 기간을 명시한다.

### 4.7 재시도

재시도 가능한 오류는 일시적 인프라 오류로 제한한다.

```text
RATE_LIMITED
TIMED_OUT
RUNTIME_UNAVAILABLE
```

다음 오류는 자동 재시도하지 않는다.

```text
AUTH_REQUIRED
AUTH_FORBIDDEN
MODEL_NOT_AVAILABLE
MODEL_PROFILE_UNSATISFIED
HARD_CONSTRAINT_VIOLATION
```

`INVALID_OUTPUT`은 일반 retry가 아니라 `outputRepairAttempts` 정책으로만 처리한다.

---

## 5. 예시 — Participant Proxy

```ts
const participantProxySpec = {
  schemaVersion: 1,
  specId: "participant-proxy.default",
  role: "PARTICIPANT_PROXY",
  displayName: "참가자 대리 Agent",
  description: "한 참가자의 목적·제약·취향을 왜곡 없이 대변한다.",
  enabled: true,

  prompt: {
    promptId: "participant-proxy",
    version: "v1",
  },

  contracts: {
    inputSchemaId: "participant-proxy.input",
    inputSchemaVersion: "v1",
    outputSchemaId: "participant-proxy.output",
    outputSchemaVersion: "v1",
    strictOutput: true,
    outputRepairAttempts: 1,
  },

  model: {
    profile: "BALANCED",
    preferredReasoningEffort: "medium",
    unavailablePolicy: "FAIL_CLOSED",
  },

  execution: {
    sandbox: "READ_ONLY",
    approvalPolicy: "NEVER",
    sideEffectPolicy: "PROPOSE_ONLY",
    allowedToolIds: [],
    maxToolCallsPerRun: 0,
    timeoutMs: 120000,
    maxOutputTokens: 1500,
    maxThreadTurns: 12,
  },

  privacy: {
    scope: "PARTICIPANT",
    contextProjectionId: "participant-proxy-context",
    crossParticipantRawProfileAccess: false,
    credentialsAccess: "NONE",
    directDatabaseAccess: "NONE",
  },

  thread: {
    mode: "PERSISTENT",
    keyDimensions: ["tripId", "planVersion", "role", "participantId", "debateIssueId"],
    staleOnPlanVersionChange: true,
    retentionDays: 7,
  },

  retry: {
    maxAttempts: 3,
    retryableErrorCodes: ["RATE_LIMITED", "TIMED_OUT", "RUNTIME_UNAVAILABLE"],
    backoff: {
      strategy: "EXPONENTIAL_JITTER",
      initialDelayMs: 1000,
      maxDelayMs: 10000,
    },
  },
} as const;
```

위 수치는 최초 운영값이며 eval과 실제 사용량 측정 후 조정한다. 권한·개인정보·fail-closed 정책은 성능 튜닝 대상으로 보지 않는다.

---

## 6. 런타임 검증 순서

```text
AgentSpec 등록
→ Zod parse
→ role별 개인정보·thread 불변식 확인
→ prompt/input/output schema registry 참조 확인
→ model/list와 model profile 검증
→ tool registry allowlist 확인
→ 활성 Agent Registry에 등록
```

등록에 실패한 Agent는 실행 시점에 복구하려 하지 않고 배포 단계에서 비활성화한다.

---

## 7. 불변식

```text
[SPEC-01] AgentSpec은 정적 정의이며 여행별 데이터를 포함하지 않는다.
[SPEC-02] AgentSpec은 Auth token과 실제 model 이름을 포함하지 않는다.
[SPEC-03] 모든 Agent 출력은 versioned strict JSON Schema를 사용한다.
[SPEC-04] 모든 LLM Agent는 READ_ONLY·PROPOSE_ONLY다.
[SPEC-05] Agent는 DB와 Codex credential에 직접 접근하지 않는다.
[SPEC-06] Proxy thread는 participantId와 debateIssueId 단위로 격리한다.
[SPEC-07] planVersion 변경 시 기존 thread를 재사용하지 않는다.
[SPEC-08] 모델을 사용할 수 없으면 다른 모델로 조용히 폴백하지 않는다.
[SPEC-09] 자동 재시도는 일시적 런타임 오류만 대상으로 한다.
[SPEC-10] 개인정보 접근은 scope가 아니라 context projection이 최종 제한한다.
```

---

## 8. 완료 기준

- [x] 공통 역할 enum 정의
- [x] Zod runtime schema 정의
- [x] TypeScript 공통 역할 enum과 Python Pydantic runtime model 제공
- [x] prompt·입출력 schema 버전 분리
- [x] model profile과 fail-closed 정책 정의
- [x] read-only·propose-only 권한 정의
- [x] privacy scope와 context projection 정의
- [x] persistent·ephemeral thread 불변식 정의
- [x] retry 대상과 상한 정의
- [x] 역할별 실제 `AgentSpec` 6개 등록
- [x] prompt registry 구현
- [x] input/output schema registry 구현
- [x] tool allowlist 등록(MVP는 전 역할 빈 배열)
- [x] `CodexGatewayClient` 실행 경계 연결
- [ ] Gateway의 실제 Auth·model resolver 구현
- [x] 스키마·권한·개인정보·종단 단위 테스트 추가

구현 파일과 실행 방법은 [Agent 구현 가이드](agents-implementation.md)를 따른다. 다음 단계는 Worker Orchestrator와 Data Gateway를 연결하는 것이다.

---

## 9. 공식 문서 근거

- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk): 로컬 Codex thread 시작·연속 실행·resume 및 sandbox 설정
- [Codex App Server](https://learn.chatgpt.com/docs/app-server): thread/turn 구조, `model/list`, 지원 reasoning effort와 모델 capability 조회
