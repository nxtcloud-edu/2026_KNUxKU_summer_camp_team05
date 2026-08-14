# 이의 제기와 부분 재논의

- 문서 버전: v2.0 / 2026-08-14
- 권위 범위: 결과 이후 재논의, 프로필 반영, 영향 기반 재실행

## 1. 원칙

사용자는 에이전트 토론 중간에 개입하지 않는다. `FinalPlanRecord`, `VERIFIED_DRAFT`, `NEEDS_USER_CHOICE` 또는 정직한 부분 결과를 받은 뒤 문제 결정을 선택해 재논의를 요청한다.

재논의는 처음부터 다시 시작하는 자유 채팅이 아니다.

1. 사용자가 문제 카테고리·결정·이유를 지정한다.
2. 시스템이 바뀔 계약·하위 계획·예약 위험·비용을 미리 보여준다.
3. 해당 문제를 구분할 정보가 부족하면 기본 2개, 최대 4개의 확인 질문을 묻는다.
4. 사용자가 영향 범위를 승인한다.
5. `RunController`가 권한·원장 버전·의존성 범위를 검사해 재개방한다.
6. 새 계약과 최종 계획을 만들고 전후 차이를 보여준다.

## 2. 기본 상한

| 항목 | MVP 기본값 |
| --- | --- |
| 참여자당 자동 재논의 | 1회 |
| 방 전체 자동 재논의 | 3회 |
| 한 요청 안의 카테고리 내부 재시도 | 최대 2회 |
| 확인 질문 | 기본 2개, 최대 4개 |

이 수치는 비용·남용·공정성을 위한 MVP 가설이다. 보안·알레르기·접근성·예약 오류처럼 안전과 실행 가능성에 관한 정정은 일반 횟수 상한으로 숨기지 않고 별도 운영 경로로 받는다.

## 3. 요청 유형

| 유형 | 예시 | 프로필 처리 |
| --- | --- | --- |
| `PREFERENCE_MISMATCH` | “이 식당 유형은 정말 싫어요” | 이번 여행 신호 + 확인 후 장기 후보 |
| `FACT_ERROR` | “숙소 주소·가격이 틀렸어요” | 프로필 변경 없음, 근거 재검증 |
| `CONSTRAINT_ADDED` | “계단은 이용할 수 없어요” | `ConstraintProfile` 확인 후 즉시 영향 계산 |
| `BUDGET_CHANGE` | “이번 여행 상한을 5만원 올릴게요” | `TripEffectiveProfile`만 변경, 권한 확인 |
| `VALUE_POLICY_CHANGE` | “이 항목은 제가 최종 선택할게요” | `approval_required`로 이번 여행 적용 |
| `PLAN_QUALITY` | “동선이 너무 빡빡해요” | 관련 페이스·버퍼 축 확인 후보 |

사용자 문장은 raw evidence로 보존하고 에이전트가 더 넓은 취향으로 일반화하지 않는다.

## 4. `ReopenRequest`

```ts
type ReopenRequest = {
  requestId: string;
  roomId: string;
  requesterId: string;
  trigger: "user_objection" | "evidence_expired" | "continuity_failure";
  sourceLedgerId: string;
  sourceLedgerVersion: number;
  sourceFinalPlanRecordId: string;
  targetCategories: Array<1 | 2 | 3 | 4 | 5>;
  targetContractIds: string[];
  reasonRaw: string;
  evidenceRefs: string[];
  profilePatchCandidates: string[];
  impactPreview: {
    categories: number[];
    planNodeIds: string[];
    estimatedCost: string;
    estimatedDuration: string;
    reservationRisks: string[];
  };
  authorityRequired: "none" | "requester" | "affected_users" | "room_owner";
  status: "PREVIEW" | "AUTHORIZED" | "APPLIED" | "REJECTED" | "STALE";
};
```

`sourceLedgerVersion`이 현재 버전과 다르면 자동 적용하지 않는다. 새 계약을 만들 때까지 기존 계약을 수정하지 않는다.

## 5. 영향 범위

| 재개방 | 항상 재검사 | 조건부 하류 영향 |
| --- | --- | --- |
| 1 오는 길·가는 길 | 날짜, 총비용, 도착·출발 시간 | 2~5 전체 |
| 2 체류 거점·숙소 | 주소, 객실 재고, 체크인, 비용 | 3·4 후보 권역, 5 동선 |
| 3 갈 곳·할 일 | 영업·티켓·체류시간 | 4 식사 배치, 5 일정·교통패스 |
| 4 식사 | 영업·예약·식이 안전·비용 | 5 식사 슬롯·동선 |
| 5 날짜별 일정·현지 이동 | 시간·경로·버퍼·예산 | 통합 계획만, 필요 시 원인 카테고리 역전파 |

