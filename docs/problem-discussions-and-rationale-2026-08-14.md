# MOA 문제별 논의·근거·의도·해결책

- 작성일: 2026-08-14
- 대상 브랜치: `dawnkim`
- 관련 요약: [알고리즘·Agent·Flowchart 감사 및 반영 기록](algorithm-flowchart-audit-2026-08-14.md)
- 목적: 결과만 나열하지 않고, 각 변경을 왜 했는지와 어떤 위험을 막는지 리뷰 가능한 형태로 남긴다.

## 1. 공통 판단 원칙

각 문제는 다음 원칙으로 판단했다.

1. **Fail-closed**: 안전·필수조건·근거가 불명확하면 성공으로 간주하지 않는다.
2. **결정 권한 분리**: Agent는 제안하고, 상태 전이와 최종 확정은 Worker의 결정론적 코드가 담당한다.
3. **단일 기준 정보**: 같은 proposal, participant, evidence ID는 모든 단계에서 같은 의미를 가져야 한다.
4. **구조화된 판정**: 자연어 문구보다 enum, ID, 상태 코드, 수치 계약을 우선한다.
5. **버전이 있는 의미**: 같은 숫자라도 설문 척도가 달라지면 schema와 scale version을 함께 올린다.
6. **소유권 존중**: 다른 팀원 문서는 임의로 삭제·수정하지 않고 문제와 권고만 기록한다.
7. **구현 상태를 과장하지 않음**: fixture와 preloaded 데이터만 지원하면 실시간 Provider 연동 완료로 표시하지 않는다.

## 2. 문제별 결정 기록

### 문제 1. 여행 스타일 숫자 입력의 의미가 모호함

**관찰된 문제**

여행 페이스를 1~7 숫자로 받으면 사용자는 `3`과 `4`의 실제 일정 차이를 알기 어렵다. 활동 선호 1~10도 같은 문제가 있으며, 숫자 정밀도가 높아 보여도 실제 일정 생성 정책은 그만큼 정밀하지 않았다.

**근거**

- 사용자가 직접 `휴식형(1개) / 보통형(2개) / 활동형(3개)`처럼 행동 단위로 묻는 방식을 제안했다.
- 일정 생성기가 필요한 값은 미세한 심리 점수가 아니라 하루 일정 밀도와 우선순위 구간이다.
- 구현 위치: [apps/web/src/data.ts](../apps/web/src/data.ts), [apps/web/src/App.tsx](../apps/web/src/App.tsx)

**설계 의도**

- 질문을 읽는 순간 선택 결과가 실제 일정에 어떻게 반영되는지 이해하게 한다.
- 연속 척도에서 발생하는 거짓 정밀도와 사용자별 숫자 해석 차이를 줄인다.

**검토한 선택지**

- 기존 slider를 유지하고 양 끝 설명만 강화: 중간 숫자의 의미가 계속 모호하다.
- 숫자 입력칸으로 직접 입력: 모바일 사용성과 응답 일관성이 더 나빠진다.
- 3개 의미 버튼: 선택지는 줄지만 일정 정책과 직접 연결할 수 있다.

**채택한 해결책**

- 여행 스타일은 의미 버튼 3개로 변경하고 내부 값은 기존 계산 범위를 유지하는 `1 / 4 / 7`로 저장한다.
- 활동 선호는 `관심 적어요 / 괜찮아요 / 꼭 하고 싶어요`, 내부 값은 `1 / 5 / 10`으로 저장한다.
- 선택 전에는 다음 버튼을 비활성화하고, 모든 항목 응답 후에만 진행하게 한다.

**검증**

- 브라우저에서 스타일 11개 질문의 3개 버튼, disabled → enabled 전이, 활동 카드 다음 이동을 실제 클릭으로 확인했다.
- 브라우저 console error는 없었다.

### 문제 2. UI 스타일 축 ID와 공통 계약 ID가 다름

**관찰된 문제**

UI는 `pace`, `place-style` 같은 소문자 로컬 키를 사용했지만 공통 계약은 `PACE`, `HISTORY_VS_TREND` 같은 canonical ID를 사용했다. 이 상태에서는 API나 분석 계층에서 별도 매핑이 누락될 가능성이 있다.

**근거**

- canonical 축: [packages/contracts/src/style-policy.ts](../packages/contracts/src/style-policy.ts)
- UI 질문: [apps/web/src/data.ts](../apps/web/src/data.ts)
- 로컬 저장 초안 마이그레이션: [apps/web/src/App.tsx](../apps/web/src/App.tsx)

