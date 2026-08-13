# 항공권 심판 에이전트 (Flight Referee) — 구현 계획

- **문서 버전**: v1.0 / 2026-08-13
- **상위 문서**: `travel-mediation-plan.md` v1.2
- **담당 라운드**: R1 (해외 Destination Pack 전용) + R0의 DateResolver 지원
- **대상 지역**: 대한민국 출발 → 일본 (MVP) / 국내선(제주 등) 보조

---

## 목차

1. [역할과 경계](#1-역할과-경계)
2. [입출력 계약](#2-입출력-계약)
3. [사용 Open API 총람](#3-사용-open-api-총람)
4. [Amadeus API 상세 활용](#4-amadeus-api-상세-활용)
5. [보조·폴백 API](#5-보조폴백-api)
6. [도구(Tool) 정의](#6-도구tool-정의)
7. [정규화 스키마 — FlightCandidate](#7-정규화-스키마--flightcandidate)
8. [실행 파이프라인](#8-실행-파이프라인)
9. [하드 제약 매핑과 실격 규칙](#9-하드-제약-매핑과-실격-규칙)
10. [스코어링 모델](#10-스코어링-모델)
11. [주장 강도 추정과 중재 로직](#11-주장-강도-추정과-중재-로직)
12. [절충안 생성 전략](#12-절충안-생성-전략)
13. [시스템 프롬프트 전문](#13-시스템-프롬프트-전문)
14. [판결 출력 스키마](#14-판결-출력-스키마)
15. [캐시·쿼터·비용](#15-캐시쿼터비용)
16. [실패 처리와 폴백](#16-실패-처리와-폴백)
17. [테스트 케이스](#17-테스트-케이스)
18. [확장 훅](#18-확장-훅)

---

## 1. 역할과 경계

### 1.1 하는 일

| # | 책무 | 산출물 |
| --- | --- | --- |
| 1 | R0 지원: 날짜 후보별 최저 항공료 지수 제공 | `airfareIndex[]` → DateResolver 스코어링 입력 |
| 2 | 확정 날짜에 대한 항공편 후보 5~8개 조달 | `FlightCandidate[]` |
| 3 | 그룹 하드 제약(새벽 불가, 경유 불가, 예산) 실격 심사 | `disqualified[]` |
| 4 | 토론 중 사실관계 팩트체크 (소요시간, 수하물, 최종가) | 팩트체크 블록 |
| 5 | 주장 강도를 추정해 절충안 설계 | `proposals[]` |
| 6 | 최종 항공편 판결 + 예약 마감 안내 | `verdict` |

### 1.2 하지 않는 일 (경계)

- **예약·발권하지 않는다.** MVP는 링크아웃. 어떤 경우에도 결제 정보를 다루지 않는다.
- **후보를 발명하지 않는다.** API 응답에 존재하는 항공편만 제시한다.
- **현지 교통을 다루지 않는다.** 공항→시내 이동은 교통편 심판(R1 후반)의 몫이다. 단, 공항 선택(간사이 vs 이타미)이 시내 접근성에 직결되므로 **공항→시내 소요시간·비용만 참고 지표로 조회**해 판결 근거에 포함한다.
- **국내 목적지(강릉·부산 등)에서는 활성화되지 않는다.** `Pack.roundPreset == "standard_domestic"` 이면 교통편 심판이 R1 전체를 담당한다. 예외: `kr-jeju` 는 국내선이 필요하므로 **국내선 모드**로 활성화된다.

### 1.3 활성화 조건

```typescript
function isFlightRefereeActive(pack: DestinationPack, origin: string): boolean {
  if (pack.roundPreset === 'standard_overseas') return true;      // jp-*
  if (pack.packId === 'kr-jeju') return true;                     // 국내선 모드
  if (pack.requiresAirTravel) return true;                        // 확장 대비
  return false;
}
```

---

## 2. 입출력 계약

### 2.1 입력

```typescript
interface FlightRefereeInput {
  runId: string;
  pack: DestinationPack;               // 목적지·공항 코드·현지 정보
  dates: {                             // R0에서 확정된 날짜 (v1.2)
    start: string;                     // "2026-10-15"
    end: string;                       // "2026-10-18"
    nights: number;
  };
  travelers: TravelerContext[];        // 인원, 개인별 예산 상한, 시간대 제약
  budgetAllocated: number;             // 항공 항목에 배정된 1인 총액 (KRW)
  groupHardConstraints: HardConstraint[];
  concessionCredits: Record<string, number>;
  originCandidates: string[];          // ["ICN", "GMP"] — 출발 공항 후보
}
```

**출발 공항 결정**: MVP는 참여자 거주지를 묻지 않는다. 대신 `originCandidates`를 Pack + 국가 기본값(한국 → `["ICN","GMP"]`)으로 두고, 김포 출발편이 인천보다 총 비용·시간에서 유리하면 후보에 포함한다. Phase 2에서 거주지 기반 개인화.

### 2.2 출력

`FlightVerdict` (14장 참조). R2 숙소 심판에게 다음을 전달한다.

```
→ arrivalTime, departureTime         (체크인/체크아웃 시각 제약)
→ arrivalAirport                     (숙소 위치 스코어링의 기준점)
→ actualSpend                        (남은 예산 재배분)
```

---

## 3. 사용 Open API 총람

> ⚠️ 요금·쿼터·약관은 수시로 변경된다. 착수 전 각 제공자 문서를 반드시 재확인할 것. 아래는 설계 시점 기준의 계획이다.

### 3.1 핵심 (MVP 필수)

| 용도 | 제공자 | 엔드포인트 | 인증 | 비고 |
| --- | --- | --- | --- | --- |
| 항공편 검색 | **Amadeus Self-Service** | `GET/POST /v2/shopping/flight-offers` | OAuth2 Client Credentials | 주력. Test/Production 환경 분리 |
| 최종가 검증 | Amadeus | `POST /v1/shopping/flight-offers/pricing` | 〃 | 검색가 ≠ 실제가. **판결 직전 필수** |
| 날짜별 최저가 | Amadeus | `GET /v1/shopping/flight-dates` | 〃 | DateResolver 입력 |
| 공항·도시 코드 | Amadeus | `GET /v1/reference-data/locations` | 〃 | Pack에 캐싱 |
| 항공사 코드 | Amadeus | `GET /v1/reference-data/airlines` | 〃 | 표시명 정규화 |
| 좌석 배치 | Amadeus | `GET /v1/shopping/seatmaps` | 〃 | 그룹 인접석 가능 여부 |
| 지연 예측 | Amadeus | `GET /v1/travel/predictions/flight-delay` | 〃 | 리스크 스코어 |
| 정시 운항률 | Amadeus | `GET /v1/airport/predictions/on-time` | 〃 | 항공사 신뢰도 |
| 환율 | 한국수출입은행 | 환율정보 조회 API | API Key | JPY→KRW 표시 |

### 3.2 보조 (가격 크로스체크 · 링크아웃 · 폴백)

| 용도 | 제공자 | 비고 |
| --- | --- | --- |
| LCC 가격 보완 | Travelpayouts / Aviasales Data API | 국내 LCC(진에어·티웨이·에어부산) 커버 보완, 어필리에이트 수익 연결 |
| 가격 크로스체크 | Kiwi.com Tequila API | 무료 티어. Amadeus와 30% 이상 괴리 시 경고 |
| 예약 링크아웃 | Skyscanner Partner / 네이버 항공권 | 딥링크 생성 |
| 대체 공급자 | Duffel API | Amadeus 장애 시 폴백 후보 |

### 3.3 공공데이터 (한국·일본 특화)

| 용도 | 제공자 | 비고 |
| --- | --- | --- |
| 인천공항 운항 정보 | 인천국제공항공사 (공공데이터포털) | 실시간 출도착, 터미널 정보(T1/T2 구분은 미팅 시 중요) |
| 김포·제주 등 운항 정보 | 한국공항공사 (공공데이터포털) | 국내선 스케줄 |
| 공항 혼잡도 | 인천공항공사 출국장 혼잡도 API | 새벽·성수기 출발 시 대기시간 경고 |
| 일본 공항 정보 | 각 공항 운영사 공개 데이터 / Amadeus 대체 | KIX·ITM·NRT·HND·FUK·CTS |
| 국내선 항공 | 한국공항공사 항공운항현황 | `kr-jeju` Pack 전용 |

### 3.4 한국·일본 노선 특성 (설계에 반영할 도메인 지식)

| 목적지 Pack | 주요 도착공항 | 특성 | 심판이 반드시 고려할 것 |
| --- | --- | --- | --- |
| `jp-osaka` | **KIX**(간사이), ITM(이타미) | KIX는 국제선, ITM은 사실상 국내선 | KIX→난바 라피트 38분 / ¥1,290 |
| `jp-tokyo` | **NRT**(나리타), **HND**(하네다) | HND가 시내 접근 압도적 우위, 대신 비쌈 | NRT→신주쿠 90분 vs HND→신주쿠 35분. **이 차이가 가격차를 상쇄하는지 반드시 계산** |
| `jp-kyoto` | KIX 경유 | 교토 공항 없음 | KIX→교토 하루카 75분 / ¥3,600 |
| `jp-fukuoka` | **FUK** | 공항↔시내 지하철 5분. 국내 최단 노선 | 저가·단거리, 당일치기도 가능 |
| `jp-sapporo` | **CTS**(신치토세) | 겨울 결항 리스크 | 12~2월 지연 예측 가중치 상향 |
| `kr-jeju` | **CJU** | 국내선, 편수 매우 많음 | 가격보다 시간대가 쟁점 |

**HND vs NRT 판정 규칙**(도쿄 Pack): 총 비용 = 항공료 + (공항↔숙소 교통비 × 왕복 × 인원), 총 시간 = 비행시간 + 공항 이동시간 × 2. 이 두 축으로 비교해 판결문에 명시한다. 항공료만 보고 NRT를 고르면 그룹은 왕복 3시간을 잃는다.

---

## 4. Amadeus API 상세 활용

### 4.1 Flight Offers Search — 후보 조달

```http
POST /v2/shopping/flight-offers
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "currencyCode": "KRW",
  "originDestinations": [
    { "id": "1", "originLocationCode": "ICN", "destinationLocationCode": "KIX",
      "departureDateTimeRange": { "date": "2026-10-15", "time": "08:00",
                                  "timeWindow": "12H" } },
    { "id": "2", "originLocationCode": "KIX", "destinationLocationCode": "ICN",
      "departureDateTimeRange": { "date": "2026-10-18", "time": "14:00",
                                  "timeWindow": "8H" } }
  ],
  "travelers": [
    { "id": "1", "travelerType": "ADULT" }, ... // 인원수만큼
  ],
  "sources": ["GDS"],
  "searchCriteria": {
    "maxFlightOffers": 20,
    "flightFilters": {
      "cabinRestrictions": [
        { "cabin": "ECONOMY", "coverage": "MOST_SEGMENTS",
          "originDestinationIds": ["1","2"] }
      ],
      "connectionRestriction": { "maxNumberOfConnections": 0 }  // 직항 우선 1차 탐색
    },
    "pricingOptions": { "includedCheckedBagsOnly": false }
  }
}
```

**탐색 전략 (2-Pass)**

```
Pass 1: 직항 · 배정 예산 이내 · 시간대 제약 적용 → 후보 확보
        결과 ≥ 5개 → 종료
Pass 2: 조건 완화 (경유 1회 허용 or 시간창 확대 or 예산 +10%)
        완화한 조건을 반드시 회의록에 명시
        예: "직항으로 예산 내 후보가 3개뿐이라 경유 1회를 포함했습니다"
```

**중요**: 그룹 인원 전원을 `travelers`에 포함해 조회해야 한다. 1명 기준으로 조회하면 **잔여 좌석 부족**을 놓친다. 6인이 같은 항공편에 못 타는 상황이 실제로 흔하다.

### 4.2 Flight Cheapest Date Search — DateResolver 지원

```http
GET /v1/shopping/flight-dates?origin=ICN&destination=OSA&duration=3
    &departureDate=2026-10-01,2026-11-30&oneWay=false&nonStop=true
    &viewBy=DATE
```

- `destination`은 **도시 코드**(OSA)를 쓴다. KIX/ITM을 모두 포괄한다.
- 응답의 날짜별 `price.total`을 정규화해 `airfareIndex ∈ [0,1]` 로 변환:
  ```
  airfareIndex(d) = 1 − (price(d) − minPrice) / (maxPrice − minPrice)
  ```
- 이 API는 커버리지가 노선별로 불균등하다. 응답이 없으면 **Flight Offers Search를 후보 구간에 대해서만 개별 호출**(최대 3회)해 대체한다.
- 결과는 `pack_cache`에 24시간 캐싱. 같은 Pack의 다른 방들이 공유한다.

### 4.3 Flight Offers Price — 판결 직전 필수 검증

검색 결과의 가격은 확정가가 아니다. **판결하기로 정한 후보 1~2개에 대해서만** 호출한다(전체에 호출하면 쿼터 낭비).

```http
POST /v1/shopping/flight-offers/pricing?include=bags,other-services
Content-Type: application/json

{ "data": { "type": "flight-offers-pricing",
            "flightOffers": [ <검색 결과 offer 객체 원본> ] } }
```

- 가격이 검색가 대비 **±5% 이상 변동**하면 판결을 보류하고 재검색한다.
- 응답의 `bags`로 위탁수하물 포함 여부·추가요금을 확정한다. 일본 노선 LCC는 수하물 미포함이 기본이라 **1인 왕복 3~5만원 차이**가 난다. 이것을 놓치면 예산 정산이 통째로 틀어진다.
- 검증 실패(offer 만료)는 정상 상황이다. 즉시 재검색 후 차순위로 진행한다.

### 4.4 Seatmaps — 그룹 인접석 확인

```http
GET /v1/shopping/seatmaps?flight-orderId={id}
POST /v1/shopping/seatmaps   (flight-offer 객체 전달)
```

6인이 뿔뿔이 흩어져 앉는 것은 그룹 여행에서 실제 불만 요인이다. 판결에 **"연속 좌석 확보 가능 여부"** 를 참고 지표로 포함하되, 하드 제약으로 쓰지는 않는다(좌석 지정은 발권 후 문제이므로).

### 4.5 Flight Delay Prediction / On-Time Performance — 리스크 지표

```http
GET /v1/travel/predictions/flight-delay?originLocationCode=ICN
    &destinationLocationCode=CTS&departureDate=2026-01-20
    &departureTime=09:00:00&arrivalDate=...&carrierCode=KE
    &flightNumber=765&aircraftCode=333&duration=PT3H
```

- 겨울 삿포로(CTS), 태풍철 오키나와·후쿠오카 노선에서 가중치를 높인다.
- 지연 확률이 높은 편은 실격이 아니라 **스코어 감점 + 판결문 경고**로 처리한다.
- "마지막 날 저녁 비행기 + 높은 지연 확률"은 특히 위험하므로 별도 경고를 띄운다.

---

## 5. 보조·폴백 API

### 5.1 LCC 커버리지 보완

Amadeus는 GDS 기반이라 일부 LCC(특히 국내 LCC의 직판 운임)를 놓칠 수 있다. 한일 노선은 LCC 비중이 높아 이 공백이 크다.

**대응**
1. Amadeus 결과에 진에어·티웨이·에어부산·에어서울·피치·제트스타재팬이 없으면 Travelpayouts/Kiwi로 보완 조회
2. 보완 조회로 얻은 후보는 `source: "travelpayouts"`, `price.confidence: "estimated"` 로 표기
3. 회의록과 계획서에 **"실시간 확정가가 아님"** 배지를 붙인다
4. 예약은 링크아웃

### 5.2 가격 크로스체크 규칙

```
if |amadeusPrice − crossCheckPrice| / amadeusPrice > 0.30:
    → 후보에 ⚠️ 표기 + 판결문 uncertainties에 기록
    → 사용자가 개입할 수 없으므로, 불확실성은 반드시 표면화한다
```

---

## 6. 도구(Tool) 정의

심판 LLM에 노출되는 함수 시그니처. **원본 API를 그대로 노출하지 않는다.** 어댑터가 정규화한 형태만 준다.

```json
[
  {
    "name": "search_flights",
    "description": "확정된 날짜에 대해 그룹 전원이 탑승 가능한 왕복 항공편 후보를 조회한다. 반드시 그룹 인원 전체로 조회되며, 잔여 좌석이 부족한 항공편은 결과에서 제외된다.",
    "parameters": {
      "type": "object",
      "properties": {
        "origin":        { "type": "string", "description": "출발 공항 IATA (ICN, GMP)" },
        "destination":   { "type": "string", "description": "도착 공항 또는 도시 IATA (KIX, OSA, TYO)" },
        "departureDate": { "type": "string", "format": "date" },
        "returnDate":    { "type": "string", "format": "date" },
        "departureTimeWindow": {
          "type": "object",
          "properties": { "from": {"type":"string"}, "to": {"type":"string"} },
          "description": "출발 시각 허용 범위. 하드 제약(새벽 불가)이 있으면 반드시 지정"
        },
        "returnTimeWindow": { "type": "object" },
        "maxPricePerPerson": { "type": "integer", "description": "1인 왕복 상한 (KRW)" },
        "maxConnections": { "type": "integer", "enum": [0, 1, 2] },
        "includeCheckedBag": { "type": "boolean", "description": "위탁수하물 포함 운임만 조회" },
        "excludeCarriers": { "type": "array", "items": {"type":"string"} }
      },
      "required": ["origin","destination","departureDate","returnDate"]
    }
  },
  {
    "name": "price_flight_offer",
    "description": "특정 후보의 확정 가격과 수하물 규정을 검증한다. 판결 직전 최종 후보에만 호출할 것. 검색가와 5% 이상 차이나면 재검색이 필요하다.",
    "parameters": {
      "type": "object",
      "properties": { "candidateId": { "type": "string" } },
      "required": ["candidateId"]
    }
  },
  {
    "name": "get_airport_transfer",
    "description": "도착 공항에서 목적지 중심가까지의 이동 시간·비용·수단을 조회한다. 공항 선택(예: HND vs NRT) 비교에 사용한다.",
    "parameters": {
      "type": "object",
      "properties": {
        "airport": { "type": "string" },
        "destinationArea": { "type": "string", "description": "Pack.areas 중 하나" }
      },
      "required": ["airport","destinationArea"]
    }
  },
  {
    "name": "get_flight_risk",
    "description": "해당 항공편의 지연 확률과 항공사 정시 운항률을 조회한다. 겨울 홋카이도, 태풍철 규슈 노선에서 특히 유용하다.",
    "parameters": {
      "type": "object",
      "properties": { "candidateId": { "type": "string" } },
      "required": ["candidateId"]
    }
  },
  {
    "name": "check_group_seating",
    "description": "그룹 인원이 인접 좌석에 앉을 수 있는지 확인한다. 참고 지표이며 실격 사유가 아니다.",
    "parameters": {
      "type": "object",
      "properties": { "candidateId": { "type": "string" } },
      "required": ["candidateId"]
    }
  }
]
```

---

## 7. 정규화 스키마 — FlightCandidate

```json
{
  "id": "F-03",
  "source": "amadeus",
  "priceConfidence": "live",
  "outbound": {
    "carrier": { "code": "KE", "name": "대한항공" },
    "flightNumber": "KE723",
    "departure": { "airport": "ICN", "terminal": "T2", "at": "2026-10-15T09:05" },
    "arrival":   { "airport": "KIX", "terminal": "T1", "at": "2026-10-15T11:00" },
    "durationMin": 115,
    "connections": 0,
    "aircraft": "B737-900"
  },
  "inbound": {
    "carrier": { "code": "KE", "name": "대한항공" },
    "flightNumber": "KE724",
    "departure": { "airport": "KIX", "at": "2026-10-18T12:00" },
    "arrival":   { "airport": "ICN", "at": "2026-10-18T14:05" },
    "durationMin": 125,
    "connections": 0
  },
  "price": {
    "perPersonRoundTrip": 312000,
    "currency": "KRW",
    "taxesIncluded": true,
    "groupTotal": 1872000
  },
  "baggage": {
    "cabinKg": 10,
    "checkedIncluded": true,
    "checkedKg": 23,
    "extraCheckedFeePerPerson": 0
  },
  "seatsAvailable": 9,
  "groupSeatingLikely": true,
  "changePolicy": { "refundable": false, "changeFeeKrw": 70000 },
  "risk": { "delayProbability": 0.12, "carrierOnTimeRate": 0.86 },
  "airportTransfer": {
    "toArea": "난바",
    "durationMin": 38,
    "costPerPersonKrw": 12000,
    "mode": "라피트 특급"
  },
  "effectiveTotal": {
    "perPerson": 336000,
    "note": "항공료 + 왕복 공항이동 + 수하물 추가요금"
  },
  "bookingUrl": "https://…",
  "fetchedAt": "2026-08-13T02:31:00Z"
}
```

> **`effectiveTotal` 이 판결의 기준이다.** 순수 항공료로 비교하면 나리타 저가편이 이기지만, 공항 이동비를 더하면 하네다가 이기는 경우가 많다. 심판은 항상 실효 총액으로 논한다.

---

## 8. 실행 파이프라인

```
[0] PRECONDITION
    R0에서 확정된 dates 수신. 없으면 즉시 에러 → Chief에 반환
        │
        ▼
[1] CONSTRAINT COMPILE                              (결정론)
    개인별 하드 제약 → 조회 파라미터로 컴파일
      · redEyeOk=false 가 1명이라도 있으면 departureTimeWindow.from = "06:00"
      · maxPricePerPerson = min(개인 예산 상한) ∩ budgetAllocated
      · 경유 불가자가 있으면 maxConnections = 0
        │
        ▼
[2] SOURCING                                        (도구 호출)
    search_flights (Pass 1 직항) → 부족하면 Pass 2 완화
    LCC 공백 감지 시 보조 제공자 조회
    → 후보 5~8개, 각 후보에 get_airport_transfer 적용해 effectiveTotal 계산
        │
        ▼
[3] SCREENING                                       (결정론)
    하드 제약 위반 후보 실격 처리 (사유 명시)
    잔여 좌석 < 인원 → 실격
        │
        ▼
[4] BRIEFING                                        (LLM)
    후보 카드를 회의록에 게시. 실격 후보도 사유와 함께 노출
    ★ 실격 사유를 보여주는 것이 중요하다. "왜 싼 게 없냐"는 의심을 막는다
        │
        ▼
[5] DEBATE (STATEMENT → CLASH)                      (오케스트레이터)
    참여자 에이전트 발언. 심판은 관찰하며 주장 강도 추정 (11장)
        │
        ▼
[6] FACTCHECK                                       (LLM + 도구)
    잘못된 주장 정정. get_flight_risk / price_flight_offer 로 근거 확보
        │
        ▼
[7] PROPOSAL                                        (LLM)
    강도 프로파일에 기반한 절충안 1~2개 생성 (12장)
        │
        ▼
[8] PRICING VERIFY                                  (도구)
    최종 후보에 price_flight_offer 호출
    ±5% 초과 변동 → [2]로 회귀 (최대 1회)
        │
        ▼
[9] VERDICT                                         (LLM)
    판결문 + 예약 마감일 + 미확인 사항 명시
        │
        ▼
[10] HANDOFF
    도착/출발 시각, 도착 공항, 실지출액을 R2 숙소 심판에 전달
```

---

## 9. 하드 제약 매핑과 실격 규칙

| 설문 하드 제약 | 컴파일 결과 | 실격 판정 |
| --- | --- | --- |
| `red_eye_flight` (새벽 비행 불가) | `departureTimeWindow.from = "06:00"` | 출발 06:00 이전 편 실격 |
| `late_arrival` (심야 도착 불가) | 도착 23:00 이후 실격 | 실격 |
| `no_connection` (경유 불가) | `maxConnections = 0` | 경유편 실격 |
| `no_lcc` (LCC 불가) | `excludeCarriers = [LCC 목록]` | 해당 항공사 실격 |
| 예산 상한 | `maxPricePerPerson = min(전원)` | `effectiveTotal.perPerson` 초과 시 실격 |
| 신체 제약(장시간 착석 불가) | 총 여정 시간 상한 | 한일 노선은 사실상 무관 |
| 특정일 불가 | R0에서 이미 반영 | — |

### 9.1 예산 상한의 특수성

**항공은 그룹 전원이 같은 항공편을 타야 한다.** 따라서 예산 상한은 다른 라운드와 달리 **최저 예산자 기준이 절대적**이다. 평균이나 다수결을 쓰면 최저 예산자가 여행 자체를 포기하게 된다.

```
maxPricePerPerson = min_i( personalBudgetForFlight[i] )
```

예외 처리: 최저 예산자의 상한이 시장 최저가보다도 낮아 후보가 0개가 되면,
1. 실격시키지 않고 **"예산 초과 후보"** 로 표시해 전부 노출
2. 판결문에 `budgetShortfall` 을 명시하고 Chief에 경보 발령
3. Chief가 다른 라운드(숙소·식사)에서 차감해 항공 예산을 늘릴 수 있는지 검토
4. 그래도 불가하면 미해결 쟁점으로 계획서에 기록 — **조용히 예산을 넘기지 않는다**

---

## 10. 스코어링 모델

### 10.1 개인 만족도

```
Sat(i, c) = 0.35 × priceFit(i, c)
          + 0.25 × timeFit(i, c)
          + 0.15 × durationFit(c)
          + 0.10 × carrierFit(i, c)
          + 0.10 × baggageFit(i, c)
          + 0.05 × riskFit(c)
```

| 항목 | 계산 |
| --- | --- |
| `priceFit` | `1 − (effectiveTotal − minTotal) / (personalBudget − minTotal)`, 0 하한. 개인 예산이 빠듯할수록 가격 민감도가 자동으로 커진다 |
| `timeFit` | 출발·도착 시각을 개인의 `earlyRiser` 슬라이더와 매칭. 새벽 출발은 `earlyRiser < 0.4` 인 사람에게 큰 감점 |
| `durationFit` | 총 여정 시간(비행+환승+공항이동)의 정규화 역수 |
| `carrierFit` | FSC 선호/LCC 기피 성향(`spendOnStay`, `adventure` 슬라이더에서 유도) |
| `baggageFit` | 쇼핑 선호도(카드 점수)가 높으면 위탁수하물 포함에 가산 — **오사카·도쿄 Pack에서 실제로 유의미** |
| `riskFit` | 지연 확률의 역수. 겨울 CTS Pack에서 가중치 0.05 → 0.12 로 상향 |

### 10.2 그룹 선택 기준

상위 문서 8.2와 동일: **Maximin 우선 → 총합 → CC 가중.**

단, 항공 라운드에는 추가 규칙이 있다.

```
[R-FLIGHT-1] effectiveTotal.perPerson > min(personalBudget) 인 후보는
             Maximin 계산 이전에 실격 (9.1의 예외 상황 제외)

[R-FLIGHT-2] 도착 시각이 20:00 이후인 후보는 "첫날 활동 불가"로 간주해
             durationFit에 −0.15 페널티. 3박4일이 실질 2.5일이 되는 것을
             사용자는 나중에야 깨닫는다.

[R-FLIGHT-3] 마지막 날 출발이 12:00 이전이면 "마지막 날 활동 불가"로
             동일 페널티. 심판은 이 손실을 판결문에 명시해야 한다.
```

R-FLIGHT-2/3은 **사용자가 개입할 수 없기 때문에 특히 중요하다.** 실시간이라면 누군가 "그럼 마지막 날 아무것도 못 하잖아"라고 말했겠지만, 여기서는 심판이 대신 지적해야 한다.

---

## 11. 주장 강도 추정과 중재 로직

> 이 장은 항공권 심판의 핵심 차별점이며, 교통편·숙소 심판도 같은 프레임워크를 카테고리별로 특화해 사용한다.

### 11.1 왜 필요한가

각 참여자 에이전트는 `stance`(support/oppose/conditional)만 반환한다. 그러나 "H-02 괜찮은 것 같아요"와 "F-01은 절대 안 됩니다, 새벽 4시 기상이라고요"는 같은 oppose여도 무게가 전혀 다르다. 심판이 이 차이를 읽지 못하면 절충안이 엉뚱한 방향으로 간다.

### 11.2 강도 신호 (Intensity Signals)

심판은 각 발화에서 다음 신호를 읽어 `I(i, c) ∈ [0, 1]` 를 추정한다.

| # | 신호 | 강도 ↑ | 강도 ↓ |
| --- | --- | --- | --- |
| S1 | **단정 표현** | "절대", "무조건", "이건 못 받아들여요" | "괜찮을 것 같아요", "상관없어요", "다들 좋다면" |
| S2 | **근거 개수와 구체성** | 수치·경험을 든 논거 2개 이상 | 근거 없는 선호 표명 |
| S3 | **반복성** | 여러 턴에 걸쳐 같은 주장 유지 | 1회 언급 후 침묵 |
| S4 | **양보 거부** | 절충안 제시에도 조건 고수 | 즉시 조건부 수용 |
| S5 | **하드 제약 연계** | 자신의 등록된 절대조건을 근거로 듦 | 취향 수준의 언급 |
| S6 | **개인 비용 언급** | "예산 넘어요", "그날 연차 못 써요" | 일반론 |
| S7 | **감정 강도** | 강한 부정·반복 강조 | 중립 서술 |

### 11.3 페르소나 정합성 검증 — 강도 인플레이션 방지

**여기가 설계의 핵심이다.** 강도를 그대로 반영하면 "목소리 큰 사람이 이긴다"는 원래 문제를 AI로 재현하게 된다. 그래서 강도는 반드시 **설문 데이터와 대조**해 할인한다.

```
rawIntensity      = LLM이 발화에서 추정한 값 ∈ [0,1]
personaSupport    = 해당 주장이 설문 데이터로 뒷받침되는가?

  · 하드 제약과 일치           → ×1.00 (그리고 이건 강도가 아니라 실격 사유)
  · 슬라이더/카드 점수와 일치   → ×1.00
  · 설문에 근거 없음           → ×0.50
  · 설문과 모순                → ×0.25  + 심판이 회의록에서 지적

adjustedIntensity = rawIntensity × personaSupport × min(CC_i, 1.3)
```

*예시*: 설문에서 `earlyRiser = 0.8`(새벽형)로 답한 사람이 "새벽 비행은 너무 힘들어요"라고 강하게 주장하면 `×0.25` 로 할인되고, 심판은 다음과 같이 지적한다.

> 🔎 심판: 서연님은 설문에서 아침형이라고 답하셨습니다. 새벽 출발에 대한 우려는 강도를 낮춰 반영하겠습니다.

이 한 줄이 회의록에 남는 것이 신뢰 확보에 결정적이다. **AI가 설문을 실제로 읽고 있다는 증거**가 된다.

### 11.4 강도를 어디에 쓰는가 (그리고 어디에 쓰지 않는가)

| 용도 | 사용 여부 | 이유 |
| --- | --- | --- |
| 최종 후보 선택 | ❌ **쓰지 않는다** | Maximin(만족도 기반)이 유일한 선택 기준. 강도로 뽑으면 공정성이 무너진다 |
| 쟁점 축 식별 | ✅ | 강도 합이 높은 속성이 진짜 쟁점 (가격 vs 시간대) |
| 절충안 설계 방향 | ✅ | 강도 높은 반대의 원인을 제거하는 쪽으로 안을 만든다 |
| 만족도 하한 설정 | ✅ | 강도 0.8 이상 반대자에게는 `Sat ≥ 5.5` 를 제약으로 추가 |
| 동점 시 타이브레이크 | ✅ | Maximin·총합이 동률일 때만 |
| 발언 순서·재반박 기회 | ✅ | 강도 높은 쪽에 1턴 추가 배정 |
| 판결문 서술 | ✅ | "지훈님이 가장 강하게 주장한 부분은…" 으로 반영 사실을 명시 |

### 11.5 강도 인플레이션 상한

한 참여자가 한 라운드에서 `adjustedIntensity > 0.8` 인 주장을 **최대 1회**만 행사할 수 있다. 2회차부터는 0.8로 클리핑한다. 전부 강하게 주장하면 아무것도 강하게 주장하지 않은 것과 같기 때문이다.

### 11.6 강도 프로파일 산출

```json
{
  "roundId": "r_1",
  "intensityProfile": [
    { "userId": "u_882", "candidateId": "F-01", "stance": "oppose",
      "rawIntensity": 0.92, "personaSupport": 1.0, "ccFactor": 1.1,
      "adjusted": 1.0, "clipped": 1.0,
      "signals": ["S1","S5","S6"],
      "basis": "하드 제약 red_eye_flight 등록됨 — 실격 사유로 승격",
      "evidence": "새벽 4시 기상은 무리입니다. 설문에도 적었어요." },
    { "userId": "u_913", "candidateId": "F-03", "stance": "support",
      "rawIntensity": 0.35, "personaSupport": 1.0, "ccFactor": 1.0,
      "adjusted": 0.35,
      "signals": [],
      "basis": "약한 선호 — 절충 여지 큼" }
  ],
  "conflictAxis": { "primary": "출발 시간대", "secondary": "가격" },
  "hardBlocks": [{ "userId": "u_882", "candidateIds": ["F-01","F-05"] }]
}
```

### 11.7 중재 결정 절차

```
[1] 강도 0.8 이상 반대가 하드 제약에 근거 → 후보 실격. 협상 종료
[2] 강도 0.8 이상 반대가 취향에 근거     → 해당 후보의 그 속성을 개선한 대안 탐색
[3] 강도가 양측 모두 높음 (교착)         → 속성 분해 절충 (12장)
[4] 강도가 전반적으로 낮음               → 즉시 Maximin 1위로 판결, 턴 절약
[5] 강도 높은 1명 vs 낮은 다수           → Maximin으로 계산하되,
                                          강도 높은 1인의 Sat 하한 5.5를 제약으로 추가
```

[5]가 중요하다. 다수결이면 1명이 항상 진다. 그러나 강도만 보면 1명이 항상 이긴다. **만족도 하한을 제약으로 거는 방식**이 두 실패를 모두 피한다.

---

## 12. 절충안 생성 전략

항공은 "A냐 B냐"의 이산 선택이라 절충이 어려워 보이지만, **속성을 분해하면 절충 공간이 생긴다.**

| 교착 유형 | 절충 전략 | 예시 |
| --- | --- | --- |
| 가격 vs 시간대 | **왕복 분리** — 갈 때는 저렴한 편, 올 때는 편한 편 | 출발 LCC 07:30 / 귀국 FSC 14:00 |
| 가격 vs 공항 | 공항 이동비를 포함한 실효 총액으로 재프레이밍 | "NRT가 3만원 싸지만 이동비가 4만원 더 듭니다" |
| 직항 vs 경유 | 경유 대기시간이 3시간 미만이면 실질 손실 계산해 제시 | |
| 수하물 포함 여부 | 쇼핑 예정자만 추가 구매하는 안 | "4명은 기본, 2명은 위탁 추가 — 1인 평균 +8천원" |
| 시간대 교착 | **인접 날짜 검토** — R0 후보 2위 날짜에 원하는 시간대가 있는지 재조회 | 단, 날짜 변경은 Chief 승인 필요 |
| 예산 교착 | Chief에 타 라운드 예산 이관 요청 | "숙소에서 2만원 줄이면 직항 가능합니다" |

**날짜 변경 절충의 제약**: R0에서 확정한 날짜를 R1에서 되돌리면 전체 일정이 흔들린다. 다음 조건을 모두 만족할 때만 Chief에 제안한다.

1. 대안 날짜가 R0 후보 리스트에 있었을 것 (전원 참석 가능이 이미 검증됨)
2. 1인 절감액이 3만원 이상일 것
3. R0 점수차가 0.10 미만이었을 것

---

## 13. 시스템 프롬프트 전문

```
당신은 여행 계획 회의의 **항공권 담당 심판**입니다.
공정하고, 데이터에 근거하며, 참여자의 감정보다 사실을 우선합니다.

═══════════════════════════════════════════════
【 가장 중요한 전제 】
참여자들은 이 회의를 실시간으로 보고 있지 않습니다.
그들은 설문만 제출했고, 회의가 끝난 뒤 결과만 확인합니다.
당신의 판결을 중간에 고칠 사람이 아무도 없습니다.

따라서:
· 추측하지 마세요. 반드시 도구로 확인하세요.
· 불확실한 것은 숨기지 말고 uncertainties에 기록하세요.
· 사용자가 나중에야 깨달을 손해(도착이 너무 늦어 첫날을 날리는 등)를
  당신이 대신 지적해야 합니다. 아무도 대신 말해주지 않습니다.
═══════════════════════════════════════════════

## 여행 정보
목적지: {pack.displayName} ({pack.packId})
확정 일정: {dates.start} ~ {dates.end} ({dates.nights}박)   ← R0에서 확정됨
인원: {headcount}명
출발 공항 후보: {originCandidates}
도착 공항 후보: {pack.airports}
항공 항목 배정 예산: 1인 {budgetAllocated}원

## 그룹 하드 제약 (절대 위반 불가)
{hard_constraints}

특히 다음은 어떤 근거로도 타협할 수 없습니다:
· 새벽 비행 불가로 등록된 참여자가 있으면 06:00 이전 출발편은 실격입니다.
· 1인 실효 총액이 그룹 최저 예산자의 상한을 넘는 후보는 실격입니다.
  (항공은 전원이 같은 편에 타야 하므로, 평균이나 다수결을 쓰면 안 됩니다.)

## 사용 가능한 도구
- search_flights(...)        후보 조달. 반드시 그룹 인원 전체로 조회됩니다.
- price_flight_offer(...)    확정가·수하물 검증. 최종 후보에만 호출하세요.
- get_airport_transfer(...)  공항→시내 이동 시간·비용. 공항 비교에 필수입니다.
- get_flight_risk(...)       지연 확률·정시율.
- check_group_seating(...)   인접 좌석 가능 여부. 참고 지표이며 실격 사유가 아닙니다.

## 반드시 지킬 판정 원칙

【원칙 1】 항공료가 아니라 "실효 총액"으로 비교하세요.
  실효 총액 = 항공료 + (공항↔숙소 왕복 교통비) + 수하물 추가요금
  나리타행이 3만원 싸도 공항 이동에 왕복 4만원이 더 들면 하네다가 낫습니다.
  반드시 get_airport_transfer로 실측한 뒤 판결문에 두 값을 함께 쓰세요.

【원칙 2】 여행의 "실질 일수"를 계산해 알리세요.
  · 도착이 20:00 이후면 첫날은 사실상 없습니다.
  · 마지막 날 출발이 12:00 이전이면 마지막 날도 없습니다.
  3박 4일이 실질 2.5일이 되는 것을 참여자는 나중에야 깨닫습니다.
  이 손실을 판결문에 반드시 명시하세요.

【원칙 3】 수하물을 확인하세요.
  일본 노선 LCC는 위탁수하물 미포함이 기본이며, 1인 왕복 3~5만원 차이가 납니다.
  쇼핑 선호도가 높은 참여자가 있으면 이 차이는 실질적입니다.
  price_flight_offer로 확인하기 전에는 "포함"이라고 단정하지 마세요.

【원칙 4】 잔여 좌석을 확인하세요.
  6인이 같은 항공편에 탈 수 없으면 그 후보는 무의미합니다.
  좌석이 부족한 후보는 실격 처리하고 사유를 밝히세요.

【원칙 5】 실격 후보도 사유와 함께 보여주세요.
  "왜 더 싼 게 없느냐"는 의심을 막는 유일한 방법입니다.

## 주장 강도 추정 (가장 중요한 중재 기술)

참여자 에이전트의 발언을 읽고, 각 주장의 강도를 0.0~1.0으로 추정하세요.

강도가 높다는 신호:
  · 단정적 표현 ("절대", "무조건", "이건 못 받아들입니다")
  · 구체적 근거 2개 이상 (수치, 개인 사정, 과거 경험)
  · 여러 턴에 걸쳐 같은 주장을 유지함
  · 절충안을 제시해도 조건을 고수함
  · 자신의 등록된 하드 제약을 근거로 듦
  · 개인적 비용을 구체적으로 언급 ("예산이 넘어요", "연차를 못 써요")

강도가 낮다는 신호:
  · "괜찮을 것 같아요", "다들 좋다면", "상관없어요"
  · 근거 없는 선호 표명
  · 한 번 말하고 더 언급하지 않음
  · 즉시 조건부 수용

★ 반드시 페르소나와 대조해 강도를 보정하세요 ★
  · 주장이 설문의 하드 제약과 일치 → 강도 100% 인정 (그리고 실격 사유입니다)
  · 주장이 설문의 슬라이더·카드 점수와 일치 → 100% 인정
  · 설문에 근거가 없음 → 50%로 할인
  · 설문과 모순됨 → 25%로 할인하고, 회의록에서 정중히 지적하세요
    예: "서연님은 설문에서 아침형이라고 답하셨습니다.
         새벽 출발에 대한 우려는 강도를 낮춰 반영하겠습니다."

  이 지적을 반드시 회의록에 남기세요. 당신이 설문을 실제로 읽고 있다는
  증거가 되며, 목소리 큰 사람이 이기는 것을 막는 유일한 장치입니다.

★ 강도를 최종 선택에 직접 쓰지 마세요 ★
  최종 후보는 언제나 "가장 불만족한 사람의 만족도가 가장 높은 안"입니다.
  강도는 다음에만 사용합니다:
    · 진짜 쟁점이 무엇인지 식별 (가격인가, 시간대인가)
    · 절충안을 어느 방향으로 만들지 결정
    · 강도 0.8 이상으로 반대한 사람의 만족도 하한(5.5)을 제약으로 추가
    · 만족도가 동률일 때의 타이브레이크
  강도로 승자를 정하면, 이 서비스가 없애려던 "목소리 큰 사람이 이기는 문제"를
  그대로 재현하게 됩니다.

★ 강도 상한 ★
  한 사람이 한 라운드에서 강도 0.8 이상의 주장을 행사할 수 있는 것은 1회뿐입니다.
  두 번째부터는 0.8로 취급하세요.

## 교착 상태 해소 (절충안 설계)

강도가 양쪽 모두 높아 교착이면, 항공권을 속성으로 분해해 절충하세요.
  · 가격 vs 시간대  → 왕복 분리 (갈 때 저렴하게, 올 때 편하게)
  · 가격 vs 공항    → 실효 총액으로 재프레이밍
  · 직항 vs 경유    → 경유 대기시간의 실질 손실을 수치로 제시
  · 수하물          → 필요한 사람만 추가 구매하는 안
  · 예산 부족       → Chief에 타 라운드 예산 이관 요청

날짜 변경은 최후의 수단입니다. 다음을 모두 만족할 때만 Chief에 제안하세요.
  (1) 그 날짜가 R0의 후보 리스트에 있었을 것 (전원 참석 가능이 검증됨)
  (2) 1인 절감액이 3만원 이상일 것
  (3) R0 점수차가 0.10 미만이었을 것

## 진행 절차

SOURCING
  하드 제약을 조회 파라미터로 컴파일한 뒤 search_flights를 호출하세요.
  1차는 직항으로 탐색하고, 후보가 5개 미만이면 조건을 완화하되
  무엇을 완화했는지 반드시 밝히세요.
  각 후보에 get_airport_transfer를 적용해 실효 총액을 계산한 뒤 게시하세요.

FACTCHECK
  참여자가 사실관계를 틀리게 말하면 즉시 정정하세요.
  도구로 확인하지 않은 내용은 말하지 마세요.
  "아마", "보통" 같은 표현을 쓰고 있다면 그건 확인해야 한다는 신호입니다.

PROPOSAL
  강도 프로파일을 근거로 절충안을 1~2개 제시하세요.
  각 안이 누구의 어떤 우려를 해소하는지 명시하세요.

VERDICT
  판결 직전, 최종 후보에 price_flight_offer를 호출해 확정가를 검증하세요.
  검색가와 5% 이상 차이나면 판결을 멈추고 재검색하세요.

## 금지 사항
· 도구로 확인하지 않은 가격·시간·수하물 정보를 말하지 마세요.
· 후보를 발명하지 마세요. 조회 결과에 있는 항공편만 다루세요.
· 특정 참여자를 편들지 마세요. 기준과 수치로만 판단하세요.
· 예산 초과를 조용히 넘기지 마세요. 반드시 Chief에 경보를 올리세요.
· 결제·예약을 시도하지 마세요. 당신의 역할은 후보 선정과 판결까지입니다.

## 발화 스타일
· 한국어. 간결하고 사무적으로. 라운드당 발언은 6회 이내.
· 숫자를 제시할 때는 항상 단위와 기준을 붙이세요 (1인 왕복, 세금 포함 등).
· 판결문은 400자 이내.

## 출력 형식
모든 응답은 아래 JSON 스키마를 따르세요. (14장 참조)
```

---

## 14. 판결 출력 스키마

```json
{
  "roundId": "r_1",
  "category": "flight",
  "winner": {
    "type": "single | split_leg",
    "candidateIds": ["F-03"],
    "detail": "KE723/KE724 왕복 직항"
  },
  "rationale": "실효 총액 1인 336,000원으로 배정 예산 대비 −4%. 도착 11:00로 첫날 온전히 확보. 최소 만족도 7.1로 전 후보 중 최고.",
  "effectiveTotal": { "perPerson": 336000, "groupTotal": 2016000,
                      "breakdown": { "airfare": 312000, "transfer": 24000, "baggage": 0 } },
  "effectiveTripDays": { "nominal": "3박4일", "actual": "3.5일",
                         "note": "마지막 날 12:00 출발로 오전만 활용 가능" },
  "intensityProfile": [ /* 11.6 참조 */ ],
  "dissent": [
    { "userId": "u_501", "reason": "LCC가 5만원 저렴했음",
      "intensity": 0.45,
      "mitigation": "차액은 식사 예산으로 이관 제안" }
  ],
  "disqualified": [
    { "candidateId": "F-01", "reason": "출발 05:40 — 지훈님 하드 제약(새벽 비행 불가) 위반" },
    { "candidateId": "F-06", "reason": "잔여 좌석 4석 — 6인 탑승 불가" }
  ],
  "budgetImpact": { "allocated": 350000, "actual": 336000, "delta": -0.04 },
  "handoff": {
    "arrivalAt": "2026-10-15T11:00", "arrivalAirport": "KIX",
    "departureAt": "2026-10-18T12:00",
    "earliestCheckIn": "13:00", "latestCheckOut": "10:00"
  },
  "uncertainties": [
    "좌석 잔여 9석 — 예약 지연 시 가격 변동 가능",
    "10/1 이후 유류할증료 변동 가능성"
  ],
  "followups": [
    { "task": "항공권 예약", "deadline": "2026-09-15",
      "reason": "60일 전 요금 마감", "url": "https://…" }
  ],
  "toolCalls": ["amadeus.flightOffers", "amadeus.flightOffersPrice",
                "amadeus.seatmaps", "transfer.kix_namba"],
  "priceSnapshot": { "fetchedAt": "2026-08-13T02:31:00Z", "currency": "KRW" }
}
```

---

## 15. 캐시·쿼터·비용

### 15.1 캐시 전략

| 데이터 | TTL | 키 | 공유 범위 |
| --- | --- | --- | --- |
| Flight Cheapest Date | 24h | `pack:origin:month` | 같은 Pack 전체 방 |
| Flight Offers Search | 2h | `origin:dest:dates:pax:filters` 해시 | 같은 조건 전체 방 |
| Airport Transfer | 30d | `airport:area` | 전역 |
| 공항·항공사 코드 | 영구 | — | 전역 (Pack 부트스트랩 시 적재) |
| On-time / Delay | 7d | `carrier:route:month` | 전역 |
| Flight Offers Price | **캐시 금지** | — | 확정가는 항상 실시간 |

**핵심 절감 포인트**: 같은 Pack·같은 주간의 방들이 Cheapest Date 결과를 공유하면, 인기 목적지에서 캐시 적중률이 80%를 넘는다.

### 15.2 쿼터 관리

- Amadeus Self-Service는 무료 티어(테스트 환경)와 유료(운영)의 쿼터·데이터가 다르다. **테스트 환경 데이터로 실서비스를 하면 안 된다** — 가격과 재고가 실제와 다르다.
- 라운드당 도구 호출 상한: `search_flights` 3회, `price_flight_offer` 2회, 기타 각 2회
- 상한 도달 시 심판은 현재 후보로 판결한다 (무한 재조회 방지)
- 레이트리밋 초과는 지수 백오프 3회 후 폴백 제공자

### 15.3 예상 비용 (방 1개 기준)

| 항목 | 호출 수 | 비고 |
| --- | --- | --- |
| Cheapest Date | 0~1 (캐시 적중 시 0) | DateResolver 공유 |
| Flight Offers Search | 1~3 | Pass 1/2 |
| Flight Offers Price | 1~2 | 최종 후보만 |
| Airport Transfer | 2~4 | 캐시 적중률 높음 |
| Risk / Seatmap | 0~2 | 조건부 |
| **LLM** | 8~14회 | 브리핑·팩트체크·강도추정·절충·판결 |

---

## 16. 실패 처리와 폴백

| 실패 | 처리 |
| --- | --- |
| Amadeus 인증 실패 | 토큰 재발급 1회 → 실패 시 잡 전체 중단, Chief에 보고 |
| 검색 결과 0건 | 조건 완화 2단계 → 그래도 0건이면 "해당 날짜 항공편 없음"으로 Chief에 반환, R0 날짜 재검토 요청 |
| Price 검증에서 offer 만료 | 정상 상황. 재검색 후 차순위 진행 (최대 1회) |
| 가격 5% 초과 변동 | 파이프라인 [2]로 회귀 1회, 이후엔 변동가 그대로 채택 + 판결문 명시 |
| 크로스체크 30% 괴리 | 실격 아님. ⚠️ 표기 + uncertainties 기록 |
| Transfer API 실패 | Pack의 정적 `airportTransfer` 테이블로 폴백 (근사치임을 명시) |
| 타임아웃 | 부분 후보로 판결하되 `partialSourcing: true` 기록 |

**폴백 시 항상 지킬 것**: 데이터 품질이 낮아졌다는 사실을 회의록과 계획서에 그대로 노출한다. 사용자가 검증할 수 없는 구조이므로, 침묵이 가장 큰 위험이다.

---

## 17. 테스트 케이스

| # | 시나리오 | 기대 동작 |
| --- | --- | --- |
| T1 | 6인 중 1명이 새벽 비행 불가 | 06:00 이전 편 전부 실격, 사유 회의록 노출 |
| T2 | 최저 예산자 상한 25만원, 시장 최저가 29만원 | 실격시키지 않고 전 후보 노출 + Chief 예산 경보 |
| T3 | 도쿄 Pack, NRT 28만 vs HND 32만 | 실효 총액 계산 후 HND 승리, 판결문에 이동비 명시 |
| T4 | LCC 후보의 수하물 미포함 | price 검증에서 적발, 실효 총액에 반영 |
| T5 | 잔여 좌석 4석인 최저가 후보 | 실격 처리 |
| T6 | 설문상 아침형인 사람이 새벽 출발 강하게 반대 | 강도 25%로 할인 + 회의록에 정중한 지적 |
| T7 | 전원 강도 낮음 | 토론 조기 종료, Maximin 1위 즉시 판결 |
| T8 | 가격파 3명 vs 시간대파 3명 교착 | 왕복 분리 절충안 생성 |
| T9 | 마지막 날 08:00 출발편이 최저가 | −0.15 페널티 + "마지막 날 활동 불가" 명시 |
| T10 | 겨울 삿포로 Pack | riskFit 가중치 상향, 지연 경고 노출 |
| T11 | Amadeus 응답 지연 30초 | 백오프 후 재시도, 실패 시 부분 후보 판결 |
| T12 | 강도 0.9 주장을 한 사람이 3회 반복 | 2회차부터 0.8로 클리핑 |

---

## 18. 확장 훅

| 확장 | 준비 사항 |
| --- | --- |
| 동남아·유럽 Pack | `originCandidates`에 부산(PUS) 추가, 장거리용 `durationFit` 가중치 재조정, 경유 허용 기본값 변경 |
| 출발지 개인화 | 설문에 거주 지역 추가 → 지방 참여자가 있으면 KTX 연계 or 지방 공항 출발 후보 생성 |
| 좌석 등급 분리 | 예산 격차가 큰 그룹을 위한 "일부만 프리미엄" 옵션 (그룹 결속 문제로 MVP 제외) |
| 실시간 예약 | Amadeus Flight Create Orders 연동. 결제·PCI 요건 별도 검토 필요 |
| 마일리지 | 개인 마일리지 보유 여부를 설문에 추가, 특가 좌석 조회 |
| 가격 추적 | 확정 후 출발까지 가격 변동 모니터링 및 하락 시 알림 |

---

## 마무리 — 이 심판의 실패 조건

1. **항공료만 보고 판결하면 실패한다.** 실효 총액(항공료 + 공항이동 + 수하물)이 기준이다.
2. **강도를 선택 기준으로 쓰면 실패한다.** 강도는 쟁점 식별과 절충 설계에만 쓰고, 승자는 Maximin이 정한다.
3. **불확실성을 숨기면 실패한다.** 사용자가 개입할 수 없으므로, 확인 못 한 것은 반드시 표면화한다.


---

## 19. v1.1 실행 보강 — Door-to-door·예약 검증·전역 그래프

이 장은 `travel-mediation-plan.md` 19장의 전역 계약을 항공 심판에 적용한다. 항공은 링크아웃 MVP에서도 이후 모든 일정의 시간·재고·취소 위험을 결정하므로, 검색 결과만으로 확정하지 않는다.

## 19.1 입력·시간 모델 보강

`FlightRefereeInput`은 참여자별 출발 권역과 공항 도착 가능 시간창을 받는다. 모든 시각은 IANA timezone을 포함한 ISO-8601 timestamp로 저장한다.

```typescript
interface OriginAccessProfile {
  userId: string;
  area: string;
  earliestAirportArrivalAt: string;
  latestHomeArrivalAt?: string;
  modes: Array<'transit' | 'taxi' | 'driving'>;
}
```

`effectiveTotal`은 항공료·수하물·목적지 공항 이동뿐 아니라 그룹의 출발 권역→출발 공항 비용·시간, 공항 수속, 출입국·수하물, 터미널 이동, 최소 연결 시간을 반영한다. 각 구간은 점추정이 아니라 duration range와 confidence를 가진다. 새벽 출발 여부는 항공편 이륙 시각만이 아니라 가장 제약적인 참여자의 공항 도착 가능 시각으로 판정한다.

## 19.2 운임·재고·예약 가능 상태

최종 후보에는 다음 정보를 정규화한다.

```text
fareFamily, seatAvailabilityAsOf, groupInventoryVerified,
checkedBagRule, seatSelectionRule, refundPolicy, changePolicy,
priceAsOf, priceExpiresAt, bookingStatus
```

- `groupInventoryVerified !== true`이면 그룹 항공편은 `VERIFIED` 또는 `BOOKABLE`이 될 수 없다.
- 가격 검증은 후보 1~2개에만 수행하되, 운임 만료·±5% 이상 가격 변동·수하물 변경은 해당 후보와 모든 하위 계획 노드를 `STALE`로 만든다.
- 분리발권·왕복 분리에는 missed-connection, 환불 책임, 수하물 재위탁 위험을 후보 카드와 판결문에 명시한다. 위험을 확인할 수 없으면 편의성 점수로 상쇄하지 않는다.
- 아동·유아·특수 지원·좌석 등급은 명시적으로 수집된 경우에만 처리하며 추론하지 않는다.

## 19.3 링크아웃 Booking Coordinator handoff

항공 판결은 예약 URL만 넘기지 않고 다음 의존성 작업을 생성한다.

```json
{
  "type": "flight_booking",
  "status": "verified",
  "owner": "host",
  "deadline": "2026-09-01T23:59:59+09:00",
  "preconditions": ["groupInventoryVerified", "farePriceVerified"],
  "fallbackCandidateIds": ["F-02", "F-04"],
  "invalidates": ["arrivalTime", "airportTransfer", "accommodationCheckIn", "schedule"]
}
```

예약·재가격 실패 시 후보를 조용히 교체하지 않는다. Flight node를 `FAILED`로, 숙소·교통·일정 노드를 `STALE`로 표시하고, 동일 Mandate 범위에서 대체 후보를 재검증한다. 날짜 변경은 `approval_required`다.

## 19.4 fail-closed와 폴백

| 항목 | 폴백 허용 여부 | 처리 |
| --- | --- | --- |
| 항공 가격 | 허용 | 추정으로 표시하되 BOOKABLE 금지 |
| 그룹 좌석 재고 | 불가 | 확인 전 winner 금지 |
| 수하물·운임 규정 | 불가 | 확인 전 총액 확정 금지 |
| 출발/도착·최소 연결 시각 | 불가 | 확인 전 일정 handoff 금지 |
| 지연 확률·정시율 | 허용 | confidence 하향과 경고 |

기존의 `partialSourcing: true`는 초안 후보를 보여줄 수 있지만, 필수 재고·운임 검증이 빠진 상태에서 판결 또는 예약 체크리스트를 발행하는 근거가 될 수 없다.

## 19.5 전역 재최적화와 검증 케이스

항공의 도착 공항·도착 시각·귀국 시각·실효 총액·운임 조건이 바뀌면 Transport, Accommodation, Scheduler, Budget을 `STALE`로 하고 전역 수렴 규칙을 실행한다. 항공 심판은 대체 후보의 단독 점수뿐 아니라 재계산된 전체 계획의 `min satisfaction`, 총비용 범위, 첫날/마지막날 실질 활동시간을 Chief에 넘긴다.

기존 테스트에 다음을 추가한다.

| # | 시나리오 | 기대 동작 |
| --- | --- | --- |
| T13 | 지방 출발 참여자가 06:30 인천편을 타야 함 | 집→공항 첫차/도착 가능 시각 반영, 불가능하면 실격 |
| T14 | 검색 후 단체 재고가 사라짐 | 후보 BLOCKED, 하위 노드 STALE, 차순위 재검증 |
| T15 | 저가 분리발권이 연결 실패 위험을 가짐 | 위험·보상 불가를 명시하고 단일 발권안과 비교 |
| T16 | 항공 변경으로 22:30 도착 | 늦은 체크인·공항 이동·Day 1 계획을 전역 재검증 |
| T17 | 가격만 추정되고 운임 규정 미확인 | 초안 표시는 가능, VERDICT/BOOKABLE 승격 금지 |
