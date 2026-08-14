# MOA Python 에이전트 초안

제품 런타임과 분리한 실행 가능한 Python 3.12 초안이다. 사용자별 Proxy, 공통 베이스를 공유하는 카테고리 중재자 5개, 결론을 다시 고르지 않는 여행 총괄 감독관의 경계를 먼저 검증한다.

이 폴더는 현재 TypeScript Worker, 실제 여행 API, DB 원장에 연결되지 않는다. 출력은 `CategoryDecisionDraft`와 `SupervisorReport`이며 `ACCEPTED`, `BOOKABLE`, 실제 예약을 만들지 않는다. AgentCore Gateway inference와 ECS 실행면은 추가됐지만 실제 AWS 배포 완료를 뜻하지 않는다.

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

## AgentCore Gateway 모델 연결

`AgentCoreGatewayBackend`는 OpenAI Responses 호환 inference target을 호출하고 각 에이전트의 JSON Schema를 강제한다. ECS task role의 임시 AWS 자격 증명으로 Gateway 요청을 SigV4 서명하며, OpenAI API key는 AgentCore credential provider가 보관한다.

```text
ECS task role -> AgentCore Gateway -> OpenAI credential provider -> model
```

로컬 Codex의 ChatGPT OAuth 파일을 ECS에 복사하지 않는다. 같은 OpenAI 프로젝트의 서버용 API key를 AgentCore에 등록하고, 모델은 기본 `openai/gpt-5.4-mini` 또는 배포 환경의 `MOA_MODEL`로 선택한다. 자세한 절차는 [infra 배포 경계](infra/README.md)에 있다.

원본 공급자 응답, 다른 사용자의 프로필, API secret을 LLM payload에 넣지 않는다.

현재 범위는 Proxy·카테고리 중재자·감독관 초안이다. `CandidateEvidenceAgent`, `PlanFinalizerAgent`, `DateResolver`, `FactConstraintValidator`의 실제 도메인 구현과 `RunController` 영속화는 이 폴더의 범위가 아니다. 테스트에서는 이미 생성된 `VerificationReceipt`와 결정론적 선택 결과를 입력으로 사용한다.

## 실행

```bash
cd prototypes/python-agents
PYTHONPATH=src python3.12 -m moa_agents.demo
PYTHONPATH=src python3.12 -m unittest discover -s tests -v
mypy --strict src tests
python3.12 -m compileall -q src tests
python3.12 infra/provision_openai_target.py \
  --gateway-id example-gateway \
  --region ap-northeast-2 \
  --dry-run
docker build -t moa-python-agents .
```

## 다음 구현 경계

이 초안 다음에는 별도 작업으로 다음을 연결한다.

1. Survey v4/Profile v1에서 `UserProfileView` 투영
2. TypeScript 계약과 Python 계약의 JSON Schema 단일 원본
3. 실제 `FactConstraintValidator` 영수증 입력
4. 결정론적 `SatisfactionNormalizer`·`LeximinSelector`
5. `RunController`와 불변 `CategoryDecisionContract` 저장 경계
6. 토큰·비용·trace 영속 기록과 retry/timeout 운영 정책