**설계 의도**

프런트엔드, API payload, 계약, 추천 알고리즘이 동일한 축 이름을 사용하도록 한다.

**채택한 해결책**

- UI 저장 키를 11개 canonical 대문자 ID로 통일했다.
- 기존 localStorage 초안은 구버전 키를 읽어 새 ID와 3단계 값으로 정규화한다.
- 새 제출 payload는 schema v4와 척도 버전을 함께 보낸다.

### 문제 3. 설문 숫자 의미가 바뀌었는데 schema가 그대로인 문제

**관찰된 문제**

같은 `1~7`, `1~10` 범위라도 연속 slider 응답과 3단계 버튼 응답은 통계적 의미가 다르다. schema version이 같으면 백엔드와 분석에서 두 응답을 구분할 수 없다.

**근거**

- payload 정의: [apps/web/src/formState.ts](../apps/web/src/formState.ts)
- API 문서: [docs/development-and-deployment.md](development-and-deployment.md)

**설계 의도**

값의 타입뿐 아니라 값이 만들어진 척도까지 데이터 계약에 포함한다.

**채택한 해결책**

- `schemaVersion: 4`
- `travelStyleScaleVersion: THREE_LEVEL_1_4_7_V1`
- `activityScoreScaleVersion: THREE_LEVEL_1_5_10_V1`
- 구버전 로컬 값은 문서화된 구간 규칙으로 한 번 변환한다.

### 문제 4. 활동 카드가 Osaka에 결합되어 있음

**관찰된 문제**

질문 문구와 데이터 타입이 Osaka 전용이면 다른 목적지를 골라도 Osaka 활동이 보이거나 코드에 예외 처리가 늘어난다.

**근거**

- 목적지별 데이터 구성: [apps/web/src/data.ts](../apps/web/src/data.ts)
- 선택 목적지에 따른 카드 계산: [apps/web/src/App.tsx](../apps/web/src/App.tsx)

**설계 의도**

목적지는 데이터 입력이고 설문 컴포넌트는 목적지와 무관한 재사용 구조가 되게 한다.

**채택한 해결책**

- 타입을 `ActivityPreference`로 일반화했다.
- `destinationPreferences`와 `getDestinationPreferences(destinationId)`를 추가했다.
- 목적지를 바꾸면 카드 index와 활동 응답을 해당 목적지 기준으로 초기화한다.
- Osaka는 큐레이션 데이터로 남기되 UI 컴포넌트의 고정 의존성은 제거했다.

### 문제 5. Zod 3 enum record가 전체 축 존재를 보장하지 못함

**관찰된 문제**

여행 스타일 profile이 일부 축만 가진 객체여도 검증을 통과할 수 있으면, 누락 축을 `null` 응답과 구분할 수 없다.

**근거**

- 계약 구현: [packages/contracts/src/style-policy.ts](../packages/contracts/src/style-policy.ts)
- 회귀 테스트: [packages/contracts/tests/contracts.test.mjs](../packages/contracts/tests/contracts.test.mjs)

**설계 의도**

`키가 없음`과 `질문했지만 미응답(null)`을 구분하고 11개 축 완전성을 계약 경계에서 보장한다.

**채택한 해결책**

Zod enum record 대신 11개 키를 모두 선언한 strict object를 사용하고, style fit 계산 전에도 값 범위를 다시 parse한다.

### 문제 6. TypeScript 계산 함수가 타입만 믿고 런타임 입력을 신뢰함

**관찰된 문제**

TypeScript 타입은 네트워크·DB·JSON 런타임 값까지 보장하지 않는다. 중복 participant, 음수 재토론 횟수, 빈 변경 사유, 잘못된 계획 전이가 계산 함수로 들어갈 수 있었다.

**근거**

- 만족도 격차: [packages/contracts/src/rounds.ts](../packages/contracts/src/rounds.ts)
- 변경 권한: [packages/contracts/src/change-authority.ts](../packages/contracts/src/change-authority.ts)
- 계획 상태 전이: [packages/contracts/src/planning.ts](../packages/contracts/src/planning.ts)

**설계 의도**

결정 함수가 호출 위치와 무관하게 스스로 입력 불변식을 확인하도록 한다.

**채택한 해결책**

- 만족도 계산 전 participant schema, ID 중복, 재토론 횟수를 검증한다.
- 빈 변경 사유는 자동 재계획으로 추측하지 않고 거부한다.
- 계획 노드는 허용 전이, version 정확히 +1, 잠금 상태, `BOOKABLE + live confidence`를 검사한다.

