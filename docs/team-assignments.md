# 팀 역할과 작업 경계

- 문서 버전: v2.1 / 2026-08-14
- 원칙: 새 공식 명칭과 0/1~5/6단계 계약을 기준으로 배분

구체 담당자 이름은 팀이 확정한 뒤 채운다. 이 문서는 폴더 소유권이 아니라 충돌을 줄이는 책임 경계를 정한다.

## 1. 트랙

| 트랙 | 주요 책임 | 주 소유 경로 |
| --- | --- | --- |
| T1 FE·UX | Survey v4, 프로필 확인, 결과·재논의 UI | `apps/web/` |
| T2 Pack·공급자 | 네 도시 후보·태그·근거, ProviderAdapter | `packs/`, `packages/data-agents/` |
| T3 백엔드·에이전트 | API, Worker, 계약, 검증, 공식 에이전트 5종 | `apps/api/`, `apps/worker/`, `packages/core/`, `packages/contracts/`, `packages/agents/`, `packages/db/` |
| T4 평가·설문 | 질문·축 매핑, 사용자 실험, 선택 예측력 | `docs/survey-v4-profile-v1.md`, 평가 fixture |

## 2. T1 FE·UX

### 산출물

1. 방 생성: 목적지 + 설명용 목표 페이스
2. 필수 입력: 날짜, 하드 제약, 개인 목표·절대상한 예산, 가치 정책, 같은 객실·테이블·회차 이용과 분리 허용 범위
3. 고정 11개 취향 질문 + 적응형 최대 2개
4. “이렇게 이해했어요” 프로필 확인 카드
5. 결과 상태·근거·만료·차단 사유 표시
6. 영향 미리보기와 2~4개 확인 질문을 포함한 재논의 UI

### 불변 규칙

- `5`, `3`, `1`, `피하고 싶음`, `모름`, `hard`를 같은 숫자축으로 합치지 않는다.
- 질문을 건너뛰면 중립값을 만들지 않는다.
- 사용자가 체크하지 않은 추론을 장기 프로필 저장 요청에 넣지 않는다.
- `PROVISIONAL`, `VERIFIED`, `BOOKABLE`, `BOOKED`를 구분한다.

## 3. T2 Pack·공급자

### MVP 범위

- `kr-seoul`
- `kr-busan`
- `jp-tokyo`
- `jp-osaka`

한국 5곳·일본 6곳 목표는 사용하지 않는다. 먼저 한국 1곳·일본 1곳에서 실제 종단 검증한 뒤 같은 계약으로 네 도시를 완성한다.

### 산출물

1. 후보 속성·권역·자체 태그 사전
2. 도시별 초기 활성축 6개와 후보 분산 근거
3. 공급자별 `EvidenceSnapshot` 정규화
4. 데이터 권리·TTL·쿼터·유효기간 기록
5. 빈 공급자 슬롯과 사용자 확인 경로
6. 정확한 날짜·시간·인원 요청과 단위별 정원을 연결한 capacity fixture

### 공급자 경계

타베로그는 자동 수집·DB 적재 공급자가 아니다. Google Places의 `reservable`, HotPepper의 총 좌석 수, 정적 영업시간을 live 예약 슬롯으로 바꾸지 않는다. 검증기가 만든 영수증 없이 후보를 `VERIFIED` 또는 `BOOKABLE`로 올리지 않는다.

## 4. T3 백엔드·에이전트

### 공식 LLM 역할

1. `UserProxyAgent`
2. `CandidateEvidenceAgent`
3. `CategoryArbiterAgent`
4. `TripOrchestratorAgent`
5. `PlanFinalizerAgent`

### 결정론적 구성요소

1. `DateResolver`
2. `FactConstraintValidator`
3. `RunController`

`Supervisor`, `Chief Referee`, 심판 7종, Persona, Document Agent라는 새 패키지 구조를 만들지 않는다. 기존 코드의 이름은 마이그레이션 대상이다.

### 구현 순서

1. Profile v1과 설문 응답 매핑
2. `TripCharter`, `CategoryProposal`, `ProxyBallot`, `CategoryDecisionContract`, `CategoryContractView`
3. `DecisionLedger`, 재개방, 원장 멱등성
4. `RunController` 0/1~5/6단계
5. `PartyRequirement`, `CapacityPlan`과 참여자 전원 배정 검증
6. `FactConstraintValidator` 오사카 숙소 수직 경로
7. 공통 `EvaluationCaseSnapshot`, `ParticipantBallotView`, `DecisionEvaluationRun`
8. `MULTI_PROXY`: Proxy·Arbiter 토론과 leximin 선택 trace
9. `CENTRAL_BASELINE`: 평가용 중앙 플래너와 사용자별 `CentralPlannerBallot`
10. 두 모드가 같은 후보·근거·검증기·선택기를 쓰는 비교 runner
11. Orchestrator 전역 가드
12. Finalizer 연속성 감사와 `FinalPlanRecord`

