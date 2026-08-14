# ADR-0002: MVP Agent 역할과 권한

- 상태: Accepted (MVP)
- 결정일: 2026-08-14

## 결정

장기 목표의 논리 역할 5종은 유지하되 MVP의 모델 호출은 다음 세 역할만 사용한다.

| MVP 모델 역할 | 입력 범위 | 허용 출력 | 금지 권한 |
| --- | --- | --- | --- |
| `UserProxyAgent` | 자기 확정 프로필과 이번 여행 예외 | 주장, 양보안, `ProxyBallot` | 다른 사용자 열람, 사실·상태 변경 |
| `StayArbiterAgent` | 정규화 후보, 영수증, 모든 투표 | 논점·선택 설명, 종료/차단 초안 | 선택 계산 변경, 검증 실패 덮어쓰기 |
| `TripSupervisorAgent` | 헌장, 선택안, 영수증, 예산·정원 결과 | `CLEAR`, `RECHECK`, `HOLD` 감사 | 대안 재선택, 예약·상태 직접 변경 |

`CandidateEvidenceAgent`의 MVP 책임은 결정론적 검색 계획과 데이터 게이트웨이가 맡는다. `PlanFinalizerAgent`의 MVP 책임은 결정론적 결과 렌더러가 맡는다. 이는 두 역할의 장기 목표를 폐기하는 결정이 아니다.

## 종료 계약

- Proxy 실패를 찬성으로 추정하지 않는다.
- Arbiter는 `CONCLUDED` 또는 `NO_SAFE_DECISION`을 명시한다.
- Supervisor가 실패하거나 근거가 부족하면 `CLEAR`로 추정하지 않는다.
- 모델은 제안하고 설명한다. 계산, 검증, 상태 전이, 영속화 권한은 갖지 않는다.

## 결과

MVP 모델 호출 수와 권한 면적을 줄이면서 사용자별 대변, 중재 설명, 전역 감사를 각각 관찰할 수 있다.