### 문제 7. Candidate Search가 실행 흐름과 분리된 장식 단계였음

**관찰된 문제**

Search Agent가 QueryPlan을 만들지만 Worker는 그 결과와 무관하게 기존 `PlanOption`을 평가했다. 그러면 검색을 실행한 것처럼 보이지만 실제 후보에는 영향을 주지 않는다.

**근거**

- Worker 연결 모드: [apps/worker/moa_worker/orchestrator.py](../apps/worker/moa_worker/orchestrator.py)
- Search handler: [packages/agents/moa_agents/handlers.py](../packages/agents/moa_agents/handlers.py)
- Provider Data Gateway는 아직 미구현이다.

**설계 의도**

현재 할 수 있는 것과 없는 것을 실행 결과에서 명시하고, 미구현 Provider 호출을 완료된 기능처럼 보이게 하지 않는다.

**검토한 선택지**

- Provider 연동을 즉시 구현: 현재 범위를 크게 넘고 인증·정규화 계약이 필요하다.
- Search 단계를 제거: 향후 Gateway 연결 지점을 잃는다.
- preloaded 모드를 명시: 현재 fixture 검증과 미래 연결점을 모두 유지한다.

**채택한 해결책**

- QueryPlan의 안전성과 canonical filter 보존을 검사한다.
- 실제 후보는 `VERIFIED + fresh + hard-safe` preloaded 옵션으로 제한한다.
- 결과에 `PRELOADED_NORMALIZED_OPTIONS`를 기록한다.
- Search가 `NO_SAFE_QUERY`를 반환하거나 안전 후보가 없으면 차단한다.

**남은 한계**

QueryPlan을 실제 Provider에 실행하고 `CandidateRecord`로 정규화하는 Data Gateway가 필요하다.

### 문제 8. 무효 고득점안이 점수만으로 선택될 수 있음

**관찰된 문제**

만족도가 높더라도 `INVALID`, `PARTIAL`, hard constraint 실패, stale evidence인 계획은 실행 가능한 선택지가 아니다.

**근거**

- 후보 필터와 정렬: [apps/worker/moa_worker/orchestrator.py](../apps/worker/moa_worker/orchestrator.py)
- `test_invalid_high_score_option_is_removed_before_voting`: [apps/worker/tests/test_worker.py](../apps/worker/tests/test_worker.py)

**설계 의도**

안전·실행 가능성이 효용 점수보다 항상 우선하게 한다.

**채택한 해결책**

먼저 실행 불가 후보를 제거한 뒤, 남은 계획만 참가자 만족도 최솟값 우선 leximin으로 정렬하고 비용·이동시간·canonical ID를 결정론적 tie-breaker로 사용한다.

### 문제 9. 타협 라운드가 같은 입력을 반복하고 반복 한도가 한 번 더 실행될 수 있음

**관찰된 문제**

Supervisor가 `PROPOSE_COMPROMISE`를 반환해도 같은 options를 다시 주면 결과가 바뀔 근거가 없다. 또한 0-based iteration에서 `iteration < maxIterations` 식은 마지막 index에서 한 라운드를 더 요청하는 off-by-one을 만들 수 있다.

**근거**

- 라운드 반복: [apps/worker/moa_worker/orchestrator.py](../apps/worker/moa_worker/orchestrator.py)
- Supervisor 한도 처리: [packages/agents/moa_agents/handlers.py](../packages/agents/moa_agents/handlers.py)
- `test_compromise_moves_to_a_distinct_verified_plan_and_finalizes_that_plan`
- `test_supervisor_does_not_start_an_extra_round_at_the_iteration_limit`

**설계 의도**

반복은 실제로 새로운 검증 대안을 평가할 때만 의미가 있도록 한다.

**채택한 해결책**

- 각 iteration은 정렬된 후보 중 서로 다른 계획 하나만 평가한다.
- 다음 검증 계획이 없으면 보호 목적은 사용자 확인, 그 외 미해결은 차단한다.
- 추가 라운드 조건은 `iteration + 1 < maxIterations`로 고정한다.

### 문제 10. Watcher `BLOCK`이 Supervisor `WAIT`와 사용자 승인으로 우회될 수 있음

**관찰된 문제**

Watcher는 기계적 안전 가드인데, 분기 순서가 `WAIT_FOR_USER`를 먼저 처리하면 악성·오류 Supervisor 출력이 안전 차단을 승인 문제로 바꿀 수 있다.

