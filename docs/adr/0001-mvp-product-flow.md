# ADR-0001: MVP 제품 흐름

- 상태: Accepted (MVP)
- 결정일: 2026-08-14

## 맥락

0~6단계 전체 여행 계획은 해커톤 MVP에서 구현·검증 범위가 너무 넓다. 한 번에 실제로 관찰 가능한 결과를 만들어야 한다.

## 결정

MVP 시나리오는 **오사카, 성인 3명, 3박, 체류 거점·숙소 한 카테고리**로 고정한다.

```text
확정 입력과 TripCharter 스냅샷
  -> 후보와 EvidenceSnapshot
  -> 참여자별 ProxyBallot
  -> 하드 제약 검사와 결정론적 leximin 선택
  -> StayArbiter 설명 초안
  -> TripSupervisor 감사
  -> CategoryContractView 또는 사용자 선택/차단
```

MVP 결과는 `CategoryDecisionDraft`와 `CategoryContractView` 수준이다. 전체 여행의 `FinalPlanRecord`, 예약, 결제, 다른 카테고리, 네 도시 확장은 만들지 않는다. `MULTI_PROXY`만 제품 경로에 사용하고 `CENTRAL_BASELINE` 비교 실험은 뒤로 미룬다.

## 완료 결과

- 정상: 근거 ID, 참여자별 만족도, 선택 이유, 미확인 항목이 표시된 숙소 결과
- 사용자 결정 필요: `NEEDS_USER_CHOICE`와 선택이 필요한 이유
- 안전한 결론 없음: 선택안 없는 `BLOCKED`와 `blockReason`

## 결과

전체 제품 목표 문서는 유지하되 MVP 완료를 전체 일정 또는 예약 가능성으로 표현하지 않는다. 출시 라벨은 [MVP 출시 게이트](../operations/mvp-release-gates.md)를 따른다.
