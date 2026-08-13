# 에이전트 아키텍처와 제어 계약 — 구현 계획

- **문서 버전**: v1.0 / 2026-08-13
- **상위 문서**: [travel-mediation-plan.md](travel-mediation-plan.md) (19장 전역 계약 우선)
- **연계 문서**: [flight-referee-implementation.md](flight-referee-implementation.md) · [transport-referee-implementation.md](transport-referee-implementation.md) · [accommodation-referee-implementation.md](accommodation-referee-implementation.md)
- **다루는 범위**: 에이전트 인벤토리, 제어 평면 분리, 심판 호출 순서 결정 프로토콜, 데이터(API·캐시) 에이전트 계약, 병렬 실행, 최종 문서 생성
- **권위 순서**: 기획서 19장 > **이 문서** > 개별 심판 문서의 예시. 같은 주제에서 충돌하면 위 순서를 따른다.

---

## 목차

1. [설계 결정 요약](#1-설계-결정-요약)
2. [에이전트 인벤토리](#2-에이전트-인벤토리)
3. [제어 평면 분리 — Orchestrator와 Supervisor](#3-제어-평면-분리--orchestrator와-supervisor)
4. [디스패치 프로토콜 — 호출 순서 결정](#4-디스패치-프로토콜--호출-순서-결정)
5. [라운드·심판 매핑과 의존성 그래프](#5-라운드심판-매핑과-의존성-그래프)
6. [Data Agent 계약 — API 호출·DB 저장·조회](#6-data-agent-계약--api-호출db-저장조회)
7. [심판 에이전트 공통 계약](#7-심판-에이전트-공통-계약)
8. [사람 에이전트 병렬 실행 계약](#8-사람-에이전트-병렬-실행-계약)
9. [최종 계획 문서 생성 에이전트](#9-최종-계획-문서-생성-에이전트)
10. [상태·이벤트 모델](#10-상태이벤트-모델)
11. [실패 처리와 수렴 상한](#11-실패-처리와-수렴-상한)
12. [관측·로그·데이터 모델 추가분](#12-관측로그데이터-모델-추가분)
13. [테스트 케이스](#13-테스트-케이스)
14. [미결정 사항](#14-미결정-사항)

---

## 1. 설계 결정 요약

이미지의 전체 구조를 문서 계약으로 고정하면서, 기획서 6.1(오케스트레이터는 결정론)과 19장(전역 Planning Graph·fail-closed)을 침범하지 않도록 네 가지를 확정한다.

| # | 결정 | 이유 |
| --- | --- | --- |
| **D1** | 제어 평면을 **Orchestrator(코드, 비LLM)** 와 **Supervisor 심판(LLM)** 으로 분리한다. Supervisor는 순서와 규칙 준수를 **판정·제안**하고, 실제 호출·재시작·상한 집행은 Orchestrator가 한다 | LLM이 상태 전이를 직접 실행하면 재현성·비용 상한·감사 기록이 무너진다. C5(하드 제약 위반)·C7(후보 미실재)은 기계 판정이어야 한다 |
| **D2** | 심판은 캐시 DB를 직접 읽지 않는다. **Data Agent가 유일한 read-through 게이트웨이**다 (조회 → 미스 시 API 호출 → 정규화 → 저장 → 반환을 한 번의 도구 호출로 처리) | 심판 관점의 동작은 동일하되(정보가 필요하면 도구 한 번), 정규화 스키마·TTL·신뢰도·fail-closed 정책이 한 곳에서 강제된다. 기획서 10.3 "에이전트와 심판은 원본 API 형식을 절대 보지 않는다"를 지킬 수 있는 유일한 배치다 |
| **D3** | 캐시 히트를 무조건 사용하지 않는다. 요청의 **`purpose`(exploration / verification / booking_readiness)** 와 `queryClass` 정책이 캐시 사용 여부를 결정한다 | 확정가·그룹 재고·객실 조합·알레르기 대응은 캐시로 `VERIFIED`/`BOOKABLE`을 통과할 수 없다 (기획서 19.6, 항공 19.4, 숙소 20.1) |
| **D4** | 심판 인스턴스와 라운드는 1:1이 아니다. R1은 항공 → 교통 순차 2개이고, 교통패스는 R3 이후 재계산된다. Supervisor의 순서 조절은 **전역 Planning Graph의 STALE 재수렴까지 포함**한다 | 교통 정책이 숙소 가중치를 결정하고(숙소 1.4), 패스 손익은 확정 관광지에 의존한다(교통 5.2) |

Data Agent는 이미지상 독립 컴포넌트로 두되 **내부 판단은 결정론으로 구현한다.** 후보 완화 탐색(Pass 1 → Pass 2)은 심판의 책무이므로(항공 4.1) Data Agent에 추론을 넣을 이유가 없고, 넣으면 캐시 정책이 확률적으로 흔들린다. 제공자 폴백 체인·TTL 판정·정규화는 규칙으로 충분하다.

---

## 2. 에이전트 인벤토리

| 컴포넌트 | LLM | 인스턴스 | 호출자 | 핵심 산출물 |
| --- | --- | --- | --- | --- |
| **Orchestrator** | ✗ | 1 / run | Job Queue | 라운드·턴 진행, LegalMove 집합, 상한 집행, 체크포인트 |
| **Supervisor 심판** | ✓ | 1 / run | Orchestrator | `DispatchProposal`, `ReviewDecision`, 재심 지시문, 미해결 쟁점 서술 |
| **카테고리 심판** | ✓ | 7 종 (flight, transport, accommodation, activity, dining, scheduler, budget) | Orchestrator | 후보 카드, 팩트체크, 절충안, `Verdict` |
| **사람(페르소나) 에이전트** | ✓ | N (병렬) | Orchestrator | `stance` JSON, 발화, 조건부 수용 |
| **Data Agent** | ✗ | 카테고리별 7 종 | 심판 / Orchestrator | 정규화 후보·측정값 + 캐시 레코드 |
| **Scoring Engine** | ✗ | 1 | Orchestrator | `Sat(i,c)`, Maximin 선택, 양보 크레딧 갱신 |
| **Constraint Optimizer** | ✗ | 1 | Scheduler 심판 | 검증된 top-K 전체 일정 |
| **Validation Pass** | ✗ | 1 / run | Orchestrator | 환각·모순·실현가능성 전수 검증 리포트 |
| **Booking Coordinator** | ✗ | 1 / run | Orchestrator | 예약 체크리스트, 의존성·만료·폴백 |
| **최종 문서 생성 에이전트** | ✓ | 1 / run | Orchestrator | 계획서 본문(웹/PDF), 회의록 요약 |
| **Notification** | ✗ | 1 | Orchestrator | 알림톡·푸시·이메일 |

Data Agent 인스턴스와 담당 범위:

| 인스턴스 | 담당 `queryClass` 예시 | 제공자 우선순위 원천 |
| --- | --- | --- |
| `FlightData` | `flight.cheapest_date`, `flight.offers_search`, `flight.offer_price`, `flight.risk`, `flight.seatmap` | `Pack.providers.flight` |
| `TransportData` | `transit.route`, `transit.last_train`, `transit.pass_rules`, `intercity.timetable`, `driving.cost` | `Pack.providers.transit` |
| `AccommodationData` | `hotel.search`, `hotel.details`, `hotel.vacancy_price`, `hotel.price_band` | `Pack.providers.hotel` |
| `ActivityData` | `poi.search`, `poi.hours`, `poi.ticket`, `weather.forecast` | `Pack.providers.poi` |
| `DiningData` | `dining.search`, `dining.hours`, `dining.diet_support`, `dining.reservation_slot` | `Pack.providers.dining` |
| `GeoData` | `geo.travel_time`, `geo.matrix`, `geo.place_details`, `geo.geocode` | 전역 (Google 계열 + 지역 폴백) |
| `RefData` | `ref.fx`, `ref.airport_codes`, `ref.airline_codes`, `ref.pack_config` | 전역 · Pack 부트스트랩 |

---

## 3. 제어 평면 분리 — Orchestrator와 Supervisor

### 3.1 권한 분배

| 책무 | Orchestrator (코드) | Supervisor (LLM) |
| --- | --- | --- |
| 실행 가능한 다음 단계 집합 산출 | ✅ | ✗ |
| 그 집합 안에서 순서·우선순위 선택 | 검증만 | ✅ |
| 심판·페르소나·문서 에이전트 실제 호출 | ✅ | ✗ |
| 라운드 재시작 실행 | ✅ | 요청 |
| C1~C4·C6 판정 (수치는 코드가 제공) | 수치 산출 | ✅ 판정·서술 |
| C5·C7 판정 | ✅ 기계 판정 | 사유 서술만 |
| 만족도·예산·이동시간 산출 | ✅ | ✗ **금지** |
| 후보 선택 (Maximin) | ✅ | ✗ **금지** |
| 턴·토큰·도구·시간 상한 집행 | ✅ | ✗ |
| Planning Graph 버전·STALE 전파 | ✅ | 재계산 순서 제안 |
| 예산 이관 | 계산·적용 | 대상·규모 제안 및 승인 |
| 날짜 변경·참석자 제외 | 승인 요청 잡 생성 | 제안만 (`approval_required`) |
| 회의록에 노출될 사유 서술 | ✗ | ✅ |

### 3.2 불변식

```
[INV-1] Supervisor의 출력은 항상 "제안"이다. Orchestrator 검증을 통과하지 못한
        제안은 어떤 상태도 바꾸지 못한다.
[INV-2] Supervisor는 숫자를 만들지 않는다. 판정에 쓰는 모든 수치는
        Scoring Engine·Budget·Optimizer가 계산해 컨텍스트로 주입한 값이다.
[INV-3] C5(하드 제약 위반)·C7(후보 미실재)은 코드 판정이 최종이다.
        Supervisor 판단이 코드와 다르면 코드를 채택하고 불일치를 로그에 남긴다.
[INV-4] Supervisor는 라운드를 건너뛰거나 삭제할 수 없다.
        R0~R6은 각각 최소 1회 판결을 남긴 뒤에만 finalize가 가능하다.
[INV-5] 잠긴 노드(BOOKED, 사용자 수동 확정)는 Supervisor 제안으로 변경되지 않는다.
        변경은 취소 비용·영향 범위를 제시한 승인 요청을 거친다.
```

---

## 4. 디스패치 프로토콜 — 호출 순서 결정

Supervisor가 심판 호출 순서를 조절하되, 결정론을 유지하는 방식은 **제한된 선택(constrained dispatch)** 이다. Orchestrator가 합법 수(legal move) 집합을 계산해 제시하고, Supervisor는 그 안에서만 고른다.

### 4.1 1단계 — LegalMove 산출 (Orchestrator)

의존성 충족 + 미잠금 + 상한 여유를 모두 만족하는 수만 집합에 넣는다.

```json
{
  "moveId": "mv_07",
  "type": "run_referee",
  "target": { "round": "r_2", "category": "accommodation", "nodeId": "accommodation" },
  "dependencies": {
    "satisfied": ["date@2", "flight@1", "transport_policy@1"],
    "missing": []
  },
  "guards": {
    "roundRerunUsed": 0, "roundRerunCap": 2,
    "globalRecalcUsed": 1, "globalRecalcCap": 3,
    "turnsRemaining": 32
  },
  "budget": {
    "tokensRemaining": 82000,
    "usdRemaining": 0.24,
    "toolCallsRemaining": { "search_hotels": 4, "get_hotel_details": 8, "measure_location": 12 }
  },
  "parallelGroup": null,
  "estimated": { "latencySec": 95, "usd": 0.06 }
}
```

`type` 목록: `run_referee` · `rerun_round` · `resource_candidates`(재조달) · `recalc_node`(STALE 재계산) · `prefetch`(Data Agent 워머) · `request_budget_transfer` · `raise_approval` · `finalize_plan` · `block_run`.

### 4.2 2단계 — DispatchProposal (Supervisor)

```json
{
  "runId": "run_1",
  "sequence": [
    { "moveId": "mv_07", "reason": "교통 정책이 확정되어 숙소 가중치 입력이 준비됨" },
    { "moveId": "mv_11", "reason": "R3·R4 후보 조달을 미리 채워 대기시간 단축",
      "parallelWith": ["mv_07"] }
  ],
  "reviewDecisions": [
    { "roundId": "r_4", "decision": "rerun", "triggered": ["C1"],
      "reason": "최소 만족도 4.3 — 알레르기 대응 가능한 후보가 1개뿐이었습니다.",
      "instruction": "갑각류 무취급 확인이 가능한 후보를 2개 이상 확보한 뒤 재논의하세요." }
  ],
  "budgetTransferRequest": {
    "fromRound": "r_4", "toRound": "r_2", "amountPerPersonKrw": 20000,
    "rationale": "료칸 조석식 포함으로 식사 예산 여유 발생"
  },
  "notes": "회의록에 그대로 노출되는 서술"
}
```

### 4.3 3단계 — 검증 규칙 (Orchestrator)

| # | 규칙 | 위반 시 |
| --- | --- | --- |
| V1 | 모든 `moveId`가 현재 LegalMove 집합에 존재 | 거부 |
| V2 | `sequence`가 노드 의존성 위상 순서를 위반하지 않음 | 거부 |
| V3 | `parallelWith`는 동일 `parallelGroup`끼리만 | 해당 항목 직렬화 |
| V4 | 잠긴 노드(BOOKED·수동 확정) 변경 없음 | 거부 |
| V5 | `rerun ≤ 2` / 전역 재계산 `≤ 3` 준수 | 거부 후 차선책 채택 경로로 전환 |
| V6 | 토큰·비용·턴·도구 호출 상한 준수 | 축약 모드로 강등 |
| V7 | R0~R6 중 미실행 라운드가 있으면 `finalize_plan` 금지 | 거부 |
| V8 | `approval_required`(날짜 변경, 참석자 제외, 예산 +10% 초과)를 자동 실행하지 않음 | `raise_approval` 잡으로 변환 |
| V9 | fail-closed 미검증 노드를 `finalize`/`BOOKABLE`로 승격하지 않음 | 거부 + 노드 `BLOCKED` |
| V10 | `reviewDecisions`의 C5·C7이 기계 판정과 일치 | 코드 판정 채택 + 불일치 로그 |

### 4.4 4단계 — 거부와 폴백

```
검증 거부 → 거부 사유를 붙여 Supervisor에 1회 재요청
         → 2회째도 거부되면 기본 위상 순서(4.5)를 채택하고
            dispatch_decisions.fallbackUsed = true 기록
         → 회의록: "진행 순서는 기본 규칙으로 결정되었습니다"
같은 run에서 폴백이 3회 누적되면 Supervisor 모델 티어를 1단계 올려 1회 재시도하고,
그래도 실패하면 남은 run 전체를 기본 순서로 고정한다 (비용·시간 폭주 방지).
```

Supervisor 호출 자체가 실패(타임아웃·파싱 실패)해도 동일하게 기본 순서로 진행한다. **Supervisor는 품질 장치이지 단일 장애점이 아니다.**

### 4.5 기본 위상 순서 (fallback + 참조 순서)

| seq | 단계 | 실행 주체 | 선행 조건 |
| --- | --- | --- | --- |
| 0 | 하드 제약 통합·충돌 검사 | 코드 | 전원 페르소나 확인 |
| 1 | DateResolver (`flight.cheapest_date` 조회 포함) | 코드 + `FlightData` | 설문 availability |
| 2 | R0 프레이밍 (일정 확정·컨셉·예산 배분) | Supervisor 주재 | 날짜 후보 ≥ 1 |
| 3 | R1a 항공 심판 (해외 Pack / `kr-jeju`) | flight | R0 |
| 4 | R1b 교통 심판 (해외: mode B / 국내: mode A 단독) | transport | R1a (해외) |
| 5 | R2 숙소 심판 | accommodation | R1b `mobilityPolicy` |
| 6 | R3 액티비티 심판 | activity | R2 좌표·지역 |
| 6.5 | **교통패스 재계산** (토론 없음, 자동 갱신) | 코드 + `TransportData` | R3 확정 POI |
| 7 | R4 식사 심판 | dining | R2 반경, R3 일자 후보 |
| 8 | R5 동선 심판 (Optimizer → LLM 설명) | scheduler | R2·R3·R4 + matrix v4 |
| 9 | R6 예산 심판 | budget | R1~R5 실지출 |
| 10 | Validation Pass | 코드 | R6 |
| 11 | Booking Readiness 체크리스트 | 코드 | Validation pass |
| 12 | 최종 문서 생성 | 문서 에이전트 | 11 통과 |

### 4.6 Supervisor의 실질 재량 범위

순서 조절 권한은 실재하지만 좁다. 의존성이 강한 파이프라인이므로 재량이 발생하는 지점을 명시한다.

| # | 재량 | 예시 |
| --- | --- | --- |
| **A1** | 병렬 가능한 `prefetch` 우선순위 | R2 진행 중 R3·R4 후보를 미리 채울지, R5용 이동시간 행렬을 먼저 채울지 |
| **A2** | REVIEW 결과 선택 | `pass` / `rerun`(C1~C4·C6) / `resource_candidates`(C5·C7 후속) |
| **A3** | STALE이 여러 개일 때 재계산 순서 | 숙소 변경 후 Dining과 Scheduler 중 무엇을 먼저 되돌릴지 |
| **A4** | 예산 이관 대상·규모 제안과 승인 | "식사에서 2만원 이관하면 양쪽 안 모두 가능" |
| **A5** | 상한 도달 시 차선책 채택 여부와 미해결 쟁점 서술 | 재심 2회 소진 후 |

명시적 금지: 라운드 스킵·삭제, 날짜 자체 확정 변경, 만족도·예산 수치 산출, 하드 제약 완화, 후보 발명, 예약 실행.

### 4.7 한 라운드의 호출 시퀀스

```
Orchestrator ── computeLegalMoves ──▶ Supervisor
Supervisor   ── DispatchProposal ───▶ Orchestrator ── validate(V1~V10)
Orchestrator ── run_referee ────────▶ 카테고리 심판
심판         ── DataRequest ────────▶ Data Agent ── 캐시 조회 → (미스) API → 정규화 → 저장
심판         ── 후보 카드 게시 ─────▶ Orchestrator
Orchestrator ── STATEMENT 배치 ─────▶ 사람 에이전트 × N (병렬)
Orchestrator ── 충돌축 추출(코드) ──▶ CLASH 대표 2~3명만 호출
심판         ── FACTCHECK / PROPOSAL / Verdict ─▶ Orchestrator
Orchestrator ── Scoring + C5/C7 기계 검증 ─────▶ Supervisor (REVIEW)
Supervisor   ── ReviewDecision ─────▶ Orchestrator ── pass → 다음 move
                                                  └ rerun → CLASH로 회귀 (≤ 2회)
```

---

## 5. 라운드·심판 매핑과 의존성 그래프

### 5.1 노드 의존성

```text
Date ──┬─▶ Flight ─┬─▶ TransportPolicy ─┬─▶ AccommodationArea ─▶ Accommodation
       │           │                    │                              │
       │           └─▶ BudgetSnapshot ──┤                              │
       │                                │                              ▼
       └────────────────────────────────┴──▶ Activity ─▶ TransitPass(재계산) │
                                                 │                          │
                                                 ▼                          ▼
                                              Dining ───────────────▶ Schedule
                                                                          │
                                                              ┌───────────┴──────────┐
                                                              ▼                      ▼
                                                        Budget(정산)        BookingReadiness
                                                              └────────┬─────────────┘
                                                                       ▼
                                                                ValidationPass ─▶ Document
```

각 노드는 `{nodeId, version, inputHash, dependencyVersions, status, confidence, evidenceRefs}`를 갖고, 상태는 `PROVISIONAL → VERIFIED → BOOKABLE → BOOKED` + `BLOCKED / STALE / FAILED`이다 (기획서 19.3).

### 5.2 재계산 트리거

| 변경된 것 | STALE로 전환되는 노드 |
| --- | --- |
| 확정 날짜 | 전 노드 |
| 도착 공항·도착/귀국 시각·항공 실효 총액 | TransportPolicy, Accommodation, Activity, Dining, Schedule, Budget |
| `mobilityPolicy`(역세권 가중치, 택시 규칙) | AccommodationArea, Accommodation, Schedule, Budget |
| 숙소 좌표·체크인/아웃·객실가·식사 포함·분할 숙박 | Activity, Dining, Schedule, TransitPass, Budget |
| 확정 POI 집합 | TransitPass, Dining, Schedule, Budget |
| 이동시간 행렬 버전(`matrixVersion`) | Schedule, TransportPolicy 예비비 |
| 예약 실패·만료·가격 급등 | 해당 노드 `FAILED` + 하위 전부 `STALE` |

### 5.3 수렴 규칙

```
전역 재계산 ≤ 3회, 또는 (후보 순위 · 하드 제약 · 총비용 범위)가 안정화될 때까지
라운드 재심 ≤ 2회
수렴 실패 → 최선의 "검증 가능한" 계획 + 충돌 설명을 BLOCKED로 제시
           (조용히 차선책으로 바꾸지 않는다)
run 전체 시간 상한 30분 → 초과 시 부분 계획서 + 사유 안내
```

---

## 6. Data Agent 계약 — API 호출·DB 저장·조회

### 6.1 단일 게이트웨이 원칙

```
심판/Orchestrator ── DataRequest ──▶ Data Agent
                                       ├─ 1. 캐시 조회 (정책이 허용할 때만)
                                       ├─ 2. 미스·만료·신뢰도 부족 → 제공자 호출 (Pack 우선순위 → 폴백)
                                       ├─ 3. 정규화 스키마로 변환
                                       ├─ 4. 캐시 저장 (금지 클래스 제외)
                                       └─ 5. 정규화 결과 + evidence 메타 반환
```

- 심판은 캐시 DB·제공자 SDK에 직접 접근하지 않는다. 도구 화이트리스트만 본다.
- 심판 입장의 사용감은 "필요하면 도구 한 번 호출"로 동일하다. 조회·미스·저장은 Data Agent 내부 관심사다.
- Data Agent는 후보를 **발명하거나 보간하지 않는다.** 응답에 없는 값은 `null` + `confidence: "unknown"`로 남긴다.

### 6.2 요청·응답 스키마

```typescript
interface DataRequest {
  requestId: string;              // 멱등 키의 일부
  runId: string;
  roundId: string;
  callerId: string;               // 'referee:accommodation' | 'orchestrator:date_resolver'
  queryClass: string;             // 6.4 카탈로그
  purpose: 'exploration' | 'verification' | 'booking_readiness';
  packId: string;
  params: Record<string, unknown>;   // 도구 파라미터 (정규화 전 canonical 형태)
  maxStalenessSec?: number;          // 호출자가 더 엄격하게 요구할 때만
}

interface DataResponse<T> {
  payload: T;                     // 정규화 스키마 (FlightCandidate, HotelCandidate, …)
  evidence: {
    evidenceId: string;
    source: string;               // 'rakuten_travel' | 'amadeus' | …
    retrievedAt: string;
    validUntil: string | null;
    confidence: 'live' | 'estimated' | 'unknown';
    termsRef: string;
    cacheHit: boolean;
    degraded: boolean;            // 폴백 제공자 사용 여부
    fallbackReason?: string;
  };
  quota: { classCallsUsed: number; classCallsCap: number };
}
```

`purpose`가 이 계약의 핵심 스위치다. 같은 `queryClass`라도 탐색용이면 캐시를 쓰고, 검증용이면 실시간을 강제한다.

### 6.3 read-through 알고리즘

```
resolve(req):
  policy = CLASS_POLICY[req.queryClass]

  if policy.cache == 'never' or req.purpose in policy.liveOnlyPurposes:
      return callLive(req)                       # 캐시 우회. 저장도 하지 않음(never인 경우)

  key = sha256(canonicalize(req.packId, req.queryClass, req.params))
  rec = cache.get(key)

  fresh   = rec != null and rec.validUntil > now()
  trusted = rec != null and rank(rec.confidence) >= rank(policy.minConfidence[req.purpose])
  strict  = req.maxStalenessSec == null or age(rec) <= req.maxStalenessSec

  if fresh and trusted and strict:
      return hit(rec)                            # cacheHit = true

  live = callWithFallback(providers(req.packId, req.queryClass))
  norm = normalize(live)                         # 정규화 스키마 강제
  if policy.cache != 'never':
      cache.put(key, norm, ttl = policy.ttl, confidence = norm.confidence)
  return norm
```

`canonicalize`는 파라미터 정렬·날짜 정규화·좌표 반올림(5자리)·인원수 포함을 수행한다. **인원수를 키에서 빼면 안 된다** — 1인 기준 캐시를 6인 조회에 재사용하면 재고 부족을 놓친다(항공 4.1).

### 6.4 캐시 레코드

```json
{
  "key": "sha256:…",
  "packId": "jp-osaka",
  "queryClass": "hotel.vacancy_price",
  "payload": { "…": "정규화 스키마" },
  "source": "rakuten_travel",
  "retrievedAt": "2026-08-13T02:50:00Z",
  "validUntil": "2026-08-13T04:50:00Z",
  "confidence": "live",
  "termsRef": "rakuten:tos-2026-04",
  "providerRequestHash": "sha256:…",
  "rawPayloadRef": "s3://…/raw/…json",
  "internalOnly": true,
  "latencyMs": 412,
  "costUsd": 0.0
}
```

`rawPayloadRef`는 감사·재현용이며 **LLM 컨텍스트에 절대 들어가지 않는다.**

### 6.5 queryClass 정책 카탈로그

| queryClass | TTL | 캐시 키 | exploration | verification / booking | 근거 |
| --- | --- | --- | --- | --- | --- |
| `flight.cheapest_date` | 24h | `pack:origin:month` | 허용 | 허용 | 항공 15.1 |
| `flight.offers_search` | 2h | `origin:dest:dates:pax:filters` | 허용 | 허용 | 항공 15.1 |
| `flight.offer_price` | **never** | — | 금지 | **live 강제** | 항공 15.1 |
| `flight.group_inventory` | **never** | — | 금지 | **live 강제** | 항공 19.2 |
| `flight.risk` | 7d | `carrier:route:month` | 허용 | 허용(신뢰도 표기) | 항공 15.1 |
| `ref.airport_codes` / `ref.airline_codes` | 영구 | 전역 | 허용 | 허용 | 항공 15.1 |
| `transit.airport_transfer` | 30d | `airport:area:mode` | 허용 | live 권장 | 교통 15 |
| `geo.matrix` | 30d | `pack:matrixVersion` | 허용 | 버전 일치 시만 | 교통 19.1 |
| `intercity.timetable` | 7d | `origin:dest:date` | 허용 | live 강제 | 교통 15 |
| `transit.last_train` | 30d | `from:to` | 허용 | **live 강제** | 교통 19.2 |
| `transit.pass_rules` | Pack 갱신 | `packId:passId` | 허용 | 유효조건 live 확인 | 교통 19.2 |
| `transit.accessibility_route` | 7d | `from:to:mode` | 허용 | **live 강제 · fail-closed** | 교통 19.2 |
| `driving.fuel_toll` | 24h | `route` | 허용 | 허용 | 교통 15 |
| `transit.realtime_route` | 1h | 좌표 해시 | 허용 | live 강제 | 교통 15 |
| `hotel.area_profile` | Pack 갱신 | `pack:area` | 허용 | 허용 | 숙소 16 |
| `hotel.search` | 7d | `pack:area:type` | 허용 | 허용 | 숙소 16 |
| `hotel.vacancy_price` | 2h | `hotelId:in:out:guests` | 허용 | live 강제 | 숙소 16 |
| `hotel.room_combination` | **never** | — | 금지 | **live 강제 · fail-closed** | 숙소 20.1 |
| `hotel.all_in_price` | **never** | — | 금지 | **live 강제** | 숙소 20.1 |
| `hotel.details` | 30d | `hotelId` | 허용 | 안전 항목만 live | 숙소 16 |
| `hotel.price_band` (KR) | 분기 | `pack:area:type:season` | 허용(상단값) | **BOOKABLE 금지** | 숙소 5·20.5 |
| `geo.travel_time` | 30d | `hotelId:target` | 허용 | 허용 | 숙소 16 |
| `poi.hours` | 24h | `placeId:date` | 허용 | **live 강제 · fail-closed** | 기획서 19.6 |
| `poi.ticket` | 24h | `placeId:date` | 허용 | live 강제 | 기획서 9.3 |
| `dining.diet_support` | **never** | — | 금지 | **live 강제 · fail-closed** | 기획서 9.4·19.6 |
| `dining.reservation_slot` | 1h | `placeId:datetime:pax` | 허용 | **live 강제** | 기획서 19.6 |
| `weather.forecast` | 3h | `area:date` | 허용 | 허용 | 기획서 9.5 |
| `ref.fx` | 6h | `pair` | 허용 | 허용(조회시각 병기) | 기획서 9.6 |

`fail-closed` 표시 클래스는 검증 실패·조회 불가 시 **후보를 `winner`/`VERIFIED`/`BOOKABLE`로 승격할 수 없다.** `uncertainties`에 적는 것만으로 통과하지 못한다.

### 6.6 LLM 컨텍스트 투영

```
심판 프롬프트에 들어가는 것
  · candidateCard  — 정규화 스키마에서 쟁점 관련 속성만 추린 투영
  · evidenceId     — 근거 참조용 ID
  · 신뢰도 배지    — live / 추정 / 확인 필요
금지
  · 제공자 원본 JSON, 응답 전문, 제공자 고유 필드명
  · rawPayloadRef 내용
  · 다른 참여자의 설문 원문, 방 배정 선호 원문
```

기획서 19.10의 "conflict-relevant 속성 diff + evidence ID만 전달"을 Data Agent 응답 계층에서 구조적으로 강제한다.

### 6.7 쿼터·상한·멱등성

라운드당 도구 호출 상한(개별 심판 문서 기준을 그대로 집행):

| 심판 | 상한 |
| --- | --- |
| flight | `search_flights` 3, `price_flight_offer` 2, 기타 각 2 |
| transport | `get_route` 8, `evaluate_transit_passes` 2, 기타 각 3 |
| accommodation | `search_hotels` 4, `get_hotel_details` 8, `measure_location` 12, `evaluate_split_stay` 3 |
| activity / dining / scheduler / budget | 담당 팀 문서에서 확정 (미정, 14장) |

- 상한 도달 시 Data Agent는 `quotaExceeded`를 반환하고, 심판은 현재 후보로 판결한다. 무한 재조회를 막는다.
- 멱등 키: `sha256(runId, roundId, queryClass, canonicalParams, attempt)`. 재시도 시 같은 키로 dedupe하고 `tool_calls.response_hash`로 재현성을 확인한다.
- 제공자 호출 실패는 지수 백오프 3회 → 폴백 제공자 → 그래도 실패면 `degraded: true`와 함께 반환하거나, fail-closed 클래스면 실패로 올린다.

### 6.8 프리페치와 프리컴퓨트

- `prefetch` move는 Supervisor가 A1 재량으로 우선순위를 정하고, Data Agent가 백그라운드로 캐시를 채운다. 프리페치 결과는 **`exploration` 신뢰도로만 사용**된다.
- 인기 Pack의 POI 이동시간 행렬(200×200), 상위 숙소 100개 × 주요 지점 10개 실측은 배치로 미리 계산한다. 행렬은 `matrixVersion` + `modePolicyHash` + `originSetHash`로 버전을 고정하고, 입력이 바뀌면 즉시 `STALE`이다.

---

## 7. 심판 에이전트 공통 계약

| 항목 | 내용 |
| --- | --- |
| 입력 | Pack, 확정 날짜, 인원, 배정 예산, 그룹 하드 제약, 선행 라운드 handoff, 양보 크레딧, Supervisor 지시문 |
| 도구 | Pack이 주입한 화이트리스트만. 전부 Data Agent 경유 |
| 단계 | OPENING → SOURCING → (BRIEFING) → STATEMENT → CLASH → FACTCHECK → PROPOSAL → VERDICT |
| 출력 | `winner`, `rationale`(400자 이내), `disqualified[]`(사유 포함), `intensityProfile[]`, `dissent[]`, `budgetImpact`, `handoff`, `uncertainties[]`, `followups[]`, `toolCalls[]` |
| 강도 사용 | 쟁점 식별·절충 설계·`Sat ≥ 5.5` 하한·동점 타이브레이크에만. **후보 선택 금지** |
| 강도 보정 | 설문 대조 후 할인(하드 제약 일치 1.0 / 근거 없음 0.5 / 모순 0.25), 라운드당 0.8 초과 1회 |
| 금지 | 후보 발명, 미확인 수치 발화, 하드 제약 완화, 예약·결제, 방 배정 민감정보 노출 |
| 실격 노출 | 실격 후보도 사유와 함께 회의록에 게시 |

Supervisor가 `rerun`을 지시하면 심판은 지시문을 컨텍스트에 받아 CLASH부터 재개한다. 재개 사유는 회의록에 그대로 노출된다.

---

## 8. 사람 에이전트 병렬 실행 계약

| 항목 | 규칙 |
| --- | --- |
| 병렬 단위 | STATEMENT는 N명을 **한 배치**로 제출. 라운드당 1회 |
| 발언 순서 | 양보 크레딧 내림차순 (Orchestrator가 계산) |
| CLASH | 충돌축 클러스터링(코드) 후 진영별 최극단 1명만 LLM 호출. 2~3턴 |
| 비발언자 | "👍 동의" 경량 반응은 Scoring Engine이 계산. LLM 미사용 |
| 컨텍스트 격리 | 타인 페르소나는 요약본(하드 제약 + 상위 3개 선호)만. 설문 원문·방 배정 선호·건강·신념 상세는 주입 금지 |
| 출력 | `{stance, candidate_ids, condition, message}` JSON. 발화 3문장 이내, `max_tokens` 120 |
| 상한 | 라운드당 32턴. 3턴 연속 후보 순위 불변이면 조기 종료 |
| 미응답자 | 기본 페르소나로 대체하되 회의록에 명시. **가용 일정은 대체 불가** — 일정 계산에서 제외 |

병렬 실행은 비용 최적화 수단이지 탐색 다양성 보장 수단이 아니다. 스타일 분포가 한쪽으로 쏠리면 Orchestrator가 최소 1명을 주장형으로 강제 배정한다.

---

## 9. 최종 계획 문서 생성 에이전트

### 9.1 게이트

```
R6 종료 → Validation Pass(코드) → Booking Readiness(코드) → 문서 생성 에이전트
```

Validation Pass를 문서 에이전트에 합치지 않는다. 환각·모순·실현가능성 검증은 기계 판정이어야 하고(`external_id` 전수 검증, 예산 정합성, 일정 실현 가능성), 문서 에이전트는 **검증된 사실을 서술**하는 역할이다.

### 9.2 계약

| 항목 | 내용 |
| --- | --- |
| 입력 | 확정 `itinerary` JSON, `validation_report`, 예약 체크리스트, 라운드별 판결 요약, 만족도·양보 원장 |
| 출력 | 웹 뷰 본문, PDF, ICS, 공유 카드, 라운드 3줄 요약 |
| 상태 배지 | `DRAFT / PARTIAL / VERIFIED / BOOKABLE / BOOKED`를 항목마다 렌더. `PARTIAL`은 예약 행동을 유도하지 않는다 |
| 금지 | 새로운 사실 생성, 상태 승격, 누락 검증 은폐, 불확실성 삭제 |
| 프라이버시 | 공동 뷰는 최소 만족도·익명 우려·최종 배정만. 설문 원문·건강·신념·예산 상세·방 배정 선호·개인 만족도 상세는 본인 전용 뷰 |
| 우선순위 | ① 내 하드 제약 충족 상태 ② 내 대리인이 지킨/양보한 조건 ③ 실격·근거·불확실성 ④ 일정표·체크리스트 ⑤ 선택형 회의록 |

방 배정에 관해서는 **결과만 출력하고 이유를 쓰지 않는다.** "같은 방이 곤란한 상대"·코골이·수면 예민도는 어떤 형태로도(암시 포함) 드러나지 않는다.

---

## 10. 상태·이벤트 모델

### 10.1 이벤트

| 이벤트 | 발신 | 수신 | 핵심 페이로드 |
| --- | --- | --- | --- |
| `LEGAL_MOVES_OFFERED` | Orchestrator | Supervisor | `moves[]`, graph 요약, 남은 예산 |
| `DISPATCH_PROPOSED` | Supervisor | Orchestrator | `DispatchProposal` |
| `DISPATCH_ACCEPTED` / `DISPATCH_REJECTED` | Orchestrator | Supervisor | 위반 규칙 ID, 재요청 여부 |
| `MOVE_STARTED` / `MOVE_COMPLETED` / `MOVE_FAILED` | Orchestrator | 로그·대시보드 | moveId, latency, cost |
| `DATA_RESOLVED` | Data Agent | Orchestrator | evidence 메타, cacheHit, degraded |
| `VERDICT_SUBMITTED` | 카테고리 심판 | Orchestrator | verdict 전문 |
| `MECHANICAL_CHECK_RESULT` | Orchestrator | Supervisor | C5·C7 판정, 만족도·예산 수치 |
| `REVIEW_DECIDED` | Supervisor | Orchestrator | pass / rerun / resource + 사유 |
| `NODE_STALED` | Orchestrator | Supervisor | nodeIds, 원인 노드·버전 |
| `CONVERGENCE_EXCEEDED` | Orchestrator | Supervisor | 상한 종류, 차선책 후보 |
| `APPROVAL_REQUIRED_RAISED` | Orchestrator | Notification | 항목, 선택지(계산된 것만) |
| `RUN_BLOCKED` | Orchestrator | Notification | 미검증 안전 항목, 설명 |
| `PLAN_PUBLISHED` | Orchestrator | Notification | itineraryId, 상태 배지 요약 |

### 10.2 상태 전이

```
room:   DRAFT → COLLECTING → DATE_RESOLVING → READY → QUEUED → RUNNING → COMPLETED → ARCHIVED
                              ↘ DATE_BLOCKED → 방장 선택 → READY
                                              ↘ FAILED → (자동 재시도) → QUEUED
round:  PENDING → SOURCING → STATEMENT → CLASH → FACTCHECK → PROPOSAL → VERDICT → REVIEW
        REVIEW 실패 → CLASH (rerun_count++, ≤ 2)
dispatch: MOVES_OFFERED → PROPOSED → (REJECTED → PROPOSED) → ACCEPTED → EXECUTING → SETTLED
                                     └ REJECTED ×2 → FALLBACK_ORDER
node:   PROVISIONAL → VERIFIED → BOOKABLE → BOOKED
        └→ BLOCKED / STALE → 재계산 / FAILED
```

체크포인트는 **라운드 경계 + 디스패치 결정 단위**로 저장한다. 재개 시 마지막 `SETTLED` 디스패치 이후부터 실행한다.

---

## 11. 실패 처리와 수렴 상한

| 실패 | 처리 |
| --- | --- |
| Supervisor 호출 실패·파싱 실패 | 기본 위상 순서로 진행. 회의록에 "기본 규칙 진행" 표기 |
| Supervisor 제안 2회 거부 | 기본 순서 채택 + `fallbackUsed` 기록. run당 3회 누적 시 모델 티어 1회 상향 후 고정 |
| Supervisor가 C5·C7을 코드와 다르게 판정 | 코드 판정 채택 + 불일치 로그 + 프롬프트 회귀 테스트 대상으로 표시 |
| Data Agent 제공자 장애 | 백오프 3회 → 폴백 체인 → `degraded: true`. fail-closed 클래스면 라운드 실패 |
| 캐시 히트지만 만료·신뢰도 부족 | 재조회. 재조회 실패 시 `exploration`에서만 사용 |
| 도구 상한 초과 | 현재 후보로 판결 (`partialSourcing: true`). 단, 필수 검증 미완이면 판결·체크리스트 발행 금지 |
| 라운드 재심 2회 초과 | 차선책 채택 + 미해결 쟁점 기록. C5·C7은 재심이 아니라 재조달 |
| 전역 재계산 3회 초과 | 검증 가능한 최선안 + 충돌 설명을 `BLOCKED`로 제시 |
| run 30분 초과 | 부분 계획서 발행 + 사유 안내 + 재시도 예약 |
| 잡 3회 실패 | DLQ 이동 + 운영 알림 + 사용자에게 정직한 실패 통지 |

**침묵 금지 원칙**: 데이터 품질 하락·폴백 사용·검증 누락은 회의록과 계획서에 그대로 노출한다. 사용자가 검증할 수 없는 구조에서 침묵이 가장 큰 위험이다.

---

## 12. 관측·로그·데이터 모델 추가분

### 12.1 신규 테이블

| 테이블 | 핵심 컬럼 |
| --- | --- |
| `planning_nodes` | id, run_id, node_id, version, input_hash, dependency_versions(jsonb), status, confidence, evidence_refs(jsonb), locked, updated_at |
| `dispatch_decisions` | id, run_id, seq, legal_moves(jsonb), proposal(jsonb), validation_result(jsonb), rejected_rules(jsonb), fallback_used(bool), decided_by(supervisor/default), latency_ms, cost |
| `data_requests` | id, run_id, round_id, caller_id, query_class, purpose, canonical_hash, cache_hit(bool), confidence, degraded(bool), fallback_reason, provider, latency_ms, cost, response_hash, created_at |
| `approval_requests` | id, room_id, type(date_change/exclude_attendee/budget_over), options(jsonb), raised_at, responded_at, response |
| `review_decisions` | id, round_id, triggered(jsonb), decision, instruction, machine_check(jsonb), mismatch(bool) |

기존 `tool_calls`·`llm_usage`는 유지하고, `llm_usage`에 `promptVersion`, `cacheTokens`, `fallbackReason`, `purpose`를 추가한다 (기획서 19.10).

### 12.2 감시 지표

| 지표 | 목표·용도 |
| --- | --- |
| 디스패치 폴백률 | ≤ 10%. 높으면 LegalMove 표현력이나 Supervisor 프롬프트 문제 |
| C5·C7 판정 불일치율 | 0에 가까워야 함. 상승하면 프롬프트 회귀 |
| 캐시 적중률 (`purpose=exploration`) | 인기 Pack ≥ 70% |
| fail-closed 차단 건수 | 0이면 검증 게이트가 작동하지 않는다는 신호 |
| `degraded` 응답 비율 | 제공자 안정성 추적 |
| 라운드별 token / tool / latency budget 소진율 | p50·p95로 상한 재조정 |
| run당 총원가 | ≤ $0.6 (LLM + API) |

---

## 13. 테스트 케이스

| # | 시나리오 | 기대 동작 |
| --- | --- | --- |
| A1 | Supervisor가 R2를 R1b보다 먼저 실행하자고 제안 | V2 위반 → 거부 → 재요청 |
| A2 | Supervisor가 LegalMove에 없는 moveId 제시 | V1 위반 → 거부 |
| A3 | Supervisor 2회 연속 거부 | 기본 위상 순서 채택 + `fallbackUsed` 기록 + 회의록 표기 |
| A4 | Supervisor 호출 타임아웃 | 기본 순서로 계속 진행, run 실패 아님 |
| A5 | Supervisor가 만족도 수치를 직접 산출해 반환 | 해당 필드 폐기 + INV-2 위반 로그 |
| A6 | 코드가 C5 위반 1건 검출, Supervisor는 pass 판정 | 코드 채택 → 재조달, 불일치 로그 |
| A7 | 재심 2회 소진 후에도 C1 미충족 | 차선책 채택 + 미해결 쟁점 기록 |
| A8 | R2 숙소 변경 | Activity·Dining·Schedule·TransitPass·Budget `STALE`, A3 재량으로 순서 결정 |
| A9 | 전역 재계산 4회째 요구 | `CONVERGENCE_EXCEEDED` → 검증 가능 최선안 `BLOCKED` 제시 |
| A10 | `flight.offer_price`를 캐시에서 반환하려 시도 | 정책상 `never` → live 강제 |
| A11 | 6인 조회 캐시 키에 인원수 누락 | canonicalize 계약 위반 → 회귀 테스트 실패 |
| A12 | `hotel.room_combination` 조회 불가 | fail-closed → winner·BOOKABLE 승격 금지 |
| A13 | `dining.diet_support` 확인 실패, 대체 안전식 없음 | 후보 `BLOCKED`, 라운드 재조달 |
| A14 | 한국 Pack 추정 가격 후보가 최상위 점수 | 후보 유지, `BOOKABLE` 금지, 보수적 상단값으로 Budget 전달 |
| A15 | 심판 프롬프트에 제공자 원본 JSON이 포함됨 | 투영 계약 위반 → 빌드 검사 실패 |
| A16 | 도구 상한 초과 후 필수 검증 미완 | 판결·체크리스트 발행 금지, Chief에 보고 |
| A17 | Supervisor가 날짜 변경을 자동 실행하려 함 | V8 → `raise_approval`로 변환 |
| A18 | 예약 완료(BOOKED) 노드 변경 제안 | V4 거부 → 취소 비용·영향 범위 제시 후 승인 요청 |
| A19 | 페르소나 컨텍스트에 타인 방 배정 선호가 주입됨 | 격리 계약 위반 → 검사 실패 |
| A20 | Validation Pass 실패 상태에서 문서 생성 요청 | 게이트 차단, `PARTIAL` 계획서만 발행 |

---

## 14. 미결정 사항

| # | 항목 | 결정 필요 시점 |
| --- | --- | --- |
| 1 | Activity / Dining / Scheduler / Budget 심판의 도구 화이트리스트·호출 상한·정규화 스키마 | 각 담당 팀 구현서 작성 시 |
| 2 | Chief(Supervisor) 프롬프트 전문과 REVIEW 컨텍스트 투영 범위 | Supervisor 구현서 |
| 3 | `parallelGroup` 정의 범위 — 프리페치 외에 실제 병렬 실행 가능한 라운드 조합이 있는지 | Phase 0 프로토타입 실측 후 |
| 4 | Data Agent를 프로세스로 분리할지, 라이브러리로 인프로세스 호출할지 | W5 어댑터 착수 전 |
| 5 | 자연어 필드(리뷰·주의사항) 요약 정규화에 LLM을 쓸지 | Phase 2 |
| 6 | Supervisor 모델 티어와 폴백 티어 | 비용 실측 후 |
| 7 | `dispatch_decisions` 보존 기간과 민감정보 마스킹 규칙 | 프라이버시 정책 확정 시 |

---

## 마무리 — 이 아키텍처의 실패 조건

1. **Supervisor에 실행 권한을 주면 실패한다.** 순서를 정하는 것과 상태를 바꾸는 것은 다른 일이다. 상한 집행·수치 계산·기계 검증을 LLM에 넘기면 재현성과 비용 통제가 동시에 무너진다.
2. **캐시 히트를 무조건 신뢰하면 실패한다.** 확정가·그룹 재고·객실 조합·알레르기 대응은 캐시로 통과할 수 없다. `purpose`와 `queryClass` 정책이 이 경계를 지키는 유일한 장치다.
3. **Data Agent를 우회하면 실패한다.** 심판이 제공자 응답을 직접 보는 순간 정규화·신뢰도·프라이버시 경계가 전부 프롬프트 관습으로 강등되고, Pack 추가마다 심판 프롬프트를 손대야 한다.
