# ADR-0002: MVP Agent 역할과 권한

- 상태: Accepted (MVP)
- 결정일: 2026-08-14

## 결정

제품과 Gateway가 노출하는 공식 Agent 역할은 다음 다섯 종류뿐이다.

| 공식 역할 | 입력 범위 | 허용 출력 | 금지 권한 |
| --- | --- | --- | --- |
| `UserProxyAgent` | 자기 확정 프로필, `TripCharter`, 동일 버전 Proposal | `ProxySearchBrief`, 전체 순위 `ProxyBallot`, 근거·후보 보완 요청 | 다른 사용자 열람, 여행 API 호출, 만족도·상태 변경 |
| `CandidateEvidenceAgent` | Proxy별 Brief, 중립 Brief, 승인 Provider 목록 | `DataRequest`·`QueryPlan`, 중복 병합·공정한 검색 예산 | API Key·원본 응답 열람, HTTP 실행, 후보 선택·검증 선언 |
| `CategoryArbiterAgent` | 한 카테고리의 고정 ProposalSet, 전원 Ballot, 결정론 선택 | 갈등·조건부 수용 설명, `CategoryDecisionContract` | 결정론 선택 변경, 검증 실패 덮어쓰기 |
| `TripOrchestratorAgent` | 카테고리 계약, 전역 가드, 필요한 Evidence | `CLEAR`, `RECHECK`, `HOLD` 전역 감사 | 대안 재선택, 실행 순서·제품 상태 직접 변경 |
| `PlanFinalizerAgent` | 계약 연속성, 전역 감사, 상태 상한 | `FinalPlanRecord` 설명과 미해결 항목 | 검증·상태 상한 승격, 예약·결제 실행 |

`CandidateEvidenceAgent`는 제품 논리상 Provider 선택과 검색 계획을 소유하지만 실제 Network I/O, 자격 증명, 캐시, 쿼터, retry, 정규화는 결정론적 Provider Gateway가 수행한다. `UserProxyAgent`는 Codex 모델을 호출할 수 있지만 여행 API를 직접 호출하지 않는다.

`long_distance`, `stay`, `activity`, `dining`, `schedule`이 공식 카테고리다. `budget`은 독립 토론 카테고리가 아니라 모든 단계의 횡단 제약이다.

기존 `STAY_ARBITER`, `TRIP_SUPERVISOR`, Persona·Referee·Supervisor, Python AgentCore 경로는 신규 제품 계약이 아니다. 삭제 전까지 migration 호환 코드로만 유지하고 신규 호출·문서·테스트는 공식 다섯 역할을 사용한다.

## 종료 계약

- Proxy 실패나 사용자 미응답을 찬성으로 추정하지 않는다.
- 모든 Proxy는 동일 `proposalSetVersion`의 모든 Proposal을 평가한다.
- Arbiter는 `CONCLUDED` 또는 `NO_SAFE_DECISION`을 명시한다.
- Orchestrator가 실패하거나 근거가 부족하면 `CLEAR`로 추정하지 않는다.
- 토론 도중 사용자를 호출하지 않고 자동 복구 불가 시 `NO_SAFE_DECISION` 또는 `NEEDS_USER_CHOICE`로 종료한다.
- 모델은 제안하고 설명한다. 계산, 검증, 상태 전이, 영속화 권한은 갖지 않는다.

## 결과

첫 수직 경로가 `stay` 하나여도 역할·권한·wire 명칭이 장기 구조와 다시 갈라지지 않는다.
