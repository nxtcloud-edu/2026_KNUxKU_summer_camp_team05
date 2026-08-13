# 팀 역할과 작업 폴더

- **문서 버전**: v1.0 / 2026-08-13
- **인원**: 5명 / 4개 트랙 (설문은 2명이 함께)
- **연계 문서**: [development-and-deployment.md](development-and-deployment.md) · [agent-architecture.md](agent-architecture.md) · [objection-and-rerun.md](objection-and-rerun.md)

---

## 1. 트랙과 소유 폴더

| 트랙 | 담당 | 소유 폴더 · 파일 | 건드리지 않을 것 |
| --- | --- | --- | --- |
| **T1 · 프론트엔드 UI/UX** | 1명 | `apps/web/src/**` (컴포넌트·CSS·화면 흐름), `apps/web/public/**`, `apps/web/index.html` | `packages/contracts/**`, 백엔드 전체 |
| **T2 · Destination Pack** | 1명 | `packs/*.json`, `packs/README.md` | `packs/decks/**`(T4 소유), 앱 코드 |
| **T3 · 백엔드·에이전트** | 1명 | `apps/api/**`, `apps/worker/**`, `packages/core/**`, `packages/agents/**`, `packages/data-agents/**`, `packages/db/**`, `docker-compose.yml`, `infra/**` | `apps/web/src/**`, `packs/*.json` |
| **T4 · 설문 (2명 공동)** | 2명 | `packages/contracts/src/survey.ts`, `packs/decks/**`, `docs/survey-design.md` | `apps/web/src/components/**` 레이아웃·CSS |

`packages/contracts/`의 나머지 파일은 T3이 소유한다. 스키마 변경은 항상 PR로 알린다 — 여기가 모든 트랙의 접점이다.

---

## 2. T1 · 프론트엔드 UI/UX

**소유**: 화면이 어떻게 보이고 어떻게 입력받는가.

작업 폴더

```text
apps/web/src/App.tsx            화면 전환과 페이지 컴포넌트
apps/web/src/components/        재사용 컴포넌트
apps/web/src/styles.css         기본 스타일
apps/web/src/features.css       기능별 추가 스타일
apps/web/public/                이미지·PWA manifest
```

첫 과제

1. **이의 제기 UI** — 결과 화면의 각 결정 카드에 `[이 결정 다시 논의하기]`. 남은 횟수(방 3회·1인 1회) 표시. 제출 전 `preview` 결과를 반드시 보여준다: 다시 계산될 라운드, 예상 시간·비용, 예약 취소 위험. 정책은 [objection-and-rerun.md](objection-and-rerun.md) 10장.
2. **회의록에서 이의 걸기** — 특정 발언·판결을 선택해 앵커를 만드는 인터랙션.
3. **상태 배지** — `DRAFT / PARTIAL / VERIFIED / BOOKABLE / BOOKED`를 항목마다 렌더. `PARTIAL`은 예약 행동을 유도하지 않는다.
4. **앱 라우팅 검토** — 현재 `App.tsx` 465줄에 화면 상태가 몰려 있다. 이의 제기 화면이 늘어나면 라우터 도입이 필요한지 판단해 제안한다.
5. **설문 이탈률** — 가용 일정 입력 평균 40초, 전체 7분이 목표다. 병목 화면을 찾아 개선한다.

지켜야 할 것

- 알레르기 카드는 지우거나 식이 제약과 합치지 않는다. 안전 축이라 분리되어 있다.
- 페르소나 확인 화면은 **건너뛸 수 없는 게이트**다. 알레르기가 제약 목록 맨 앞에 온다.
- 방 배정 관련 정보는 MVP에서 수집하지 않으므로 화면에도 없다.

---

## 3. T2 · Destination Pack

**소유**: 목적지 데이터의 정확성.

작업 폴더

```text
packs/<packId>.json     목적지 하나 = 파일 하나
packs/README.md          작성 규칙·조사 체크리스트
```

시작점은 `packs/jp-osaka.json`이다. 구조는 채워져 있고 확인이 필요한 값이 `verification`에 6건 나열되어 있다. 스키마는 `packages/contracts/src/pack.ts`가 유일한 출처다.

검증

```text
npm run packs:validate
```

스키마 위반과 등급 과대 표기를 잡는다. PR 전에 반드시 통과시킨다.

첫 과제

1. `jp-osaka`의 `verification` 6건을 출처·조회일과 함께 `verified`로 바꾸거나, 확인 불가면 그대로 남기고 이유를 적는다.
2. MVP 11개 Pack 중 우선순위 3개를 골라 구조부터 채운다. 추천: `jp-osaka`, `kr-gangneung`, `jp-tokyo` (국내/해외, 단순/복잡을 모두 검증할 수 있는 조합).
3. `providers` 배열의 각 API에 **테스트 호출**을 해보고 이 도시를 실제로 커버하는지 확인한다. 커버리지 조사 결과가 곧 등급이다.
4. 교통패스 룰 테이블을 만든다. 공개 API가 없어 직접 구축해야 하는 자산이며, 이게 교통 심판의 핵심 차별점이다.