**근거**

- Worker 분기: [apps/worker/moa_worker/orchestrator.py](../apps/worker/moa_worker/orchestrator.py)
- `test_watcher_block_cannot_be_converted_to_user_approval`: [apps/worker/tests/test_worker.py](../apps/worker/tests/test_worker.py)

**설계 의도**

사용자는 취향·보호 목적 변경을 승인할 수 있지만, 기계적으로 실패한 안전·예산·일정·근거 조건까지 승인으로 덮을 수는 없게 한다.

**채택한 해결책**

- Watcher `BLOCK`을 모든 Supervisor 행동보다 먼저 처리한다.
- 승인 대기 레코드에 `selectedProposalId`를 저장한다.
- 승인 재개 시 대상이 여전히 verified/fresh인지 확인하고 Watcher를 다시 실행한다.
- 재검증이 `PASS`가 아니면 Finalizer를 호출하지 않는다.

### 문제 11. Supervisor 출력 schema는 맞지만 투표 의미와 모순될 수 있음

**관찰된 문제**

`WAIT_FOR_USER`라는 enum 자체는 유효해도 실제 투표에 보호 목적·최소 만족도·사용자 확인 사유가 없을 수 있다. 입력에 없는 participant 또는 proposal을 참조할 수도 있다.

**근거**

- 의미 검증: [apps/worker/moa_worker/orchestrator.py](../apps/worker/moa_worker/orchestrator.py)
- `test_supervisor_cannot_request_user_approval_without_an_authority_reason`

**설계 의도**

LLM 출력의 문법적 유효성과 업무 의미의 유효성을 분리해 둘 다 통과하도록 한다.

**채택한 해결책**

- target participant는 실제 vote participant의 부분집합이어야 한다.
- referenced proposal 집합은 실제 투표 proposal 집합과 정확히 같아야 한다.
- `WAIT_FOR_USER`는 권한 사유가 있는 vote가 필요하다.
- `BLOCK`은 Watcher block 또는 hard constraint opposition이 필요하다.

### 문제 12. Logic Auditor가 사실·규칙 ID 존재만 보고 결론을 인정함

**관찰된 문제**

premise와 rule ID가 존재한다는 사실만으로는 “누가 어떤 계획에 어떤 결정을 했는지”가 실제 vote와 같은지 증명하지 못한다. 자연어 conclusion 정규식은 언어와 표현 변화에도 취약하다.

**근거**

- 구조화 주장 모델: [packages/agents/moa_agents/models.py](../packages/agents/moa_agents/models.py)
- 감사 로직: [packages/agents/moa_agents/handlers.py](../packages/agents/moa_agents/handlers.py)
- `test_logic_auditor_rejects_a_conclusion_that_does_not_match_the_vote`

**설계 의도**

표시용 설명 문장과 기계 판정용 claim을 분리한다.

**채택한 해결책**

- `claimedParticipantId`, `claimedProposalId`, `claimedDecision`을 ProofArgument에 추가했다.
- 같은 라운드의 `expectedVotes`를 Logic Auditor 필수 입력으로 전달한다.
- 구조화 claim이 expected vote와 정확히 일치하지 않으면 `CONCLUSION_NOT_DERIVED`로 무효 처리한다.
- premise fact의 evidence가 argument evidence에 포함되는지도 확인한다.

**남은 한계**

일반 자연어 규칙의 완전한 기계 증명은 범용 SymbolicReasoner가 필요하다. 현재 구현은 정해진 구조화 claim과 rule/evidence 연결 검증 범위다.

### 문제 13. Pydantic 모델이 개별 타입만 검사하고 교차 필드 모순을 허용함

**관찰된 문제**

예를 들어 `SUPPORT + HARD_CONSTRAINT`, `PASS + 변경 요청`, `READY + warnings`, vote와 다른 preferred proposal처럼 각 필드는 enum상 유효하지만 조합은 모순일 수 있었다.

**근거**

- 교차 validator: [packages/agents/moa_agents/models.py](../packages/agents/moa_agents/models.py)
- `test_accepting_vote_cannot_carry_an_opposition_reason`
- `test_finalizer_template_scores_must_match_the_selected_plan`

**설계 의도**

모순된 상태가 Worker에 도달하기 전에 Agent 계약 경계에서 거부한다.

**채택한 해결책**

