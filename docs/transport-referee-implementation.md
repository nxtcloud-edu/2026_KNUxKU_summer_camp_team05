# 교통편 심판 에이전트 (Transport Referee) — 구현 계획

- **문서 버전**: v1.0 / 2026-08-13
- **상위 문서**: `travel-mediation-plan.md` v1.2
- **담당 라운드**: R1 후반 (현지 이동 수단) · 국내 Pack의 R1 전체 · R5 동선 검증 지원
- **대상 지역**: 대한민국, 일본

---

## 목차

1. [역할과 경계](#1-역할과-경계)
2. [입출력 계약](#2-입출력-계약)
3. [사용 Open API 총람 — 한국](#3-사용-open-api-총람--한국)
4. [사용 Open API 총람 — 일본](#4-사용-open-api-총람--일본)
5. [교통패스 손익분기 엔진](#5-교통패스-손익분기-엔진)
6. [도구(Tool) 정의](#6-도구tool-정의)
7. [정규화 스키마 — TransportCandidate](#7-정규화-스키마--transportcandidate)
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

### 1.1 두 개의 모드

교통편 심판은 Destination Pack에 따라 전혀 다른 문제를 푼다.

| 모드 | 활성 조건 | 다루는 것 |
| --- | --- | --- |
| **A. 국내 도시간 모드** | `roundPreset == "standard_domestic"` | 출발지→목적지 이동 수단 결정 (KTX / 고속버스 / 자차 / 렌터카) + 현지 이동 |
| **B. 현지 이동 모드** | `roundPreset == "standard_overseas"` | 항공권 심판이 도착 공항을 정한 뒤, 공항↔시내 + 현지 이동 전략 + 교통패스 |

두 모드는 후보 조달 API와 쟁점이 다르므로 프롬프트도 분기한다.

### 1.2 하는 일

| # | 책무 | 산출물 |
| --- | --- | --- |
| 1 | 도시간·공항 접근 이동 수단 후보 조달 | `TransportCandidate[]` |
| 2 | 현지 이동 전략 결정 (도보/대중교통/택시 비율) | `mobilityPolicy` |
| 3 | **교통패스 손익분기 계산** | `passRecommendation` |
| 4 | 자차 선택 시 운전자·유류비·통행료 산정 | `drivingPlan` |
| 5 | 체력 제약(도보 상한, 계단) 검증 | `accessibilityReport` |
| 6 | R5 동선 심판에 이동시간 행렬 제공 | `travelTimeMatrix` |

### 1.3 하지 않는 일

- **항공편을 다루지 않는다.** 해외 Pack에서는 항공권 심판이 먼저 도착 공항·시각을 확정하고, 그 결과를 받아 시작한다.
- **일자별 동선을 짜지 않는다.** 그것은 R5 동선 심판의 몫이다. 교통편 심판은 **"어떤 수단을 쓸 것인가"** 라는 정책을 정하고, R5는 그 정책 안에서 순서를 최적화한다.
- **실시간 승차권을 예매하지 않는다.** 링크아웃.

### 1.4 순서 의존성

```
R1 전반: 항공권 심판 (해외만)  →  도착 공항·시각 확정
              │
              ▼
R1 후반: 교통편 심판           →  공항↔시내 + 이동 정책 + 패스
              │
              ▼
R2 숙소 심판                   →  이동 정책이 "대중교통 중심"이면 역세권 가중치 ↑
              │
              ▼
R5 동선 심판                   →  교통편 심판의 이동시간 행렬로 순서 최적화
```

숙소 심판보다 **먼저** 실행되는 것이 중요하다. "택시 위주로 다닐 것"이라는 정책이 정해지면 역세권 프리미엄을 낼 이유가 사라지고, 숙소 예산을 다른 데 쓸 수 있다.

---

## 2. 입출력 계약

### 2.1 입력

```typescript
interface TransportRefereeInput {
  mode: 'domestic_intercity' | 'local_mobility';
  pack: DestinationPack;
  dates: { start: string; end: string; nights: number };   // R0 확정
  headcount: number;
  budgetAllocated: number;                                  // 교통 항목 1인 배정액
  arrival?: {                                               // 해외 Pack: 항공 심판 산출물
    airport: string; at: string; departureAt: string;
  };
  origin?: { city: string; station?: string };              // 국내 Pack: 출발지
  mobilityConstraints: {                                    // 설문에서 취합
    maxWalkKmPerDay: number;      // 그룹 최솟값
    stairsOk: boolean;            // 전원 AND
    wheelchair: boolean;
    strollers: number;
    luggageHeavy: boolean;        // 쇼핑 선호도 높으면 true
  };
  transitVsTaxiSliders: Record<string, number>;             // 개인별 성향
  licensedDrivers: string[];                                // 국내 자차 모드
  concessionCredits: Record<string, number>;
}
```

### 2.2 출력

`TransportVerdict` (14장). 후속 라운드에 다음을 전달한다.

```
→ mobilityPolicy       (숙소 위치 스코어링 가중치 결정)
→ passRecommendation   (예산 정산 항목)
→ travelTimeMatrix     (R5 동선 최적화 입력)
→ dailyBudgetTransport (R6 정산)
```

---

## 3. 사용 Open API 총람 — 한국

> ⚠️ 요금·쿼터·약관은 수시로 변경된다. 착수 전 각 제공자 문서를 반드시 재확인할 것.

### 3.1 도시간 이동

| 용도 | 제공자 | 인증 | 비고 |
| --- | --- | --- | --- |
| 시외/고속버스 시간표·요금 | **국토교통부 TAGO** (공공데이터포털) | 서비스키 | `노선정보`, `운행정보`, `요금` 제공 |
| 철도(KTX·무궁화) 운행 정보 | **공공데이터포털 열차정보 API** / 코레일 | 서비스키 | 시간표·소요시간. 실시간 좌석은 제한적 |
| SRT | 공식 공개 API 없음 | — | 링크아웃 + 정적 시간표 테이블로 보완 |
| 고속도로 통행료 | **한국도로공사 통행료 API** (공공데이터포털) | 서비스키 | 자차 모드 필수 |
| 유가 정보 | **오피넷(한국석유공사) 유가 API** | 서비스키 | 유류비 계산 |
| 자차 경로·소요시간 | 네이버 Directions 5 / 카카오모빌리티 길찾기 / TMAP API | API Key | 실시간 교통 반영 |

### 3.2 현지 이동

| 용도 | 제공자 | 비고 |
| --- | --- | --- |
| 대중교통 경로 탐색 | **ODsay LAB 대중교통 API** | 국내 최강. 지하철+버스 복합 경로, 환승 정보, 요금 |
| 지하철 실시간 | 서울시 열린데이터광장 / 각 지자체 | 막차 시간 확인용 |
| 버스 도착 정보 | 공공데이터포털 전국버스정보 | 지방 Pack(강릉·여수)에서 중요 |
| 택시 요금 추정 | 카카오모빌리티 API | 정확한 추정치. 그룹 분할 탑승 계산에 사용 |
| 도보 경로 | 카카오/네이버/Google Directions (walking) | 실제 도보 시간 |
| 렌터카 | 공개 API 사실상 없음 | 제주·강릉 Pack에서 **링크아웃 + 시세 테이블**로 대응 |

### 3.3 한국 Pack별 교통 특성 (도메인 지식)

| Pack | 핵심 쟁점 | 심판이 반드시 고려할 것 |
| --- | --- | --- |
| `kr-gangneung` | KTX vs 자차 | KTX 서울→강릉 약 2시간. 단, **강릉 시내 대중교통이 약해** 도착 후 이동이 문제. 렌터카/택시 예산 필수 반영 |
| `kr-busan` | KTX 압도적 | 부산 지하철 커버리지 양호. 자차는 주차난으로 비추천 |
| `kr-jeju` | **렌터카 사실상 필수** | 대중교통만으로는 일정 성립 불가. 운전자·보험·유류비가 핵심 쟁점 |
| `kr-seoul` | 대중교통 완결 | 자차 불필요. 심야 이동만 쟁점 |
| `kr-yeosu` | KTX + 시내 이동 취약 | 택시 의존도 높음. 예산 반영 필요 |

**제주 특수 규칙**: `kr-jeju` Pack에서는 렌터카 없이는 후보 자체가 성립하지 않는다. 심판은 "렌터카 대수 + 운전자 배정 + 보험 등급"을 결정 항목으로 승격하고, 면허 보유자가 0명이면 **택시 투어/버스 투어 대안**으로 전환한다.

---

## 4. 사용 Open API 총람 — 일본

### 4.1 경로 탐색

| 용도 | 제공자 | 비고 |
| --- | --- | --- |
| 철도·버스 경로 | **NAVITIME API** (Japan Travel by NAVITIME 계열) | 일본 최강. 환승·요금·소요시간. 유료 |
| 철도 경로·운임 | **駅すぱあと(Ekispert) Web Service** | 발데이터 정확도 높음. 요금 체계 상세 |
| 경로 탐색 대안 | Jorudan 乗換案内 API | 제휴 필요 |
| 범용 경로 | **Google Routes API / Directions API (transit)** | 일본 대중교통 커버리지 양호. 폴백 1순위 |
| 이동시간 행렬 | Google Distance Matrix API | R5 동선 최적화용 |
| 도보 | Google Directions (walking) | |

> ⚠️ **HyperDia는 2022년 서비스가 종료**되었다. 과거 자료나 블로그를 참고해 이 API를 설계에 넣지 않도록 주의한다.

### 4.2 일본 특화 데이터 (자체 구축이 필요한 영역)

일본 여행의 교통 의사결정은 **패스 선택**이 절반이다. 그런데 이를 계산해주는 공개 API는 없다. 따라서 **자체 패스 룰 테이블**을 구축하는 것이 이 심판의 핵심 자산이 된다.

| Pack | 주요 패스 | 데이터 항목 |
| --- | --- | --- |
| `jp-osaka` | 오사카 주유패스(1·2일), 간사이 스루패스, 엔조이에코카드 | 가격, 유효 노선, 포함 시설 입장권, 사용 조건 |
| `jp-kyoto` | 지하철·버스 1일권, 간사이 스루패스 | 버스 균일구간 여부 |
| `jp-tokyo` | 도쿄메트로 24/48/72시간권, 도쿄 서브웨이 티켓, JR 도쿄 와이드패스 | 메트로/도에이 구분 주의 |
| `jp-fukuoka` | 후쿠오카 지하철 1일권, SUNQ패스 | |
| `jp-sapporo` | 삿포로 지하철 1일권, 도난 패스 | 겨울 이동 리스크 |
| 공통 | JR패스(전국·지역별), IC카드(ICOCA·Suica) | 광역 이동 시에만 유효 |

**패스 데이터는 Destination Pack에 포함**해 지역 확장 시 함께 추가한다.

```json
"transitPasses": [
  {
    "id": "osaka-amazing-pass-1d",
    "name": "오사카 주유패스 1일권",
    "priceJpy": 2800,
    "validity": "1일",
    "coverage": ["osaka_metro", "osaka_city_bus", "hankyu_partial"],
    "includedAttractions": ["우메다 스카이빌딩", "오사카성 천수각", "츠텐카쿠", "…"],
    "excludes": ["JR선"],
    "purchaseUrl": "https://…",
    "notes": "포함 시설 입장권 가치가 커서, 관광지 2곳 이상 방문 시 유리"
  }
]
```

### 4.3 일본 Pack별 교통 특성

| Pack | 핵심 쟁점 | 심판이 반드시 고려할 것 |
| --- | --- | --- |
| `jp-osaka` | 주유패스 손익분기 | 관광지 입장권이 포함되어 **액티비티 라운드 결과에 따라 이득이 달라짐** → R3 이후 재검토 필요 |
| `jp-tokyo` | 메트로 vs JR 혼재 | 도쿄 서브웨이 티켓은 JR 미포함. 야마노테선 이용이 많으면 손해 |
| `jp-kyoto` | 버스 정체 | 관광 시즌 버스는 정시성이 낮다. 지하철+도보 조합 권장 |
| `jp-osaka-kyoto` | 도시간 이동 | 한큐/게이한/JR 3개 선택지. 숙소 위치에 따라 최적이 달라짐 |
| `jp-sapporo` | 겨울 도보 | 적설기 도보 시간은 1.3~1.5배. `maxWalkKmPerDay` 를 하향 보정 |

---

## 5. 교통패스 손익분기 엔진

이 서비스의 실질적 차별점 중 하나다. 결정론적 계산으로 구현하며 LLM에 맡기지 않는다.

### 5.1 계산 방식

```
입력: 확정 이동 리스트 (R5 이전에는 추정 리스트)
      [{from, to, mode, individualFareJpy}, ...]
      확정 관광지 리스트 (R3 결과, 없으면 카드 선호도 상위로 추정)

for each pass P in pack.transitPasses:
    coveredFare  = Σ fare(leg)  where leg.mode ∈ P.coverage
    attractionValue = Σ ticketPrice(a)  where a ∈ P.includedAttractions
                                          ∩ 확정_관광지
    totalValue   = coveredFare + attractionValue
    savings      = totalValue − P.priceJpy
    breakEven    = P.priceJpy / (평균 1회 요금)   # 몇 회 타야 본전인지

권장: savings > 0 이고, 사용 편의성 감점을 넘어서면 구매 권장
```

### 5.2 두 번 계산해야 하는 이유

패스의 가치는 **관광지 입장권 포함 여부**에 크게 좌우된다. 그런데 관광지는 R3에서 정해진다. 따라서:

```
R1 (1차 계산): 카드 선호도 상위 관광지로 추정 → 잠정 권고
R3 종료 후    : 확정 관광지로 재계산 → Chief가 R1 판결을 갱신
```

이 재계산은 **토론 없이 자동 갱신**된다. Chief가 "액티비티 확정에 따라 오사카 주유패스 2일권이 1일권보다 유리해졌습니다"라고 회의록에 기록하고 예산을 조정한다.

### 5.3 편의성 감점

패스가 금액상 이득이어도 항상 좋은 것은 아니다.

| 감점 요인 | 처리 |
| --- | --- |
| 유효 노선이 복잡해 실수 위험 | 도쿄 메트로/도에이 구분 등 → 감점 |
| 그룹 전원이 항상 함께 움직여야 함 | 자유시간 선호(`social` 슬라이더 낮음)가 많으면 감점 |
| 구매처가 현지 한정 | 대기 시간 발생 → 소폭 감점 |
| 남는 유효시간 | 마지막 날 오전만 쓰는 1일권 → 감점 |

`savings`가 1인 500엔 미만이면 **"굳이 사지 않아도 됨"** 으로 판결한다. 미미한 이득을 위해 사용 제약을 감수할 이유가 없다.

---

## 6. 도구(Tool) 정의

```json
[
  {
    "name": "search_intercity_transport",
    "description": "국내 도시간 이동 수단 후보를 조회한다. KTX·고속버스·자차를 모두 포함하며, 자차는 통행료·유류비를 포함한 총비용으로 환산된다. 국내 Pack에서만 사용 가능하다.",
    "parameters": {
      "type": "object",
      "properties": {
        "originCity": { "type": "string" },
        "destinationCity": { "type": "string" },
        "date": { "type": "string", "format": "date" },
        "departAfter": { "type": "string", "description": "HH:MM. 하드 제약 반영" },
        "headcount": { "type": "integer" },
        "modes": { "type": "array",
                   "items": { "enum": ["train","express_bus","car","rental_car"] } }
      },
      "required": ["originCity","destinationCity","date","headcount"]
    }
  },
  {
    "name": "get_route",
    "description": "두 지점 간 경로를 조회한다. 대중교통·도보·택시·자차 중 지정한 수단으로 소요시간, 요금, 환승 횟수, 도보 거리를 반환한다. 한국은 ODsay, 일본은 NAVITIME/Ekispert를 사용하며 실패 시 Google로 폴백한다.",
    "parameters": {
      "type": "object",
      "properties": {
        "from": { "type": "string", "description": "장소명 또는 좌표" },
        "to": { "type": "string" },
        "mode": { "enum": ["transit","walking","taxi","driving"] },
        "departureTime": { "type": "string", "format": "date-time" },
        "headcount": { "type": "integer", "description": "택시는 인원수에 따라 대수가 결정됨" }
      },
      "required": ["from","to","mode"]
    }
  },
  {
    "name": "get_airport_transfer_options",
    "description": "도착 공항에서 숙소 후보 지역까지의 이동 수단을 비교한다. 특급열차·공항버스·택시를 모두 반환하며, 짐이 많은 그룹을 위한 편의성 지표를 포함한다.",
    "parameters": {
      "type": "object",
      "properties": {
        "airport": { "type": "string" },
        "targetAreas": { "type": "array", "items": {"type":"string"} },
        "arrivalTime": { "type": "string", "format": "date-time" },
        "headcount": { "type": "integer" },
        "heavyLuggage": { "type": "boolean" }
      },
      "required": ["airport","targetAreas","headcount"]
    }
  },
  {
    "name": "evaluate_transit_passes",
    "description": "확정 또는 추정된 이동 리스트와 관광지 리스트를 기준으로 교통패스별 손익을 계산한다. 절감액, 손익분기 횟수, 편의성 감점을 함께 반환한다.",
    "parameters": {
      "type": "object",
      "properties": {
        "packId": { "type": "string" },
        "estimatedLegs": { "type": "array", "items": { "type": "object" } },
        "plannedAttractions": { "type": "array", "items": {"type":"string"} },
        "days": { "type": "integer" }
      },
      "required": ["packId","days"]
    }
  },
  {
    "name": "calculate_driving_cost",
    "description": "자차 또는 렌터카 이동의 총비용을 계산한다. 유류비(오피넷 실시간 유가), 통행료(한국도로공사), 주차비 추정, 렌터카 요금·보험을 포함한다. 국내 Pack 전용.",
    "parameters": {
      "type": "object",
      "properties": {
        "route": { "type": "array", "items": {"type":"string"} },
        "vehicleType": { "enum": ["compact","midsize","van"] },
        "days": { "type": "integer" },
        "isRental": { "type": "boolean" }
      },
      "required": ["route","days"]
    }
  },
  {
    "name": "get_last_train_time",
    "description": "특정 구간의 막차 시각을 조회한다. 야간 활동 계획 시 택시 필요 여부를 판단하는 데 사용한다.",
    "parameters": {
      "type": "object",
      "properties": { "from": {"type":"string"}, "to": {"type":"string"} },
      "required": ["from","to"]
    }
  }
]
```

---

## 7. 정규화 스키마 — TransportCandidate

```json
{
  "id": "T-02",
  "source": "odsay",
  "kind": "intercity | airport_transfer | local_policy",
  "label": "KTX 서울→강릉",
  "segments": [
    { "mode": "train", "operator": "코레일", "line": "KTX-이음",
      "from": "서울역", "to": "강릉역",
      "departAt": "08:01", "arriveAt": "10:00",
      "durationMin": 119, "farePerPersonKrw": 27600 }
  ],
  "totals": {
    "durationMin": 119,
    "farePerPersonKrw": 27600,
    "groupTotalKrw": 165600,
    "transfers": 0,
    "walkMeters": 320
  },
  "accessibility": {
    "stairsRequired": false,
    "elevatorAvailable": true,
    "luggageFriendly": true,
    "wheelchairOk": true
  },
  "comfort": {
    "seatGuaranteed": true,
    "groupSeatingLikely": true,
    "restroomOnboard": true
  },
  "reliability": { "onTimeRate": 0.94, "weatherSensitive": false },
  "lastTrainNote": null,
  "bookingUrl": "https://…",
  "fetchedAt": "2026-08-13T02:40:00Z"
}
```

**현지 이동 정책(`local_policy`) 후보는 형태가 다르다.**

```json
{
  "id": "T-P1",
  "kind": "local_policy",
  "label": "대중교통 중심 + 패스 구매",
  "policy": {
    "primaryMode": "transit",
    "taxiUsage": "심야·우천 시에만",
    "passRecommendation": {
      "passId": "osaka-amazing-pass-1d",
      "buyCount": 1,
      "savingsPerPersonJpy": 1450,
      "breakEvenRides": 6,
      "convenienceScore": -0.1
    },
    "estimatedDailyCostPerPersonJpy": 900,
    "estimatedDailyWalkKm": 5.8
  },
  "tradeoffs": {
    "pros": ["1인 일 900엔으로 저렴", "정시성 높음"],
    "cons": ["하루 도보 5.8km — 지훈님 상한 8km에 근접", "짐 있을 때 불편"]
  }
}
```

---

## 8. 실행 파이프라인

```
[0] MODE SELECT
    Pack.roundPreset 으로 모드 분기
    해외 모드는 항공 심판의 handoff(도착 공항·시각) 수신 필수
        │
        ▼
[1] CONSTRAINT COMPILE                              (결정론)
    maxWalkKmPerDay = min(전원)
    stairsOk = AND(전원)
    겨울 Pack이면 도보 시간 ×1.4 보정
    heavyLuggage = 쇼핑 카드 점수 평균 ≥ 7 이면 true
        │
        ▼
[2] SOURCING
    [모드 A] search_intercity_transport
             + 자차 후보는 calculate_driving_cost 로 총비용 환산
    [모드 B] get_airport_transfer_options (숙소 후보 지역별)
             + get_route 샘플링으로 현지 이동 단가 추정
             + evaluate_transit_passes 로 패스 후보 생성
        │
        ▼
[3] SCREENING                                       (결정론)
    접근성 위반(계단 필수 + 휠체어) 실격
    도보 상한 초과 정책 실격
    예산 초과 실격
        │
        ▼
[4] BRIEFING                                        (LLM)
    후보 카드 게시. 이동 정책 후보는 pros/cons를 함께 노출
        │
        ▼
[5] DEBATE                                          (오케스트레이터)
    강도 추정 (11장)
        │
        ▼
[6] FACTCHECK                                       (LLM + 도구)
    "역에서 가까워요" 같은 주장을 get_route로 실측 검증
    막차 시각 확인 (get_last_train_time)
        │
        ▼
[7] PROPOSAL                                        (LLM)
    절충안 생성 (12장)
        │
        ▼
[8] VERDICT                                         (LLM)
    이동 정책 + 패스 권고 + 일 예상 교통비 확정
        │
        ▼
[9] HANDOFF
    mobilityPolicy → R2 숙소 (역세권 가중치)
    travelTimeMatrix → R5 동선
    passRecommendation → R6 정산 (R3 후 재계산 예약)
```

---

## 9. 하드 제약 매핑과 실격 규칙

| 설문 하드 제약 | 컴파일 | 실격 판정 |
| --- | --- | --- |
| 하루 도보 상한 (그룹 최솟값) | `maxWalkKmPerDay` | 정책의 `estimatedDailyWalkKm` 초과 시 실격 |
| 계단 불가 / 휠체어 | `stairsOk=false` | 엘리베이터 없는 환승 경로 포함 후보 실격 |
| 유모차 동반 | `strollers > 0` | 계단 환승 다수 경로 감점(실격 아님) |
| 장시간 버스 불가 | 좌석 이동 120분 상한 | 고속버스 후보 실격 |
| 예산 상한 | 교통 항목 배정액 | 초과 시 실격 |
| 면허 보유자 0명 | `licensedDrivers = []` | **자차·렌터카 후보 전면 실격** |
| 음주 계획 있음 | 야간 활동 선호 높음 | 자차 후보에 경고(실격 아님) |

### 9.1 도보 거리 제약의 특수성

도보 상한은 **그룹의 최솟값**을 쓴다. 한 사람이 하루 3km가 한계인데 5.8km 정책을 채택하면, 그 사람은 여행 내내 고통받고 아무도 그 사실을 모른다. 이것은 개입 불가 구조에서 특히 위험하다.

```
maxWalkKmPerDay = min_i( personalWalkLimit[i] )
```

정책의 예상 도보량이 상한의 **85%를 넘으면** 실격은 아니지만 판결문에 경고를 명시하고, 택시 예비비를 자동 배정한다.

---

## 10. 스코어링 모델

### 10.1 개인 만족도

```
Sat(i, c) = 0.28 × costFit(i, c)
          + 0.24 × timeFit(c)
          + 0.20 × comfortFit(i, c)
          + 0.16 × accessibilityFit(i, c)
          + 0.12 × flexibilityFit(i, c)
```

| 항목 | 계산 |
| --- | --- |
| `costFit` | 1인 총 교통비를 개인 예산 여유도로 정규화. `transitVsTaxi` 슬라이더가 낮은(=아끼는) 사람일수록 민감도 ↑ |
| `timeFit` | 총 이동시간 + 환승 페널티(환승 1회 = 8분 상당) |
| `comfortFit` | 좌석 보장, 짐 편의, 그룹 동승 가능 여부. `transitVsTaxi` 높은 사람에게 가중 |
| `accessibilityFit` | 도보량·계단이 개인 신체 제약에 얼마나 여유 있는지. 상한에 가까울수록 급감 |
| `flexibilityFit` | `planning` 슬라이더가 낮은(즉흥형) 사람은 패스·정해진 시각에 감점, 택시·자차에 가점 |

### 10.2 추가 규칙

```
[R-TRANS-1] 도보 예상량 > maxWalkKmPerDay × 0.85 인 정책은
            실격이 아니되 판결문 경고 + 택시 예비비 자동 배정

[R-TRANS-2] 막차 시각이 야간 활동 종료 예정 시각보다 이르면
            "심야 택시비"를 예산에 선반영. 누락 시 R6에서 예산이 터진다.

[R-TRANS-3] 패스 절감액이 1인 500엔(또는 5,000원) 미만이면
            "구매 불필요"로 판결. 미미한 이득에 사용 제약을 감수시키지 않는다.

[R-TRANS-4] 국내 자차 모드에서 운전자가 1명뿐이고 편도 3시간 초과면
            "운전자 피로"를 리스크로 명시하고 교대 or 대중교통 대안을 병기.
            운전자 본인의 만족도는 다른 참여자보다 구조적으로 낮으므로
            Maximin 계산에서 이 손실을 반드시 반영한다.
```

R-TRANS-4는 그룹 여행의 고전적 불공정 지점이다. 다만 운전 부담은 취향 미반영이 아니므로 `preferenceLoss`에 임의의 가산점을 넣지 않는다. 운전자 지정과 장거리 운전 동의를 별도 운영 제약으로 확인하고, 미동의 시 `DRIVER_CONFIRMATION_REQUIRED` 또는 대중교통 재탐색으로 처리한다.

---

## 11. 주장 강도 추정과 중재 로직

프레임워크는 `flight-referee-implementation.md` 11장과 동일하다. 여기서는 **교통 라운드에 특화된 신호와 함정**을 정의한다.

### 11.1 교통 라운드의 강도 신호

| 신호 | 교통에서의 구체적 발현 |
| --- | --- |
| S1 단정 | "택시는 절대 못 타요, 돈이 아까워요" / "걸어다니는 건 무리예요" |
| S2 근거 | "지난번에 3km 걷고 무릎이 아팠어요" — 신체 근거는 강도 높음 |
| S3 반복 | 여러 턴에 걸쳐 도보량 우려 반복 |
| S4 양보 거부 | 절충(부분 택시)에도 "그래도 걷는 게 많아요" |
| S5 하드 제약 연계 | 등록된 `maxWalkKmPerDay` 를 근거로 듦 → **실격 사유로 승격** |
| S6 개인 비용 | "1인당 3천엔이면 밥 한 끼예요" |

### 11.2 교통 라운드 고유의 함정 — "비용 vs 신체"의 비대칭

교통 라운드에서 가장 흔한 교착은 **아끼려는 사람 vs 체력이 약한 사람**이다. 이 둘은 겉보기에 대칭적인 취향 충돌 같지만 그렇지 않다.

```
· 비용 주장은 "선호"다. 3천원 더 쓰면 해결된다.
· 신체 주장은 "제약"이다. 돈으로 해결되지만, 참으라고 할 수는 없다.

→ 심판은 신체 근거 주장에 personaSupport 가중치를 우선 적용하고,
  비용 주장은 "얼마면 해결되는가"로 환산해 절충 공간을 만든다.
```

**규칙**: 신체 제약에 근거한 강도는 설문의 `maxWalkKmPerDay`·`stairsOk`와 대조해 검증하되, 검증되면 **감점 없이 100% 인정**한다. 반면 비용 주장은 개인 예산 여유도와 대조한다. 예산이 충분한데 아끼자고 강하게 주장하면 `×0.5` 할인한다.

### 11.3 페르소나 정합성 검증 예시

| 발화 | 설문 데이터 | 처리 |
| --- | --- | --- |
| "많이 걷는 건 힘들어요" | `maxWalkKmPerDay = 4` | 100% 인정 + 실격 사유 검토 |
| "많이 걷는 건 힘들어요" | `maxWalkKmPerDay = 12` | 25% 할인 + 회의록 지적 |
| "택시비 아까워요" | `transitVsTaxi = 0.1`(아끼는 성향) | 100% 인정 |
| "택시비 아까워요" | 예산 상한 최상위 + `transitVsTaxi = 0.8` | 50% 할인 |
| "패스 사면 이득이에요" | 계산 결과 절감 1인 200엔 | 사실 오류로 정정 |

마지막 행이 중요하다. **강도가 아무리 높아도 사실이 틀리면 정정한다.** 심판은 `evaluate_transit_passes` 결과로 즉시 반박한다.

### 11.4 강도 활용 범위

항공 심판과 동일하게, 강도는 **선택 기준이 아니다.**

| 용도 | 사용 |
| --- | --- |
| 최종 정책 선택 | ❌ Maximin |
| 쟁점 축 식별 (비용 vs 체력 vs 편의) | ✅ |
| 절충안 방향 결정 | ✅ |
| 강도 0.8 이상 반대자의 `Sat ≥ 5.5` 제약 | ✅ |
| 예비비 배정 규모 결정 | ✅ (체력 우려 강하면 택시 예비비 상향) |
| 동점 타이브레이크 | ✅ |

---

## 12. 절충안 생성 전략

교통은 항공보다 절충 공간이 훨씬 넓다. **"전부 A 아니면 전부 B"가 아니라 시간·상황별로 섞을 수 있다.**

| 교착 | 절충 전략 | 예시 |
| --- | --- | --- |
| 비용 vs 체력 | **조건부 택시 정책** | "평소엔 지하철, 하루 도보 5km 초과 시점부터 택시. 예비비 1인 3천엔" |
| 비용 vs 체력 | **시간대 분리** | "낮에는 대중교통, 밤에는 택시" — 막차·피로 문제 동시 해결 |
| 패스 구매 vs 개별 결제 | **부분 구매** | "관광지 많이 도는 2명만 주유패스, 나머지는 IC카드" |
| 자차 vs 대중교통 (국내) | **하이브리드** | "이동은 KTX, 현지는 렌터카 1대" — 강릉·제주에서 유효 |
| 렌터카 대수 | **1대 vs 2대** | 6인 1밴 vs 2대 분산. 운전 부담과 자유도의 트레이드오프 |
| 공항 이동 | **편도 분리** | "갈 때는 짐 많으니 택시 분승, 올 때는 특급열차" |
| 도보 상한 교착 | **일자별 강약 배치** | R5에 "빡센 날 다음은 여유 날" 제약 전달 |

**조건부 정책이 핵심이다.** 교통은 결정 하나로 고정할 필요가 없고, "이럴 땐 이렇게"라는 규칙으로 만들면 양쪽 우려를 동시에 해소할 수 있다. 심판은 이 형태를 우선적으로 시도한다.

---

## 13. 시스템 프롬프트 전문

```
당신은 여행 계획 회의의 **교통편 담당 심판**입니다.
공정하고, 데이터에 근거하며, 참여자의 감정보다 사실을 우선합니다.

═══════════════════════════════════════════════
【 가장 중요한 전제 】
참여자들은 이 회의를 실시간으로 보고 있지 않습니다.
설문만 제출했고, 회의가 끝난 뒤 결과만 확인합니다.
당신의 판결을 중간에 고칠 사람이 아무도 없습니다.

특히 교통은 "여행지에서 몸으로 겪는" 항목입니다.
하루 6km를 걷게 되는지, 막차를 놓쳐 택시비가 터지는지는
계획서에 숫자로 적히지 않으면 아무도 미리 알 수 없습니다.
그것을 계산해서 알려주는 것이 당신의 일입니다.
═══════════════════════════════════════════════

## 모드
{mode}
  · domestic_intercity : 국내 도시간 이동 + 현지 이동을 모두 결정합니다.
  · local_mobility     : 항공 심판이 정한 도착 공항·시각을 받아,
                         공항↔시내 이동과 현지 이동 정책을 결정합니다.

## 여행 정보
목적지: {pack.displayName} ({pack.packId})
확정 일정: {dates.start} ~ {dates.end} ({dates.nights}박)
인원: {headcount}명
교통 항목 배정 예산: 1인 {budgetAllocated}원
{mode == local_mobility 일 때}
  도착: {arrival.airport} {arrival.at}
  귀국편 출발: {arrival.departureAt}
{mode == domestic_intercity 일 때}
  출발지: {origin.city}
  면허 보유자: {licensedDrivers}

## 그룹 이동 제약 (절대 위반 불가)
하루 도보 상한: {maxWalkKmPerDay}km   ← 그룹에서 가장 낮은 사람 기준입니다
계단 이용 가능: {stairsOk}
휠체어/유모차: {wheelchair} / {strollers}
짐 많음 예상: {luggageHeavy}
{hard_constraints}

## 사용 가능한 도구
- search_intercity_transport(...)  국내 도시간 후보 (모드 A 전용)
- get_route(...)                   두 지점 간 실측 경로. 추측 금지, 반드시 이걸 쓰세요.
- get_airport_transfer_options(...) 공항↔시내 비교 (모드 B 전용)
- evaluate_transit_passes(...)     교통패스 손익 계산
- calculate_driving_cost(...)      자차·렌터카 총비용 (모드 A 전용)
- get_last_train_time(...)         막차 시각

## 반드시 지킬 판정 원칙

【원칙 1】 도보량을 반드시 수치로 계산하세요.
  "역에서 가깝다"는 말은 근거가 아닙니다. get_route로 실측하세요.
  하루 예상 도보량이 그룹 상한의 85%를 넘으면 경고를 명시하고
  택시 예비비를 배정하세요. 상한을 넘으면 그 정책은 실격입니다.
  겨울 목적지(삿포로 등)에서는 도보 시간을 1.4배로 보정하세요.

【원칙 2】 막차를 확인하세요.
  야간 활동이 예상되는데 막차 시각을 확인하지 않으면,
  그룹은 현지에서 예상 못 한 택시비를 씁니다.
  get_last_train_time으로 확인하고, 필요하면 심야 교통비를 예산에 선반영하세요.

【원칙 3】 패스는 계산해서 판단하세요.
  "패스가 이득"이라는 통념을 그대로 받아들이지 마세요.
  evaluate_transit_passes를 호출해 절감액과 손익분기를 확인하세요.
  절감액이 1인 500엔(또는 5,000원) 미만이면 "굳이 살 필요 없음"으로 판결하세요.
  미미한 이득을 위해 사용 제약을 감수시킬 이유가 없습니다.

  ★ 오사카 주유패스처럼 관광지 입장권이 포함된 패스는,
    액티비티 라운드(R3)가 끝난 뒤 가치가 달라집니다.
    지금은 잠정 권고로 판결하고, R3 후 재계산이 필요하다고 명시하세요.

【원칙 4】 운전자의 부담을 계산에 넣으세요. (모드 A)
  자차·렌터카를 선택하면 운전자는 여행 내내 일하고 술도 마실 수 없습니다.
  운전자가 1명뿐이고 편도 3시간을 넘으면 리스크로 명시하고,
  교대 가능 여부나 대중교통 대안을 함께 제시하세요.
  운전자의 만족도는 구조적으로 낮으므로 판결문에 반드시 언급하세요.
  면허 보유자가 없으면 자차 후보는 전부 실격입니다.

【원칙 5】 "비용 우려"와 "신체 제약"을 같은 무게로 다루지 마세요.
  비용 문제는 돈으로 해결됩니다. 얼마면 해결되는지 계산해 제시하세요.
  신체 제약은 참으라고 할 수 없습니다. 설문에 등록된 제약이라면
  감점 없이 100% 인정하고, 필요하면 실격 사유로 삼으세요.

## 주장 강도 추정 (중재의 핵심 기술)

참여자 발언에서 각 주장의 강도를 0.0~1.0으로 추정하세요.

강도가 높다는 신호:
  · 단정적 표현 ("절대", "무조건", "그건 무리예요")
  · 구체적 근거 2개 이상, 특히 신체적 경험 ("3km 걷고 무릎이 아팠어요")
  · 여러 턴에 걸쳐 같은 우려 반복
  · 절충안에도 조건 고수
  · 등록된 하드 제약(도보 상한, 계단 불가)을 근거로 듦
  · 구체적 금액 언급 ("1인 3천엔이면 밥 한 끼예요")

강도가 낮다는 신호:
  · "괜찮을 것 같아요", "다들 편한 대로", "상관없어요"
  · 근거 없는 선호
  · 한 번 말하고 그침

★ 반드시 설문과 대조해 보정하세요 ★
  · 신체 제약 주장 ↔ 설문의 도보 상한·계단 여부
      일치하면 100% 인정 (그리고 실격 사유를 검토하세요)
      모순되면 25%로 할인하고 정중히 지적하세요
      예: "민재님은 설문에서 하루 12km까지 가능하다고 답하셨습니다.
           도보량 우려는 강도를 낮춰 반영하겠습니다."
  · 비용 주장 ↔ 개인 예산 여유도와 transitVsTaxi 성향
      절약 성향이면 100% 인정
      예산이 넉넉한데 강하게 아끼자고 하면 50%로 할인
  · 설문에 근거가 없으면 50%로 할인

  이 지적을 반드시 회의록에 남기세요.
  당신이 설문을 실제로 읽고 있다는 증거이며,
  목소리 큰 사람이 이기는 것을 막는 유일한 장치입니다.

★ 사실이 틀린 주장은 강도와 무관하게 정정하세요 ★
  "패스 사면 무조건 이득"처럼 계산으로 반박 가능한 주장은
  아무리 강하게 말해도 도구 결과로 정정하세요.

★ 강도를 최종 선택에 직접 쓰지 마세요 ★
  최종 정책은 언제나 "가장 불만족한 사람의 만족도가 가장 높은 안"입니다.
  강도는 다음에만 사용합니다:
    · 진짜 쟁점 식별 (비용인가, 체력인가, 편의인가)
    · 절충안 방향 결정
    · 강도 0.8 이상 반대자의 만족도 하한(5.5)을 제약으로 추가
    · 예비비 규모 결정 (체력 우려가 강하면 택시 예비비 상향)
    · 동률일 때의 타이브레이크

★ 강도 상한 ★
  한 사람이 한 라운드에서 강도 0.8 이상을 행사할 수 있는 것은 1회뿐입니다.

## 교착 해소 — 조건부 정책을 우선 시도하세요

교통은 하나로 고정할 필요가 없습니다.
"이럴 땐 이렇게"라는 규칙을 만들면 양쪽 우려를 동시에 해소할 수 있습니다.

  · 비용 vs 체력  → "평소 지하철, 하루 5km 초과 시점부터 택시, 예비비 1인 3천엔"
  · 비용 vs 체력  → "낮에는 대중교통, 밤에는 택시" (막차 문제도 동시 해결)
  · 패스 교착      → "많이 도는 2명만 패스, 나머지는 IC카드"
  · 국내 이동      → "도시간은 KTX, 현지는 렌터카 1대" 하이브리드
  · 공항 이동      → "갈 때는 짐 많으니 택시 분승, 올 때는 특급열차"
  · 도보 교착      → R5 동선 심판에 "빡센 날 다음은 여유 날" 제약을 전달

## 진행 절차

SOURCING
  제약을 조회 조건으로 컴파일한 뒤 도구를 호출하세요.
  현지 이동 정책 후보는 반드시 pros/cons와 예상 일 도보량, 일 교통비를
  함께 제시하세요. 숫자 없는 후보는 비교할 수 없습니다.

FACTCHECK
  "가깝다", "금방이다", "별로 안 걷는다" 같은 표현이 나오면 반드시 실측하세요.
  도구로 확인하지 않은 시간·요금·거리를 말하지 마세요.

PROPOSAL
  조건부 정책을 우선 제시하세요. 각 안이 누구의 어떤 우려를 해소하는지 밝히세요.

VERDICT
  이동 정책 + 패스 권고 + 1인 일 예상 교통비 + 예비비를 확정하세요.
  R3 이후 패스를 재계산해야 하면 반드시 명시하세요.

## 금지 사항
· 실측하지 않은 시간·거리·요금을 말하지 마세요.
· 후보를 발명하지 마세요.
· 특정 참여자를 편들지 마세요.
· 신체 제약을 "조금만 참으면 된다"는 식으로 다루지 마세요.
· 예산 초과를 조용히 넘기지 말고 Chief에 경보하세요.

## 발화 스타일
· 한국어. 간결하고 사무적으로. 라운드당 발언 6회 이내.
· 시간·거리·금액은 항상 단위와 기준(1인/그룹, 편도/왕복)을 붙이세요.
· 판결문 400자 이내.

## 출력 형식
아래 JSON 스키마를 따르세요. (14장 참조)
```

---

## 14. 판결 출력 스키마

```json
{
  "roundId": "r_1b",
  "category": "transport",
  "mode": "local_mobility",
  "winner": {
    "type": "policy",
    "candidateIds": ["T-P1"],
    "detail": "대중교통 중심 + 조건부 택시"
  },
  "mobilityPolicy": {
    "primaryMode": "transit",
    "taxiRule": "하루 누적 도보 5km 초과 시점부터 택시 허용, 심야는 무조건 택시",
    "estimatedDailyWalkKm": 5.2,
    "walkLimitGroup": 6.0,
    "walkUtilization": 0.87,
    "estimatedDailyCostPerPersonKrw": 8200,
    "contingencyPerPersonKrw": 25000,
    "contingencyReason": "도보 상한 87% 도달 — 택시 예비비 배정"
  },
  "airportTransfer": {
    "inbound": { "mode": "라피트 특급", "durationMin": 38,
                 "costPerPersonKrw": 12000, "reason": "짐 많음, 도착 11:00 여유" },
    "outbound": { "mode": "공항버스", "durationMin": 55,
                  "costPerPersonKrw": 9500 }
  },
  "passRecommendation": {
    "passId": "osaka-amazing-pass-1d",
    "decision": "provisional_buy",
    "buyCount": 1,
    "savingsPerPersonJpy": 1450,
    "breakEvenRides": 6,
    "convenienceScore": -0.1,
    "recheckAfterRound": "r_3",
    "recheckReason": "포함 관광지가 액티비티 라운드 결과에 따라 달라짐"
  },
  "lastTrainWarnings": [
    { "route": "난바→호텔", "lastTrain": "23:52",
      "note": "이자카야 일정이 24시를 넘기면 택시 필요 (약 ¥1,800/대)" }
  ],
  "intensityProfile": [
    { "userId": "u_318", "stance": "oppose", "target": "T-P2(도보 중심)",
      "rawIntensity": 0.88, "personaSupport": 1.0, "adjusted": 0.88,
      "signals": ["S1","S2","S5"],
      "basis": "설문 도보 상한 6km와 일치 — 신체 제약으로 100% 인정",
      "evidence": "하루 8km는 무리예요. 무릎이 안 좋아요." },
    { "userId": "u_501", "stance": "oppose", "target": "T-P1(택시 허용)",
      "rawIntensity": 0.70, "personaSupport": 0.5, "adjusted": 0.35,
      "signals": ["S6"],
      "basis": "예산 여유 상위권이며 transitVsTaxi 0.55 — 절약 성향 근거 약함",
      "note": "회의록에 정중히 지적함" }
  ],
  "dissent": [
    { "userId": "u_501", "reason": "택시비 지출 우려", "intensity": 0.35,
      "mitigation": "예비비는 실제 사용분만 정산하도록 R6에 전달" }
  ],
  "disqualified": [
    { "candidateId": "T-P3", "reason": "일 도보 8.4km — 그룹 상한 6km 초과" }
  ],
  "budgetImpact": { "allocated": 62000, "actual": 58600, "delta": -0.05 },
  "handoff": {
    "toAccommodation": { "stationProximityWeight": 0.25,
                         "note": "대중교통 중심 정책이므로 역세권 가중치 상향" },
    "toScheduler": { "maxDailyWalkKm": 6.0, "alternateHardEasyDays": true,
                     "travelTimeMatrixRef": "ttm_rm401_v1" }
  },
  "uncertainties": [
    "주유패스 포함 시설은 R3 확정 후 재계산 필요",
    "우천 시 택시 사용량 증가 가능"
  ],
  "toolCalls": ["navitime.route", "google.distanceMatrix",
                "pass.evaluate", "navitime.lastTrain"]
}
```

---

## 15. 캐시·쿼터·비용

| 데이터 | TTL | 키 | 공유 |
| --- | --- | --- | --- |
| 공항↔지역 이동 | 30d | `airport:area:mode` | 전역 |
| 주요 POI 간 이동시간 행렬 | 30d | `pack:matrixVersion` | Pack 전체 (프리컴퓨트) |
| 도시간 교통 시간표 | 탐색 7d / 확정 24h | `origin:dest:date` | 전역 |
| 막차 시각 | 30d | `from:to` | 전역 |
| 패스 정보 | Pack 갱신 시 | `packId:passId` | 전역 |
| 유가·통행료 | 24h | `route` | 전역 |
| 예상 이동시간 | 탐색 1h / 확정 6h 상한 | 좌표 해시 | 전역 |

**프리컴퓨트가 핵심**: 인기 Pack의 주요 POI 100~200개에 대한 이동시간 행렬을 배치로 미리 계산해두면, 교통편 심판과 R5 동선 심판의 API 호출이 90% 이상 줄어든다. 목적지 확정형 구조이기에 가능한 최적화다.

라운드당 도구 호출 상한: `get_route` 8회, `evaluate_transit_passes` 2회, 기타 각 3회.

---

## 16. 실패 처리와 폴백

| 실패 | 처리 |
| --- | --- |
| NAVITIME/Ekispert 실패 | Google Routes(transit)로 폴백. 요금 정확도가 낮아지므로 `fareConfidence: "estimated"` 표기 |
| ODsay 실패 | 카카오모빌리티 → Google 순 폴백 |
| 경로 결과 없음 | 직선거리 기반 추정 + "실제 경로 확인 필요" 경고 |
| 패스 데이터 미비 | 패스 항목 생략하고 "현지에서 확인 권장" 안내 |
| 유가·통행료 API 실패 | Pack의 정적 평균 단가 사용, 오차 ±15% 명시 |
| 프리컴퓨트 행렬 부재 | 실시간 조회로 전환, 상한 도달 시 샘플링(주요 10개 지점만) |

---

## 17. 테스트 케이스

| # | 시나리오 | 기대 동작 |
| --- | --- | --- |
| T1 | 도보 상한 4km인 참여자 존재 | 일 도보 5km 이상 정책 전부 실격 |
| T2 | 도보 예상 5.2km, 상한 6km | 실격 아님 + 경고 + 택시 예비비 배정 |
| T3 | 오사카, 관광지 2곳 확정 전 | 패스 잠정 권고 + R3 재계산 명시 |
| T4 | 패스 절감 1인 300엔 | "구매 불필요" 판결 |
| T5 | 제주 Pack, 면허 보유자 0명 | 렌터카 전 후보 실격 → 택시투어 대안 제시 |
| T6 | 제주 Pack, 운전자 1명, 일 4시간 운전 | 리스크 명시 + 운전자 CC +0.2 |
| T7 | 이자카야 일정 24시 예상, 막차 23:52 | 심야 택시비 선반영 |
| T8 | 예산 상위권 참여자가 강하게 절약 주장 | 강도 50% 할인 + 회의록 지적 |
| T9 | 설문 도보 12km인 사람이 도보 우려 주장 | 강도 25% 할인 + 정중한 지적 |
| T10 | 겨울 삿포로 Pack | 도보 시간 1.4배 보정 반영 |
| T11 | 비용파 vs 체력파 교착 | 조건부 택시 정책 절충안 생성 |
| T12 | NAVITIME 장애 | Google 폴백 + 요금 신뢰도 표기 |

---

## 18. 확장 훅

| 확장 | 준비 사항 |
| --- | --- |
| 유럽 Pack | Rome2Rio(도시간), GTFS/Transitland(대중교통), 철도패스 룰 테이블(유레일 등) 추가. `roundPreset: "europe_multicity"` |
| 북미 Pack | 렌터카 비중이 높아 모드 A 로직을 해외에도 적용해야 함 |
| 동남아 Pack | Grab API 등 라이드헤일링 연동, 툭툭·오토바이 택시 등 로컬 수단 |
| 실시간 예매 | 코레일·NAVITIME 예약 연동 (제휴 필요) |
| 접근성 강화 | 휠체어 경로 전용 탐색, 배리어프리 정보 DB |
| 탄소 배출 | 수단별 CO2 계산 → 환경 신념 하드 제약과 연동 |

---

## 마무리 — 이 심판의 실패 조건

1. **도보량을 계산하지 않으면 실패한다.** "역에서 가깝다"는 근거가 아니다. 실측하지 않은 정책은 여행지에서 무너진다.
2. **비용과 신체를 같은 무게로 다루면 실패한다.** 비용은 돈으로 해결되고, 신체 제약은 해결되지 않는다.
3. **패스를 통념으로 권하면 실패한다.** 계산해서 절감액이 미미하면 사지 말라고 해야 한다.


---

## 19. v1.1 실행 보강 — 행렬 버전·안전한 이동·수렴

이 장은 `travel-mediation-plan.md` 19장의 Planning Graph·fail-closed 계약을 교통 심판에 적용한다. R1의 이동 정책은 잠정 결정이며, 숙소·활동·일정이 확정되면서 검증 가능한 정책으로 수렴해야 한다.

## 19.1 버전된 이동시간 행렬과 재계산

`travelTimeMatrix`는 `matrixVersion`, `source`, `retrievedAt`, `timezone`, `modePolicyHash`, `originSetHash`, `destinationSetHash`, `confidence`를 가진다. 숙소 좌표, 확정 POI, 시간대, 날씨 보정, 이동 정책 중 하나라도 변하면 이전 행렬은 `STALE`이다.

```text
R1: 공항·잠정 지역·선호 카드 기반 matrix v1 / 잠정 패스 권고
R2: 숙소 좌표 반영 matrix v2 / 공항 접근과 역세권 재검증
R3: 확정 POI 반영 matrix v3 / 패스 손익 재계산
R5: 시간 슬롯·막차 반영 matrix v4 / 최종 일정 실행 가능성 검증
```

R3/R5 재계산으로 패스·택시 예비비·이동시간이 바뀌어 예산, 도보 상한, 숙소 위치 가정이 깨지면 자동 갱신만 하지 않는다. 영향 노드를 `STALE`로 만들고 전역 수렴 루프에 넣는다.

## 19.2 패스·차량·접근성 검증

패스 권고는 가격뿐 아니라 유효 날짜, 연속/비연속 사용 조건, 운영사·노선 제외, 구매·교환 장소와 시간, 시간대별 운행 가능성, 확정 일정의 실제 승차 구간을 검증해야 한다. 검증 전 `provisional_buy`는 BOOKABLE이 아니며, 절감액이 양수여도 일정 충돌이나 사용 불가 노선이 있으면 권고하지 않는다.

렌터카·자차 후보에는 정원, 좌석·짐 적재량, 주차 가능 여부·요금, 운전자 면허·보험 범위, 영업소 운영시간, 운전자 휴식과 음주 제약을 포함한다. 확인할 수 없는 사항은 단순 경고가 아니라 해당 차량 정책을 `BLOCKED`로 둔다.

휠체어·계단·유모차 접근성, 막차, 심야 안전 경로는 fail-closed다. 경로 제공자가 이를 보장하지 못하면 보행·환승 후보를 채택하지 않고, 검증된 택시·전용 이동 대안과 예산을 함께 제시한다. 우천·장애·막차 상황의 대체 경로도 같은 정책으로 검증한다.

## 19.3 조건부 정책의 실행 계약

조건부 택시 같은 절충안은 자연어만으로 두지 않는다.

```json
{
  "policyId": "T-P1",
  "rules": [
    {"when": "dailyWalkKm >= 5", "action": "use_taxi", "budgetKrwPerPerson": 3000},
    {"when": "transit_last_service_unavailable", "action": "use_taxi", "budgetKrwPerGroup": 18000}
  ],
  "requires": ["routeConfidence >= verified", "taxiCapacityVerified"],
  "fallback": "shorten_activity_or_use_verified_accessible_route"
}
```

Scheduler는 이를 시간·예산 제약으로 직접 소비한다. 정책 실행 조건이 충족되지 않으면 계획을 정상으로 보이지 않고 `BLOCKED` 또는 `STALE`로 올린다.

## 19.4 실패·재실행·테스트 보강

직선거리 기반 추정은 탐색용 초안에만 허용한다. 하드 접근성·막차·필수 이동 구간은 추정으로 `VERIFIED`를 통과할 수 없다. 공급자 장애가 있으면 data confidence를 낮춘 대체 후보를 제시하되, 안전 조건을 만족하는 후보가 없으면 해당 라운드를 실패 처리한다.

기존 테스트에 다음을 추가한다.

| # | 시나리오 | 기대 동작 |
| --- | --- | --- |
| T13 | R2 숙소가 변경됨 | matrix v1을 STALE로 전환하고 공항·역 접근 재계산 |
| T14 | R3 확정 POI가 패스 제외 노선에 집중 | 패스 권고 취소, 예산·일정 영향 노드 재검증 |
| T15 | 6인+대형 짐, 렌터카 적재량 미확인 | 차량 정책 BLOCKED, 확정 불가 |
| T16 | 계단 없는 경로를 제공자가 보장하지 못함 | 보행/환승안 fail-closed, 검증된 대체 이동 제시 |
| T17 | 막차 이후 일정이 생성됨 | 택시 수용 인원·비용을 검증하거나 일정 node를 BLOCKED |
