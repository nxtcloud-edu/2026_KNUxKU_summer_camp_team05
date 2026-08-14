# MOA Python 에이전트 초안

제품 런타임과 분리한 실행 가능한 Python 3.12 초안이다. 사용자별 Proxy, 공통 베이스를 공유하는 카테고리 중재자 5개, 결론을 다시 고르지 않는 여행 총괄 감독관의 경계를 먼저 검증한다.

이 폴더는 현재 TypeScript Worker, 실제 여행 API, DB 원장에 연결되지 않는다. 출력은 `CategoryDecisionDraft`와 `SupervisorReport`이며 `ACCEPTED`, `BOOKABLE`, 실제 예약을 만들지 않는다.

**MVP 상태:** Proxy·중재자·감독관 계약과 네트워크 없는 fixture는 참고 구현이다. AgentCore Gateway inference와 ECS 실행면은 과거 실험으로 보존하지만 [로컬 Codex OAuth 런타임 ADR](../../docs/adr/0007-local-codex-oauth-runtime.md)에 따라 현재 MVP에서 사용·확장·배포하지 않는다. 제품 상태 권한은 TypeScript Worker에 있다.

## 구성

```text
src/moa_agents/
├─ contracts.py       불변 입력·출력 계약
├─ backend.py         구조화 JSON LLM 포트와 로컬 scripted backend
├─ agentcore_backend.py AgentCore Gateway Responses 어댑터
├─ aws_transport.py   ECS task role 기반 SigV4 전송
├─ proxy.py           사용자 한 명만 읽는 UserProxyAgent
├─ arbitrators.py     공통 베이스와 중재자 5개
├─ supervisor.py      TripCharter·근거·예산·정원 감사
├─ runtime.py         Proxy 병렬 실행 → 중재 → 감독 초안 흐름
├─ service.py         ECS용 인증 HTTP 실행면
└─ demo.py            네트워크 없는 오사카 숙소 예제

infra/
├─ provision_openai_target.py     OpenAI inference target 생성
├─ ecs-task-role-policy.json      특정 Gateway만 호출하는 task role 정책
├─ ecs-task-definition.template.json ECS Fargate 등록 초안
└─ README.md                      인증·배포·완료 판정 절차
```

중재자 5개는 다음 클래스다.

| 클래스 | 카테고리 | 별도 코드 |
| --- | --- | --- |
| `LongDistanceArbiterAgent` | 오는 길·가는 길 | 필수 검증 규칙과 도메인 지시만 |
| `StayArbiterAgent` | 체류 거점·숙소 | 필수 검증 규칙과 도메인 지시만 |
| `ActivityArbiterAgent` | 갈 곳·할 일 | 필수 검증 규칙과 도메인 지시만 |
| `DiningArbiterAgent` | 식사 | 필수 검증 규칙과 도메인 지시만 |
| `ScheduleArbiterAgent` | 날짜별 일정·현지 이동 | 필수 검증 규칙과 도메인 지시만 |

토론 수렴, 구조화 응답 파싱, 검증 계획안 필터링, 결정론적 선택 고정, 초안 생성은 모두 `BaseCategoryArbiterAgent`가 담당한다.

## 권한 경계

- `UserProxyAgent`는 생성 시 받은 한 명의 `UserProfileView`만 읽는다.
- LLM에는 `ProxyTripView`와 `ProxyProposalView`만 보내 다른 사용자의 예산·프로필·배정 ID를 제거한다.
- Proxy가 반환한 `profileFactRefs`가 자기 프로필에 없으면 실행을 거부한다.
- 중재자는 모든 필수 `VerificationReceipt`가 근거를 가진 `PASS`인 계획안만 다룬다.
- 중재자는 외부 결정론적 선택 결과와 다른 계획안을 선택할 수 없다.
- 감독관은 선택안을 바꾸지 않고 헌장 버전, 개인 예산, 전원 정원 배정, 근거를 감사한다.
- LLM이 `CLEAR`를 반환해도 결정론적 오류가 있으면 `RECHECK` 또는 `HOLD`로 내린다.

## 범위 밖인 AgentCore 참고 구현

`AgentCoreGatewayBackend`는 OpenAI Responses 호환 inference target을 호출하고 각 에이전트의 JSON Schema를 강제한다. ECS task role의 임시 AWS 자격 증명으로 Gateway 요청을 SigV4 서명하며, OpenAI API key는 AgentCore credential provider가 보관한다.

```text
ECS task role -> AgentCore Gateway -> OpenAI credential provider -> model
```

이 경로는 현재 MVP 선택이 아니며 개발·배포 명령을 실행하지 않는다. 로컬 Codex OAuth 파일을 ECS나 다른 호스트에 복사하지 않는다. 과거 구조와 절차는 [infra 배포 경계](infra/README.md)에 참고용으로 남아 있다.

원본 공급자 응답, 다른 사용자의 프로필, API secret을 LLM payload에 넣지 않는다.

현재 범위는 Proxy·카테고리 중재자·감독관 초안이다. `CandidateEvidenceAgent`, `PlanFinalizerAgent`, `DateResolver`, `FactConstraintValidator`의 실제 도메인 구현과 `RunController` 영속화는 이 폴더의 범위가 아니다. 테스트에서는 이미 생성된 `VerificationReceipt`와 결정론적 선택 결과를 입력으로 사용한다.

## 실행

```bash
cd prototypes/python-agents
PYTHONPATH=src python3.12 -m moa_agents.demo
PYTHONPATH=src python3.12 -m unittest discover -s tests -v
mypy --strict src tests
python3.12 -m compileall -q src tests
```

아래 명령은 과거 AgentCore/ECS 실험 재현용이며 현재 MVP 검증 항목이 아니다.

```bash
python3.12 infra/provision_openai_target.py \
  --gateway-id example-gateway \
  --region ap-northeast-2 \
  --dry-run
docker build -t moa-python-agents .
```

## MVP 선별 이식 경계

이 초안 전체를 제품 경로로 병합하지 않는다. 다음 항목만 TypeScript 기준 계약과 golden fixture를 먼저 맞춘 뒤 선별 이식한다.

1. Survey v4/Profile v1에서 `UserProfileView` 투영
2. TypeScript Zod 기준 계약과 Python 계약의 golden JSON fixture
3. 실제 `FactConstraintValidator` 영수증 입력
4. 결정론적 `SatisfactionNormalizer`·`LeximinSelector`
5. TypeScript `RunController`에 호출 결과를 반환하는 로컬 Gateway 경계
6. 모델·prompt·schema·token·시간 영수증과 1회 복구 정책