- Evidence, PlanOption, ProofReview, ProxyVote, ProxyOutput, SearchOutput, WatcherOutput, SupervisorOutput, FinalizerInput/Output에 model validator를 추가했다.
- `VERIFIED` 계획은 hard constraint를 통과해야 한다.
- accepting vote는 `NONE`, 반대·확인 vote는 non-NONE 사유를 요구한다.
- 상태·사유·경고·참조 집합이 서로 일치해야 한다.

### 문제 14. 동일 evidence ID가 Agent마다 다른 내용을 가질 수 있음

**관찰된 문제**

딕셔너리 병합 과정에서 같은 evidence ID의 다른 payload가 마지막 값으로 덮이면, Agent마다 다른 사실을 봤는데도 하나의 근거처럼 처리될 수 있다.

**근거**

- Job 입력 검증: [apps/worker/moa_worker/models.py](../apps/worker/moa_worker/models.py)
- `test_conflicting_evidence_payloads_are_rejected_at_the_job_boundary`

**설계 의도**

evidence ID를 단순 문자열이 아니라 불변 사실 레코드의 식별자로 취급한다.

**채택한 해결책**

- Proxy별 evidence ID 중복을 거부한다.
- 같은 evidence ID는 모든 Proxy와 Finalizer에서 전체 payload가 같아야 한다.
- 선택 후보의 evidence는 존재하고 `VERIFIED`, fresh여야 한다.

### 문제 15. Finalizer가 토론과 다른 결과를 만들 수 있음

**관찰된 문제**

Finalizer 입력이 최초 계획에 고정되어 있거나 Agent가 새 candidate를 추가·누락하고 만족도 수치를 바꾸면, 토론 결과와 최종 일정이 분리된다.

**근거**

- Finalizer 입력 생성과 출력 검사: [apps/worker/moa_worker/orchestrator.py](../apps/worker/moa_worker/orchestrator.py)
- Finalizer 계약: [packages/agents/moa_agents/models.py](../packages/agents/moa_agents/models.py)
- `test_finalizer_invented_candidate_id_fails_closed`
- `test_finalizer_does_not_invent_candidate_ids`

**설계 의도**

Finalizer는 결정을 새로 내리는 Agent가 아니라 선택된 결과를 설명 가능한 형식으로 정리하는 역할만 갖게 한다.

**채택한 해결책**

- 실제 선택 계획으로 FinalizerInput을 매 라운드 동적으로 만든다.
- proposal ID, itinerary candidate 전체 집합, participant별 만족도, evidence를 선택 계획과 정확히 묶는다.
- 후보 추가뿐 아니라 누락도 실패 처리한다.
- Finalizer가 `BLOCKED`를 반환하거나 새로운 ID를 만들면 Workflow를 성공으로 기록하지 않는다.

### 문제 16. Mermaid에서 `CLEAR`와 `HOLD`가 같은 공개 경로로 합쳐짐

**관찰된 문제**

일부 `kim1188_md` 설계도는 최종 가드의 `CLEAR`와 `HOLD`가 같은 publish 노드로 연결돼 정상 결과와 부분·차단 결과의 구분이 흐려질 수 있었다.

**설계 의도**

- 정상 공개: 연속성 `PASS` AND 통합 검증 `PASS` AND 가드 `CLEAR`
- 부분 공개: `BLOCKED/HOLD`와 완전한 `blockReason`, 검증·불확실성 표시가 있을 때 별도 레코드

**소유권 결정**

`kim1188_md`는 다른 팀원 소유이며 Git에 이미 추적된 문서다. 삭제하면 해당 팀원 파일 삭제가 push되고, 직접 수정하면 소유자 동의 없는 설계 변경이 된다.

**채택한 해결책**

- `dawnkim` 브랜치에서는 해당 폴더를 삭제하지 않았다.
- 이번에 가했던 Mermaid 수정도 원상복구해 Git 변경 목록에서 제외했다.
- 문제와 권고안만 이 문서에 남기고, 소유자가 동의한 별도 PR/공동 편집에서 처리한다.

### 문제 17. 구현 완료 상태를 문서가 과장함

**관찰된 문제**

Worker와 Agent가 fixture 환경에서 실행된다는 이유로 `로컬 구현 완료`라고 쓰면 Provider Search, 범용 추론, 운영 저장소까지 완료된 것으로 오해될 수 있다.

**근거**

- 상태표: [docs/README.md](README.md)
- 구현 경계: [docs/agents-implementation.md](agents-implementation.md)

**설계 의도**

