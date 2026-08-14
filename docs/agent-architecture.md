# 에이전트 아키텍처와 제어 계약 — 구현 계획

- **문서 버전**: v1.0 / 2026-08-13
- **상위 문서**: [travel-mediation-plan.md](travel-mediation-plan.md) (19장 전역 계약 우선)
- **연계 문서**: [공통 AgentSpec](agent-spec.md) · [ECS 기반 Codex Auth 런타임](ecs-codex-auth-agent-architecture.md) · [flight-referee-implementation.md](flight-referee-implementation.md) · [transport-referee-implementation.md](transport-referee-implementation.md) · [accommodation-referee-implementation.md](accommodation-referee-implementation.md)
- **다루는 범위**: 에이전트 인벤토리, 제어 평면 분리, 심판 호출 순서 결정 프로토콜, 결정론적 Data Gateway·Provider Connector 계약, 병렬 실행, 최종 문서 생성
- **권위 순서**: 기획서 19장 > **이 문서** > 개별 심판 문서의 예시. 같은 주제에서 충돌하면 위 순서를 따른다.

---

## 목차

1. [설계 결정 요약](#1-설계-결정-요약)
2. [에이전트 인벤토리](#2-에이전트-인벤토리)
3. [제어 평면 분리 — Orchestrator와 Supervisor](#3-제어-평면-분리--orchestrator와-supervisor)
4. [디스패치 프로토콜 — 호출 순서 결정](#4-디스패치-프로토콜--호출-순서-결정)
5. [라운드·심판 매핑과 의존성 그래프](#5-라운드심판-매핑과-의존성-그래프)
6. [Data Gateway 계약 — API 호출·DB 저장·조회](#6-data-gateway-계약--api-호출db-저장조회)
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
| **D2** | 심판은 캐시 DB나 외부 API를 직접 읽지 않는다. **결정론적 Data Gateway가 유일한 read-through 게이트웨이**다 (조회 → 미스 시 Connector 호출 → 정규화 → 저장 → 반환을 한 번의 typed tool 호출로 처리) | API 호출을 LLM 추론과 분리하여 정규화 스키마·TTL·신뢰도·fail-closed·시크릿 정책을 한 곳에서 강제한다. 기획서 10.3 "에이전트와 심판은 원본 API 형식을 절대 보지 않는다"를 지킨다 |
| **D3** | 캐시 히트를 무조건 사용하지 않는다. 요청의 **`purpose`(exploration / verification / booking_readiness)** 와 `queryClass` 정책이 캐시 사용 여부를 결정한다 | 확정가·그룹 재고·객실 조합·알레르기 대응은 캐시로 `VERIFIED`/`BOOKABLE`을 통과할 수 없다 (기획서 19.6, 항공 19.4, 숙소 20.1) |
| **D4** | 심판 인스턴스와 라운드는 1:1이 아니다. R1은 항공 → 교통 순차 2개이고, 교통패스는 R3 이후 재계산된다. Supervisor의 순서 조절은 **전역 Planning Graph의 STALE 재수렴까지 포함**한다 | 교통 정책이 숙소 가중치를 결정하고(숙소 1.4), 패스 손익은 확정 관광지에 의존한다(교통 5.2) |

Data Gateway는 독립 컴포넌트지만 Agent가 아니다. 내부에 모델 호출이나 확률적 판단이 없으며, Provider Connector·캐시·정규화·근거 저장·폴백 체인을 결정론적으로 실행한다. CandidateSearchAgent는 검색 계획만 제안하고 실제 외부 호출 권한은 갖지 않는다.

---

## 2. 에이전트 인벤토리

| 컴포넌트 | LLM | 인스턴스 | 호출자 | 핵심 산출물 |
| --- | --- | --- | --- | --- |
| **Orchestrator** | ✗ | 1 / run | Job Queue | 라운드·턴 진행, LegalMove 집합, 상한 집행, 체크포인트 |
| **Supervisor 심판** | ✓ | 1 / run | Orchestrator | `DispatchProposal`, `ReviewDecision`, 재심 지시문, 미해결 쟁점 서술 |
| **CategoryWatcherAgent** | ✓ | 공통 역할 1개 / 분야 인스턴스 7개 | Orchestrator | 분야 규칙 감시, `PASS`·`REVISE`·`BLOCK`, 수정 요청 |
| **사람(페르소나) 에이전트** | ✓ | N (병렬) | Orchestrator | `stance` JSON, 발화, 조건부 수용 |
| **Data Gateway + Provider Connector** | ✗ | Gateway 1개 + 제공자별 Connector | typed tool / Orchestrator | 정규화 후보·측정값 + 근거·캐시 레코드 |
| **Scoring Engine** | ✗ | 1 | Orchestrator | `Sat(i,c)`, Maximin 선택, 선호 손실도 계산 |
| **Constraint Optimizer** | ✗ | 1 | Scheduler 심판 | 검증된 top-K 전체 일정 |
| **Validation Pass** | ✗ | 1 / run | Orchestrator | 환각·모순·실현가능성 전수 검증 리포트 |
| **Booking Coordinator** | ✗ | 1 / run | Orchestrator | 예약 체크리스트, 의존성·만료·폴백 |
| **최종 문서 생성 에이전트** | ✓ | 1 / run | Orchestrator | 계획서 본문(웹/PDF), 회의록 요약 |
| **Notification** | ✗ | 1 | Orchestrator | 알림톡·푸시·이메일 |

Data Gateway가 노출하는 도메인별 typed tool과 담당 범위:

| 인스턴스 | 담당 `queryClass` 예시 | 제공자 우선순위 원천 |
| --- | --- | --- |
| `FlightData` | `flight.cheapest_date`, `flight.offers_search`, `flight.offer_price`, `flight.risk`, `flight.seatmap` | `Pack.providers.flight` |
| `TransportData` | `transit.route`, `transit.last_train`, `transit.pass_rules`, `intercity.timetable`, `driving.cost` | `Pack.providers.transit` |
| `AccommodationData` | `hotel.search`, `hotel.details`, `hotel.vacancy_price`, `hotel.price_band` | `Pack.providers.hotel` |
| `ActivityData` | `poi.search`, `poi.hours`, `poi.ticket`, `weather.forecast` | `Pack.providers.poi` |
| `DiningData` | `dining.search`, `dining.hours`, `dining.diet_support`, `dining.reservation_slot` | `Pack.providers.dining` |
| `GeoData` | `geo.travel_time`, `geo.matrix`, `geo.place_details`, `geo.geocode` | 전역 (Google 계열 + 지역 폴백) |
| `RefData` | `ref.fx`, `ref.airport_codes`, `ref.airline_codes`, `ref.pack_config` | 전역 · Pack 부트스트랩 |

### 2.1 CategoryWatcherAgent 인스턴스

`CategoryWatcherAgent`는 7개의 별도 Agent 정의가 아니다. 하나의 공통 `AgentSpec`·입출력 스키마에 분야별 `RulePack`을 결합해 실행한다.

| 인스턴스 | Rule Pack | 감시 범위 |
| --- | --- | --- |
| `FlightWatcher` | `FlightRulePack` | 항공편 실효 가격, 시간, 수하물, 좌석·재고 근거 |
| `TransportWatcher` | `TransportRulePack` | 공항·도시간·현지 교통, 막차, 패스 손익 |
| `AccommodationWatcher` | `AccommodationRulePack` | 위치, 객실 조합, 체크인·아웃, 동시 재고 |
| `ActivityWatcher` | `ActivityRulePack` | 목적급 콘텐츠, 운영시간, 예약, 체력·접근성 |
| `DiningWatcher` | `DiningRulePack` | 알레르기, 식이 제약, 영업시간, 예약 가능성 |
| `ScheduleWatcher` | `ScheduleRulePack` | 이동시간, 시간 중복, pace, 일자별 밀도 |
| `BudgetWatcher` | `BudgetRulePack` | 참가자별 실제 부담액, 공동비 분담, 예비비, 개인 상한 초과 여부 |

분야는 `category`와 `rulePackVersion`으로 식별하고 thread·캐시·평가 결과를 서로 분리한다. 공통 Agent는 후보를 조달하거나 확정하지 않으며, 해당 분야에 주입된 후보·주장·계획 변경이 Rule Pack을 지키는지만 감시한다.

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
| 변경 권한 분류 | `ChangeAuthorityPolicy`로 4단계 분류·실행 | 사유 코드와 대안 제안만 |
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
[INV-6] 날짜·기간·여행지·활성 참가자·개인 예산 상한·하드 제약·목적급 변경은
        기존 설문을 덮어쓰지 않고 새 SurveySnapshot을 만든다.
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

`type` 목록: `run_referee` · `rerun_round` · `resource_candidates`(재조달) · `recalc_node`(STALE 재계산) · `prefetch`(Data Gateway 캐시 워머) · `request_budget_transfer` · `raise_approval` · `finalize_plan` · `block_run`.

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
| V5 | `rerun ≤ 2` / 전역 재계산 `≤ 3` 준수 | 거부 후 반대 사유별 `FALLBACK_ORDER` 또는 `WAITING_USER`로 전환 |
| V6 | 토큰·비용·턴·도구 호출 상한 준수 | 축약 모드로 강등 |
| V7 | R0~R6 중 미실행 라운드가 있으면 `finalize_plan` 금지 | 거부 |
| V8 | 변경 사유를 `AUTO_REPLAN / PROXY_DELEGATED / USER_CONFIRMATION_REQUIRED / NEW_SURVEY_SNAPSHOT`으로 기계 분류 | 정책보다 낮은 권한으로 실행하면 거부. 새 스냅샷 또는 승인 잡 생성 |
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
| 1 | DateResolver (`flight.cheapest_date` 조회 포함) | 코드 + `FlightData` | 전원 설문 availability + `DurationAgreement.AGREED` |
| 2 | R0 프레이밍 (일정 확정·컨셉·예산 사용 우선순위) | Supervisor 주재 | 날짜 후보 ≥ 1 |
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
| **A5** | 상한 도달 시 이견과 대안 서술 | 종료 분기는 반대 사유 코드에 따라 Orchestrator가 결정 |

명시적 금지: 라운드 스킵·삭제, 날짜 자체 확정 변경, 만족도·예산 수치 산출, 하드 제약 완화, 후보 발명, 예약 실행.

### 4.7 한 라운드의 호출 시퀀스

```
Orchestrator ── computeLegalMoves ──▶ Supervisor
Supervisor   ── DispatchProposal ───▶ Orchestrator ── validate(V1~V10)
Orchestrator ── run_referee ────────▶ 카테고리 심판
심판         ── DataGatewayRequest ─▶ Data Gateway ── 캐시 조회 → (미스) Connector → 정규화 → 저장
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

## 6. Data Gateway 계약 — API 호출·DB 저장·조회

### 6.1 단일 게이트웨이 원칙

```
심판/Orchestrator ── DataGatewayRequest ──▶ Data Gateway
                                       ├─ 1. 캐시 조회 (정책이 허용할 때만)
                                       ├─ 2. 미스·만료·신뢰도 부족 → 제공자 호출 (Pack 우선순위 → 폴백)
                                       ├─ 3. 정규화 스키마로 변환
                                       ├─ 4. 캐시 저장 (금지 클래스 제외)
                                       └─ 5. 정규화 결과 + evidence 메타 반환
```

- 심판은 캐시 DB·제공자 SDK에 직접 접근하지 않는다. 도구 화이트리스트만 본다.
- 심판 입장의 사용감은 "필요하면 typed tool 한 번 호출"로 동일하다. 조회·미스·저장은 Data Gateway 내부 관심사다.
- Data Gateway와 Connector는 후보를 **발명하거나 보간하지 않는다.** 응답에 없는 값은 `null` + `confidence: "unknown"`로 남긴다.

#### 후보 검색 계획과 CandidateSearchAgent 호출 조건

표준 설문 필드는 결정론적 `SearchPlanner`가 API용 canonical filter로 변환한다. `CandidateSearchAgent`는 상시 호출하지 않으며 다음 경우에만 검색 계획을 제안한다.

| 호출 사유 | 조건 |
| --- | --- |
| `UNRESOLVED_FREE_TEXT` | 사용자 자유 입력을 등록된 지역·카테고리·접근성·편의 조건으로 하나만 결정하지 못함 |
| `INSUFFICIENT_VERIFIED_CANDIDATES` | Pack의 제공자 폴백까지 실행했지만 분야별 최소 검증 후보 수를 충족하지 못함 |
| `SEARCH_PLAN_EXHAUSTED` | 허용된 표준 query 조합을 모두 실행했지만 결과가 없음 |

```text
구조화 설문 → SearchPlanner(코드) → Data Gateway
자유 입력 미해결·후보 부족 → CandidateSearchAgent
                            → SearchPlanValidator(코드)
                            → Data Gateway
```

CandidateSearchAgent의 출력은 `CandidateQueryPlan` 제안뿐이다. 외부 API·DB를 직접 호출하거나 후보를 생성할 수 없고, 하드 제약을 제거·완화할 수 없다. 반경·시간대·소프트 선호 같은 완화안에는 변경 전후 값과 영향을 받는 참가자를 명시해야 하며, `SearchPlanValidator`가 허용한 query만 실행한다.

### 6.2 요청·응답 스키마

```typescript
interface DataGatewayRequest {
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

interface DataGatewayResponse<T> {
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  payload: T;                     // 정규화 스키마 (FlightCandidate, HotelCandidate, …)
  evidence: {
    evidenceId: string;
    source: string;               // 'rakuten_travel' | 'amadeus' | …
    retrievedAt: string;
    validUntil: string | null;
    confidence: 'live' | 'estimated' | 'unknown';
    authorityTier: 0 | 1 | 2 | 3; // queryClass 정책이 부여
    termsRef: string;
    cacheHit: boolean;
    degraded: boolean;            // 폴백 제공자 사용 여부
    fallbackReason?: string;
  };
  missingFields: string[];
  errors: Array<{ code: string; message: string; retryable: boolean }>;
  quota: { classCallsUsed: number; classCallsCap: number };
}
```

`purpose`가 이 계약의 핵심 스위치다. 같은 `queryClass`라도 탐색용이면 캐시를 쓰고, 검증용이면 실시간을 강제한다.

Provider Connector는 다음 공통 결과를 Data Gateway에 반환한다. 원본 제공자 JSON과 API 키는 이 경계를 넘지 않는다.

```ts
interface ProviderResult<T> {
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  provider: string;
  fetchedAt: string;
  expiresAt: string | null;
  data: T;
  evidenceIds: string[];
  missingFields: string[];
  errors: Array<{ code: string; message: string; retryable: boolean }>;
}
```

`PARTIAL`은 누락 필드를 명시해야 하고, fail-closed 필드가 누락되면 Data Gateway가 `FAILED` 또는 후보 `BLOCKED`로 승격한다. Agent는 `PARTIAL`을 `SUCCESS`로 바꿀 수 없다.

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
  "authorityTier": 3,
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
| `flight.offers_search` | 탐색 2h / 확정 10m | `origin:dest:dates:pax:filters` | 허용 | 10분 이내만 |
| `flight.offer_price` | **never** | — | 금지 | **live 강제** | 항공 15.1 |
| `flight.group_inventory` | **never** | — | 금지 | **live 강제** | 항공 19.2 |
| `flight.risk` | 7d | `carrier:route:month` | 허용 | 허용(신뢰도 표기) | 항공 15.1 |
| `ref.airport_codes` / `ref.airline_codes` | 영구 | 전역 | 허용 | 허용 | 항공 15.1 |
| `transit.airport_transfer` | 30d | `airport:area:mode` | 허용 | live 권장 | 교통 15 |
| `geo.matrix` | 30d | `pack:matrixVersion` | 허용 | 버전 일치 시만 | 교통 19.1 |
| `intercity.timetable` | 탐색 7d / 확정 24h | `origin:dest:date` | 허용 | 24시간 이내 또는 live |
| `transit.last_train` | 30d | `from:to` | 허용 | **live 강제** | 교통 19.2 |
| `transit.pass_rules` | Pack 갱신 | `packId:passId` | 허용 | 유효조건 live 확인 | 교통 19.2 |
| `transit.accessibility_route` | 7d | `from:to:mode` | 허용 | **live 강제 · fail-closed** | 교통 19.2 |
| `driving.fuel_toll` | 24h | `route` | 허용 | 허용 | 교통 15 |
| `transit.realtime_route` | 탐색 1h / 확정 6h 상한 | 좌표 해시 | 허용 | live 우선, 최대 6시간 |
| `hotel.area_profile` | Pack 갱신 | `pack:area` | 허용 | 허용 | 숙소 16 |
| `hotel.search` | 7d | `pack:area:type` | 허용 | 허용 | 숙소 16 |
| `hotel.vacancy_price` | 탐색 2h / 확정 15m | `hotelId:in:out:guests` | 허용 | 15분 이내 또는 live |
| `hotel.room_combination` | **never** | — | 금지 | **live 강제 · fail-closed** | 숙소 20.1 |
| `hotel.all_in_price` | **never** | — | 금지 | **live 강제** | 숙소 20.1 |
| `hotel.details` | 탐색 30d / 확정 7d | `hotelId` | 허용 | 7일 이내, 안전 항목 live |
| `hotel.price_band` (KR) | 분기 | `pack:area:type:season` | 허용(상단값) | **BOOKABLE 금지** | 숙소 5·20.5 |
| `geo.travel_time` | 탐색 30d / 확정 6h | `hotelId:target` | 허용 | 6시간 이내 |
| `poi.hours` | 24h | `placeId:date` | 허용 | **live 강제 · fail-closed** | 기획서 19.6 |
| `poi.ticket` | 24h | `placeId:date` | 허용 | live 강제 | 기획서 9.3 |
| `dining.diet_support` | **never** | — | 금지 | **live 강제 · fail-closed** | 기획서 9.4·19.6 |
| `dining.reservation_slot` | 탐색 1h / 확정 30m | `placeId:datetime:pax` | 허용 | 30분 이내 또는 live |
| `weather.forecast` | 3h | `area:date` | 허용 | 허용 | 기획서 9.5 |
| `ref.fx` | 6h | `pair` | 허용 | 허용(조회시각 병기) | 기획서 9.6 |

`fail-closed` 표시 클래스는 검증 실패·조회 불가 시 **후보를 `winner`/`VERIFIED`/`BOOKABLE`로 승격할 수 없다.** `uncertainties`에 적는 것만으로 통과하지 못한다.

공통 확정용 TTL은 항공 가격·좌석 10분, 숙소 가격·객실 15분, 예약 가능 여부 30분, 영업시간·대중교통 시간표 24시간, 예상 이동시간 6시간, 장소 기본정보와 미디어·평판 7일이다. 최종 일정 직전에 미디어·평판을 제외한 변동 데이터를 일괄 재검증한다. 후보별 최대 2회까지만 재검증하며, 계속 실패하면 검증 가능한 대체 후보로 전환한다.

가격이 이전 검증값 대비 `500bp(5%)` 이내로 변하면 최신 값으로 개인별 예산을 재계산하고 상한을 통과할 때 유지한다. `500bp`를 넘으면 대체 후보와 다시 비교한다. 개인 예산 상한 초과는 변동률과 무관하게 `BUDGET_BLOCKED`다. `PARTIAL`에서 가격·가용성·영업 여부·날짜·운영시간·위치·알레르기 안전·접근성처럼 해당 후보에 필요한 fail-closed 필드가 누락되면 차단한다.

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

기획서 19.10의 "conflict-relevant 속성 diff + evidence ID만 전달"을 Data Gateway 응답 계층에서 구조적으로 강제한다.

### 6.7 쿼터·상한·멱등성

라운드당 도구 호출 상한(개별 심판 문서 기준을 그대로 집행):

| 심판 | 상한 |
| --- | --- |
| flight | `search_flights` 3, `price_flight_offer` 2, 기타 각 2 |
| transport | `get_route` 8, `evaluate_transit_passes` 2, 기타 각 3 |
| accommodation | `search_hotels` 4, `get_hotel_details` 8, `measure_location` 12, `evaluate_split_stay` 3 |
| activity / dining / scheduler / budget | 담당 팀 문서에서 확정 (미정, 14장) |

- 상한 도달 시 Data Gateway는 `quotaExceeded`를 반환하고, 심판은 현재 후보로 판결한다. 무한 재조회를 막는다.
- 멱등 키: `sha256(runId, roundId, queryClass, canonicalParams, attempt)`. 재시도 시 같은 키로 dedupe하고 `tool_calls.response_hash`로 재현성을 확인한다.
- 제공자 호출 실패는 지수 백오프 3회 → 폴백 제공자 → 그래도 실패면 `degraded: true`와 함께 반환하거나, fail-closed 클래스면 실패로 올린다.

### 6.8 프리페치와 프리컴퓨트

- `prefetch` move는 Supervisor가 A1 재량으로 우선순위를 정하고, Data Gateway가 백그라운드로 캐시를 채운다. 프리페치 결과는 **`exploration` 신뢰도로만 사용**된다.
- 인기 Pack의 POI 이동시간 행렬(200×200), 상위 숙소 100개 × 주요 지점 10개 실측은 배치로 미리 계산한다. 행렬은 `matrixVersion` + `modePolicyHash` + `originSetHash`로 버전을 고정하고, 입력이 바뀌면 즉시 `STALE`이다.

---

## 7. CategoryWatcherAgent 공통 계약

| 항목 | 내용 |
| --- | --- |
| 입력 | `category`, `rulePackVersion`, 검증 후보, 관련 주장, 변경 전후 계획, 근거 ID, 코드 계산값 |
| 도구 | 직접 사용하지 않음. 추가 정보가 필요하면 구조화된 `EvidenceRequest`만 제안 |
| 단계 | INPUT_CHECK → RULE_CHECK → EVIDENCE_CHECK → IMPACT_CHECK → VERDICT |
| 출력 | `status`, `violatedRuleIds[]`, `unsupportedClaimIds[]`, `affectedPlanNodeIds[]`, `revisionRequests[]`, `uncertainties[]` |
| 강도 사용 | 쟁점 식별·절충 설계·`Sat ≥ 5.5` 하한·동점 타이브레이크에만. **후보 선택 금지** |
| 강도 보정 | 설문 대조 후 할인(하드 제약 일치 1.0 / 근거 없음 0.5 / 모순 0.25), 라운드당 0.8 초과 1회 |
| 금지 | 후보 조달·발명·확정, 미확인 수치 발화, 하드 제약 완화, 예약·결제, 타 분야 Rule Pack 적용, 민감정보 노출 |
| 실격 노출 | 실격 후보도 사유와 함께 회의록에 게시 |

Supervisor가 `rerun`을 제안하고 Orchestrator가 승인하면 Watcher는 변경된 입력과 같은 Rule Pack 버전으로 다시 검사한다. 재검사 사유는 회의록에 그대로 노출된다.

### 7.1 주장 사전 검사와 Logic Auditor 호출 조건

`LogicAuditorAgent`는 모든 주장에 호출하지 않는다. 먼저 결정론적 코드인 `ArgumentPrecheck`가 구조와 참조를 검사한다.

```text
Agent 주장
→ ArgumentPrecheck (코드)
   ├─ READY             → SymbolicReasoner (코드)
   ├─ NEEDS_STRUCTURING → LogicAuditorAgent → SymbolicReasoner
   └─ REJECTED          → 결과 폐기 또는 근거 재요청
```

`LogicAuditorAgent` 호출 사유는 다음 네 가지로 제한한다.

| 사유 코드 | 의미 |
| --- | --- |
| `MISSING_PREMISE` | 등록된 규칙에 필요한 전제가 구조화 결과에서 빠졌지만 기존 검증 사실에 존재할 가능성이 있음 |
| `MULTIPLE_RULE_MATCHES` | 동일 주장에 적용 가능한 등록 규칙이 둘 이상임 |
| `INCOMPLETE_BINDING` | 규칙 변수와 실제 사실의 연결이 완성되지 않았거나 값이 충돌함 |
| `UNRESOLVED_ENTITY` | “그 호텔”, “저녁 장소”처럼 대상을 하나의 검증된 ID로 정규화하지 못함 |

다음은 모호성이 아니라 유효하지 않은 입력이므로 Auditor를 호출하지 않는다.

```text
schema repair 1회 후에도 JSON Schema 위반
존재하지 않는 factId·ruleId
만료된 evidenceId
Agent 권한 밖의 참조
하드 제약 위반
검증된 사실과 직접 모순
```

동일 주장은 `premiseFactIds + ruleId + claimedParticipantId + claimedProposalId + claimedDecision + conclusion + planVersion`의 해시로 캐시한다. 해시가 같고 관련 근거가 `STALE`이 아니면 Auditor 결과를 재사용한다. Logic Auditor는 구조화된 claim을 같은 라운드의 `expectedVotes`와 대조하며, 새로운 사실이나 규칙을 만들 수 없고 기존 사실 연결·추가 근거 요청·결론 철회 중 하나만 제안한다.

---

## 8. 사람 에이전트 병렬 실행 계약

Proxy thread는 `tripId + planVersion + participantId + debateIssueId` 단위로 분리한다. 서로 다른 참가자뿐 아니라 동일 참가자의 서로 다른 논의 쟁점도 대화 문맥을 공유하지 않는다. 과거 선호 미반영 이력은 LLM thread가 아니라 Orchestrator의 `PreferenceLossLedger`에 저장하고 현재 쟁점과 관련된 기록만 주입한다.

Proxy Agent는 협상안마다 `SUPPORT | ACCEPTABLE | OPPOSE | USER_CONFIRMATION_REQUIRED` 중 하나와 반대 사유 코드를 반환한다. 전원 `SUPPORT` 또는 `ACCEPTABLE`이고 결정론적 검증 게이트를 모두 통과한 경우에만 Agent 전원 합의다. 사용자 투표를 모방한 다수결은 사용하지 않는다.

최초 협상안 이후 수정은 최대 2회, 투표는 총 3회다. 이를 소진한 뒤 `SOFT_PREFERENCE` 또는 `ALTERNATIVE_PREFERENCE`만 남으면 계층식 공정성 순위로 종료하고 이견을 보존한다. `HARD_CONSTRAINT` 안은 폐기하며 `PROTECTED_OBJECTIVE`, `FIVE_POINT_PREFERENCE`, `MIN_SATISFACTION` 문제는 `WAITING_USER`로 전환한다. 동일 쟁점의 사용자 요청 재개는 최대 2회이고, 세 번째부터는 Agent를 재실행하지 않고 검증된 선택지를 사용자에게 제공한다.

| 항목 | 규칙 |
| --- | --- |
| 병렬 단위 | STATEMENT는 N명을 **한 배치**로 제출. 라운드당 1회 |
| 발언 순서 | 결정론적 순환 순서. 선호 손실도를 발언권이나 말투 강화에 사용하지 않음 |
| CLASH | 충돌축 클러스터링(코드) 후 진영별 최극단 1명만 LLM 호출. 2~3턴 |
| 비발언자 | "👍 동의" 경량 반응은 Scoring Engine이 계산. LLM 미사용 |
| 컨텍스트 격리 | 타인 페르소나는 요약본(하드 제약 + 상위 3개 선호)만. 설문 원문·방 배정 선호·건강·신념 상세는 주입 금지 |
| 출력 | `{stance, candidate_ids, condition, message}` JSON. 발화 3문장 이내, `max_tokens` 120 |
| 상한 | 라운드당 32턴. 3턴 연속 후보 순위 불변이면 조기 종료 |
| 미응답자 | Agent 실행 자체를 시작하지 않음. 방장이 작성 요청·마감 연장·활성 참가자 제외 중 하나를 명시적으로 선택하며 기본 페르소나 대체와 자동 제외는 금지 |

병렬 실행은 비용 최적화 수단이지 탐색 다양성 보장 수단이 아니다. 스타일 분포가 한쪽으로 쏠리면 Orchestrator가 최소 1명을 주장형으로 강제 배정한다.

C2 공정성 검사는 `SCORED` 참가자의 `max(satisfactionBp) - min(satisfactionBp)`를 코드로 계산한다. `NOT_APPLICABLE`은 제외하고 계산 대상이 2명 미만이면 생략한다. 격차가 `2500bp(25%p)`를 초과하면 최저 만족도 참가자의 미반영 분야만 1회 재토론하며, 이후에도 남으면 검증된 최선안과 양보 내역을 보고한다. C2는 목적급·최소 만족도 게이트를 완화하지 않는다.

### 8.1 중요도별 양보 권한

| 구분 | 처리 | 사용자 확인 |
| --- | --- | --- |
| 하드 제약 | 협상·완화 불가. 위반 후보 제거 | 승인으로도 완화하지 않음 |
| 목적급 | Proxy가 임의로 포기할 수 없음 | 미반영·대체·부분 반영 모두 직접 승인 필요 |
| 5점 | Proxy는 일부 조정만 가능. 해당 참가자의 5점 취향이 전부 사라지면 중단 | 전체 미반영은 직접 확인 필요 |
| 3점 | Proxy가 조건부 양보 가능 | Plan v1에서 알리고 이의제기 기회 제공 |
| 1점 | 일정 최적화 과정에서 자동 조정 가능 | 최종 개인 요약에 표시 |
| 미선택 | 만족도·양보 계산에서 제외 | 알림 불필요 |

목적급 콘텐츠를 반영할 수 없거나 핵심 속성을 바꿔야 하면 계획을 확정하지 않고 `USER_CONFIRMATION_REQUIRED`로 전환한다. 5점 콘텐츠는 일부 조정할 수 있지만 해당 참가자의 5점 항목이 전부 미반영되면 직접 확인이 필요하다. Agent는 선택 가능한 대안과 각 대안의 비용·시간·다른 만족도 영향을 제안할 수 있지만, 사용자 확인이 필요한 쟁점을 대신 선택할 수 없다.

MVP 목적급 상한은 참가자당 2개이며 `maxPerParticipant` 정책값으로 분리한다. 입력은 선택사항이고 2개를 입력하면 1·2순위가 필수다. 두 항목 모두 목적 게이트를 적용하고 2순위를 자동 강등하지 않는다. 정규화 대상과 핵심 속성이 같은 여러 참가자의 목적은 하나의 Plan 슬롯에 연결할 수 있다. `ObjectiveCapacityValidator`가 중복 제거 후 배치 불가를 감지하면 `OBJECTIVE_CAPACITY_CONFLICT`를 생성하고, Plan v0는 유지하되 관련 사용자 승인 전 최종 확정을 막는다.

사용자가 즉시 응답하지 않으면 해당 쟁점을 `AWAITING_USER`로 저장하고 Agent 실행을 종료한다. 전체 계획은 `PROVISIONAL` 상태로 보관하며, 사용자가 돌아올 때까지 polling·주기적 Agent 호출을 하지 않는다.

```ts
type PendingDecision = {
  debateIssueId: string;
  participantId: string;
  planVersion: number;
  reason: string;
  optionIds: string[];
  affectedPlanNodeIds: string[];
  status: "AWAITING_USER";
  evidenceValidUntil?: string;
  reopenCount: number;
  createdAt: string;
};
```

사용자 응답 이벤트가 들어오면 `ImpactAnalyzer`가 `affectedPlanNodeIds`와 Planning Graph 의존성을 이용해 영향받는 노드만 `STALE`로 전환한다. 유효한 후보·근거·판결은 재사용하고, TTL이 지난 가격·재고·영업시간만 Data Gateway가 다시 확인한다.

#### 8.1.1 변경 권한 정책

Agent는 변경 이유와 대안을 구조화해 제안할 뿐, 실행 권한을 스스로 정하지 않는다. Orchestrator가 `packages/contracts/src/change-authority.ts`의 사유 코드 집합을 다음 우선순위로 분류한다. 여러 사유가 겹치면 더 높은 사용자 권한이 필요한 단계를 적용한다.

| 결정 | 적용 예 | 처리 |
| --- | --- | --- |
| `AUTO_REPLAN` | 미예약 동급 후보 교체, 순서 조정, 개인 상한 내 가격 변경, 1점 조정 | 영향을 받은 노드만 다시 계산·검증하고 차이를 기록 |
| `PROXY_DELEGATED` | 3점 조건부 양보, 5점 일부 조정 | 설문에서 위임한 범위 안에서 Proxy가 결정하고 결과에 알림 |
| `USER_CONFIRMATION_REQUIRED` | 목적급 미충족·대체·부분 반영, 5점 전체 미반영, 최소 만족도 미달, 비용 분담 변경, 최종안의 실질 변경, BOOKED 변경, 취소 수수료·중복 예약 위험, 핵심 시간 속성 변경, 검증 상태 하락 | 영향받는 참가자에게 변경 전후 비용·이동시간·만족도·예약 영향을 보여주고 응답까지 `AWAITING_USER` |
| `NEW_SURVEY_SNAPSHOT` | 개인 예산 상한, 날짜·기간, 여행지, 활성 참가자, 알레르기·접근성·절대 불가, 목적급 추가·교체, BOOKED 항목 때문에 전체 구조 재설계 | 기존 스냅샷을 보존하고 새 응답 버전·스냅샷 생성 후 영향 노드를 `STALE` 처리 |

`AUTO_REPLAN`은 미예약 상태, 하드 제약 충족, 개인 예산 상한 이내, 목적급 핵심 속성 유지, 최소 만족도 유지, 검증 상태 비하락, 영향 노드 재검증을 모두 만족해야 한다. MVP는 예약·결제를 수행하지 않으므로 단순 가격 상승은 개인 상한을 넘지 않으면 자동 재계산하되 이전 가격과 최신 가격을 함께 표시한다.

사용자 확인도 하드 제약 위반이나 fail-closed 검증 실패를 통과시키지 못한다. `BOOKABLE → PARTIAL`처럼 검증 상태가 낮아진 변경은 확인 대상으로 분류하지만, 필수 필드가 빠진 `PARTIAL` 후보는 확인 후에도 확정할 수 없다.

```text
사용자 응답
→ PendingDecision 조회
→ 근거 TTL 확인
→ 영향 노드만 STALE
→ 해당 쟁점 Proxy thread 새로 생성
→ 부분 재토론·재검증
→ planVersion 증가
```

동일 쟁점의 Agent 재개는 최대 2회로 제한한다. 세 번째 변경부터는 Agent 토론을 다시 실행하지 않고 사용자가 검증된 대안 중 직접 선택하도록 한다. 날짜·여행지·전체 예산·참가자·하드 제약처럼 계획의 기반이 바뀐 경우에만 전역 영향 분석을 수행한다.

### 8.2 PreferenceLossLedger

취향 미반영과 부분 반영은 LLM 대화에만 남기지 않고 코드 원장에 기록한다. `선호 손실도(preferenceLoss)`는 실제 돈이나 벌금이 아니라, 같은 참가자에게 중요한 취향의 손실이 반복되는지 확인하기 위한 내부 공정성 지표다.

```ts
type PreferenceLossLedgerEntry = {
  participantId: string;
  debateIssueId: string;
  planVersion: number;
  preferenceId: string;
  importance: 5 | 3 | 1;
  originalRequest: string;
  finalDecision: string;
  status: "NOT_REFLECTED" | "PARTIALLY_REFLECTED" | "REPLACED" | "DEFERRED";
  acceptedBy: "AUTO_POLICY" | "PROXY_DELEGATION" | "USER_CONFIRMATION";
  receivedCompensation?: {
    type: "ALTERNATIVE" | "BUDGET" | "TIME" | "NEXT_CHOICE";
    description: string;
  };
};
```

```text
PreferenceLoss(i, p)
= Importance(i, p) × (1 - Fulfillment(i, p))

ParticipantPreferenceLoss(i)
= Σ PreferenceLoss(i, p)
```

예를 들어 중요도 5의 항목은 완전 반영 시 `0`, 부분 반영 시 `2.5`, 미반영 시 `5`다. `NO_PREFERENCE`는 계산에서 제외한다. 목적급 항목은 이 숫자로 상쇄하지 않고 별도 목적 게이트를 계속 적용한다.

`PreferenceLossLedger`는 버전별 결정 이력을 변경 불가능하게 보존하지만, 현재 선호 손실도는 현 Plan 버전에서 다시 계산한다. 같은 미반영을 버전마다 중복 누적하지 않으며 Plan이 개선되면 현재 손실도도 내려간다. 값은 여행 단위로만 사용하고 다음 여행에 이월하지 않는다.

MVP에서는 선호 손실도를 만족도, Maximin 또는 평균 점수에 섞지 않는다. 현재 Plan의 최종 결과를 기준으로 그 단계까지 동일한 후보의 공정성 타이브레이커에만 사용한다. 라운드 순서나 연속 횟수를 계산하지 않으며 참가자의 발언권이나 Proxy의 공격성도 변경하지 않는다.

### 8.3 SatisfactionScorer

만족도 계산은 LLM Agent가 아니라 결정론적 코드인 `SatisfactionScorer`가 담당한다.

```text
fulfillment = 충족 1.0 / 부분 충족·대체 0.5 / 미충족 0.0

CategorySat(i, c)
= Σ(세부 중요도 × fulfillment) / Σ(응답한 세부 중요도)

Sat(i)
= 100 × Σ(분야 중요도 × CategorySat(i, c)) / Σ(응답한 분야 중요도)
```

- 분야와 세부 중요도는 각각 `5·3·1`을 사용한다.
- 미응답은 각 분모에서 제외하고, 하드 제약 위반 후보는 계산 전에 실격시킨다.
- 목적급 항목은 총점으로 상쇄하지 않고 `USER_CONFIRMATION_REQUIRED` 게이트로 처리한다. 5점 항목의 차단 여부는 참가자의 `goalMode` 정책에 따른다.
- 일반 취향의 `effectiveImportance = categoryPriority × detailImportance`를 계산하고 `25 → 15 → 9 → 5 → 3 → 1` 계층으로 비교한다.
- 선택 순서는 `하드 제약 → 참가자별 목적 게이트 → 목적 유형별 최소 만족도 → 실효 중요도 계층별 Maximin·평균 → 스타일 적합도 → 선호 손실도 → 비용·동선`이다.
- `preferenceLoss`는 만족도 식에 넣지 않고 그 전까지 동일한 대안의 타이브레이커로만 사용한다.

```text
CandidatePreferenceOrder
= PURPOSE
  > EFFECTIVE_25
  > EFFECTIVE_15
  > EFFECTIVE_9
  > EFFECTIVE_5
  > EFFECTIVE_3
  > EFFECTIVE_1
```

같은 실효 중요도에서는 `categoryPriority DESC → intraTierRank ASC`를 적용한다. 여러 참가자가 충돌하면 해당 계층 안에서 `max(min TierFulfillment(i))`를 먼저 적용하고 동급이면 `max(avg TierFulfillment(i))`를 적용한다. 하위 계층의 충족 수나 전체 만족도 총합으로 상위 계층의 손실을 상쇄하지 않는다. 전체 `Sat(i)`는 목적 유형별 하한 판정과 사용자 설명에 계속 사용한다.

목적급 비교는 수치 오차 없이 개별 항목마다 `FULL > APPROVED_SUBSTITUTE > UNMET` 순서를 적용하고 `UNMET`은 최종 확정을 차단한다. 일반 취향 계층의 동급 판정은 다음 버전 정책을 사용한다.

```ts
const PREFERENCE_TIE_POLICY_V1 = {
  tierToleranceBp: 500, // 5%p; 경계값 포함
} as const;
```

```text
TierSat(i, tier)
= 10000 × Σ fulfillment(i, p) / count(preferences(i, tier))
```

- 해당 계층에 취향이 없는 참가자는 집계에서 제외한다.
- 취향이 있지만 미반영이면 `0`으로 포함한다.
- 집계 대상이 없으면 계층을 건너뛴다.
- 먼저 후보별 `min TierSat`를 비교하고 차이가 `500bp` 이내면 동급으로 본다.
- 최소값이 동급일 때 `avg TierSat`를 비교하고 차이가 `500bp` 이내면 다음 계층으로 이동한다.
- 화면에 반올림된 점수가 아니라 정수 원본으로만 판정한다.

```ts
function compareTierMetric(aBp: number, bBp: number) {
  const differenceBp = aBp - bBp;
  if (Math.abs(differenceBp) <= PREFERENCE_TIE_POLICY_V1.tierToleranceBp) {
    return "TIE" as const;
  }
  return differenceBp > 0 ? ("A" as const) : ("B" as const);
}
```

MVP 만족도 정책은 다음과 같이 코드 설정으로 관리한다.

```ts
const SATISFACTION_POLICY_V1 = {
  TOGETHERNESS: {
    passMin: null,
    includeInMaximin: false,
    includeInAverageWhenScored: true,
  },
  BALANCED: {
    targetMin: 60,
    userConfirmationBelow: 40,
    includeInMaximin: true,
  },
  CONTENT_DRIVEN: {
    passMin: 60,
    requirePurposeGate: true,
    includeInMaximin: true,
  },
} as const;
```

| 목적 유형 | 만족도 처리 |
| --- | --- |
| `TOGETHERNESS` | 점수 하한 없음; Maximin에서 제외하고 점수가 있을 때 평균에만 포함 |
| `BALANCED` | `60` 이상 목표, `40~59.99` 재탐색·재토론, `40` 미만 사용자 확인 |
| `CONTENT_DRIVEN` | 목적급 게이트 통과와 `60` 이상 모두 필요 |

Maximin은 보호 대상 참가자 사이에서 후보 순위를 결정하고, 목적 유형별 하한은 선택된 후보를 최종 일정으로 확정할 수 있는지 판정한다. 모든 후보가 하한 미달이어도 가장 높은 후보를 자동 확정하지 않는다. 목적급 승인 게이트는 이 판정과 독립적으로 적용하며, 불완전 응답은 그보다 앞선 설문 완료 게이트에서 차단한다.

Proxy Agent에는 `goalMode`, `goalStatus`, `preferenceScore`, `scoreCanBlockPlan`을 함께 전달한다. `TOGETHERNESS` Proxy는 낮은 취향 점수만을 근거로 일정을 차단할 수 없다.

#### FulfillmentEvaluator

`FulfillmentEvaluator`는 `SatisfactionScorer` 앞에서 실행하는 결정론적 코드 모듈이다. LLM Agent는 `fulfillment` 숫자를 확정할 권한이 없다.

```text
CandidateSearch Agent
→ 후보와 출처 근거 제출
→ Verification Code가 후보 속성 검증
→ Schedule Agent가 itinerarySlotId 배정
→ FulfillmentEvaluator가 RulePack 적용
→ SatisfactionScorer가 점수 계산
```

판정 우선순위:

```text
하드 제약 위반       → DISQUALIFIED
일정 미포함          → 0 / NOT_SCHEDULED
근거·Rule 미확인     → 0 / UNVERIFIED 또는 NO_ALLOWED_RULE
핵심 속성 전체 충족  → 1 / FULL_MATCH
허용된 일부·대체 충족 → 0.5 / PARTIAL_ATTRIBUTE_MATCH 또는 APPROVED_SUBSTITUTE
```

각 결정에는 `preferenceId`, `candidateId`, `itinerarySlotId`, `matchedAttributeIds`, `missingAttributeIds`, `evidenceIds`, `ruleId`, `ruleVersion`을 저장한다. 명시적 횟수 요구가 없는 동일 취향에 여러 일정이 매칭되어도 기본값은 `max(fulfillment)`이며 합산해 `1`을 넘기지 않는다. `requestedCount > 1`인 요청만 `MultiplicityResolver` 규칙을 적용한다. 목적급 항목의 `0.5`는 사용자 승인 전까지 목적 게이트를 통과시키지 않는다.

카테고리별 `RulePack`은 다음 책임을 가진다.

| RulePack | 완전 반영 기준 | 부분 반영·대체 기준 |
| --- | --- | --- |
| `FoodRulePack` | 음식 유형·필수 식이 조건·방문 가능 시간 | 검증된 동일 음식 계열 또는 허용된 대체 음식 |
| `LodgingRulePack` | 숙소 유형·실제 객실·전망·위치 속성 | 하드 조건을 지킨 상태의 일부 핵심 속성 또는 허용된 인접 대체 |
| `ActivityRulePack` | 장소·경험 유형·운영·예약·동선 | 같은 경험 계열의 허용된 대체 장소 또는 일부 핵심 경험 |

Agent가 제안한 새로운 대체 관계는 해당 실행 중 즉시 규칙으로 승격하지 않는다. 사용자 승인이나 운영자 검토 후 새 `ruleVersion`으로 등록해야 이후 계산에서 재사용할 수 있다.

#### MultiplicityResolver

동일 취향의 반복 횟수는 `MultiplicityResolver` 결정론적 코드가 관리한다. Agent가 참가자 동의를 추정하거나 `requestedCount`를 변경할 수 없다.

```text
requestedCount = 1
→ planningCount = 1

requestedCount > 1 && activeParticipantIds 전원 승인
→ planningCount = requestedCount

requestedCount > 1 && 명시적 비동의 존재
→ planningCount = 1
→ Plan v0 후 DEFERRED_MULTIPLICITY 쟁점 생성

승인 응답 누락
→ 설문 완료 게이트 미통과
```

원래 `requestedCount`와 현재 `planningCount`는 별도 필드다. 불일치 상태에서는 `verifiedCount`를 원래 요청과 비교해 `0 / 0.5 / 1` 반영도를 계산하고, 차이를 `PreferenceLossLedger`에 기록한다. 초기 일정을 본 뒤 `debateIssueId`에 해당하는 횟수 부분만 다시 열 수 있으며 Agent 재개는 최대 2회다.

목적급 반복 요청은 Plan v0에 부분 반영 상태로 존재할 수 있지만 최종 확정 게이트는 통과하지 못한다. 요청자가 축소안을 승인하거나 전원 합의로 횟수를 반영해야 한다.

#### 점수 부재와 집계 계약

점수 부재를 산술 값으로 다루지 않기 위해 `SatisfactionScorer`는 원시 `number | null` 대신 식별 가능한 공용체를 반환한다.

```ts
type PreferenceScoreResult =
  | { status: "SCORED"; valueBp: number }
  | { status: "NOT_APPLICABLE"; reason: "NO_PREFERENCES" };
```

`valueBp`는 `0~10000` 범위의 정수다. `SCORED`의 0점은 입력한 취향이 하나도 반영되지 않았다는 뜻이고, `NOT_APPLICABLE`은 계산할 취향이 없다는 뜻이다. 설문 미완료인 `NOT_STARTED`는 점수 결과가 아니므로 Orchestrator가 점수 계산 전에 차단한다.

집계 전용 함수는 다음 불변조건을 지킨다.

```text
Maximin 입력 = SCORED && goalMode != TOGETHERNESS
평균 입력    = SCORED
양보 누적    = SCORED인 취향의 미반영에만 적용
빈 입력      = 숫자 0이나 NaN이 아니라 NOT_APPLICABLE 반환
```

계산 가능한 참가자가 한 명도 없으면 만족도 최적화 단계를 생략하고 `하드 제약 → 여행 목적 → 응답한 스타일 적합도 → 비용·이동 Pareto 제거 → 최대 개인 예산 사용률 → 최대 하루 이동시간 → 총비용 → 총이동시간 → 예약·검증 신뢰도` 순으로 결정한다. 스타일 응답도 없으면 해당 단계 역시 생략한다. SQL의 `AVG(NULL)` 같은 암묵적 동작에 의존하지 않고 애플리케이션 코드에서 대상을 명시적으로 필터링한다.

#### BudgetEngine

예산 계산과 통과 판정은 Agent가 아니라 결정론적 `BudgetEngine`이 수행한다. 그룹 평균이나 최저 예산자의 단일 상한을 사용하지 않고 활성 참가자별 실제 부담액을 각각 검증한다.

```text
ParticipantCost(i)
= personalTransport
  + allocatedSharedCosts
  + personalDining
  + joinedActivities
  + personalUpgrades
  + reserve

PASS iff 모든 i에 대해 ParticipantCost(i) <= PersonalBudgetCap(i)
```

- 공동 숙소·차량·예약비는 `beneficiaryIds`의 인원수로 균등 분담한다.
- 개인 업그레이드 차액은 요청자에게만 배정한다.
- 다른 참가자의 비용 보조는 명시적인 `CostSharingAgreement` 없이는 허용하지 않는다.
- 예산 검사에는 `confirmedCost + provisionalUpperCost + reserve`를 사용한다.
- `reserveRate = max(10%, providerUncertaintyRate)`를 기본값으로 한다.
- 한 명이라도 초과하면 `BUDGET_BLOCKED`이며 LLM Agent가 오차나 평균값을 이유로 통과시킬 수 없다.

분야별 예산을 사전 배분하지 않는다. `개인 상한 - 필수 기본비 - 예비비`로 참가자별 남은 예산을 계산하고 `목적급 → 분야 중요도×세부 중요도 → 최저 만족도 보호 → 비용 대비 만족도 개선` 순으로 요구를 검토한다. 그 단계까지 동급인 요구만 선호 손실도로 공정성을 보정한다. 같은 만족도를 제공하면 더 저렴한 후보를 선택하며 남은 돈을 소진하기 위한 선택은 금지한다. 개인 상한 초과는 새 사용자 입력과 새 `SurveySnapshot` 없이는 완화할 수 없다.

#### CostTravelComparator

모든 선호 계층, 스타일 적합도와 선호 손실도까지 동급인 후보는 결정론적 `CostTravelComparator`가 비교한다.

```ts
const COST_TRAVEL_TIE_POLICY_V1 = {
  budgetUtilizationToleranceBp: 500, // 5%p; 경계 포함
  maxDailyTravelDifferenceToleranceMinutes: 30, // 후보 간 차이; 경계 포함
} as const;
```

```text
1. Pareto 지배 후보 제거
2. max_i(BudgetCheckAmount(i) / PersonalBudgetCap(i)) 비교
   - 500bp 초과 차이면 낮은 후보 선택
3. max_(i, day)(TravelMinutes(i, day)) 비교
   - 30분 초과 차이면 짧은 후보 선택
4. Σ_i BudgetCheckAmount(i) 최소화
5. Σ_(i, day) TravelMinutes(i, day) 최소화
6. 예약·검증 신뢰도 비교
```

Pareto 지배는 모든 참가자의 비용 벡터와 최대·총 이동시간이 모두 나쁘지 않고 하나 이상 확실히 좋은 경우에만 성립한다. 이동시간은 탑승·도보·예상 대기·환승 버퍼의 합이며 관광·식사·휴식은 제외한다. 비용은 `BudgetEngine`, 이동시간은 `ScheduleOptimizer`의 검증된 정수 출력만 사용한다.

`30분`은 하루 이동시간 상한이 아니라 `abs(A.maxDailyTravelMinutes - B.maxDailyTravelMinutes)`의 동급 허용값이다. 참가자의 체력·접근성에서 파생된 실제 하루 이동 상한은 별도 하드 제약이며 위반 후보는 `CostTravelComparator` 실행 전에 실격시킨다.

#### ReliabilityComparator

비용·동선까지 동급인 후보의 예약·검증 신뢰도는 가중합하지 않고 사전식 키로 비교한다.

```text
requiredFieldsComplete DESC
→ readinessRank DESC
→ minimumAuthorityTier DESC
→ minimumFreshnessBp DESC
→ nonDegraded DESC
→ optionalCoverageBp DESC
→ canonicalCandidateId ASC
```

예약 필요 후보는 `BOOKABLE`, 예약 불필요 후보는 운영 여부·영업시간을 확인한 `VERIFIED` 이상만 최종 후보가 될 수 있다. 필수 필드가 누락된 `PARTIAL`과 `BLOCKED/FAILED`는 비교 대상이 아니다. `BOOKED` 승격 권한은 사용자 예약 이벤트에만 있다.

출처 등급은 queryClass별 정책으로 `3=공식 API·공식 예약·실시간 판매`, `2=공식 홈페이지·계약 OTA`, `1=검증된 지도·최신 Pack`, `0=일반 웹·리뷰·검색 요약`을 사용한다. 가격·재고·예약 가능성은 최소 2등급이다. Agent는 등급을 생성하거나 수정하지 않는다.

```text
FreshnessRemainingBp
= clamp(0, 10000,
    10000 × (expiresAt - comparisonAt) / (expiresAt - retrievedAt))
```

핵심 근거 집계는 평균이 아닌 최솟값을 사용하며 모든 후보에 같은 `comparisonAt`을 적용한다. LLM 토큰 확률, 근거 수, 리뷰 수는 신뢰도 입력이 아니다. ID 비교는 완전 동률의 재현성만 보장한다.

#### StyleFitEngine

분야·세부 `5·3·1`은 콘텐츠 우선순위에만 사용하고, 1~7 여행 스타일은 일정 구성과 모든 세부 취향 비교가 끝난 동급 후보의 보조 판정에만 사용한다. 두 값을 곱하지 않는다.

```text
StyleFitBp(i, candidate, axis)
= round(10000 × (1 - abs(userValue - candidateStyle) / 6))
```

후보·Plan 스타일 태그는 Destination Pack 또는 검증 코드의 버전 있는 데이터여야 한다. 미응답은 `NOT_APPLICABLE`이며 0점으로 집계하지 않는다. 비교는 참가자별 최소 적합도 최대화 후 응답자 평균 최대화 순서다. 스타일 적합도는 만족도 하한에 더하지 않고 선호 손실도보다 먼저 적용한다. 음식↔숙소 소비 성향 축은 분야 중요도와 중복되어 MVP에서 제거한다. 하드 제약 위반 후보는 StyleFit 계산 전에 실격한다.

#### ScheduleOptimizer

MVP는 결정론적 `CONSTRAINT_FIRST_BEAM_SEARCH`를 사용한다. `CategoryWatcherAgent`의 Scheduler 인스턴스는 `ScheduleHints`만 제안하며 시간표를 확정하지 않는다.

```text
하드 제약 필터
→ 항공·도시간 교통·체크인·예약시간 고정
→ 목적급 콘텐츠 배치
→ 날짜·지역별 후보 클러스터링
→ 15분 슬롯 Beam Search
→ top 3 생성
→ 계층식 공정성 비교
→ PlanValidator
```

정책값은 `beamWidth=30`, `outputPlanCount=3`, `candidateLimitPerCategoryPerDay=10`이다. 하루 주요 콘텐츠 수는 `REST=1`, `BALANCED=2`, `ACTIVE=3`이며 식사·체크인·체크아웃·단순 이동은 제외한다. 이동 버퍼는 `max(10분, 예상 이동시간×20%)`이고 항공·도시간 이동의 여유시간은 분야별 하드 규칙을 사용한다. 같은 정규화 입력과 정책 버전에는 같은 결과가 나와야 한다.

### 8.4 사용자 알림 시점

```text
Plan v0 생성
→ 그룹에 논의 예정 쟁점 공개
→ Proxy·Supervisor 부분 토론
→ Plan v1 생성
→ 각 참가자에게 본인의 반영·양보·대체 내역 공개
→ 목적급 및 goalMode상 확인이 필요한 5점 미반영은 직접 승인
→ 이의가 제기된 부분만 재토론
→ 최종 일정 검증
```

공개 범위:

- 개인 화면: 본인의 반영·부분 반영·미반영 항목, 이유, 대체 보상 상세
- 그룹 화면: 충돌 항목, 결정 결과, 검증 가능한 결정 이유
- 기본 비공개: 다른 참가자의 전체 프로필, 개인별 선호 손실 이력과 `preferenceLoss`

다른 참가자의 선호 손실도를 순위처럼 노출하지 않는다. 공정성 계산에는 사용하지만 감정적 경쟁을 만들 수 있는 개인별 원점수는 Orchestrator 내부 값으로 유지한다.

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

> MVP는 방 배정 선호를 수집하지 않는다([development-and-deployment.md](development-and-deployment.md) 6장). 따라서 문서 에이전트는 객실 구성 충족 여부와 침실 분리 여부까지만 서술하고, 개인별 배정 사유는 애초에 존재하지 않는다. 위 금지 규칙은 Phase 2 재도입 시 그대로 적용된다.

---

## 10. 상태·이벤트 모델

### 10.1 이벤트

| 이벤트 | 발신 | 수신 | 핵심 페이로드 |
| --- | --- | --- | --- |
| `LEGAL_MOVES_OFFERED` | Orchestrator | Supervisor | `moves[]`, graph 요약, 남은 예산 |
| `DISPATCH_PROPOSED` | Supervisor | Orchestrator | `DispatchProposal` |
| `DISPATCH_ACCEPTED` / `DISPATCH_REJECTED` | Orchestrator | Supervisor | 위반 규칙 ID, 재요청 여부 |
| `MOVE_STARTED` / `MOVE_COMPLETED` / `MOVE_FAILED` | Orchestrator | 로그·대시보드 | moveId, latency, cost |
| `DATA_RESOLVED` | Data Gateway | Orchestrator | evidence 메타, cacheHit, degraded |
| `VERDICT_SUBMITTED` | 카테고리 심판 | Orchestrator | verdict 전문 |
| `MECHANICAL_CHECK_RESULT` | Orchestrator | Supervisor | C5·C7 판정, 만족도·예산 수치 |
| `REVIEW_DECIDED` | Supervisor | Orchestrator | pass / rerun / resource + 사유 |
| `NODE_STALED` | Orchestrator | Supervisor | nodeIds, 원인 노드·버전 |
| `CONVERGENCE_EXCEEDED` | Orchestrator | Supervisor | 상한 종류, 차선책 후보 |
| `DURATION_AGREED` | Survey Service | Orchestrator | version, nights, days, participantConfirmations |
| `MULTIPLICITY_DECIDED` | Survey Service | Orchestrator | preferenceId, requestedCount, planningCount, approvals, status |
| `SURVEY_SNAPSHOT_LOCKED` | Survey Service | Orchestrator | snapshotId, version, activeParticipantIds, inputHash |
| `PLAN_START_REJECTED` | Orchestrator | API·Notification | `SURVEY_INCOMPLETE`, 미완료 참가자·섹션 |
| `APPROVAL_REQUIRED_RAISED` | Orchestrator | Notification | 항목, 선택지(계산된 것만) |
| `RUN_BLOCKED` | Orchestrator | Notification | 미검증 안전 항목, 설명 |
| `PLAN_PUBLISHED` | Orchestrator | Notification | itineraryId, 상태 배지 요약 |

### 10.2 상태 전이

```
room:   DRAFT → COLLECTING → SURVEY_READY → DATE_RESOLVING → READY → QUEUED → RUNNING → COMPLETED → ARCHIVED
                   ↺ 미완료: COLLECTING 유지       ↘ DATE_BLOCKED
                                                    └→ 날짜·기간·활성 인원 명시적 변경 → 새 Snapshot → DATE_RESOLVING
                                                        ↘ FAILED → (자동 재시도) → QUEUED
round:  PENDING → SOURCING → STATEMENT → CLASH → FACTCHECK → PROPOSAL → VERDICT → REVIEW
        REVIEW 실패 → CLASH (rerun_count++, ≤ 2)
dispatch: MOVES_OFFERED → PROPOSED → (REJECTED → PROPOSED) → ACCEPTED → EXECUTING → SETTLED
                                     └ REJECTED ×2 → FALLBACK_ORDER | WAITING_USER
node:   PROVISIONAL → VERIFIED → BOOKABLE → BOOKED
        └→ BLOCKED / STALE → 재계산 / FAILED
```

체크포인트는 **라운드 경계 + 디스패치 결정 단위**로 저장한다. 재개 시 마지막 `SETTLED` 디스패치 이후부터 실행한다.

`COLLECTING → SURVEY_READY` 전이는 모든 활성 참가자가 `SUBMITTED`이고 필수조건 검증이 `VALID`이며, 방장이 제안한 정확한 여행 기간을 전원이 확인해 `DurationAgreement.AGREED`가 된 경우에만 허용한다. 전이 시 `requiredTripDays`와 `durationAgreementVersion`을 포함한 불변 `SurveySnapshot`을 생성하고 원본 설문을 `LOCKED`한다. 미완료 상태에서는 후보 탐색·일정 생성·점수 계산·Proxy 생성·토론 관련 move를 `LegalMove`로 제공하지 않는다.

`DateResolver`는 스냅샷의 모든 활성 참가자 availability를 교집합한 뒤 여행 일수 길이의 연속 구간만 반환한다. 결과가 없으면 `DATE_BLOCKED`이며 `N-1`·최다 참석·추정 날짜를 대안으로 만들지 않는다. 날짜 입력, 전원이 동의한 여행 기간, 활성 참가자 집합 중 하나가 명시적으로 바뀌어 새 `SurveySnapshot`이 생성된 뒤에만 재실행한다.

여행 기간 변경은 기존 `DurationAgreement`를 무효화한다. 방장이 새 `nights`를 제안하고 모든 활성 참가자가 다시 확인하기 전에는 새 스냅샷과 DateResolver move를 생성할 수 없다. `days === nights + 1`은 코드로 검증하며 MVP에서는 개인별 희망 박수의 최빈값이나 자동 `±1박` 완화를 사용하지 않는다.

---

## 11. 실패 처리와 수렴 상한

| 실패 | 처리 |
| --- | --- |
| Supervisor 호출 실패·파싱 실패 | 기본 위상 순서로 진행. 회의록에 "기본 규칙 진행" 표기 |
| Supervisor 제안 2회 거부 | 기본 순서 채택 + `fallbackUsed` 기록. run당 3회 누적 시 모델 티어 1회 상향 후 고정 |
| Supervisor가 C5·C7을 코드와 다르게 판정 | 코드 판정 채택 + 불일치 로그 + 프롬프트 회귀 테스트 대상으로 표시 |
| Data Gateway 제공자 장애 | 백오프 3회 → 폴백 체인 → `degraded: true`. fail-closed 클래스면 라운드 실패 |
| 캐시 히트지만 만료·신뢰도 부족 | 재조회. 재조회 실패 시 `exploration`에서만 사용 |
| 도구 상한 초과 | 현재 후보로 판결 (`partialSourcing: true`). 단, 필수 검증 미완이면 판결·체크리스트 발행 금지 |
| 라운드 재심 2회 초과 | 일반 취향은 공정성 차선책과 이견 기록, 목적급·5점·최소 만족도는 `WAITING_USER`. C5·C7은 재심이 아니라 재조달 |
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
| `change_authority_decisions` | id, room_id, survey_snapshot_version, plan_version, decision, reason_codes(jsonb), affected_participant_ids(jsonb), affected_node_ids(jsonb), decided_at |
| `approval_requests` | id, change_decision_id, participant_id, impact_diff(jsonb), options(jsonb), raised_at, responded_at, response |
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
| A7 | 재심 2회 소진 후에도 C1 미충족 | 검증된 대안을 제시하고 `WAITING_USER` 전환 |
| A8 | R2 숙소 변경 | Activity·Dining·Schedule·TransitPass·Budget `STALE`, A3 재량으로 순서 결정 |
| A9 | 전역 재계산 4회째 요구 | `CONVERGENCE_EXCEEDED` → 검증 가능 최선안 `BLOCKED` 제시 |
| A10 | `flight.offer_price`를 캐시에서 반환하려 시도 | 정책상 `never` → live 강제 |
| A11 | 6인 조회 캐시 키에 인원수 누락 | canonicalize 계약 위반 → 회귀 테스트 실패 |
| A12 | `hotel.room_combination` 조회 불가 | fail-closed → winner·BOOKABLE 승격 금지 |
| A13 | `dining.diet_support` 확인 실패, 대체 안전식 없음 | 후보 `BLOCKED`, 라운드 재조달 |
| A14 | 한국 Pack 추정 가격 후보가 최상위 점수 | 후보 유지, `BOOKABLE` 금지, 보수적 상단값으로 Budget 전달 |
| A15 | 심판 프롬프트에 제공자 원본 JSON이 포함됨 | 투영 계약 위반 → 빌드 검사 실패 |
| A16 | 도구 상한 초과 후 필수 검증 미완 | 판결·체크리스트 발행 금지, Chief에 보고 |
| A17 | Supervisor가 날짜 변경을 자동 실행하려 함 | V8 → 기존 설문 보존 후 `NEW_SURVEY_SNAPSHOT` 요청으로 변환 |
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
| 4 | Data Gateway를 프로세스로 분리할지, 라이브러리로 인프로세스 호출할지 | W5 어댑터 착수 전 |
| 5 | 자연어 필드(리뷰·주의사항) 요약 정규화에 LLM을 쓸지 | Phase 2 |
| 6 | Supervisor 모델 티어와 폴백 티어 | 비용 실측 후 |
| 7 | `dispatch_decisions` 보존 기간과 민감정보 마스킹 규칙 | 프라이버시 정책 확정 시 |

---

## 마무리 — 이 아키텍처의 실패 조건

1. **Supervisor에 실행 권한을 주면 실패한다.** 순서를 정하는 것과 상태를 바꾸는 것은 다른 일이다. 상한 집행·수치 계산·기계 검증을 LLM에 넘기면 재현성과 비용 통제가 동시에 무너진다.
2. **캐시 히트를 무조건 신뢰하면 실패한다.** 확정가·그룹 재고·객실 조합·알레르기 대응은 캐시로 통과할 수 없다. `purpose`와 `queryClass` 정책이 이 경계를 지키는 유일한 장치다.
3. **Data Gateway를 우회하면 실패한다.** 심판이 제공자 응답을 직접 보는 순간 정규화·신뢰도·프라이버시 경계가 전부 프롬프트 관습으로 강등되고, Pack 추가마다 심판 프롬프트를 손대야 한다.
