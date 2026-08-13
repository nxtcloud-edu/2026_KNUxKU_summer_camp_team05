# 완주 스프린트 계획 — 2트랙 병렬

- **문서 버전**: v1.0 / 2026-08-14
- **목표**: 방 1개가 `설문 → 페르소나 확인 → 시작 → 실제 후보 조달 → 토론·판결 → 계획서·회의록 발행 → 결과 확인 → 이의 제기 → 재실행`까지 **실데이터로 한 바퀴** 돈다.
- **인원**: 사람 1명(백엔드 전부) + AI 코딩 에이전트 1개(프론트엔드 전속)

---

## 1. 지금 막혀 있는 것

병목은 하나다. **에이전트 계층이 0이라 후보가 0건이고, 그래서 결과 API도 프론트도 보여줄 데이터가 없다.**

```
설문 ✅ → DB ✅ → 트리거 ✅ → 큐 ✅ → 워커 루프 ✅ → [심판 ❌] → 후보 0건 → 판결 ❌ → 계획서 ❌ → [결과 API ❌] → [프론트 목업 ❌]
                                        └── supervisor=null, candidateSearch=null, documentAgent=null
                                            (apps/worker/src/main.ts:55-76)
```

이미 끝난 것은 건드리지 않는다: `packages/core`(엔진 전부), `packages/db`(리포지토리 15종·읽기 메서드 포함), `packages/data-agents`(게이트웨이·정책 38클래스·프리페치), 워커 루프·그래프·finalize 배선.

---

## 2. 트랙 분할과 파일 소유

| 트랙 | 담당 | 배타 소유 | 절대 건드리지 않음 |
| --- | --- | --- | --- |
| **A · 백엔드** | 사람 | `packages/agents/**`(신규) · `apps/api/**` · `apps/worker/**` · `packages/contracts/**` · `packages/core/**` · `packages/db/**` · `packages/data-agents/**` · `packs/**` | `apps/web/**` |
| **B · 프론트** | AI 에이전트 | `apps/web/**` 전부 | 그 외 전부. 특히 `packages/contracts/**` |

소유가 겹치는 파일이 하나도 없다. 유일한 접점은 **`packages/contracts`의 응답 타입**이며, A가 먼저 못박고 B는 읽기만 한다. B가 계약 변경이 필요하면 코드를 고치지 않고 **요청한다.**

브랜치: A는 `hoon`, B는 `feat/web-wiring` → PR.

---

## 3. 임계 경로

```
P0 계약 못박기 (A, 최우선) ──┬── P1 에이전트 계층 (A) ── P2 워커 배선 ── P3 fixture 완주 ── P4 실키 전환 ── P5 배포
                            └── B 프론트 연결 (병렬, P0 커밋 직후 출발)
```

P0가 B의 출발 신호다. **P0를 끝내기 전에는 B를 시작시키지 않는다.**

---

## 4. 트랙 A — 백엔드

### P0 · 계약 못박기 — B의 출발 신호

1. **`packages/contracts/src/result.ts` 신규** — 결과 응답 타입 4종
   - `RoomProgress` — status, 현재 라운드, 완료 라운드, 진행률, `stopReason`
   - `PlanResult` — 일자별 일정, 항목별 배지(`DRAFT|PARTIAL|VERIFIED|BOOKABLE|BOOKED`), 예약 링크
   - `TranscriptView` — 라운드별 발화(화자·역할·본문·인용 후보 id), 판결, 점수
   - `FairnessView` — 참여자별 만족도, 양보 크레딧, 소수 의견
   - `ObjectionQuota` — 방 3회·1인 1회 잔여, preview 결과
