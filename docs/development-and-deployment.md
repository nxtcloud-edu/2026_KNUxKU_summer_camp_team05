# 개발 환경과 배포 계획

> 팀 개발의 시작점과 작업 패키지는 [docs/README.md](README.md)와 [MVP 구현 가이드](mvp-implementation-guide.md)를 따른다.
> 이 문서의 로컬 개발·저장소 구조는 유효하다. Agent 운영 런타임과 배포는 사용자가 확정한 [ECS 기반 Codex Auth 설계](ecs-codex-auth-agent-architecture.md)가 EC2·일반 LLM API Key 예시보다 우선한다.

- **문서 버전**: v1.1 / 2026-08-14
- **상위 문서**: [travel-mediation-plan.md](travel-mediation-plan.md) · [agent-architecture.md](agent-architecture.md)
- **다루는 범위**: 저장소 구조, 스택 결정, 로컬 개발 절차, 프론트–백엔드 계약 현황, MVP 범위 변경, 과거 EC2 배포안 기록
- **권위**: 로컬 개발과 저장소 구조는 이 문서를 따른다. Agent 운영 런타임·인증·운영 배포는 ECS Codex Auth 설계를 따른다.

---

## 1. 개발 원칙 — 로컬 세로 기능 검증 후 ECS

```
[1] 로컬에서 전 기능 개발·검증          ← 현재 단계
    docker compose(PostgreSQL·Redis) + npm workspaces
[2] 로컬 Codex Runtime Gateway 연결
    Fixture Agent 회귀 테스트 통과 후 Codex Auth·thread 검증
[3] ECS에 Worker + Codex Runtime Gateway 배포
    Auth는 Gateway만 소유하고 EFS에 암호화 저장
```

로컬에서 fixture 후보와 Fixture Agent만으로 전체 세로 기능을 통과시킨 뒤 Codex Runtime Gateway를 연결하고, 마지막에 ECS로 배포한다. 로컬 단계부터 ECS 리소스를 만들지는 않는다. 캠프 기간 안에 먼저 검증할 것은 인프라 탄력성이 아니라 **에이전트 파이프라인의 결과 품질**이다.

