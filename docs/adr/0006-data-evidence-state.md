# ADR-0006: 데이터·근거·상태 계약

- 상태: Accepted (MVP)
- 결정일: 2026-08-14

## 권위 레코드

MVP의 사실과 상태는 `CandidateRecord`, `EvidenceSnapshot`, `VerificationReceipt`, `DecisionLedger`가 소유한다. LLM 텍스트는 이 레코드를 생성·승격하는 권위가 아니다.

## 허용 상태

| 상태 | 의미 |
| --- | --- |
| `PROVISIONAL` | 후보는 있으나 날짜별 가격·재고 등 핵심 사실 미확인 |
| `VERIFIED` | 현재 입력의 하드 제약과 필요한 사실을 영수증으로 통과 |
| `NEEDS_USER_CHOICE` | 사용자 승인이나 선택 없이는 결론을 봉인할 수 없음 |
| `BLOCKED` | 근거 부족 또는 안전한 후보 없음 |

`BOOKABLE`과 `BOOKED`는 MVP에서 생성하거나 화면에 표시하지 않는다. 예약 URL도 검증 상태를 승격하지 않는다.

## 근거 규칙

- `fixture`, `live`, `estimated` 출처 배지를 보존한다.
- 공급자 응답에 없는 값은 0이나 `PASS`로 채우지 않는다.
- Evidence ID, 조회 시각, 요청 날짜·인원, 유효기간을 연결한다.
- 일부 인원만 확인된 정원과 동의 없는 객실 분리는 실패다.
- 현재 `data-agent.ts` 명칭은 호환을 위해 유지할 수 있지만 MVP 역할은 결정론적 data gateway다.