2. **`apps/api/src/routes/results.ts` 신규** — 위 4종 GET을 **실 리포지토리로 즉시 구현**. 읽기 메서드는 이미 있다(`messages.transcript`·`verdicts.listByRun`·`scores.listByRound`·`concessions.creditsByRoom`). 데이터가 비면 빈 배열 + `pending` 상태를 정직하게 반환한다 — 목 데이터로 채우지 않는다.
3. **`apps/api/src/routes/session.ts` 신규** — 쿠키 기반 간이 세션으로 `x-user-id` 헤더를 대체. 카카오 OAuth는 범위 밖.

> P0가 끝나면 B는 **실제 엔드포인트에 대고** 개발한다. 응답은 비어 있지만 200이 오고 타입이 맞는다.

### P1 · `packages/agents` 신규

| 파일 | 내용 |
| --- | --- |
| `client.ts` | Anthropic SDK. 역할별 모델 티어, 프롬프트 캐싱, **`createRunMeter().charge()` → `repos.llmUsage.record()` 강제 경유**. 모르는 모델은 0원이 아니라 예외 |
| `persona.ts` | 설문 → 페르소나 카드 생성 + 라운드 발화자. **도구를 주지 않는다** — 모든 조달은 심판이 Data Agent로 |
| `referee/base.ts` | 심판 공통 골격 (아래 순서 고정) |
| `referee/*.ts` | R0 프레이밍 · R1 이동 · R2 숙소 · R3 액티비티 · R4 식사 · R5 동선 · R6 예산. 라운드별로 다른 것은 **조달 파라미터와 판정 기준뿐** |
| `supervisor.ts` | `LegalMove` 집합 안에서 순서 제안. 실패하면 null 반환 (폴백 경로는 이미 있다) |
| `document.ts` | `DocumentPort.draft()` 계획서 초안 |

심판 골격의 순서는 기존 계약이 이미 정해두었다. 벗어나면 테스트가 깨진다.

```
조달 요청 산출 → CandidateSearchPort.propose() → (코드가 캐시·쿼터·정규화·적재)
  → buildGroundedIndexFromRows(후보) → 페르소나 발화 → checkUtterance/factcheckGate
  → scoreCandidates → selectWinner        ← 후보 선택과 수치는 코드가 한다 (INV-2)
  → 심판은 서술만 → repos.verdicts.save → 노드 VERIFIED 승격
```

### P2 · 워커 배선 + DateResolver ↔ R0