배포 시점에는 워커가 외부 여행 API와 Codex Runtime Gateway를 호출한다. 여행 API 키는 Connector에만, Codex Auth는 Runtime Gateway에만 존재해야 한다. 방 1개 실행마다 실비가 발생하므로 비용·동시성 상한을 배포 전에 검증한다.

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
│  ├─ contracts/              공용 TypeScript 타입·Zod 스키마
│  └─ agents/                 Python 3.12·Pydantic Agent 런타임과 테스트
├─ docs/                      설계 문서 (권위 순서: 기획서 19장 > agent-architecture > 개별 심판 문서)
├─ docker-compose.yml         로컬 PostgreSQL 16 · Redis 7
├─ package.json               npm workspaces 루트
├─ tsconfig.base.json         공용 컴파일러 설정
└─ .nvmrc                     Node 20.20.2
```

### 2.1 앞으로 추가될 워크스페이스

| 경로 | 역할 | 비고 |
| --- | --- | --- |
| `apps/api` | API Gateway — 인증, 방·설문 CRUD, Pack 레지스트리, 잡 디스패치 | 미착수 |
| `apps/worker` | Debate Worker — Orchestrator 루프, 심판·페르소나 실행 | 미착수 |
| `packages/core` | 결정론 엔진 — LegalMove, 디스패치 검증, Maximin, DateResolver, Validation Pass | 미착수 |
| `packages/agents` | Python Agent — Proxy, Supervisor, Watcher, Search, Auditor, Finalizer | 로컬 구현 완료 |
| `packages/data-gateway` | 결정론적 read-through Gateway + 제공자 Connector | 미착수 |
| `packages/db` | 마이그레이션·리포지토리 | 미착수 |
| `packs/` | Destination Pack 데이터 (JSON) | 미착수 |

`apps/api`는 **NestJS(TypeScript)** 를 기본안으로 유지한다. Agent 런타임은 Python 3.12와 Pydantic으로 분리했으므로 `apps/worker`는 Python으로 구현하거나, TypeScript Worker가 내부 HTTP/RPC로 Python Agent Runner를 호출해야 한다. MVP에서는 프로세스 경계를 늘리지 않기 위해 Python Worker를 우선한다.

---

## 3. 스택 결정 기록

| 항목 | 결정 | 근거 | 재검토 조건 |
| --- | --- | --- | --- |
| 프론트엔드 | **React 19 SPA + Vite 7** | 프론트 담당이 React로 MVP를 이미 구현. 기획서 10.1의 Next.js에서 변경 | SEO·SSR·공유 링크 OG 프리뷰가 요구사항이 되면 Next.js 재검토 |
| PWA | `public/manifest.webmanifest` + 필요 시 `vite-plugin-pwa` | 기획서 14.2 "네이티브 앱 대신 PWA" | — |
| 패키지 매니저 | **npm workspaces** | 로컬에 pnpm 미설치. Node 20 기본 도구로 충분 | 워크스페이스가 10개를 넘고 설치 시간이 문제되면 pnpm |
| 언어 | 웹·API·공통 계약 TypeScript / Agent·Worker Python 3.12 | Agent 구현 요청과 Pydantic 기반 strict 검증을 반영 | 서비스 간 JSON Schema 생성이 자동화되지 않으면 경계 재검토 |
| 로컬 데이터스토어 | Docker Compose (PostgreSQL 16, Redis 7) | 기획서 10.1 Storage 구성 | — |
| 잡 큐 | BullMQ (Redis) | 기획서 10.1, 비동기 배치 실행 모델 | — |
| 배포 | 로컬 Docker Compose → ECS | 로컬 세로 기능을 먼저 검증하고 Auth 소유권을 Gateway로 격리 | ECS 세부 계약은 전용 문서 적용 |

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
| Agent Runtime | `CODEX_GATEWAY_URL`, `AGENT_SPEC_REGISTRY_PATH`, `AGENT_RUN_TIMEOUT_MS` |
| Codex Runtime Gateway 전용 | `CODEX_HOME`, `CODEX_GATEWAY_PORT`, `CODEX_MAX_CONCURRENCY` |
| 여행 API | `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET`, `AMADEUS_ENV`, `RAKUTEN_APPLICATION_ID`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `ODSAY_API_KEY`, `NAVITIME_API_KEY`, `TOURAPI_SERVICE_KEY`, `HOTPEPPER_API_KEY`, `KAKAO_REST_API_KEY`, `KOREAEXIM_FX_API_KEY` |
| 인증 | `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET`, `SESSION_SECRET` |

> Amadeus는 테스트 환경과 운영 환경의 데이터가 다르다. **테스트 키로 실서비스를 하면 안 된다** (항공 심판 15.2).

---

## 5. 프론트엔드 ↔ 백엔드 계약 현황

프론트가 이미 두 엔드포인트를 가정하고 있다. 백엔드는 이 형태부터 맞춘다.

| 메서드 | 경로 | 페이로드 | 비고 |
| --- | --- | --- | --- |
| POST | `/api/trip-rooms` | `RoomSubmissionPayload` `{ schemaVersion: 1, destinationId }` | 방장은 목적지만 선택 (기획서 v1.2) |
| POST | `/api/survey-responses` | `SurveySubmissionPayload` `{ schemaVersion: 3, destinationId, availability, hardConstraints, travelStyles, activityScores, purposeItems, avoid }` | `credentials: 'include'` |

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

### 5.2 설문 스키마 v3 — 목적급 콘텐츠 배열

v2의 `mustDo: string`을 v3에서 `purposeItems: string[]`로 바꾼다. MVP는 빈 배열부터 최대 2개까지 허용하며 배열 순서가 1·2순위다. 제출 시 공백 항목을 제거하고 2개를 초과하면 거부한다. 기존 브라우저 로컬 초안의 `mustDo` 값은 첫 번째 배열 요소로 이관한다.

```text
v2: mustDo: string
v3: purposeItems: string[]  // 0~2개, 순서 보존
```

상한은 공통 계약의 `protectedObjectivePolicyV1.maxPerParticipant`에서 관리한다. 후속 버전에서 상한을 늘릴 때 저장 구조를 다시 바꾸지 않는다.

### 5.3 MVP 보류 — 참가자 간 알레르기 상세 공개

알레르기 수집과 안전 제외는 MVP에 유지하지만, **정확한 알레르기 항목·당사자를 다른 참가자나 ParticipantProxyAgent에 공개하는 기능은 MVP에서 구현하지 않는다.** 공개 동의와 공개 범위 선택 UI도 후속 단계로 미룬다.

MVP 처리:

```text
알레르기 원문
→ ConstraintValidator·Dining 안전 검증 코드만 사용
→ 해당 음식·식당을 협상 전에 제외
→ 다른 참가자와 Proxy에는 “그룹 안전 제약으로 선택 불가”만 공개
```

후속 구현 시에는 다음 정책을 적용한다.

- 일반 개인정보 동의와 구분된 민감정보 처리 동의
- 여행방 참가자에게 정확한 알레르기 항목·당사자를 공개할지 별도 선택
- 비공개를 선택해도 안전 제외 기능은 동일하게 동작
- 공개 대상·목적·항목·보유 기간·거부 권리 안내
- 공개 동의 철회와 여행 종료 후 파기

법적 근거는 개인정보 보호법 제17조(공유를 포함한 제3자 제공)와 제23조(건강정보 등 민감정보 처리 제한)를 기준으로 하며, 실제 출시 전 개인정보 처리방침과 동의 문구를 별도로 검토한다.

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

## 7. 과거 AWS EC2 배포안 — 구현 기준 아님

> 아래 내용은 초기 배포 검토 기록이다. 새 구현·작업 배정·운영 체크리스트의 기준으로 사용하지 않는다. 현재 구현 기준은 [ECS 기반 Codex Auth 에이전트 런타임 설계](ecs-codex-auth-agent-architecture.md) 14~16장이다.

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
- ECS 배포에서는 외부 여행 API 키를 Secrets Manager에서 Provider Connector Task에만 주입한다. CandidateSearchAgent·CategoryWatcher·Codex Runtime에는 키를 주입하지 않는다.
- Authorization 헤더, query-string 키, 원본 제공자 응답은 Agent tool 결과와 애플리케이션 로그에서 마스킹한다.

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

Agent 런타임의 필수 체크리스트는 ECS Codex Auth 설계 15·16장을 우선한다. 아래는 서비스 공통 항목이다.

- [ ] 카카오 OAuth·세션 구현 완료 (API 퍼블릭 노출의 전제)
- [ ] `RUN_COST_CAP_USD`·`WORKER_CONCURRENCY` 실측 기반 설정
- [ ] 외부 API 키를 운영 키로 교체 (Amadeus 테스트 키 금지)
- [ ] 민감정보 파기 잡과 저장소 암호화 적용
- [ ] DB 백업 자동화 및 복구 1회 리허설
- [ ] 실패 알림 경로(DLQ → 운영자) 검증
- [ ] HTTPS 인증서 자동 갱신 확인

---

## 9. 미결정 사항

| # | 항목 | 결정 시점 |
| --- | --- | --- |
| 1 | `apps/api` 프레임워크 최종 확정 (NestJS 기본안) | 백엔드 착수 시 |
| 2 | DB 접근 계층 (Prisma / Kysely / raw SQL) | `packages/db` 착수 시 |
| 3 | `packages/contracts`를 프론트가 import하는 시점 (설문 payload 단일화) | W0·W8 |
| 4 | 루트 `.env.example` 추가 | W1 착수 시 |
| 5 | ECS 리전·Task 크기·EFS Access Point | W10 부하·비용 실측 후 |
