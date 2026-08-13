# @tm/data-agents

심판이 외부 데이터에 닿는 **유일한 경로**. 캐시 read-through 게이트웨이와 제공자 어댑터.

계약: [agent-architecture.md](../../docs/agent-architecture.md) 6장

## 계층

"Data Agent"는 하나가 아니고 LLM도 아니다. 셋으로 나뉜다.

```
심판 7종  ──▶  Data Agent 8종  ──▶  제공자 어댑터 N개
             (카테고리 담당)      (Amadeus, Rakuten, ODsay, …)
```

| 파일 | 역할 | 늘어나는가 |
| --- | --- | --- |
| `gateway.ts` | 정책 조회 → 캐시 → 제공자 폴백 → 정규화 → 저장 → 로그 | **아니오. 한 벌** |
| `policy.ts` | 38개 `queryClass`의 TTL·캐시 여부·fail-closed·캐시 키 | 클래스 추가 시에만 |
| `agents.ts` | 인스턴스 8종: 누가 어떤 클래스를 담당하고 라운드당 몇 번 부르나 | 거의 안 늘어남 |
| `providers/*.ts` | **API 하나 = 파일 하나** | 예. 여기만 늘어난다 |
| `prefetch.ts` | 라운드 시작 전 조달 — 캐시를 데우고 후보를 DB에 적재 | 아니오. 한 벌 |

게이트웨이가 한 벌이라 정규화 스키마·TTL·신뢰도·프라이버시 경계가 한 곳에서만 강제된다. 심판 입장에서는 인스턴스가 8종이든 제공자가 30개든 "필요하면 도구 한 번"으로 동일하다.

## 붙어 있는 제공자

| 어댑터 | 담당 클래스 | 환경변수 | 비고 |
| --- | --- | --- | --- |
| `amadeus` | `flight.offers_search` · `flight.cheapest_date` · `flight.offer_price` | `AMADEUS_CLIENT_ID` · `AMADEUS_CLIENT_SECRET` | 기본 baseUrl은 test 환경. `AMADEUS_BASE_URL`로 운영 전환 |
| `odsay` | `transit.route` · `transit.airport_transfer` | `ODSAY_API_KEY` | 실패도 HTTP 200으로 온다 — 본문 `error`를 본다 |
| `tourapi` | `poi.search` · `dining.search` · `geo.place_details` | `TOUR_API_KEY` | 액티비티 정규화 스키마가 없어 **캐시 전용**. `candidates`에 적재되지 않는다 |

`providersFromEnv()`는 키가 있는 것만 싣고, 빠진 것은 `missing`으로 보고한다. 조용히 빠지면 후보가 0건인 이유를 아무도 모른다.

```typescript
const setup = providersFromEnv();
setup.missing; // [{ id: 'amadeus', envVars: ['AMADEUS_CLIENT_ID', ...] }]
const registry = setup.registry(packProviders);
```

## 프리페치

라운드가 시작되기 전에 후보를 조달해 캐시와 `candidates` 테이블에 채운다. 심판은 조달을 기다리는 대신 **감시와 판정**에 집중한다.

```typescript
const plan = planPrefetch({ runId, roundId: 'r_2', packId, params: { 'hotel.search': [{ ... }] } });
const report = await runPrefetch(gateway, plan, { sink });
```

미리 받지 **않는** 것이 계약의 핵심이다.

| 제외 | 이유 |
| --- | --- |
| `web.*` · `kb.retrieve` | 후보 조달원이 아니다. 심판이 필요할 때만 부른다 (6.9) |
| fail-closed 클래스 | 안전 축은 판정 시점의 live 값이어야 한다 |
| `cache: 'never'` 클래스 | 저장 자체가 금지다. 미리 받아도 버려지고 쿼터만 태운다 |

`runPrefetch`는 **던지지 않는다.** 실패는 보고서에 남고 라운드는 그대로 진행한다 — 프리페치는 성능 최적화이지 조달의 유일한 경로가 아니다. 다만 클래스 쿼터를 넘기면 즉시 멈춘다. 프리페치가 라운드 예산을 다 먹고 심판이 검증 호출을 못 하는 상황이 최악이다.

정규화 스키마(`candidateSchema`)를 통과한 응답만 `candidates`에 들어간다. 통과하지 못한 것은 캐시에만 남는다 — 스키마 밖의 것을 후보로 인정하면 계획서의 `external_id` 전수 검증이 무너진다.

## 제공자 어댑터 추가하기

어댑터는 **호출과 정규화만** 한다. 캐시·정책·쿼터·로깅을 알 필요가 없다.

```typescript
import type { ProviderAdapter } from '@tm/data-agents';

export const rakutenTravel: ProviderAdapter = {
  id: 'rakuten_travel', // Pack의 providers 배열과 같은 이름
  supports: (queryClass) => queryClass.startsWith('hotel.'),
  async fetch(request) {
    const raw = await callRakuten(request.params);
    return {
      payload: normalizeHotel(raw), // 정규화 스키마로 변환
      confidence: 'live',
      termsRef: 'rakuten:tos-2026-04',
    };
  },
};
```

지켜야 할 것은 하나뿐이다. **응답에 없는 값을 지어내거나 보간하지 않는다.** 없으면 `null` + `confidence: 'unknown'`으로 남긴다. 보간한 값이 캐시에 들어가면 그 뒤로는 아무도 추정치인 줄 모른다.

제공자 우선순위는 Pack의 `providers` 배열이 정한다. 지역별 분기를 코드에 넣지 않는다.

```typescript
createStaticRegistry([rakutenTravel, amadeusHotel], {
  'jp-osaka': { hotel: ['rakuten_travel', 'amadeus_hotel'] },
});
```

## 검증

```bash
npm run test --workspace @tm/data-agents      # 57개, 키 없이 돈다
npm run typecheck --workspace @tm/data-agents
```

테스트는 픽스처 제공자와 `fetch` 스텁으로 돌기 때문에 API 키가 필요 없다. 실제 제공자 어댑터는 **응답 형태를 고정해 정규화 계약만** 검증한다 — 실제 호출은 키를 넣고 비용 상한이 있는 sandbox 또는 nightly로 분리한다.

## 손대면 안 되는 것

| 규칙 | 근거 |
| --- | --- |
| 캐시 금지 클래스(`flight.offer_price`, `hotel.room_combination`, `dining.diet_support` 등)에 예외를 두지 않는다 | 확정가·그룹 재고·객실 조합·알레르기 대응은 캐시로 통과할 수 없다 (D3) |
| fail-closed 클래스는 조회 실패가 곧 승격 불가다 | `uncertainties`에 적는 것만으로 통과하지 못한다 (6.5) |
| 캐시 키에서 인원수를 빼지 않는다 | 1인 캐시를 6인 조회에 재사용하면 재고 부족을 놓친다 (항공 4.1) |
| `web.*`·`kb.retrieve`는 advisory다 | 후보를 만들거나 `VERIFIED`/`BOOKABLE`로 승격시키지 못한다 (6.9) |
| 심판·Orchestrator·Supervisor만 호출한다 | `persona:*`는 스키마에서 거부된다 (6.9) |

이 다섯 가지는 전부 테스트로 고정되어 있다. 깨면 `npm run test`가 실패한다.
