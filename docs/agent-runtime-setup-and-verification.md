# Agent Runtime 구현·설치·검증 기록

- 기록일: 2026-08-14
- 범위: `packages/agents`, `apps/codex-runtime-gateway`, `apps/worker`
- 상태: 로컬 구현과 의존성 설치 검증 완료, 실제 Codex 호출은 사용자 로그인 후 가능

## 1. 결과 요약

MOA의 6개 Agent, Codex Runtime Gateway, Worker Orchestrator를 로컬에서 실행할 수 있는 형태로 연결했다. 프로젝트 전용 `.venv`에 세 로컬 패키지를 editable로 설치했으며, 직접 import와 console entry point, 의존성 일관성, 테스트와 프런트 빌드를 검증했다.

```text
MOA Worker
  → CodexAgentRuntime
    → HttpCodexGatewayClient
      → Codex Runtime Gateway
        → 공식 openai-codex SDK
          → Gateway 전용 Codex Auth
```

Worker는 Codex 인증 파일을 읽지 않는다. 인증·모델 카탈로그·thread는 Gateway가 소유하고, Worker는 localhost HTTP 계약만 사용한다.

## 2. 구현 위치

| 영역 | 위치 | 책임 |
| --- | --- | --- |
| 6개 Agent 계약·Runtime | `packages/agents/moa_agents` | strict 입출력, 프롬프트, Fixture/Codex Runtime |
| 역할별 프롬프트 | `packages/agents/prompts` | 버전별 검토용 프롬프트 |
| Codex Gateway | `apps/codex-runtime-gateway` | Auth, 모델 allowlist, JSON Schema, thread, repair |
| Worker | `apps/worker` | Agent 순서, 반복 상한, 사용자 대기·재개, 최종 반영 권한 |
| 로컬 컨테이너 | `docker-compose.yml` | Gateway·Worker·영속 volume과 health check |

### Gateway 구현

- 공식 `openai-codex` Python SDK 사용
- `POST /internal/v1/agent-runs`
- Auth 원문을 노출하지 않는 fingerprint 생성
- 현재 계정의 모델 카탈로그와 운영 allowlist 교집합으로 모델 선택
- Agent별 Pydantic JSON Schema 검증
- 잘못된 출력은 같은 thread에서 1회 repair
- 입력에 없는 evidence ID를 출력하면 fail-closed
- `runId` 멱등 캐시와 Proxy별 thread 격리
- 인증정보 로그 redaction

### Worker 구현

- Candidate Search → Participant Proxies → Logic Auditor → Category Watcher → Debate Supervisor → Result Finalizer 순서
- Proxy는 병렬 실행
- `REQUEST_REBUTTAL`, `PROPOSE_COMPROMISE`, `CALL_VOTE`는 최대 3회 안에서 다음 iteration으로 진행
- `WAIT_FOR_USER`는 SQLite에 저장하고 `/resume`으로 재개
- `VERIFIED`이고 필수조건을 통과한 계획만 Finalizer에 전달
- Worker 재시작 시 `QUEUED`·`RUNNING` Job 복구

## 3. 설치 과정에서 발견하고 해결한 문제

### 3.1 로컬 Python 패키지 미설치

처음에는 외부 라이브러리만 설치돼 있고 다음 배포판이 설치되지 않았다.

- `moa-agents`
- `moa-codex-runtime-gateway`
- `moa-agent-worker`

`pytest.ini`가 소스 디렉터리를 `PYTHONPATH`에 추가해 테스트는 통과했지만, `python -m moa_codex_gateway`와 `python -m moa_worker`는 `No module named ...`로 실패했다. 프로젝트 전용 `.venv`를 만들고 세 패키지를 editable로 설치해 해결했다.

### 3.2 setuptools package discovery 오류

최초 editable 설치는 배포판 metadata와 실행 파일만 만들고 `moa_agents` 모듈을 포함하지 않았다. `packages/agents/src` 디렉터리를 setuptools가 자동으로 src-layout으로 오인한 것이 원인이었다.

각 `pyproject.toml`에 package discovery를 명시했다.

```toml
[tool.setuptools.packages.find]
where = ["."]
include = ["moa_agents*"] # Gateway와 Worker는 각자의 모듈 이름 사용
```

재설치 후 세 모듈 직접 import와 두 console entry point load가 성공했다.

### 3.3 전역 Python 의존성 충돌

전역 Python에는 `opentelemetry-exporter-otlp-proto-grpc 1.43.0`과 `opentelemetry-sdk 1.44.0` 충돌이 있었다. 이 저장소가 OpenTelemetry를 직접 사용하지는 않지만 전역 환경을 계속 사용하면 다른 패키지의 영향을 받을 수 있다. `.venv`로 격리한 뒤 `pip check`는 `No broken requirements found`를 반환했다.

### 3.4 Starlette TestClient 경고

최신 Starlette는 `fastapi.testclient.TestClient`에서 `httpx2`를 우선 사용한다. 테스트 전용 의존성에 `httpx2>=2.10,<3`을 추가해 deprecation warning을 제거했다. 런타임 HTTP 클라이언트인 `httpx`는 그대로 유지한다.

### 3.5 생성물 관리

- `.venv/`를 Git에서 제외
- `*.egg-info/`를 Git에서 제외
- 잘못된 최초 editable 설치가 만든 `egg-info` 생성물 제거

## 4. Windows PowerShell 설치

