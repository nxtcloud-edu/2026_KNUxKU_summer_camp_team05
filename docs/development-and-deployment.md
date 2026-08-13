# 개발 환경과 배포 계획

- **문서 버전**: v1.0 / 2026-08-13
- **상위 문서**: [travel-mediation-plan.md](travel-mediation-plan.md) · [agent-architecture.md](agent-architecture.md)
- **다루는 범위**: 저장소 구조, 스택 결정, 로컬 개발 절차, 프론트–백엔드 계약 현황, MVP 범위 변경, AWS EC2 배포 계획
- **권위**: 스택·환경·배포·범위 변경은 이 문서가 최신이다. 기획서 10.1의 구성도와 다르면 이 문서를 따른다.

---

## 1. 개발 원칙 — 로컬 우선, 배포는 나중에 EC2

```
[1] 로컬에서 전 기능 개발·검증          ← 현재 단계
    docker compose(PostgreSQL·Redis) + npm workspaces
[2] 단일 AWS EC2 인스턴스에 배포
    nginx(정적 + 리버스 프록시) + API + Worker + 데이터스토어
[3] 부하·데이터 중요도가 올라가면 분리
    RDS / ElastiCache / S3 / CloudFront
```

로컬에서 끝까지 돌려본 뒤 EC2로 올린다. 초기부터 ECS·EKS·오토스케일링·IaC를 도입하지 않는다. 캠프 기간(8주) 안에 검증해야 하는 것은 인프라 탄력성이 아니라 **에이전트 파이프라인의 결과 품질**이다.

배포 시점에 특히 주의할 점은 워커가 LLM·외부 여행 API를 호출한다는 사실이다. API 키가 인스턴스에 상주하고, 방 1개 실행마다 실비가 발생한다. 비용 상한과 시크릿 관리를 배포 전에 확정한다(8.5·8.6절).

---

## 2. 저장소 구조

```text
.
├─ apps/
│  └─ web/                    MOA 프론트엔드 (React 19 + Vite 7 + Tailwind 3)
│     ├─ src/                 App.tsx · components/ · data.ts · formState.ts · formApi.ts
│     ├─ public/              정적 자산, PWA manifest
│     └─ .env.example         VITE_API_BASE_URL
├─ packages/
│  └─ contracts/              공용 타입·zod 스키마 (planning · rounds · dispatch · data-agent · candidates · verdict)
├─ docs/                      설계 문서 (권위 순서: 기획서 19장 > agent-architecture > 개별 심판 문서)
├─ docker-compose.yml         로컬 PostgreSQL 16 · Redis 7
├─ package.json               npm workspaces 루트
├─ tsconfig.base.json         공용 컴파일러 설정
└─ .nvmrc                     Node 20.20.2
```

### 2.1 앞으로 추가될 워크스페이스

| 경로 | 역할 | 비고 |
| --- | --- | --- |
| `apps/api` | API Gateway — 방·설문·이의 접수, 잡 디스패치 | 골격 완료 (Fastify). PostgreSQL·큐 연동 검증 완료, **인증 미착수** |
| `apps/worker` | Debate Worker — Orchestrator 루프, 심판·페르소나 실행 | 골격 완료 (BullMQ). **잡 소비부·에이전트 미착수** |
| `packages/core` | 결정론 엔진 — Planning Graph STALE 전파, 이의 영향 산출, 디스패치 검증 | 부분 구현 (V1·V2·V5·V7) |
| `packages/agents` | LLM 에이전트 — Supervisor, 심판 7종, 페르소나, 문서 생성 | 미착수 |
| `packages/data-agents` | Data Agent read-through + 제공자 어댑터 (웹·RAG 포함) | 미착수. 계약만 `@tm/contracts`에 있음 |
| `packages/db` | 마이그레이션·리포지토리 | 착수 — 초기 스키마 + 리포지토리 3종, 실행 검증 통과 (4.2.1) |
| `packs/` | Destination Pack 데이터 (JSON) | 착수 (`jp-osaka` 초안) |

