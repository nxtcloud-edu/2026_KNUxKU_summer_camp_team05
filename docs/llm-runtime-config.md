# LLM 런타임 설정

- 문서 버전: v1.1 / 2026-08-14
- 상태: [로컬 Codex OAuth 런타임 ADR](adr/0007-local-codex-oauth-runtime.md)에 따라 MVP 경계 확정
- 현재 구현: localhost Gateway와 TypeScript 호출 계약은 fixture 검증 단계이며 OAuth 모델 실행은 미검증

## 1. MVP에서 LLM을 쓰는 역할

| MVP 역할 | LLM의 일 | 결정론적 코드가 소유하는 일 |
| --- | --- | --- |
| `UserProxyAgent` | 확정 프로필 근거로 주장·양보안·명시 투표 생성 | 프로필 권위·필드 접근, 만족도 계산 |
| `StayArbiterAgent` | 논점 조정, 선택·종료·차단 이유 작성 | leximin 계산, 하드 제약 검사, 상태 적용 |
| `TripSupervisorAgent` | 날짜·예산·정원·근거 이탈의 의미 감사 | 가격·정원·근거 기계 판정과 상태 봉인 |

후보 검색 계획과 결과 렌더링은 MVP에서 결정론적이다. `DateResolver`, `FactConstraintValidator`, `RunController`도 LLM 에이전트가 아니다. 목표 역할 5종과 MVP 활성 역할의 차이는 [Agent 역할 ADR](adr/0002-agent-roles.md)이 소유한다.

## 2. 구현 순서

1. 모델 독립 JSON Schema와 parser
2. LLM 사용량·프롬프트 버전·비용 원장
3. `UserProxyAgent` + `StayArbiterAgent` 한 카테고리 수직 경로
4. `TripSupervisorAgent` 가드
5. 실제 OAuth 모델 1회 실행과 영수증 확인

첫 LLM 소비자를 이전 설계의 Supervisor로 두지 않는다. 가장 작은 검증 단위는 한 카테고리의 `프로필 → 명시 투표 → 계약 또는 차단`이다.

## 3. 환경변수

```text
MOA_CODEX_GATEWAY_URL=http://127.0.0.1:<local-port>
MOA_MODEL_PROFILE_FAST=<allowlisted-model-id>
MOA_MODEL_PROFILE_BALANCED=<allowlisted-model-id>
MOA_MODEL_PROFILE_DEEP_REASONING=<allowlisted-model-id>
MODEL_CALL_LIMIT=<integer>
MODEL_REPAIR_LIMIT=1
```

`LLM_API_KEY`는 사용하지 않는다. 모델 ID는 문서에 미래 고정값으로 박지 않고 로그인한 Codex의 `model/list`와 allowlist 교집합으로 해석한다. 교집합이 없으면 실패하고 미허용 모델로 fallback하지 않는다.

Python Gateway의 `MOA_GATEWAY_HOST`는 loopback만 허용하고 기본 저장소는 `:memory:`다. `MOA_CODEX_GATEWAY_URL`은 TypeScript Worker가 이 로컬 서비스에 연결할 때만 사용한다.

## 4. 모델 배분 원칙

- Proxy는 호출 수가 인원수와 토론 턴에 비례하므로 작은 출력과 구조화 투표를 우선한다.
- Arbiter는 제안 구성·종료 판정 품질이 필요하지만 수치 계산은 하지 않는다.
- Supervisor는 전체 맥락을 읽되 `VerificationReceipt`를 재해석해 통과시키지 않는다.
- Proxy, Arbiter, Supervisor가 같은 모델을 사용해도 역할별 최소 입력과 출력 스키마는 분리한다.
- 자동 고가 티어 fallback은 두지 않으며 사용자가 허용한 모델만 쓴다.

사용자에게서 얻지 않은 “주장형·조정형·실속형” 같은 성격을 Proxy에 강제하지 않는다. 첫 발언자, 반례 검토자 같은 절차 역할만 순환할 수 있다.

## 5. 비용·지연 상한

OAuth 구독 실행에서 USD 원가를 확정값으로 가정하지 않는다. 다음을 역할·시나리오별로 기록한다.

- 입력·출력·캐시 토큰
- LLM 호출 횟수와 최대 1회 구조 복구
- 공급자 호출·실패·쿼터
- 카테고리별 wall-clock
- 구조화 출력 파싱 실패율
- `CONCLUDED`, `NO_SAFE_DECISION`, `RECHECK`, `HOLD` 비율

### 비용 절감 순서

1. 후보 원문 대신 conflict-relevant 속성과 evidence ID만 전달
2. Proxy 공통 프리픽스와 개인 정보 영역 분리
3. 중복 주장 요약과 불변 계약 참조
4. 순위가 안정되면 토론 조기 종료
5. 한 번에 한 작업을 기본값으로 하고 병렬 호출은 측정 후 허용

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
  repairUsed: boolean;
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
| 구조화 출력 파싱 실패 | 같은 입력으로 최대 1회 복구 후 차단 |
| Proxy 응답 실패 | 해당 사용자를 찬성으로 추정하지 않고 투표 미확정 표시 |
| Arbiter 실패 | 상태를 적용하지 않고 체크포인트 유지 |
| Supervisor 실패 | `CLEAR` 추정 금지, 실행 보류 |
| model/list 또는 allowlist 실패 | 다른 공급자로 전환하지 않고 실행 차단 |

API key 공급자나 미허용 모델로 자동 fallback하지 않는다.

## 8. 평가

- Proxy: 프로필 사실 재현, 범위·부정·예외 보존, 근거 없는 주장률
- Arbiter: 종료 적정성, 계약 필드 완전성, leximin trace와 설명 일치
- Supervisor: 위반 recall/precision, 검증 실패 덮어쓰기 0건

LLM-as-judge는 보조 신호다. 계약·수치·상태·실제 사용자 선택과 기계 검사를 우선한다.

## 9. 미결정

- 사용자의 현재 Codex 카탈로그에서 허용할 실제 모델 ID
- 실제 호출로 측정할 역할별 effort와 120초 안의 호출 상한