저장소 루트에서 실행한다.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e "packages/agents[dev]"
python -m pip install -e "apps/codex-runtime-gateway[dev]"
python -m pip install -e "apps/worker[dev]"
python -m pip check
python -m pytest -q
```

PowerShell 실행 정책 때문에 활성화할 수 없으면 가상환경 Python을 직접 호출한다.

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

## 5. Codex 인증과 모델 설정

공식 SDK와 CLI는 같은 Codex 로그인 저장소를 사용한다. 인증은 사용자가 직접 완료해야 한다.

```powershell
codex login --device-auth
codex login status
```

`apps/codex-runtime-gateway/.env.example`을 기준으로 세 profile을 설정한다.

```text
FAST            → gpt-5.6-luna
BALANCED        → gpt-5.6-terra
DEEP_REASONING  → gpt-5.6-sol
```

실제 선택은 위 이름을 하드코딩하는 방식이 아니라 환경변수 allowlist와 현재 Auth의 모델 카탈로그가 모두 허용하는 경우에만 성공한다. 교집합이 없으면 `MODEL_PROFILE_UNSATISFIED`로 종료한다.

## 6. 실행과 상태 확인

가상환경을 활성화한 터미널 두 개에서 각각 실행한다.

```powershell
moa-codex-gateway
```

```powershell
moa-agent-worker
```

| 서비스 | 주소 | 상태 확인 |
| --- | --- | --- |
| Gateway | `http://127.0.0.1:4600` | `GET /healthz`, `GET /readyz` |
| Worker | `http://127.0.0.1:4700` | `GET /healthz`, `GET /readyz` |

Docker로 실행할 때는 Gateway 전용 volume에 먼저 로그인한다.

```powershell
docker compose --profile agents run --rm codex-runtime-gateway codex login --device-auth
docker compose --profile agents up --build
```

## 7. 최종 검증 결과

| 검증 | 결과 |
| --- | --- |
| Python | 3.12.10 |
| `.venv` pip | 26.2.1 |
| `moa-agents` | 0.1.0, import 성공 |
| `moa-codex-runtime-gateway` | 0.1.0, entry point 성공 |
| `moa-agent-worker` | 0.1.0, entry point 성공 |
| `openai-codex` | 0.144.4 |
| `pip check` | 깨진 의존성 없음 |
| Python 테스트 | 21개 통과, 경고 없음 |
| npm lockfile | offline dry-run 일치 |
| ESLint | 통과 |
| TypeScript typecheck | 통과 |
| Vite production build | 통과, 4,982 modules transformed |
| Docker Compose config | 통과 |

Vite는 minified JavaScript chunk가 약 527KB라 code-splitting 경고를 출력한다. 이는 라이브러리 누락이나 빌드 실패가 아니며 추후 성능 최적화 항목이다.

현재 Node는 24.15.0이고 `.nvmrc`는 20.20.2다. 둘 다 현재 package engine 범위를 만족하고 빌드도 성공했지만, CI 재현성을 위해 팀 개발 환경은 `.nvmrc` 버전에 맞추는 것이 권장된다.

## 8. 편집기 확장

저장소에는 `.vscode/extensions.json`이 없으므로 필수 VS Code 확장은 정의돼 있지 않다. CLI build·lint·test는 확장 없이 동작한다. 다음 확장은 개발 편의를 위한 선택 사항이다.

- Python
- Pylance
- ESLint
- Tailwind CSS IntelliSense
- Docker
- EditorConfig

IDE에서만 `Import could not be resolved`가 보이면 확장 누락보다 `.venv` interpreter가 선택됐는지 먼저 확인한다.

## 9. 아직 남은 외부 작업

- 사용자 Codex device login
- 실제 계정으로 Agent 1회 호출과 token usage 확인
- Provider API와 Data Gateway 연결
- SQS/RDS adapter
- ECS/EFS/KMS 인프라 프로비저닝

위 항목은 라이브러리 누락이 아니라 인증 또는 후속 인프라 작업이다.

## 10. Windows pytest 임시 폴더 권한 오류

Windows에서 기본 임시 경로인 `%TEMP%\pytest-of-<사용자>` 또는 저장소의 `.pytest_cache`에 `WinError 5`가 발생하면 테스트 본문이 아니라 `tmp_path` fixture의 준비 단계에서 중단된다. 특히 Codex 샌드박스와 사용자 PowerShell이 같은 고정 경로를 사용하면 서로 다른 Windows 보안 주체가 만든 ACL 때문에 다시 접근 오류가 발생할 수 있다.

이 저장소의 루트 `conftest.py`는 실제 Windows 로그인 주체별 경로를 자동 선택한다. 예를 들어 사용자 PowerShell은 `.pytest-tmp-airsk/`, Codex 검증 환경은 `.pytest-tmp-CodexSandboxOffline/`를 사용한다. pytest 캐시는 검증에 필수적이지 않아 `pytest.ini`에서 비활성화했다.

사용자별 임시 경로는 `.gitignore`에 포함되어 Git에 올라가지 않는다. 따라서 잠긴 시스템 임시 폴더를 삭제하거나 관리자 PowerShell로 테스트할 필요 없이 기존 명령을 그대로 실행하면 된다.

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

2026-08-14 재검증 결과는 `21 passed`다. 이전의 9개 `ERROR at setup`은 애플리케이션 assertion 실패가 아니라 pytest 임시 디렉터리 접근 실패였다.