`CentralPlannerBaselineAgent`는 공식 제품 역할 목록에 추가하지 않는다. 평가 실행에서만 모든 사용자의 최소 구조화 `EvaluationProfileView`를 읽고, 후보 고정 뒤 외부 도구를 호출하지 않으며, 제품 `DecisionLedger`를 변경하지 않는다. 두 모드 중 하나가 실패해도 다른 모드 결과로 대체하지 않는다.

### 현재 코드와의 관계

기존 DateResolver·Planning Graph·scoreCandidates·데이터 게이트웨이·API/Worker 테스트는 재사용 후보지만 새 계약의 통과 증거가 아니다. 특히 다음은 수정 대상이다.

- `R0~R6` 라운드 강제
- Maximin → 총합 → CC 가중 선택
- Supervisor가 순서·재심을 폭넓게 판단하는 구조
- 심판이 조달·검증·결론을 함께 소유하는 구조
- 미확인자를 기본 Persona로 완전 대체하는 구조
- 심판이 `VERIFIED`를 직접 적용하는 구조

## 5. T4 평가·설문

### 산출물

1. 질문·선택지 ID와 축·태그 신호 매핑
2. 네 도시 후보 데이터의 축별 분산 보고서
3. 사용자가 실제 선택한 holdout 후보 레이블
4. `CENTRAL_BASELINE` 대 `MULTI_PROXY` 블라인드 A/B와 사용자 단위 데이터 분리
5. 하드 제약·정원 위반, 근거 불일치, `NO_SAFE_DECISION`, 순위 일치도, 재논의, 지연시간·토큰·비용 보고서
6. 축 제거, 중복성, 순위 안정성, 도시 전이 분석

에이전트의 최종 선택을 정답 레이블로 사용하지 않는다. 20~30명은 사용성 점검에만 쓰고 예측력 확정 주장에 사용하지 않는다.

## 6. 트랙 간 계약

| 제공 | 소비 | 고정 접점 |
| --- | --- | --- |
| T4 | T1·T3 | `surveyVersion`, 질문·선택지 ID, 신호 매핑 fixture |
| T1 | T3 | 질문 ID 기반 응답, 프로필 체크 결과, 재논의 승인 |
| T2 | T3 | `CandidateRecord`, `EvidenceSnapshot`, 공급자 상태 |
| T3 | T1 | 프로필 확인 후보, 계약 요약, `FinalPlanRecord`, 상태·만료 |
| T3 | T4 | 익명화된 선택·재논의·사후 결과 이벤트 |

## 7. 완료 정의

### 문서 완료

용어·권한·스키마가 서로 충돌하지 않고 링크 검사를 통과한다.

### 수직 경로 완료

오사카·성인 3명·3박·체류 거점·숙소에서 실제 공급자 또는 명시적 fixture로 후보 조달부터 차단/계약까지 관찰한다. 정상안 3개, 하드 제약·정원 위반안 2개, 근거 만료·불충분안 1개를 같은 `EvaluationCaseSnapshot`으로 두 모드에 제공한다. 전체 제품 완료로 부르지 않는다.

수직 경로는 정원 초과 선택 0건, 일부 인원만 확인된 재고의 전체 가능 판정 0건, 허용되지 않은 분리 0건, 날짜·인원·객실·가격 근거 일치 100%, 실행 가능안 없음의 `NO_SAFE_DECISION` 100%를 먼저 통과해야 한다. 그 뒤에만 사용자 대변 정확도와 두 모드의 비용·지연시간을 비교한다.

### MVP 완료

0단계 입력·날짜·헌장, 1~5단계 승인 계약 5개, 6단계 연속성·통합 검증, 사용자 결과·부분 재논의를 실제 시나리오에서 관찰한다.

### `BOOKABLE`

필요한 모든 날짜별 가격·재고·시간·취소 조건이 유효기간 안에서 검증된 경우에만 표시한다. 공급자 공백이 있으면 완료와 별개로 `PROVISIONAL` 또는 `NEEDS_USER_CHOICE`다.

## 8. 협업 규칙

- 스키마 변경은 버전과 fixture를 함께 올린다.
- 다른 트랙의 기존 변경을 되돌리지 않는다.
- 공급자 키·프로필 원문·건강·가치·개인 예산을 커밋하거나 공개 로그에 남기지 않는다.
- 문서의 목표 상태와 코드의 구현 상태를 같은 체크박스로 표시하지 않는다.
- PR에는 변경 계약, 영향 카테고리, 마이그레이션, 검증 결과와 미검증 공백을 적는다.
