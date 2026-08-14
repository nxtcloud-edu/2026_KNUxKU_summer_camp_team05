# 개발 환경과 배포 계획

- 문서 버전: v2.0 / 2026-08-14
- 상위 문서: [종합 기획서](travel-mediation-plan.md), [에이전트 아키텍처](agent-architecture.md)
- 범위: 현재 코드, 목표 계약, 런타임 경계, 로컬 검증, 배포 전 게이트

## 1. 현재 상태와 목표 상태

현재 저장소는 TypeScript 모노레포이며 React/Vite 프론트, Fastify API, BullMQ Worker, PostgreSQL·Redis, 공용 계약, 결정론적 점수·그래프·DateResolver, 데이터 게이트웨이 골격을 포함한다.

이 코드는 이전 설계의 `R0~R6`, Persona·Referee·Supervisor, 설문 v2/v3 계약을 포함한다. 이번 문서 갱신은 목표 아키텍처를 정리한 것이며 아래 항목이 구현됐다는 뜻이 아니다.

- Survey v4 + Profile Schema v1
- `TripCharter → CategoryDecisionContract × 5 → FinalPlanRecord`
- 새 공식 에이전트 5종
- `FactConstraintValidator`의 Python 구현
- 네 도시의 실제 공급자 연결과 `BOOKABLE` 검증

## 2. 목표 저장소 경계

```text
apps/web/                 Survey v4, 프로필 확인, 결과·재논의 UI
apps/api/                 인증, 방·설문·결과·재논의 API
apps/worker/              RunController와 비동기 실행
packages/contracts/       FE/백엔드 공용 스키마와 버전
packages/core/            날짜·점수·leximin·예산·상태·의존성 계산
packages/agents/          공식 LLM 에이전트 5종
packages/data-agents/     공급자 게이트웨이·정규화·어댑터
packages/db/              프로필·계약·원장·예약 레코드 저장
services/validator/       Python 중심 FactConstraintValidator 후보 경계
packs/                    서울·부산·도쿄·오사카 데이터 팩
docs/                     제품·아키텍처·공급자 계약
```

`services/validator/`는 목표 경계이며 아직 존재하지 않는다. Python을 별도 프로세스로 둘지, Worker가 라이브러리/CLI로 호출할지는 구현 spike 후 확정한다.

## 3. 런타임 결정

| 영역 | 현재/권장 | 이유 |
| --- | --- | --- |
| FE·API·Worker·공용 계약 | TypeScript 유지 | 기존 코드와 FE 타입 공유 |
| 날짜·점수·상태머신 | 결정론적 코드 | LLM 산술·상태 변경 금지 |
| 사실·제약 검증 | Python 중심 권장 | 시간·경로·예산·조합 검사 라이브러리 활용 |
| LLM 에이전트 | Python 또는 TypeScript 미결정 | SDK보다 계약·평가·운영 단순성이 우선 |
| 저장소 | PostgreSQL + Redis | 계약·원장 영속화와 비동기 실행 |

따라서 이전의 “TypeScript 전면 확정”은 폐기한다. 다만 Python 선호만으로 현재 TypeScript 코드를 전면 이식하지 않는다. 경계 간에는 JSON Schema/OpenAPI와 불변 ID·버전 계약을 사용한다.

## 4. 프론트엔드·백엔드 목표 계약

### 4.1 방 생성

```ts
type CreateRoomInput = {
  schemaVersion: 2;
  destinationId: "kr-seoul" | "kr-busan" | "jp-tokyo" | "jp-osaka";
  targetPace: "one_anchor" | "two_anchors" | "three_anchors";
};
```

목표 페이스는 사용자 설명용 입력이다. 실제 일정은 활동시간·이동·대기·버퍼·체력·접근성을 함께 계산한다. 방장은 날짜·교통수단·그룹 예산을 확정하지 않는다.

### 4.2 설문

현재 `/api/survey-responses`의 schema v2는 레거시다. Survey v4는 다음 블록을 구분한다.

1. 필수 입력: 가용 날짜, 하드 제약, 개인 목표·절대상한 예산, 가치 정책
2. 고정 취향 질문: 정확히 11개 질문 블록
3. 적응형 질문: 0~2개
4. 프로필 확인: `ProfilePatchCandidate` 중 장기 저장 항목 체크

FE는 질문 문구에서 점수를 계산하지 않고 `surveyVersion`, `questionId`, `optionId`를 전송한다. 백엔드의 버전된 매핑이 축·태그 신호를 만들고 같은 fixture가 FE와 백엔드에서 같은 결과를 내야 한다.

### 4.3 결과와 재논의

- 결과 API는 `FinalPlanRecord`의 상태·근거·만료·차단 사유를 그대로 노출한다.
- `BOOKABLE`과 `BOOKED`를 합치지 않는다.
- 재논의 요청은 원장 버전, 문제 카테고리, 사용자 이유, 프로필 반영 범위를 포함한다.
- 영향 미리보기를 승인한 뒤에만 `RunController`가 활성 계약 참조를 비운다.

