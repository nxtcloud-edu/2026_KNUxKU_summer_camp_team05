# 개발 환경과 배포 계획

- 문서 버전: v2.1 / 2026-08-14
- 상위 문서: [종합 기획서](travel-mediation-plan.md), [에이전트 아키텍처](agent-architecture.md)
- 범위: 현재 코드, 목표 계약, 런타임 경계, 로컬 검증, 배포 전 게이트
- MVP 결정 기준: [Accepted ADR](adr/README.md). 충돌하면 ADR을 우선한다.

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
apps/codex-runtime-gateway/ 로컬 OAuth·모델 목록·구조화 모델 호출 목표 경계
packages/contracts/       FE/백엔드 공용 스키마와 버전
packages/core/            날짜·점수·leximin·예산·상태·의존성 계산
packages/agents/          MVP Proxy·StayArbiter·TripSupervisor 계약
packages/data-agents/     결정론적 공급자 게이트웨이·정규화·어댑터
packages/db/              프로필·계약·원장·예약 레코드 저장
packs/                    서울·부산·도쿄·오사카 데이터 팩
docs/                     제품·아키텍처·공급자 계약
```

`apps/codex-runtime-gateway/`는 목표 경계이며 아직 존재하지 않는다. 다른 브랜치에서 OAuth·모델 카탈로그·구조화 출력 부분만 선별 이식한다. Python Worker나 별도 제품 상태머신은 추가하지 않는다.

## 3. 런타임 결정

| 영역 | 현재/권장 | 이유 |
| --- | --- | --- |
| FE·API·Worker·공용 계약 | TypeScript 유지 | 기존 코드와 FE 타입 공유 |
| 날짜·점수·상태머신 | 결정론적 코드 | LLM 산술·상태 변경 금지 |
| 사실·제약 검증 | TypeScript core 우선 | 한 Worker 안에서 계약과 실패 의미를 유지 |
| LLM 실행 | 로컬 Codex OAuth Gateway | 개발자 OAuth와 현재 모델 카탈로그 사용 |
| MVP 저장소 | session/로컬 개발 저장 | 장기 프로필·운영 내구성을 주장하지 않음 |

TypeScript `RunController`가 유일한 업무 오케스트레이터다. Gateway는 OAuth, 모델 allowlist, thread, JSON Schema 호출과 최대 1회 복구만 담당한다. 자세한 권한은 [오케스트레이터 ADR](adr/0003-orchestrator-authority.md)과 [계약 소유권 ADR](adr/0008-contract-module-ownership.md)을 따른다.

## 4. 프론트엔드·백엔드 MVP 계약

### 4.1 방 생성

```ts
type CreateRoomInput = {
  schemaVersion: 2;
  destinationId: "jp-osaka";
  targetPace: "one_anchor" | "two_anchors" | "three_anchors";
};
```

목표 페이스는 사용자 설명용 입력이다. 실제 일정은 활동시간·이동·대기·버퍼·체력·접근성을 함께 계산한다. 방장은 날짜·교통수단·그룹 예산을 확정하지 않는다.

### 4.2 설문

현재 `/api/survey-responses`의 schema v2는 레거시다. Survey v4는 다음 블록을 구분한다.

1. 필수 입력: 가용 날짜, 하드 제약, 개인 목표·절대상한 예산, 가치 정책
2. 고정 취향 질문: 정확히 11개 질문 블록
3. 적응형 질문: MVP에서는 0개
4. 프로필 확인: `ProfilePatchCandidate`의 이번 세션 사용 여부 체크

FE는 질문 문구에서 점수를 계산하지 않고 `surveyVersion`, `questionId`, `optionId`를 전송한다. 백엔드의 버전된 매핑이 축·태그 신호를 만들고 같은 fixture가 FE와 백엔드에서 같은 결과를 내야 한다.

### 4.3 숙소 결과

- 결과 API는 `CategoryContractView`의 상태·근거·조회 시각·차단 사유를 그대로 노출한다.
- 상태는 `PROVISIONAL`, `VERIFIED`, `NEEDS_USER_CHOICE`, `BLOCKED`만 허용한다.
- 사용자 선택이 필요하면 자동 재토론하지 않고 선택 이유와 선택지를 반환한다.
- `FinalPlanRecord`, `BOOKABLE`, `BOOKED`, 예약·결제는 MVP 결과에 포함하지 않는다.

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
| 실행 상한 | `RUN_WALLCLOCK_LIMIT_SEC`, `MODEL_CALL_LIMIT`, `MODEL_REPAIR_LIMIT` |
| 로컬 Codex | `MOA_CODEX_GATEWAY_URL`, `MOA_MODEL_ALLOWLIST`, `MOA_MODEL_PROFILE_FAST`, `MOA_MODEL_PROFILE_BALANCED`, `MOA_MODEL_PROFILE_DEEP_REASONING` |
| Google | `GOOGLE_MAPS_API_KEY` |
| 일본 식당·숙소 | `HOTPEPPER_API_KEY`, `RAKUTEN_APPLICATION_ID`, `RAKUTEN_ACCESS_KEY` |
| 한국 장소·경로 | `TOURAPI_SERVICE_KEY`, `KAKAO_REST_API_KEY` |
| 인증 | `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET`, `SESSION_SECRET` |

Open-Meteo와 Frankfurter의 무료/상업 조건은 배포 시 다시 확인한다. 타베로그 스크래핑 키나 비공식 API URL은 환경변수 목록에 넣지 않는다.

`LLM_API_KEY`와 원격 모델 공급자 fallback은 두지 않는다. Gateway URL 기본값은 localhost이며 실제 모델 ID는 현재 Codex 카탈로그와 allowlist의 교집합으로 결정한다.

## 7. MVP 개발 순서

1. Survey v4 고정 11문항, `TripCharter`, 숙소 Proposal/Ballot/Draft/View 계약
2. 오사카 fixture의 정원·분리·예산·근거 검증과 leximin
3. 로컬 Codex OAuth Gateway의 catalog/allowlist/schema 호출
4. `UserProxyAgent → StayArbiterAgent → TripSupervisorAgent` 수직 경로
5. 결과 화면의 근거·상태·사용자 선택 표시
6. [MVP 출시 게이트](operations/mvp-release-gates.md)의 fixture와 OAuth 시나리오

전체 0~6단계, 다른 도시·카테고리, 중앙 비교선, 자동 재토론, 예약은 후속 범위다.

## 8. 실행 범위

현재 MVP는 개발자 컴퓨터 한 대에서만 실행한다. EC2, ECS, EKS, AgentCore, 인터넷에 공개된 Gateway는 사용하지 않는다. 로컬 Gateway는 `127.0.0.1`에 바인딩하고 Codex OAuth 파일을 저장소·컨테이너·원격 호스트로 복사하지 않는다.

원격 배포나 실제 사용자 데이터의 장기 보존이 필요해지면 인증, 권한, 암호화, 삭제, PII 로그, 멱등성, 장애·비용 관측을 다루는 새 ADR을 먼저 승인한다.

## 9. 실행 전 게이트

구체적인 자동·수동 시나리오, OAuth 확인, 완료 라벨은 [MVP 출시 게이트](operations/mvp-release-gates.md)를 단일 기준으로 사용한다.

## 10. 미결정

- 한국 숙소와 한·일 식당 live inventory 공급자
- 일본 대중교통 자동 검증 공급자
- 사용자의 Codex 계정에서 실제로 노출되는 MVP allowlist 모델
- session 이후 프로필 보존을 활성화할지 여부