`apps/api`는 **Fastify(ESM)** 로 확정했다. 기획서 10.1은 "NestJS 또는 FastAPI"였고 앞선 초안은 NestJS를 기본안으로 두었으나, 실제 복잡도는 게이트웨이가 아니라 워커(Orchestrator·심판)에 있다. 게이트웨이는 인증·CRUD·잡 디스패치로 얇게 유지되므로, NestJS의 DI·모듈 규약이 주는 이점보다 데코레이터·CommonJS 설정 비용이 크다. 저장소 전체를 ESM + TypeScript 하나로 유지하는 편이 낫다. 모듈 경계가 실제로 부족해지면 그때 NestJS로 옮긴다.

---

## 3. 스택 결정 기록

| 항목 | 결정 | 근거 | 재검토 조건 |
| --- | --- | --- | --- |
| 프론트엔드 | **React 19 SPA + Vite 7** | 프론트 담당이 React로 MVP를 이미 구현. 기획서 10.1의 Next.js에서 변경 | SEO·SSR·공유 링크 OG 프리뷰가 요구사항이 되면 Next.js 재검토 |
| PWA | `public/manifest.webmanifest` + 필요 시 `vite-plugin-pwa` | 기획서 14.2 "네이티브 앱 대신 PWA" | — |
| 패키지 매니저 | **npm workspaces** | 로컬에 pnpm 미설치. Node 20 기본 도구로 충분 | 워크스페이스가 10개를 넘고 설치 시간이 문제되면 pnpm |
| 언어 | TypeScript 전면 | 문서 예시·프론트와 일치, 계약 타입 공유 | — |
| 로컬 데이터스토어 | Docker Compose (PostgreSQL 16, Redis 7) | 기획서 10.1 Storage 구성 | — |
| 잡 큐 | BullMQ (Redis) | 기획서 10.1, 비동기 배치 실행 모델 | — |
| 배포 | 단일 EC2 + Docker Compose | 캠프 규모, 운영 인력 없음 | 동시 실행 방이 늘어 워커 격리가 필요해지면 분리 |

### 3.1 프론트엔드를 `apps/web`으로 이동한 이유

프론트 MVP는 저장소 루트에 머지되어 있었다. 이를 `apps/web`으로 옮기고 루트를 워크스페이스로 만든 것은 **설문 스키마를 프론트와 백엔드가 한 곳에서 공유**하기 위해서다. 이 서비스는 설문이 유일한 입력이고(기획서 마무리 1번), 설문 스키마가 어긋나면 에이전트 품질이 즉시 무너진다. `packages/contracts`를 양쪽이 import하면 그 어긋남이 컴파일 단계에서 막힌다.

이동은 `git mv`로 수행해 파일 히스토리를 보존했다. 프론트 담당의 작업 경로는 `apps/web/`으로 바뀌며, 명령은 저장소 루트에서 `npm run dev`로 동일하게 실행된다.

---

## 4. 로컬 개발 절차

### 4.1 사전 요구

| 도구 | 버전 | 확인 |
| --- | --- | --- |
| Node.js | 20.10 이상 (`.nvmrc` = 20.20.2) | `node --version` |
| npm | 10 이상 | `npm --version` |
| Docker Desktop | 최신 | `docker --version` |

### 4.2 실행

```bash
npm install               # 워크스페이스 전체 설치. lockfile은 루트에 1개
npm run local:up          # PostgreSQL 16 · Redis 7 기동 (docker compose up -d)
npm run local:logs        # 데이터스토어 로그
npm run local:down        # 정지
npm run dev               # 프론트 개발 서버 → http://localhost:5173
npm run typecheck         # 워크스페이스 전체 타입 검증
npm run build             # 워크스페이스 전체 빌드
npm run lint
```

### 4.2.1 PostgreSQL 경로 실행 검증