## 5. 로컬 실행

요구사항: Node 20.10+, npm 10+, Docker Desktop.

```bash
npm install
npm run local:up
npm run dev
npm run typecheck
npm run test
npm run build
```

DB 경로:

```bash
export DATABASE_URL=postgres://tm:tm_local@localhost:5432/travel_mediation
npm run migrate --workspace @tm/db
npm run smoke --workspace @tm/db
```

`VITE_API_BASE_URL`이 비어 있으면 기존 FE가 `sessionStorage` 경로를 사용한다. 이는 화면 목업 검증이며 Survey v4나 실제 에이전트 종단 실행 검증이 아니다.

## 6. 환경변수 목표

| 범위 | 예시 키 |
| --- | --- |
| 런타임 | `NODE_ENV`, `LOG_LEVEL`, `API_PORT`, `WEB_ORIGIN` |
| 저장소·큐 | `DATABASE_URL`, `REDIS_URL`, `WORKER_CONCURRENCY` |
| 실행 상한 | `RUN_WALLCLOCK_LIMIT_SEC`, `RUN_COST_CAP_USD`, `CATEGORY_TURN_CAP`, `CATEGORY_RERUN_CAP` |
| LLM | `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL_PROXY`, `LLM_MODEL_EVIDENCE`, `LLM_MODEL_ARBITER`, `LLM_MODEL_ORCHESTRATOR`, `LLM_MODEL_FINALIZER` |
| Google | `GOOGLE_MAPS_API_KEY` |
| 일본 식당·숙소 | `HOTPEPPER_API_KEY`, `RAKUTEN_APPLICATION_ID`, `RAKUTEN_ACCESS_KEY` |
| 한국 장소·경로 | `TOURAPI_SERVICE_KEY`, `KAKAO_REST_API_KEY` |
| 인증 | `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET`, `SESSION_SECRET` |

Open-Meteo와 Frankfurter의 무료/상업 조건은 배포 시 다시 확인한다. 타베로그 스크래핑 키나 비공식 API URL은 환경변수 목록에 넣지 않는다.

## 7. 개발 순서

1. 공용 계약: Profile v1, TripCharter, CategoryProposal/Ballot/Contract/View, DecisionLedger, FinalPlanRecord
2. Survey v4 FE·API와 동일 fixture 매핑
3. `RunController`의 0/1~5/6단계 상태·버전·재개방
4. 한 도시·한 카테고리의 실제 후보 조달과 `FactConstraintValidator`
5. `UserProxyAgent → CategoryArbiterAgent` 수직 경로
6. 계약 의무 승계와 `PlanFinalizerAgent`
7. 네 도시 공급자·Pack 확장
8. 실제 사용자 선택 기반 취향축 평가

한 카테고리 수직 경로는 구조 검증용이며 전체 제품·`BOOKABLE` 완료로 표시하지 않는다.

## 8. 배포

초기에는 단일 EC2 + Docker Compose를 유지할 수 있다.

```text
nginx
  ├─ web 정적 파일
  └─ /api → API
API + Worker + PostgreSQL + Redis
Python validator sidecar 또는 Worker 호출 경계
```

ECS/EKS, 오토스케일링, 멀티 AZ는 해커톤 MVP 비목표다. 다만 실제 사용자 프로필·예산·건강·가치 정보를 받기 전에는 다음이 필요하다.

- OAuth·세션과 방 멤버 권한
- 필드 수준 접근 제어
- 전송·저장 암호화
- 보존기간·삭제·정정·동의
- 시크릿 관리와 로그 PII 제거
- 계약·원장 멱등성과 Worker 재시도
- 비용·쿼터·DLQ 관측

## 9. 배포 전 게이트

- [ ] Survey v4 FE/백엔드 fixture 일치
- [ ] `unknown`, `avoid`, `hard`, `approval_required` 상호 오변환 0건
- [ ] 0단계에서 미응답자의 날짜·예산·하드 제약을 추정하지 않음
- [ ] 1~5단계 같은 `proposalSetVersion` 투표 강제
- [ ] `CONTINUE`가 계약을 만들지 않고 체크포인트만 저장
- [ ] `NO_SAFE_DECISION`이 선택안 없는 차단 계약 생성
- [ ] `BOOKABLE`의 유효기간과 공급자 근거 연결
- [ ] 계약 재개방·동시 요청·중복 Worker 멱등 테스트
- [ ] 실제 API sandbox 호출과 약관 재확인
- [ ] 사용자 시나리오로 `FinalPlanRecord` 또는 정직한 차단 결과 관찰

## 10. 미결정

- Python 검증기의 프로세스/배포 형태
- LLM 에이전트 구현 언어와 모델 배분
- 한국 숙소와 한·일 식당 live inventory 공급자
- 일본 대중교통 자동 검증 공급자
- 동시 사용자 규모에 맞는 EC2 타입
