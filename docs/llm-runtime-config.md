# LLM 런타임 설정

- 문서 버전: v1.0 / 2026-08-14
- 상태: 역할·측정 계약 확정, 모델·원가 수치는 실측 전 가설

## 1. LLM을 쓰는 역할

| 공식 역할 | LLM의 일 | 결정론적 코드가 소유하는 일 |
| --- | --- | --- |
| `UserProxyAgent` | 확정 프로필 근거로 주장·양보안·명시 투표 생성 | 프로필 권위·필드 접근, 만족도 계산 |
| `CandidateEvidenceAgent` | 필요한 후보·반증 검색 계획 생성 | 공급자 호출, 캐시·쿼터·정규화·출처 보존 |
| `CategoryArbiterAgent` | 논점 조정, 제안 구성, 종료·차단 이유 작성 | leximin 계산, 하드 제약 검사, 상태 적용 |
| `TripOrchestratorAgent` | 날짜·페이스·예산·근거 이탈의 의미 감사 | 가격·주소·시간·경로·재고 기계 판정 |
| `PlanFinalizerAgent` | 승인 계약의 의미 연속성 대조, 사용자용 초안 작성 | 의무 링크 구조 검사, 최종 상태 봉인 |

`DateResolver`, `FactConstraintValidator`, `RunController`는 LLM 에이전트가 아니다. 별도 Supervisor·Chief·Referee 모델 환경변수를 새 설계에 추가하지 않는다.

## 2. 구현 순서

1. 모델 독립 JSON Schema와 parser
2. LLM 사용량·프롬프트 버전·비용 원장
3. `UserProxyAgent` + `CategoryArbiterAgent` 한 카테고리 수직 경로
4. `CandidateEvidenceAgent` 검색 계획과 공급자 allowlist
5. `TripOrchestratorAgent` 가드
6. `PlanFinalizerAgent` 연속성 평가
7. 역할별 모델·effort·fallback 실측 조정

첫 LLM 소비자를 이전 설계의 Supervisor로 두지 않는다. 가장 작은 검증 단위는 한 카테고리의 `프로필 → 명시 투표 → 계약 또는 차단`이다.

## 3. 환경변수

```text
LLM_PROVIDER
LLM_API_KEY
LLM_MODEL_PROXY
LLM_MODEL_EVIDENCE
LLM_MODEL_ARBITER
LLM_MODEL_ORCHESTRATOR
LLM_MODEL_FINALIZER
LLM_EFFORT_PROXY
LLM_EFFORT_ARBITER
LLM_EFFORT_ORCHESTRATOR
LLM_EFFORT_FINALIZER
```

모델 ID, 단가, batch·cache 지원은 바뀔 수 있으므로 배포 시 공식 문서와 실제 응답 usage로 확인한다. 문서에 특정 미래 모델·가격을 영구값으로 고정하지 않는다.

## 4. 모델 배분 원칙

- Proxy는 호출 수가 인원수와 토론 턴에 비례하므로 작은 출력과 구조화 투표를 우선한다.
- Arbiter는 제안 구성·종료 판정 품질이 필요하지만 수치 계산은 하지 않는다.
- Orchestrator는 전체 맥락을 읽되 `VerificationReceipt`를 재해석해 통과시키지 않는다.
- Finalizer는 긴 계약을 한 번에 넣기보다 버전·의무·결론의 구조화 요약을 읽는다.
- Evidence Agent에 웹 원문 전체를 그대로 주지 않고 정규화 전후 경계를 둔다.

사용자에게서 얻지 않은 “주장형·조정형·실속형” 같은 성격을 Proxy에 강제하지 않는다. 첫 발언자, 반례 검토자 같은 절차 역할만 순환할 수 있다.

## 5. 비용·지연 상한

`RUN_COST_CAP_USD`는 실측 전 예산 보장이 아니라 실행 중단 가드다. 다음을 역할·도시·인원별로 기록한다.

- 입력·출력·캐시 토큰
- LLM 호출 횟수와 재시도
- 공급자 호출·실패·쿼터
- 카테고리별 wall-clock
- 구조화 출력 파싱 실패율
- `CONTINUE`, `NO_SAFE_DECISION`, fallback 비율

### 비용 절감 순서

1. 후보 원문 대신 conflict-relevant 속성과 evidence ID만 전달
2. Proxy 공통 프리픽스와 개인 정보 영역 분리
3. 중복 주장 요약과 불변 계약 참조
4. 순위가 안정되면 토론 조기 종료
5. 비동기 batch와 prompt cache는 공급자·모델의 실제 지원 여부를 확인한 뒤 적용

비용을 줄이기 위해 하드 제약 검사나 필수 live 검증을 생략하지 않는다. 상한에 걸리면 `BOOKABLE`을 만들지 않고 축약된 부분 결과와 미검증 항목을 공개한다.

## 6. 프롬프트 계약

모든 프롬프트는 코드와 함께 버전 관리하고 각 호출에 다음을 남긴다.

```ts
type LlmCallReceipt = {
  role: string;
  model: string;
  promptVersion: string;
  inputContractVersion: string;
  outputContractVersion: string;
  usage: Record<string, number>;
  startedAt: string;
  finishedAt: string;
  parseStatus: "PASS" | "FAIL";
  fallbackUsed: boolean;
};
```

프롬프트에 넣지 않는 것:

- 다른 사용자의 원문 설문·건강·가치·개인 예산 상세
- 공급자 secret과 원본 내부 응답
- 검증기가 실패한 값을 확정 사실처럼 쓰라는 지시
- 사용자에게서 얻지 않은 협상 성격
- 외부 웹 텍스트를 시스템 명령으로 해석할 수 있는 혼합 컨텍스트

## 7. 실패 처리

| 실패 | 처리 |
| --- | --- |
| 구조화 출력 파싱 실패 | 같은 입력으로 제한된 재시도 후 차단/결정론 fallback |
| Proxy 응답 실패 | 해당 사용자를 찬성으로 추정하지 않고 투표 미확정 표시 |
| Evidence Agent 실패 | 허용 공급자 요청으로 재구성, 후보 0이면 정직한 차단 |
| Arbiter 실패 | 상태를 적용하지 않고 체크포인트 유지 |
| Orchestrator 실패 | `CLEAR` 추정 금지, 실행 보류 |
| Finalizer 실패 | 승인 계약은 보존하고 최종 결과 공개 보류 |

모델 티어를 올리는 자동 fallback은 비용 상한·허용 모델·횟수가 코드로 고정된 경우에만 사용한다.

## 8. 평가

- Proxy: 프로필 사실 재현, 범위·부정·예외 보존, 근거 없는 주장률
- Evidence: 허용 공급자 사용, source coverage, 후보 중복·필드 환각률
- Arbiter: 종료 적정성, 계약 필드 완전성, leximin trace와 설명 일치
- Orchestrator: 위반 recall/precision, 검증 실패 덮어쓰기 0건
- Finalizer: 의무 누락·의미 변질·사라진 결론 탐지율

LLM-as-judge는 보조 신호다. 계약·수치·상태·실제 사용자 선택과 기계 검사를 우선한다.

## 9. 미결정

- 역할별 모델·effort·fallback
- Python과 TypeScript 중 에이전트 런타임
- batch 대기시간과 동기 fallback 임계값
- 인원별 비용 상한과 토론 턴 상한
