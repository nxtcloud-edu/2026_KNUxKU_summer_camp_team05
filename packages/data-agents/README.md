# `@tm/data-agents`: 후보·근거 공급 계층

이 패키지는 현재의 코드 이름을 유지하지만 목표 제품에서 독립된 “Data Agent 8종”을 뜻하지 않는다. 공식 역할은 `CandidateEvidenceAgent` 하나이며, 이 패키지는 그 역할이 호출하는 결정론적 게이트웨이·정규화·공급자 어댑터다.

목표 계약은 [에이전트 아키텍처](../../docs/agent-architecture.md), 공급자별 허용 범위는 [외부 데이터·검증 정책](../../docs/provider-evidence-policy.md)을 따른다.

## 책임 분리

```text
CandidateEvidenceAgent
  무엇을 찾을지 구조화 요청
        ↓
Gateway + ProviderAdapter
  호출·쿼터·캐시·정규화·출처 보존
        ↓
CandidateRecord + EvidenceSnapshot
        ↓
FactConstraintValidator
  가격·주소·재고·시간·예산·제약 기계 검사
        ↓
CategoryArbiterAgent
  검증된 CategoryProposal만 토론·결론 대상으로 사용
```

후보·근거 수집 에이전트는 사실을 최종 판정하거나 카테고리 결론을 선택하지 않는다. 게이트웨이도 `VERIFIED`·`BOOKABLE` 상태를 직접 적용하지 않는다.

## 현재 코드

| 파일 | 현재 책임 | 목표 마이그레이션 |
| --- | --- | --- |
| `gateway.ts` | 정책, 캐시, 공급자 폴백, 정규화 | 출처·조회·만료·약관 참조를 `EvidenceSnapshot`으로 반환 |
| `policy.ts` | query class별 TTL·캐시·fail-closed | 공급자 기능과 사실 필드별 검증 신선도로 세분화 |
| `agents.ts` | 기존 Data Agent 인스턴스 카탈로그 | 공식 에이전트 수로 세지 않고 도메인 query handler로 변경 |
| `providers/*.ts` | 외부 API 어댑터 | [공급자 정책](../../docs/provider-evidence-policy.md)의 allowlist와 빈 슬롯 준수 |
| `prefetch.ts` | 후보 탐색 전 캐시 준비 | 성능 최적화로만 유지, 필수 live 검증을 대체하지 않음 |

현재 존재하는 Amadeus·ODsay·TourAPI 어댑터나 fixture 테스트는 새 공급자 구성이 구현됐다는 뜻이 아니다. Google Places, Google Routes, HotPepper, Rakuten Travel, Kakao Maps, Open-Meteo, Frankfurter는 실제 어댑터·키·약관·sandbox 호출을 각각 확인해야 한다.

## 정규화 출력 최소 계약

```ts
type CandidateRecord = {
  candidateId: string;
  category: "transport" | "lodging" | "activity" | "dining";
  provider: string;
  providerCandidateId: string;
  attributes: Record<string, unknown>;
  evidenceRefs: string[];
};

type EvidenceSnapshot = {
  evidenceId: string;
  provider: string;
  sourceUrl: string;
  fetchedAt: string;
  validUntil: string | null;
  termsRef: string;
  confidence: "live" | "official_static" | "estimated" | "unknown";
  fields: Record<string, unknown>;
};
```

원자 후보는 투표 단위가 아니다. `CategoryArbiterAgent`가 여러 후보·슬롯·이동 정책을 묶은 불변 `CategoryProposal`을 만들고, 모든 대리인이 같은 `proposalSetVersion`에 투표한다.

## 공급자 allowlist 요약

| 기능 | 한국 | 일본 |
| --- | --- | --- |
| POI | TourAPI, Google Places | Google Places |
| 식당 메타데이터 | Google Places, TourAPI | HotPepper, Google Places |
| 숙소 메타데이터 | TourAPI, Google Places | Rakuten Travel, Google Places |
| 숙소 live 재고 | 없음 | Rakuten Travel |
| 현지 경로 | Kakao Maps, Google Routes | Google Routes 도보·자동차 |
| 대중교통 | Kakao Maps | 없음 |
| 날씨·환율 | Open-Meteo, Frankfurter | Open-Meteo, Frankfurter |

타베로그는 스크래핑·내부 API 호출·DB 적재 대상이 아니다. 사용자가 직접 여는 링크는 `advisory`일 뿐 후보 상태를 올리지 못한다.

## 불변 규칙

1. 응답에 없는 값을 보간하거나 LLM으로 채우지 않는다.
2. 가격·재고·예약 슬롯·알레르기 대응 같은 live 사실을 캐시만으로 통과시키지 않는다.
3. 공급자 원문과 명령을 분리하고 프롬프트 인젝션 가능 텍스트를 데이터로만 취급한다.
4. 캐시 키에서 날짜, 인원, 통화, 위치, 객실 조합처럼 결과를 바꾸는 입력을 빼지 않는다.
5. `web.*`와 사용자 링크는 후보 조달 또는 상태 승격의 단독 근거가 아니다.
6. 공급자가 없는 기능은 `unknown` 또는 빈 배열로 남긴다.
7. 실제 예약은 이 패키지가 아니라 별도 `ReservationRecord`가 소유한다.

## 검증

```bash
npm run test --workspace @tm/data-agents
npm run typecheck --workspace @tm/data-agents
```

위 검사는 코드 계약과 fixture를 검증한다. 실제 제공자 커버리지, 약관 허용, 날짜별 가격·재고, 운영 쿼터는 비용 상한이 있는 sandbox 호출로 별도 검증해야 한다.