지켜야 할 것

- 값을 추측해서 채우지 않는다. 모르면 `unverified`가 정답이다.
- `coverage: "A"`는 숙소 가격·로컬 미식·대중교통 상세가 모두 검증 가능할 때만. 한국 숙소처럼 가격이 밴드 추정이면 `B`다.
- 요금·쿼터·약관은 수시로 바뀐다. 상업적 이용 조건을 확인하고 조회 시각을 남긴다.

---

## 4. T3 · 백엔드·에이전트

**소유**: 실행되는 모든 것.

작업 폴더

```text
apps/api/                 Fastify 게이트웨이 (방·설문·이의 접수)
apps/worker/              BullMQ 워커, Orchestrator 루프
packages/core/            결정론 엔진 (STALE 전파, 이의 영향, 디스패치 검증)
packages/agents/          Supervisor·심판 7종·페르소나·문서 생성   ← 신규
packages/data-agents/     Data Agent read-through + 제공자 어댑터  ← 신규
packages/db/              마이그레이션·리포지토리                  ← 신규
```

첫 과제 (의존 순서대로)

1. ~~**`packages/db`** — 인메모리 저장소를 PostgreSQL로 교체~~ **완료·실행 검증됨.** 마이그레이션 1건과 리포지토리 3종(rooms·surveys·objections)이 로컬 PostgreSQL 16에서 통과한다. 회귀 확인은 `npm run smoke --workspace @tm/db`. 다음은 나머지 테이블(runs·rounds·planning_nodes·verdicts·pack_cache)의 리포지토리다.
2. ~~**이의 → 큐 → 재실행 경로**~~ **완료·실행 검증됨.** 접수 → `queued` → 워커 소비 → 대상 라운드 재실행 기록 → `applied` + `outcome`까지 한 바퀴 돈다. 워커는 `DATABASE_URL` 없이 기동하지 않고(인메모리로는 API가 만든 이의가 보이지 않는다), 같은 이의가 다시 들어오면 건너뛴다. 최종 실패는 run `FAILED` + `unresolvedReason`으로 남기고 이의를 `applied`로 올리지 않는다. **남은 것은 심판 알맹이** — 지금은 라운드가 돌기만 하고 후보를 조달하지 않아 `outcome.changed`가 항상 false다.
3. ~~**`packages/data-agents`** — read-through 게이트웨이~~ **골격 완료.** 게이트웨이 1벌 + 정책 카탈로그 38개 `queryClass` + 인스턴스 8종 + 픽스처 제공자, 테스트 26개가 키 없이 돈다. 캐시 금지·fail-closed·인원수 키·advisory·호출자 화이트리스트가 전부 테스트로 고정되어 있다.
   - **남은 것은 실제 제공자 어댑터다** — API 하나당 파일 하나. `packages/data-agents/README.md`에 추가 방법이 있다. 게이트웨이는 손대지 않는다.
   - 웹검색·RAG도 이 경로다. `web.search`·`web.page`·`kb.retrieve`는 심판만 호출하고, RAG는 별도 저장소 없이 `pack_cache` 위에서 돈다. 세 클래스 모두 **advisory** — 후보를 만들거나 승격시키지 못한다 ([agent-architecture.md](agent-architecture.md) 6.9).
4. ~~**Scoring Engine**~~ **완료.** `packages/core/src/scoring.ts` — `Sat(i,c)`, Maximin 3단 타이브레이크, 양보 크레딧, 발언 순서. `review.ts` — C1~C7 기계 판정과 수치 산출. 테스트 28개.
   - 심판은 이 값을 받아 **서술만** 한다. 후보 선택과 수치 산출은 코드가 한다(INV-2).
   - 남은 접점: 설문 응답 → `ParticipantWeights` 변환기. v2·v3 중 무엇을 쓸지가 T4의 4번 결정에 달려 있다.
5. **`packages/agents`** — Supervisor부터. 심판은 Flight → Transport → Accommodation 순서로 붙인다(문서가 이미 있는 순서). 모델·키·프롬프트 설정은 [llm-runtime-config.md](llm-runtime-config.md).
6. **Orchestrator 검증 규칙 완성** — 현재 V1·V2·V5·V7만 구현되어 있다. **V9(fail-closed 미검증 노드 승격 금지)** 는 안전과 직결되므로 Validation Pass와 함께 반드시 추가한다. Data Agent가 `VerificationUnavailableError`를 던지므로 붙일 재료는 있다.

지켜야 할 것

