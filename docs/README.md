# MOA 개발 문서 시작점

> 이 파일은 팀원이 구두 설명 없이 개발을 시작하기 위한 문서 라우터다.  
> 제품 구현 기준은 저장소 루트 `README.md`, 이 디렉터리의 권위 문서, `packages/contracts` 순으로 확인한다.  
> `kdk_md/`는 비교·아이디어 참고 자료이며 현재 MVP 구현 계약이 아니다.

## 1. 5분 안에 시작하기

1. 루트 [README.md](../README.md)의 `핵심 원칙`, `설계 불변조건`, `AI 작업 시 읽을 규칙`을 읽는다.
2. [MVP 구현 가이드](mvp-implementation-guide.md)에서 자신이 맡을 작업 패키지를 고른다.
3. 작업 패키지에 지정된 필수 문서와 공통 계약을 읽는다.
4. `npm install`, `npm run local:up`, `npm run typecheck`, `npm run build`로 기준 상태를 확인한다.
5. 작업 패키지의 입력·출력·완료 조건 밖으로 범위를 넓히지 않는다.
6. 문서와 코드가 충돌하면 추측해서 구현하지 않고 `SPEC_CONFLICT`로 기록한다.

## 2. 문서 권위 순서

모든 문서가 모든 주제에 우선하는 것은 아니다. 분야별 단일 기준은 다음과 같다.