DB를 쓰는 코드는 타입 검사로 확인되지 않는다. 예약어·jsonb 캐스팅·조인·부분 유니크 인덱스는 실행해야 드러난다.

```bash
npm run local:up                                # PostgreSQL 16 · Redis 7
export DATABASE_URL=postgres://tm:tm_local@localhost:5432/travel_mediation
npm run migrate --workspace @tm/db              # 미적용 마이그레이션만 실행
npm run smoke   --workspace @tm/db              # 리포지토리 3종 왕복 검증
```

`smoke`는 실제로 방·설문·이의를 쓰고 읽은 뒤 `DELETE FROM rooms`로 정리한다(CASCADE). 확인 범위는 rooms 생성·상태 전이·`markCompleted`, surveys upsert와 `allergens` 승격, `rooms.get`의 파생 조회(SETTLED 라운드 · BOOKED 노드), objections 저장·집계·상태 갱신, 그리고 같은 사용자가 같은 라운드에 중복 이의를 낼 수 없다는 제약이다. SQL을 건드리는 PR은 이걸 통과시킨다.

API까지 붙여서 확인하려면 (2026-08-13 확인 완료):

```bash
DATABASE_URL=$DATABASE_URL ENABLE_QUEUE=true npm run dev --workspace @tm/api
curl localhost:3001/health          # → {"storage":"postgres","database":true,"queue":true}
```

방 생성 → 설문 제출 → 이의 preview/접수까지 태우면, 이의가 `queued`로 바뀌고 `rerun:{objectionId}` 잡이 Redis에 남는다. `ENABLE_QUEUE=false`면 접수는 되지만 `accepted`에 머문다 — 실행되지 않은 이의를 `queued`로 표시하지 않기 위한 의도된 동작이다.

`VITE_API_BASE_URL`을 비워두면 프론트는 폼 제출을 `sessionStorage`에 적재한다(`apps/web/src/formApi.ts`). 따라서 **백엔드 없이도 전체 화면 흐름을 확인할 수 있다.** 백엔드가 붙으면 `apps/web/.env`에 값을 넣는다.

### 4.3 환경변수

`.env`는 커밋하지 않는다. 아래 목록을 참고해 각자 로컬에 만든다.

**프론트엔드 (`apps/web/.env`)**

