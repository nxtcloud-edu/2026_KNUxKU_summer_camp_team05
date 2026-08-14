# MOA Codex Runtime Gateway

`dawnkim`의 Gateway 구현에서 localhost 인증·모델 카탈로그·구조화 출력 부분만 선별 이식한 Python 3.12 서비스다. 제품 오케스트레이터가 아니며 TypeScript Worker가 보낸 한 번의 Agent 호출만 실행한다.

## 현재 범위

- `127.0.0.1` 전용 FastAPI 실행면
- 기존 로컬 Codex OAuth 세션 재사용
- 현재 모델 카탈로그와 운영 allowlist 교집합 확인
- 공식 5역할 `USER_PROXY`, `CANDIDATE_EVIDENCE`, `CATEGORY_ARBITER`, `TRIP_ORCHESTRATOR`, `PLAN_FINALIZER` 호출 계약
- JSON Schema 출력 검증과 최대 1회 복구
- 입력에 없는 Evidence ID 거부
- `runId` 멱등성과 Agent scope별 thread 격리
- 기본 `:memory:` 저장으로 session 종료 시 결과 제거

Python Worker, Agent registry, 제품 상태 전이, Docker, EC2/ECS/EKS, AgentCore, API-key fallback은 포함하지 않는다. 권한은 [ADR-0003](../../docs/adr/0003-orchestrator-authority.md), 런타임은 [ADR-0007](../../docs/adr/0007-local-codex-oauth-runtime.md), 계약 기준은 [ADR-0008](../../docs/adr/0008-contract-module-ownership.md)을 따른다.

## 선별 이식 기록

| `dawnkim` 구성 | 처리 |
| --- | --- |
| `backend.py`, `app.py`, `settings.py`, `store.py`, `redaction.py` | localhost·SDK·격리 로직만 이식 |
| `service.py`, `models.py` | Python Agent registry 의존성을 제거하고 TypeScript 요청 계약 기준으로 재작성 |
| `tests/test_gateway.py` | Fake Backend 기반 allowlist·repair·evidence·thread·privacy 테스트로 재작성 |
| Python `apps/worker`, `packages/agents` | 이식 제외 |
| Dockerfile, Compose, AgentCore/ECS 문서 | 이식 제외 |
| 하드코딩된 모델 ID | 제거, 빈 allowlist로 시작 |

## 로그인 없이 가능한 검증

```bash
python3.12 -m venv /private/tmp/moa-codex-gateway-venv
/private/tmp/moa-codex-gateway-venv/bin/pip install -e 'apps/codex-runtime-gateway[dev]'
/private/tmp/moa-codex-gateway-venv/bin/pytest apps/codex-runtime-gateway/tests
/private/tmp/moa-codex-gateway-venv/bin/mypy apps/codex-runtime-gateway/moa_codex_gateway
```

테스트는 가짜 Backend를 주입하므로 OAuth 로그인과 모델 호출이 없다.

## 실제 로컬 실행

나중에 사용자가 `codex login`을 완료한 뒤 `.env.example`을 참고해 현재 카탈로그에 있는 모델만 allowlist에 넣는다.

```bash
MOA_MODEL_PROFILE_BALANCED='<확인한-model-id>' \
  /private/tmp/moa-codex-gateway-venv/bin/moa-codex-gateway
```

확인 순서는 다음과 같다.

1. `GET /healthz`: 프로세스만 확인한다.
2. `GET /internal/v1/models`: 현재 계정의 모델과 지원 effort를 확인한다.
3. allowlist 설정 후 `GET /readyz`: 인증과 허용 모델 교집합을 확인한다.
4. fixture 요청 1건을 `POST /internal/v1/agent-runs`로 실행한다.

`/readyz` 성공만으로 Agent 결과가 검증된 것은 아니다. 실제 1건의 구조화 출력과 영수증까지 확인해야 `VALIDATED_LOCAL_OAUTH_MVP` 후보가 된다.