| 주제 | 1순위 | 2순위 | 비고 |
| --- | --- | --- | --- |
| 전체 제품 원칙·MVP 흐름 | [루트 README](../README.md) | [백엔드 설계](group-trip-survey-agent-backend.md) | `Plan v0`를 먼저 만들고 충돌 부분만 토론한다 |
| 설문·목적급·5·3·1·만족도·예산 | [백엔드 설계](group-trip-survey-agent-backend.md) | [공통 계약](../packages/contracts/src/index.ts) | 결정된 수식은 LLM이 다시 계산하지 않는다 |
| Agent 역할·호출 순서·권한 | [Agent 아키텍처](agent-architecture.md) | [AgentSpec](agent-spec.md) | Orchestrator는 코드, Agent는 제안 전용이다 |
| 전역 Planning Graph·근거·검증 | [종합 기획서 19장](travel-mediation-plan.md#19-v13-실행-보강--전역-계획검증협업-계약) | [Agent 아키텍처](agent-architecture.md) | 오래된 본문 예시보다 19장을 우선한다 |
| 변경 권한 | [백엔드 설계 19장](group-trip-survey-agent-backend.md#19-변경-권한-경계) | [change-authority.ts](../packages/contracts/src/change-authority.ts) | 네 단계 정책을 사용한다 |
| 로컬 개발 | [개발·배포 문서 1~6장](development-and-deployment.md) | 이 문서 | PostgreSQL·Redis는 Docker Compose를 사용한다 |
| Agent 런타임·로컬 실행 | [Agent Runtime 구현·설치·검증 기록](agent-runtime-setup-and-verification.md) | [Agent 구현 가이드](agents-implementation.md) | 현재 코드와 설치·검증 결과를 설명한다 |
| Agent 운영 배포 | [ECS Codex Auth 설계](ecs-codex-auth-agent-architecture.md) | [AgentSpec](agent-spec.md) | 기존 EC2·일반 LLM API Key 설명보다 우선한다 |
| 항공 | [항공 구현서](flight-referee-implementation.md) | 공통 Data Gateway 계약 | 공통 fail-closed 규칙을 완화할 수 없다 |
| 교통 | [교통 구현서](transport-referee-implementation.md) | 공통 Data Gateway 계약 | 동선 수치는 코드가 계산한다 |
| 숙소 | [숙소 구현서](accommodation-referee-implementation.md) | 공통 Data Gateway 계약 | 객실 조합과 안전은 fail-closed다 |

`packages/contracts`의 Zod 스키마는 실행 가능한 계약이다. Markdown과 스키마가 다르면 임의로 한쪽을 고치지 말고 문서의 명시적 결정과 변경 이력을 확인한 뒤 둘을 같은 변경에서 수정한다.

## 3. 현재 MVP에서 고정된 결정

- 모든 활성 참가자가 설문을 완료해야 계획을 시작한다.
- 방장은 여행지·교통수단·페이스·검색 날짜 범위·전체 예산 상한·정확한 여행 기간을 설정한다.
- 정확한 여행 기간은 모든 활성 참가자가 확인해야 `AGREED`가 된다.
- 각 참가자는 개인 예산 상한과 가능한 날짜를 입력한다.
- 분야 우선순위는 음식·숙소·액티비티에 `5·3·1`을 하나씩 배정한다.
- 세부 취향도 `5·3·1`, 미선택, 제외를 사용한다.
- 일반 취향의 실효 중요도는 `분야 중요도 × 세부 중요도`다.
- 목적급 콘텐츠는 참가자당 `0~2개`이며 일반 점수와 분리된 게이트다.
- 먼저 결정론 코드가 `Plan v0`를 만들고, 충돌한 부분만 Agent가 토론한다.
- Agent는 후보·점수·시간·예산·상태를 확정하지 않는다.
- C2 만족도 격차는 `25%p`를 초과할 때 최저 만족도 참가자의 미반영 분야만 1회 재토론한다.
- 변경 권한은 `AUTO_REPLAN / PROXY_DELEGATED / USER_CONFIRMATION_REQUIRED / NEW_SURVEY_SNAPSHOT`으로 분류한다.
- 사용자 확인도 하드 제약과 fail-closed 검증을 우회하지 못한다.
- MVP는 예약·결제를 실행하지 않는다. `BOOKED`는 외부 사용자 이벤트로만 생긴다.

## 4. 현재 구현 상태

| 영역 | 상태 | 근거 |
| --- | --- | --- |
| 웹 프로토타입 | 일부 구현 | `apps/web` |
| 공통 계약 | 일부 구현 | `packages/contracts` |
| PostgreSQL·Redis 로컬 환경 | 구현 | `docker-compose.yml` |
| API 서버 | 미구현 | 목표 `apps/api` |
| Worker·Orchestrator | 부분 구현 | `apps/worker` — 상태 머신·SQLite·검증 후보 leximin 선택·사용자 대기/재검증. Provider Data Gateway 연결 전에는 preloaded 정규화 후보만 처리 |
| 결정론 엔진 | 미구현 | 목표 `packages/core` |
| Agent 역할 구현 | 부분 구현 | `packages/agents` — 6개 계약·Fixture Runtime·Codex Gateway 경계·교차 필드 검증. 자연어 일반 논리 추론은 결정론적 SymbolicReasoner 연결 전까지 제한적 |
| Data Gateway·Connector | 미구현 | 목표 `packages/data-gateway` |
| DB 마이그레이션·Repository | 미구현 | 목표 `packages/db` |
| Destination Pack | 미구현 | 목표 `packs/` |
| Codex Runtime Gateway | 로컬 구현 완료 | `apps/codex-runtime-gateway` — 실제 SDK 연결, 사용자 로그인 필요 |
| ECS 배포 | 설계만 완료 | 로컬 세로 기능 검증 후 착수 |

## 5. 현재 코드와 목표 계약의 알려진 차이

아래 차이는 팀원이 각자 다르게 해석하면 안 된다. [MVP 구현 가이드](mvp-implementation-guide.md)의 W0에서 공통 계약을 먼저 만든다.

| 현재 코드 | 목표 계약 | 처리 |
| --- | --- | --- |
| `RoomSubmissionPayload v1`은 `destinationId`만 가짐 | 방장 설정 전체를 받는 `RoomSettings v2` 필요 | v1은 초안 저장 호환용, 계획 시작은 v2 완료 후 허용 |
| `SurveySubmissionPayload v3`에 희망 박수·±1박 유연성이 남아 있음 | 방장 제안 기간에 대한 참가자 확인 사용 | v4에서 `durationAgreementVersion`과 `durationAccepted`로 교체 |
| 현재 화면은 분야별 완전한 5·3·1 응답 구조가 아님 | 음식·숙소·액티비티 분야 순위와 세부 취향 상태 필요 | 프런트와 계약을 함께 수정 |
| 프런트는 API가 없으면 `sessionStorage` 사용 | API 연결 후 서버 ID와 상태 필요 | 로컬 모드는 유지하되 통합 테스트는 API 모드 사용 |

## 6. 역할별 읽기 경로

### 프런트엔드

```text
README 사용자 흐름
→ 백엔드 설계 3~6장
→ 개발·배포 문서 5장
→ MVP 구현 가이드 W1·W2·W8
```

### API·DB

```text
백엔드 설계 3·13·14·15·16장
→ Agent 아키텍처 10·12장
→ MVP 구현 가이드 W1·W2
```

### 결정론 엔진

```text
README 4·5·8·9장
→ 백엔드 설계 4~9장
→ packages/contracts
→ MVP 구현 가이드 W3·W4·W7
```

### Agent·토론

```text
README 6~9장
→ Agent 아키텍처 3·4·7·8장
→ AgentSpec
→ Agent 구현 가이드
→ Agent Runtime 구현·설치·검증 기록
→ MVP 구현 가이드 W5·W6
```

### 데이터·외부 API

```text
Agent 아키텍처 6장
→ 분야별 구현서
→ MVP 구현 가이드 W3·W9
```

### 인프라

```text
개발·배포 문서 1~6장
→ ECS Codex Auth 설계
→ Agent Runtime 구현·설치·검증 기록
→ MVP 구현 가이드 W10
```

## 7. 공통 개발 규칙

1. LLM 출력은 항상 등록된 JSON Schema로 검증한다.
2. 숫자·날짜·예산·만족도·이동시간·상태 전이는 코드가 계산한다.
3. Agent는 DB, 시크릿, Provider 원본 응답에 직접 접근하지 않는다.
4. 하드 제약과 fail-closed 필드가 불명확하면 통과가 아니라 `BLOCKED`다.
5. 이벤트 핸들러와 Worker는 멱등해야 한다.
6. 모든 저장 객체는 `schemaVersion`, 계획 객체는 `planVersion`, 설문은 `snapshotVersion`을 가진다.
7. 변경된 노드는 삭제하지 않고 `STALE`과 사유를 기록한다.
8. 사용자 소유 변경과 기존 팀원 변경을 임의로 되돌리지 않는다.
9. 작업 패키지마다 단위 테스트, 계약 테스트, 실패 테스트를 작성한다.
10. 문서에 없는 새 정책값을 코드에 하드코딩하지 않는다.

## 8. 문서 충돌 보고 형식

```md
## SPEC_CONFLICT

- 작업 패키지: W4
- 주제: 여행 기간 입력
- 문서 A: docs/group-trip-survey-agent-backend.md#3-여행-기본-설정
- 문서 B 또는 코드: apps/web/src/formState.ts
- 충돌: 전원 확정 기간 vs 참가자별 ±1박 유연성
- 영향을 받는 타입/API/테스트: SurveySubmissionPayload, planning start gate
- 임시 구현 여부: 구현 중단
- 필요한 결정: v4 마이그레이션 승인
```

충돌이 하드 제약, 목적급, 점수식, Agent 권한, 검증 상태, 변경 권한에 영향을 주면 팀 합의 전 구현하지 않는다.

## 9. 공통 완료 기준

작업 패키지는 다음 조건을 모두 만족해야 완료다.

- 입력과 출력이 공통 Zod 계약으로 검증된다.
- 정상·경계·실패 테스트가 있다.
- 같은 정규화 입력은 같은 결정론 결과를 만든다.
- 로그에 시크릿·민감 설문 원문이 남지 않는다.
- `npm run typecheck`, `npm run test`, `npm run build`가 통과한다.
- 변경한 계약과 동작을 해당 Markdown에 같이 반영한다.
- 아직 구현하지 않은 기능을 완료로 표시하지 않는다.