- `apps/worker/src/main.ts`의 null 3개를 실제 구현으로 교체
- 설문 → `weightsForRoom()` → 페르소나 인스턴스화
- **DateResolver로 날짜 확정 → R0 조달 파라미터로 주입** (남은 것 #3)
- `settleRound`가 판결에 따라 `VERIFIED`/`BLOCKED`를 구분 (지금은 항상 `PROVISIONAL`이라 그래프가 다음 라운드를 못 연다)
- 원가 실측 → `RUN_COST_CAP_USD` 재설정

### P3 · fixture 완주 E2E

- 시드 스크립트: 방 1개 + 6인 설문 + 페르소나 확인 → start → 워커 완주 → 계획서 발행 확인
- **실기동으로 검증한다.** PG·Redis·API·워커를 띄우고 한 바퀴를 돌린다. 타입체크·단위 테스트만으로 끝내지 않는다.

### P4 · 실키 전환

- Amadeus·ODsay·TourAPI 실호출 스모크 (지금은 정규화 계약만 테스트됨)
- 숙소 어댑터 신규 — 일본은 Rakuten Travel, 한국은 밴드 추정(`coverage: B`)
- fixture 제공자는 지우지 않고 폴백으로 남긴다

### P5 · 배포 (여유가 있으면)

`infra/ec2/`, 민감정보 파기 잡, 백업 리허설.

---

## 5. 트랙 B — 프론트엔드 (AI 에이전트)

### Phase 1 · 실연결 (P0 커밋 직후 시작)

현재 `apps/web/src/App.tsx` 581줄이 `data.ts` 하드코딩 목업으로 돌고 있고, 실연결은 `POST /api/trip-rooms`·`/api/survey-responses` 두 개뿐이다.

1. `src/api/` 클라이언트 계층 신규 — 타입은 `@tm/contracts`를 **그대로 import**해서 쓴다. 프론트에서 타입을 다시 정의하지 않는다.
2. **목업 모드를 보존한다** — `VITE_API_BASE_URL`이 비면 지금처럼 `data.ts`로 동작해야 한다. 백엔드 없이 화면 흐름을 확인하는 경로다.
3. 실연결: 방 생성 · 입장 · 설문 제출 · 페르소나 확인 게이트 · 회의 시작 트리거
4. 회의 진행 화면 — `RoomProgress` 폴링. 라운드 진행과 `stopReason`을 그대로 보여준다
5. 결과 3탭(요약·일정·공정성) 실데이터 바인딩 + 회의록 뷰
6. 이의 제기 — **제출 전 preview 필수**(재계산 라운드·예상 시간·비용·예약 취소 위험), 잔여 횟수 표시
7. 상태 배지 5종 렌더. `PARTIAL`은 예약 행동을 유도하지 않는다
8. 라우터 도입 여부 판단 — 이의 제기 화면이 늘어나면 `App.tsx` 581줄이 한계다

지켜야 할 것: 알레르기 카드를 식이 제약과 합치지 않는다. 페르소나 확인은 건너뛸 수 없는 게이트다. 방 배정 정보는 수집하지 않으므로 화면에도 없다.

### Phase 2 · Pack 데이터 (프론트가 끝나면)

- `packs/jp-osaka.json`의 `verification` 6건을 출처·조회일과 함께 마감
- `kr-gangneung`·`jp-tokyo` 신규 (국내/해외, 단순/복잡 조합)
- 목적지별 카드덱 20장
- 값을 추측해 채우지 않는다. 모르면 `unverified`가 정답이다

---

## 6. 동기화 지점

| 시점 | 무엇을 |
| --- | --- |
| P0 완료 | A가 계약을 커밋 → B 출발 |
| B Phase 1 완료 | A의 워커가 아직 데이터를 안 만들었어도 화면은 빈 상태로 정상 동작해야 한다 |
| P3 완료 | 워커가 실데이터 생산 → B가 빈 화면 대신 실제 결과를 본다. **여기가 진짜 통합 지점** |
| P4 완료 | 후보가 fixture에서 실제 API로 바뀐다. 프론트 코드는 바뀌지 않아야 한다 |

각 트랙의 완료 기준은 동일하다: `npm run typecheck && npm run test` 통과 + **실행 검증**.

---

## 7. 리스크

| # | 리스크 | 대응 |
| --- | --- | --- |
| 1 | **원가 상한 $0.6이 빠듯하다.** 문서 추정으로도 라운드당 심판 4회 + Supervisor 2회 + 페르소나 12회면 캐싱·배치를 둘 다 적용해야 겨우 들어온다 | P2에서 `count_tokens`로 실측 후 상한을 다시 정한다. 넘으면 페르소나 발화 수를 줄이거나 티어를 내린다 — 조용히 초과시키지 않는다 |
| 2 | 심판 7종을 다 만들면 오래 걸린다 | 공통 베이스 + 라운드별 파라미터. R0·R1·R2·R4를 먼저 붙이고 R3·R5·R6는 베이스로 돈다 |
| 3 | 실 API 키 발급이 임계 경로에 들어온다 | fixture로 먼저 완주(P3)한다. 키는 P4에서 갈아끼운다 — 데모는 언제든 된다 |
| 4 | 프롬프트 캐싱 최소 길이가 모델마다 달라 티어 배분과 충돌한다 | 라운드 중간에 모델을 바꾸지 않는다. 공유 프리픽스 길이를 페르소나 모델 기준으로 맞춘다 |
| 5 | 인증 없이 API를 노출하면 안 된다 | P0의 간이 세션까지만. 외부 노출은 배포(P5) 전까지 하지 않는다 |