| 키 | 예시 | 설명 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:3001` | 비우면 sessionStorage 적재 모드 |

**백엔드 (`apps/api`, `apps/worker` — 착수 시 사용)**

| 그룹 | 키 |
| --- | --- |
| 런타임 | `NODE_ENV`, `LOG_LEVEL`, `API_PORT`, `WEB_ORIGIN` |
| 데이터스토어 | `DATABASE_URL`, `REDIS_URL` |
| 실행 상한 | `RUN_WALLCLOCK_LIMIT_SEC`(1800), `RUN_COST_CAP_USD`(0.6), `ROUND_TURN_CAP`(32), `ROUND_RERUN_CAP`(2), `GLOBAL_RECALC_CAP`(3), `WORKER_CONCURRENCY` |
| LLM | `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL_PERSONA`, `LLM_MODEL_REFEREE`, `LLM_MODEL_SUPERVISOR` |
| 웹·RAG | `WEB_SEARCH_PROVIDER`, `WEB_SEARCH_API_KEY`, `WEB_SEARCH_CALLS_PER_ROUND`, `RAG_EMBEDDING_MODEL`(2차) — 심판 전용 조달 경로 (agent-architecture 6.9) |
| 여행 API | `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET`, `AMADEUS_ENV`, `RAKUTEN_APPLICATION_ID`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `ODSAY_API_KEY`, `NAVITIME_API_KEY`, `TOURAPI_SERVICE_KEY`, `HOTPEPPER_API_KEY`, `KAKAO_REST_API_KEY`, `KOREAEXIM_FX_API_KEY` |
| 인증 | `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET`, `SESSION_SECRET` |

> Amadeus는 테스트 환경과 운영 환경의 데이터가 다르다. **테스트 키로 실서비스를 하면 안 된다** (항공 심판 15.2).

---

## 5. 프론트엔드 ↔ 백엔드 계약 현황

프론트가 이미 두 엔드포인트를 가정하고 있다. 백엔드는 이 형태부터 맞춘다.

| 메서드 | 경로 | 페이로드 | 비고 |
| --- | --- | --- | --- |
| POST | `/api/trip-rooms` | `RoomSubmissionPayload` `{ schemaVersion: 1, destinationId }` | 방장은 목적지만 선택 (기획서 v1.2) |
| POST | `/api/survey-responses` | `SurveySubmissionPayload` `{ schemaVersion: 2, destinationId, availability, hardConstraints, travelStyles, activityScores, mustDo, avoid }` | `credentials: 'include'` |
| GET | `/api/rooms/:roomId/objections` | — | 이의 상한·잔여·이력 |
| POST | `/api/rooms/:roomId/objections/preview` | `ObjectionRequest` | 재실행 영향 예측 |
| POST | `/api/rooms/:roomId/objections` | `ObjectionRequest` | 이의 접수 → 재토론 |

서버는 `@tm/contracts`의 zod 스키마로만 페이로드를 검증한다. 프론트와 서버가 같은 정의를 쓰는 것이 A안(모노레포 통합)의 목적이다. 이의 제기 정책은 [objection-and-rerun.md](objection-and-rerun.md)에 있다.

### 5.1 설문 스키마 v2 — 알레르기를 식이 제약에서 분리

v1은 `hardConstraints.diet`이 단일 문자열이었고 `'알레르기'`가 식이 옵션 하나로 들어가 있었다. 이 구조로는 **어떤 알레르겐인지 알 수 없고**, "비건 + 갑각류 알레르기"처럼 두 축이 겹치는 경우를 표현할 수 없다.

```
v1: diet: '알레르기' | '비건' | '없음' | …            (단일 선택)
v2: dietary:   string[]   비건·베지테리언·페스코·할랄·코셔·없음 (다중, '없음'은 배타)
    allergies: string[]   갑각류·땅콩·견과류·계란·유제품… + 자유 입력 (다중)