의존성이 없다는 기계적 증거가 있을 때만 하류 재실행을 생략한다. 영향을 미리보기보다 좁게 적용하지 않으며, 더 넓어지면 사용자에게 새 preview를 보여준다.

## 6. 프로필 반영 경계

확인 질문과 이의 사유로 만든 정보는 최대 5개의 `ProfilePatchCandidate`가 될 수 있다.

- 이번 여행에는 `TripEffectiveProfile`과 `AgentBelief`로 반영한다.
- 사용자가 `다음 여행에도 기억`을 체크한 항목만 `CanonicalProfile` 변경 후보가 된다.
- 하드 제약은 안전 확인 후 `ConstraintProfile`에 별도 저장한다.
- 에이전트 추론·양보·한 번의 결과 선택을 장기 취향으로 자동 승격하지 않는다.
- “쌀국수는 싫다”를 “면요리를 싫어한다”로 일반화하지 않는다.

## 7. 재개방 상태 전이

1. `RunController`가 요청자·영향받는 사용자·방 권한을 확인한다.
2. 현재 `DecisionLedger.latestAcceptedContractByCategory`와 기준 버전을 비교한다.
3. 승인된 대상 카테고리의 활성 계약 참조를 비우고 `REOPEN_REQUIRED` 사건을 append한다.
4. 하류 계획 노드에 `isStale=true`와 이유를 기록한다.
5. 재조달·검증·토론 후 새 불변 계약을 만든다.
6. 새 계약이 `ACCEPTED`된 뒤에만 활성 참조를 복구한다.
7. 6단계 연속성·통합 검증을 다시 수행한다.

과거 계약은 이력으로 보존하지만 다음 카테고리나 최종화의 권위 입력으로 쓰지 않는다.

## 8. 승인 경계

| 변경 | 자동 적용 가능 조건 |
| --- | --- |
| 사전 승인 날짜 유연성 안의 대안 | `DateResolver` 재계산 가능 |
| 사용자 자신의 소프트 취향·이번 여행 예산 목표 | 요청자 확인 후 가능 |
| 개인 절대예산 상한 | 해당 사용자 확인 필수 |
| 목적지·목표 페이스 | 방 생성 권한자 확인 필요 |
| 다른 사람의 부담액·서브그룹 참여 | 영향받는 사용자 확인 필요 |
| `approval_required` 결정 | 해당 사용자 최종 선택 필요 |

방장 승인은 모든 재논의의 기본 조건이 아니다. 다른 사람의 권리·방의 목적지·목표 페이스를 바꾸는 경우에만 적절한 권한을 요구한다.

## 9. UX

재논의 전 화면은 다음을 보여준다.

- 선택한 문제 결정과 사용자 원문 이유
- 추가 확인 2개, 불확실하면 최대 4개
- 다시 열 계약과 영향받는 일정·예산·예약
- 예상 시간·LLM/API 비용
- 기존 예약의 취소·변경 위험
- “이번 여행에만 반영”과 “체크한 항목은 다음 여행에도 기억” 구분

재논의 후에는 계약 버전, 바뀐 선택, 유지된 선택, 만족도·비용·시간 차이, 새 근거와 만료시각을 보여준다.

## 10. 실패 처리

- 요청이 오래된 원장 버전을 가리키면 `STALE`로 종료하고 최신 결과에서 다시 preview한다.
- live 공급자 장애로 안전하게 결론을 못 내리면 이전 결과를 조용히 유지하지 않고 `BLOCKED` 또는 `NEEDS_USER_CHOICE`를 공개한다.
- 최대 재시도 후 `NO_SAFE_DECISION`이면 선택안 없는 차단 계약을 만든다.
- 재논의가 만족도를 개선하지 못하거나 다른 하드 제약을 위반하면 새 계약을 승인하지 않는다.

## 11. 검증 시나리오

1. 숙소 주소 오류 제보가 프로필을 바꾸지 않고 2·5단계만 재검사한다.
2. 식당 불호 추가가 최대 4개 질문과 사용자 확인 후 이번 여행에만 반영된다.
3. 개인 절대상한 변경을 다른 사용자가 요청하면 거부된다.
4. 오래된 `sourceLedgerVersion` 두 요청 중 하나만 적용된다.
5. 1단계 교통편 변경이 하류 계약을 `STALE`로 만들고 최종화를 막는다.
6. 새 계약 승인 전 활성 계약 참조가 복구되지 않는다.
7. 재논의 이후 연속성 보고서가 이전 의무 누락을 잡는다.
