# ECS + AgentCore Gateway 배포 경계

## 인증 구조

```text
내부 호출자
  -> ECS의 MOA Python 에이전트 서비스
  -> ECS task role의 SigV4
  -> AgentCore Gateway /inference/v1/responses
  -> AgentCore credential provider의 OpenAI API key
  -> OpenAI model
```

로컬 Codex의 `~/.codex/auth.json`, ChatGPT refresh token, `CODEX_ACCESS_TOKEN`을 이미지·ECS secret·환경 변수로 복사하지 않는다. Codex CLI와 동일한 OpenAI 프로젝트를 쓰려면 별도의 프로젝트 범위 API key를 발급하고 그 키를 AgentCore credential provider에 저장한다. ECS에는 OpenAI key를 전달하지 않는다.

`gpt-5.4-mini`는 여행 대리·중재 MVP의 기본 비용/지연 모델이다. `gpt-5.4`와 `gpt-5.3-codex`도 target allowlist에 넣을 수 있지만, 다중 Proxy와 중앙 Planner 비교에서는 양쪽에 동일한 모델·reasoning effort·후보·제약·도구 예산을 써야 한다.

## 1. Gateway 생성

Gateway service role은 AWS 콘솔 또는 AgentCore CLI가 만드는 최소 권한 역할을 우선 사용한다. Gateway inbound authorizer는 `AWS_IAM`으로 둔다.

```bash
aws bedrock-agentcore-control create-gateway \
  --name moa-agent-gateway \
  --role-arn <GATEWAY_SERVICE_ROLE_ARN> \
  --protocol-type MCP \
  --authorizer-type AWS_IAM \
  --region <REGION>
```

응답의 `gatewayId`와 `gatewayUrl`을 보관한다. AWS가 반환하는 `gatewayUrl`이 `/mcp`로 끝나도 백엔드는 같은 Gateway origin의 `/inference/v1/responses`로 정규화한다.

## 2. OpenAI inference target 생성

`OPENAI_API_KEY`는 셸 환경에서만 읽고 명령행 인자로 넘기지 않는다.

```bash
cd prototypes/python-agents
python3.12 -m pip install '.[deploy]'
OPENAI_API_KEY='<PROJECT_SCOPED_KEY>' \
python3.12 infra/provision_openai_target.py \
  --gateway-id <GATEWAY_ID> \
  --region <REGION>
```

생성될 요청만 확인하려면 API key 없이 `--dry-run`을 쓴다. 재실행 시에는 기존 credential provider ARN을 `--credential-provider-arn`으로 전달해 키 저장소를 중복 생성하지 않는다.

## 3. ECS task role

`ecs-task-role-policy.json`의 세 placeholder를 실제 값으로 바꿔 task role에 붙인다. 핵심 권한은 특정 Gateway ARN에 대한 `bedrock-agentcore:InvokeGateway` 하나다. 컨테이너는 ECS task role의 임시 자격 증명을 botocore 기본 credential chain으로 얻고 요청을 SigV4 서명한다.

## 4. 이미지와 Task Definition

```bash
docker build -t moa-python-agents prototypes/python-agents
```

ECR로 푸시한 뒤 `ecs-task-definition.template.json`의 placeholder를 치환해 등록한다. `MOA_SERVICE_TOKEN`은 32자 이상의 무작위 값을 Secrets Manager에 저장하고 ECS execution role에 해당 secret 읽기 권한을 준다. OpenAI key는 task definition에 넣지 않는다.

서비스는 다음 두 경로만 제공한다.

- `GET /health`: 인증 없는 컨테이너 상태 확인
- `POST /v1/category-runs`: `Authorization: Bearer <MOA_SERVICE_TOKEN>` 필수

MVP에서도 ECS task는 private subnet에 두고, 외부 공개가 필요하면 인증이 있는 API Gateway 또는 내부 ALB 뒤에 둔다. 이 HTTP 토큰 하나만으로 인터넷에 직접 공개하지 않는다.

## 5. 실행 판정

다음이 모두 확인되기 전에는 “AgentCore 연결 완료”라고 표시하지 않는다.

1. `aws sts get-caller-identity` 성공
2. Gateway target 상태가 준비됨
3. ECS task가 `RUNNING`이고 health check 통과
4. CloudWatch에 provider secret 없이 호출 기록 생성
5. 실제 `POST /v1/category-runs`가 Proxy 투표, 중재 초안, 감독 보고서를 반환
6. 실패·근거 누락 fixture가 `NO_SAFE_DECISION` 또는 `HOLD/RECHECK`로 닫힘

## 공식 기준

- [AgentCore inference provider target](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-target-inference-provider.html)
- [AgentCore Gateway inbound IAM authorization](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-inbound-auth.html)
- [OpenAI API 서버 인증](https://platform.openai.com/docs/api-reference/authentication)
- [GPT-5.3-Codex Responses 지원](https://developers.openai.com/api/docs/models/gpt-5.3-codex)