```

두 축을 나눈 것은 UI 편의가 아니라 **처리 방식이 다르기 때문**이다.

| 축 | 성격 | 심판 처리 |
| --- | --- | --- |
| `dietary` | 취향·신념 | 하드 제약이지만 대체 메뉴·대체 식당으로 절충 가능 |
| `allergies` | 안전 | 협상 불가. 코드 레벨 실격, 대응 확인 실패 시 후보 `BLOCKED`, 계획서에 현지어 고지문 첨부 |

근거: 기획서 5.1 ①, 9.4 안전 규칙, 19.6 fail-closed, 숙소 20.2. 알레르기는 `dining.diet_support` 조회가 `verification` 목적일 때 항상 실시간이며 캐시로 통과할 수 없다(agent-architecture 6.5).

페르소나 확인 화면은 알레르기를 제약 목록 **맨 앞**에 표시한다. 이 화면이 사용자의 마지막 통제 지점이므로 안전 항목이 먼저 보여야 한다.

---

## 6. MVP 범위 변경 — 방 배정 선호 미수집

**결정: MVP에서 방 배정 선호(rooming preferences)를 수집하지 않는다.**

| 항목 | 내용 |
| --- | --- |
| 수집하지 않는 것 | 같은 방 희망/곤란한 상대, 1인실 희망, 코골이 자각, 수면 예민도 |
| 이유 | 설문 부담과 민감정보 취급 비용이 MVP 검증 목표(결과 납득 여부)에 비해 크다 |
| 대신 하는 것 | 숙소 심판은 **객실 구성 충족 여부만** 판정한다. 그룹 인원 수용, 객실 조합 동시 재고, 침실 분리 여부까지가 판정 범위다 |
| 유지되는 안전장치 | 하드 제약의 `도미토리 불가`·`남녀 혼숙 불가`·`흡연실 불가`는 설문 "절대 안 돼요"에 남아 있어 계속 실격 사유로 작동한다 |
| 사라지는 것 | 배정 점수 계산(숙소 8.2), 배정 결과를 `comfortFit`에 반영(숙소 8.3), 미충족 선호 기록 |
| Phase 2 복귀 조건 | 실사용자 피드백에서 방 배정 불만이 반복 관측되면 재도입. 그때는 숙소 20.4의 private enclave 처리와 노출 금지 규칙을 그대로 적용한다 |

**주의**: 방 배정을 다루지 않게 되었어도 숙소 심판의 **침실 분리 확인 의무는 유지된다.** "6인 수용"이 "한 방에 6명"인지 "2인실 3개"인지는 여전히 판결에 영향을 주고(숙소 원칙 4), 객실 조합 동시 재고는 fail-closed 항목이다(숙소 20.1).

---

## 7. AWS EC2 배포 계획

### 7.1 목표 토폴로지 (초기)

```text
            인터넷
              │ 443 / 80
        ┌─────▼──────────────────────────────────┐
        │  EC2 (t3.small ~ t3.medium, Amazon Linux 2023)
        │  ┌──────────────────────────────────┐  │
        │  │ nginx                            │  │
        │  │  · /            → web dist 정적  │  │
        │  │  · /api         → api:3001       │  │
        │  │  · TLS (certbot)                 │  │
        │  ├──────────────────────────────────┤  │
        │  │ api      (Node, @tm/api)         │  │
        │  │ worker   (Node, @tm/worker)      │  │
        │  │ postgres (docker)                │  │
        │  │ redis    (docker)                │  │
        │  └──────────────────────────────────┘  │
        └────────────────────────────────────────┘
              │ 아웃바운드 (LLM · 여행 API)