팀원이 다음 작업 범위를 정확히 판단하고 데모 결과를 운영 완성도로 오해하지 않게 한다.

**채택한 해결책**

- Worker와 Agent 상태를 `부분 구현`으로 표시했다.
- preloaded 모드, 미구현 Provider Gateway, 제한된 SymbolicReasoner 범위를 명시했다.

### 문제 18. Windows pytest 임시 폴더 권한 오류를 코드 실패로 오해함

**관찰된 문제**

9개 테스트가 assertion 전에 `WinError 5`로 실패했다. 실패 지점은 테스트 본문이 아니라 pytest의 `%TEMP%/pytest-of-...`와 cache 디렉터리 생성·삭제였다.

**근거**

- pytest 설정: [pytest.ini](../pytest.ini)
- 사용자별 임시 경로 설정: [conftest.py](../conftest.py)
- 설치·검증 기록: [docs/agent-runtime-setup-and-verification.md](agent-runtime-setup-and-verification.md)

**설계 의도**

코드 로직 실패와 실행 환경 ACL 실패를 분리하고, 관리자 권한·백신·다른 실행 주체가 만든 임시 폴더 충돌을 피한다.

**채택한 해결책**

- pytest cache provider를 비활성화했다.
- Windows 실행 주체별 `.pytest-tmp-<username>` 경로를 사용한다.
- 검증은 프로젝트 `.venv`의 Python으로 실행한다.

```powershell
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe -m pytest -q
```

### 문제 19. `openai_codex` import 실패와 가상환경·Git의 역할 혼동

**관찰된 문제**

`from openai_codex import ...`가 실패하면 SDK 코드 문제보다 현재 터미널·IDE가 프로젝트 `.venv`가 아닌 다른 Python을 보고 있을 가능성이 크다. 또한 가상환경을 활성화해야만 Git push가 되는 것으로 오해할 수 있다.

**근거**

- SDK 의존성: [apps/codex-runtime-gateway/pyproject.toml](../apps/codex-runtime-gateway/pyproject.toml)
- 실제 import adapter: [apps/codex-runtime-gateway/moa_codex_gateway/backend.py](../apps/codex-runtime-gateway/moa_codex_gateway/backend.py)
- 설치 기록상 `openai-codex 0.144.4`와 `pip check` 통과를 확인했다.

**설계 의도**

Python 실행 환경, Codex 인증, Git 인증을 서로 다른 책임으로 이해하게 한다.

**채택한 해결책**

- Python 테스트·실행은 `.venv` interpreter를 사용한다.
- Codex 호출은 별도의 Codex/Gateway 인증을 사용한다.
- Git push는 GitHub 인증을 사용하며 `.venv` 활성화 여부와 무관하다.
- `.venv`, `node_modules`, `dist`는 Git에 올리지 않는다.

## 3. 최종 검증과 추적성

| 계층 | 검증 | 결과 |
| --- | --- | --- |
| Python 전체 | Agent, Gateway, Worker | `32 passed` |
| Agent + Worker 집중 | 계약·공격·상태 머신 | `25 passed` |
| TypeScript 계약 | Zod·계산·상태 전이 | `5 passed` |
| TypeScript | 모든 workspace typecheck | 통과 |
| 빌드 | Web + contracts production build | 통과 |
| UI | 실제 브라우저 버튼 선택·다음 전이 | 통과 |
| UI 런타임 | browser console error | 없음 |

핵심 공격 테스트는 [apps/worker/tests/test_worker.py](../apps/worker/tests/test_worker.py), Agent 계약 테스트는 [packages/agents/tests/test_agents.py](../packages/agents/tests/test_agents.py), TypeScript 계약 테스트는 [packages/contracts/tests/contracts.test.mjs](../packages/contracts/tests/contracts.test.mjs)에 있다.

## 4. 남은 논의 사항

1. Provider Data Gateway의 QueryPlan 실행·정규화 계약
2. 범용 SymbolicReasoner의 규칙 표현과 proof format
3. leximin 이후 비용·이동시간 tie-breaker의 제품 정책 확정
4. `BLOCKED/HOLD` 부분 결과 공개 Mermaid를 문서 소유자와 공동 반영할지
5. 3단계 설문 척도의 사용자 테스트와 향후 버전 정책
6. Vite 500KB 초과 chunk의 code splitting 기준

이 항목들은 현재 구현이 잘못됐다는 의미가 아니라, 다음 단계에서 별도 권한·데이터·제품 결정을 받아야 하는 경계다.
