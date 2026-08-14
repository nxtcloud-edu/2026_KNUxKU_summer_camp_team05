# ADR-0001: MVP 제품 흐름

- 상태: Accepted (MVP)
- 결정일: 2026-08-14

## 맥락

0~6단계 전체 여행 계획은 해커톤 MVP에서 구현·검증 범위가 너무 넓다. 한 번에 실제로 관찰 가능한 결과를 만들어야 한다.

## 결정

MVP 시나리오는 **오사카, 성인 3명, 3박, 체류 거점·숙소 한 카테고리**로 고정한다.

```text
확정 입력과 TripCharter 스냅샷
  -> 참여자별 ProxySearchBrief + 그룹 중립 Brief
  -> CandidateEvidence QueryPlan
  -> Provider Gateway와 CandidateRecord/EvidenceSnapshot
  -> FactConstraintValidator와 고정 CandidatePoolVersion
  -> CategoryProposalSet과 참여자별 ProxyBallot
  -> 하드 제약 검사와 결정론적 leximin 선택
  -> CategoryArbiter 계약
  -> TripOrchestrator 감사
  -> PlanFinalizer의 PROVISIONAL/VERIFIED/사용자 선택/차단 결과
```

첫 수직 경로는 `stay`만 실행하지만 wire 계약과 역할 명칭은 다섯 공식 역할·다섯 카테고리를 기준으로 한다. 현재 fixture 결과는 실제 Provider 호출과 근거 영수증이 없으므로 `PROVISIONAL` 상한을 넘지 않는다. 예약, 결제, 네 도시 전체 공급자 완성은 만들지 않는다. `MULTI_PROXY`만 제품 경로에 사용하고 `CENTRAL_BASELINE` 비교 실험은 뒤로 미룬다.

## 완료 결과

- 정상: 근거 ID, 참여자별 만족도, 선택 이유, 미확인 항목이 표시된 숙소 결과
- 사용자 결정 필요: `NEEDS_USER_CHOICE`와 선택이 필요한 이유
- 안전한 결론 없음: 선택안 없는 `BLOCKED`와 `blockReason`

## 결과

전체 제품 목표 문서는 유지하되 MVP 완료를 전체 일정 또는 예약 가능성으로 표현하지 않는다. 출시 라벨은 [MVP 출시 게이트](../operations/mvp-release-gates.md)를 따른다.