```

프론트는 별도 서버가 필요 없다. `apps/web`을 빌드해 나온 `dist`를 nginx가 정적 서빙한다.

### 7.2 배포 절차 (초기 — 수동)

EC2 인스턴스에 접속한 뒤 실행한다.

```bash
git pull origin main
npm ci
npm run build                       # apps/web dist 생성
docker compose -f infra/ec2/docker-compose.prod.yml up -d --build
sudo nginx -s reload
```

`infra/ec2/` 구성 파일은 배포 착수 시점에 추가한다(미결정 3번). 안정화되면 GitHub Actions에서 빌드·아티팩트 전송·무중단 재시작으로 옮긴다.

### 7.3 프로세스 관리

로컬과 동일한 Docker Compose를 쓴다. 개발 환경과 운영 환경의 구성 차이를 줄이는 것이 단일 인스턴스 운영에서 가장 값싼 안정성 확보 수단이다. 워커는 `WORKER_CONCURRENCY`로 동시 실행 방 수를 제한한다. 방 1개 실행이 최대 30분이고 LLM·API 실비가 발생하므로, 동시성을 올리기 전에 `llm_usage` 원장으로 방당 원가를 먼저 확인한다.

### 7.4 데이터

| 항목 | 초기 | 전환 조건 |
| --- | --- | --- |
| PostgreSQL | 동일 인스턴스 Docker + EBS 볼륨 | 실사용자 데이터가 쌓이면 RDS |
| Redis | 동일 인스턴스 Docker | 잡 유실이 문제되면 ElastiCache |
| 계획서 PDF·이미지 | 로컬 볼륨 | 공유 링크 트래픽이 늘면 S3 + CloudFront |
| 백업 | `pg_dump` 일 1회 → S3 | — |

설문에는 종교·건강 같은 민감정보가 들어간다(기획서 R12). EBS 암호화를 켜고, 방 종료 후 N일 파기 잡을 배포 전에 준비한다.

### 7.5 시크릿 관리

- 키를 이미지·리포지토리에 넣지 않는다. `/etc/moa/env`(권한 600) 또는 SSM Parameter Store에서 주입한다.
- IMDSv2를 강제하고 인스턴스 IAM 역할은 최소 권한(S3 백업 버킷, SSM 읽기)만 부여한다.
- 로컬 값은 `.env`, CI 값은 GitHub Actions Secrets. 저장소의 시크릿 스캔(`docs-quality.yml`)을 우회하지 않는다.

### 7.6 보안 그룹·접근

| 포트 | 소스 | 용도 |
| --- | --- | --- |
| 443, 80 | 0.0.0.0/0 | 웹 |
| 22 | 담당자 IP만 | 배포·운영 |
| 5432, 6379 | 차단 | 컨테이너 내부 통신만 |

API는 인증이 붙기 전까지 외부에 노출하지 않는다. 방·설문 엔드포인트는 초대 링크로 접근하는 사용자 데이터를 다루므로, **카카오 OAuth와 세션이 붙기 전에 퍼블릭으로 열지 않는다.** 임시 확인이 필요하면 nginx basic auth 또는 보안 그룹으로 담당자 IP만 허용한다.

### 7.7 관측

- 애플리케이션 로그는 파일 로테이션 후 CloudWatch Agent로 수집(선택).
- 최소 지표: run 성공률, 평균 실행 시간, 방당 LLM+API 원가, 디스패치 폴백률, fail-closed 차단 건수 (agent-architecture 12.2).
- 잡 3회 실패는 DLQ로 보내고 운영 알림을 띄운다. 조용한 실패가 비동기 모델의 최대 리스크다(기획서 R4).

### 7.8 지금 하지 않는 것

ECS·EKS, 오토스케일링, Terraform·CDK, 멀티 AZ, 블루/그린 배포. 단일 인스턴스 + 수동 배포로 시작하고, 베타 사용자 규모가 확인된 뒤 재검토한다.

---

## 8. 배포 전 체크리스트

- [ ] 카카오 OAuth·세션 구현 완료 (API 퍼블릭 노출의 전제)
- [ ] `RUN_COST_CAP_USD`·`WORKER_CONCURRENCY` 실측 기반 설정
- [ ] 외부 API 키를 운영 키로 교체 (Amadeus 테스트 키 금지)
- [ ] 민감정보 파기 잡·EBS 암호화 적용
- [ ] `pg_dump` 백업 자동화 및 복구 1회 리허설
- [ ] 실패 알림 경로(DLQ → 운영자) 검증
- [ ] HTTPS 인증서 자동 갱신 확인

---

## 9. 미결정 사항

| # | 항목 | 결정 시점 |
| --- | --- | --- |
| 1 | ~~`apps/api` 프레임워크~~ **Fastify(ESM) 확정** (3장) | — |
| 2 | ~~DB 접근 계층~~ **`pg` + raw SQL 확정.** 스키마가 흔들리는 값은 jsonb라 ORM 이점이 작고, 마이그레이션 러너는 63줄이다 | — |
| 2-1 | RAG 검색 방식 — 메타+텍스트로 유지할지 pgvector로 올릴지. 후자는 `postgres:16-alpine` → `pgvector/pgvector:pg16` 이미지 교체가 필요하다 | `kb.retrieve` 품질 실측 후 |
| 3 | `infra/ec2/` 구성 파일 (compose.prod, nginx.conf, 배포 스크립트) | 첫 배포 준비 시 |
| 4 | EC2 인스턴스 타입·리전 | 첫 배포 준비 시 |
| 5 | `packages/contracts`를 프론트가 import하는 시점 (설문 payload 단일화) | 백엔드 설문 엔드포인트 구현 시 |
| 6 | 루트 `.env.example` 추가 | 백엔드 착수 시 (현재 `apps/web/.env.example`만 존재) |