- Supervisor(LLM)는 제안만 한다. 실행·수치 계산·상한 집행은 코드가 한다.
- C5·C7은 기계 판정이 최종이다. Supervisor 판단과 다르면 코드를 채택하고 불일치를 기록한다.
- 심판은 제공자 원본 JSON을 절대 보지 않는다. Data Agent가 정규화한 형태만 전달한다.
- **페르소나 에이전트에는 도구를 주지 않는다.** 웹검색 포함 모든 조달은 심판이 Data Agent를 통해 한다. 개인 에이전트가 각자 검색하면 그라운딩·공정성·비용이 동시에 무너진다.
- 인증(카카오 OAuth·세션)이 붙기 전에 API를 외부에 노출하지 않는다.

---

## 5. T4 · 설문 (2명 공동)

**소유**: 무엇을 묻고 그 답을 어떻게 해석하는가.

이 트랙이 서비스 품질의 상한을 정한다. 개입 채널이 없으므로 **설문에서 잡지 못한 제약은 영원히 반영되지 않는다.**

작업 폴더

```text
packages/contracts/src/survey.ts   설문 제출 스키마 (유일한 출처)
packs/decks/<packId>.json          목적지별 카드덱 20장          ← 신규
docs/survey-design.md              문항 설계 근거·정규화 규칙     ← 신규
```

2명이 나눌 만한 분담 (합의해서 조정)

- **한 명**: 플로우와 게이트 — 섹션 순서, 진입·이탈, 페르소나 확인 게이트, 트리거 3종(전원완료/방장시작/마감기한), 미응답자 처리
- **다른 한 명**: 문항 내용 — 하드 제약 프리셋, 슬라이더 12문항, 카드덱 20장, 자유서술 정규화 규칙

첫 과제

1. **하드 제약 프리셋 확정** — "여기 적지 않으면 반영되지 않습니다"가 유일한 사전 등록 거부권이다. 프리셋이 부족하면 사용자는 말할 기회를 영영 잃는다.
2. **카드덱 20장** — Pack별로. 카드 점수가 에이전트의 발화 근거로 직접 쓰인다. T2의 `cardDeck` ID와 맞춘다.
3. **자유서술 정규화 규칙** — 강한 부정 표현("절대", "죽어도")을 하드 제약 후보로 승격하고 본인 확인을 받는 규칙.
4. **설문 문항 상수를 공유 데이터로 이동** — 현재 `apps/web/src/data.ts`에 `preferenceSliders`, `osakaPreferences`가 있다. 이걸 `packs/decks/`와 `packages/contracts`로 옮기면 T1과 T4가 다른 파일을 만지게 되어 충돌이 구조적으로 사라진다. **첫 주에 이것부터 하는 게 좋다.**
5. **알레르기 옵션 검토** — 현재 10개 프리셋 + 자유 입력. 한국·일본 식문화에서 빠진 알레르겐이 없는지 확인한다.

지켜야 할 것

- 목표 소요 시간 7분, 가용 일정 섹션 40초.
- 알레르기와 식이 제약은 합치지 않는다. 처리 방식이 다르다.
- 방 배정 선호는 MVP에서 수집하지 않는다.
- 민감정보(종교·건강)는 다른 참여자에게 원문이 아니라 정규화 태그로만 노출한다.

---

## 6. 트랙 간 접점

| 주는 쪽 | 받는 쪽 | 무엇을 |
| --- | --- | --- |
| T4 → T3 | 설문 스키마 | `survey.ts` 확정 없이 페르소나 생성·DateResolver를 만들 수 없다 |
| T4 → T1 | 문항·카드덱 | 문항이 정해져야 화면을 만든다 |
| T4 → T2 | `cardDeck` ID | Pack이 참조할 덱 이름 |
| T2 → T3 | Pack 데이터 | 심판의 제공자 우선순위·현지 상수·패스 룰 |
| T3 → T1 | API 계약 | 엔드포인트·응답 스키마 |
| T1 → T4 | 이탈 지점 | 어느 문항에서 사용자가 포기하는지 |

**교착을 피하는 방법**: T4의 스키마와 T2의 Pack 구조는 첫 주에 초안을 던지고 나중에 고친다. 완벽해질 때까지 기다리면 T3가 아무것도 시작할 수 없다.

---

## 7. 협업 규칙

```text
브랜치   feat/<트랙>-<주제>      예: feat/t2-osaka-pack, feat/t4-card-deck
PR       단일 목적. 영향받는 트랙을 본문에 명시
검증     npm run typecheck && npm run build      (T2는 npm run packs:validate 추가)
```

- 다른 트랙의 소유 폴더를 바꿔야 하면 PR 본문에 이유를 적고 해당 담당자를 리뷰어로 넣는다.
- `packages/contracts/**` 변경은 전 트랙에 영향을 준다. 반드시 알린다.
- 설문 스키마를 바꾸면 `schemaVersion`을 올린다. 지금은 방 생성 v1, 설문 v2다.
- 커밋 메시지는 무엇을 왜 바꿨는지 쓴다. 문서 링크를 붙이면 좋다.
