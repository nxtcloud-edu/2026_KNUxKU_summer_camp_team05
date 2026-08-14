# ADR-0007: 로컬 Codex OAuth Gateway 런타임

- 상태: Accepted (MVP)
- 결정일: 2026-08-14

## 결정

MVP의 모델 호출은 개발자 컴퓨터의 **Codex OAuth Gateway**로만 실행한다.

```text
로컬 Web/API/TypeScript Worker
  -> 127.0.0.1 Codex OAuth Gateway
  -> 사용자가 Codex에 로그인한 현재 모델 카탈로그
```

EC2, ECS, EKS, AgentCore, 서버용 모델 API key, 원격 공개 Gateway는 현재 범위에서 사용하지 않는다. 미래 원격 실행은 인증·보존·비용·장애 경계를 다시 다루는 새 ADR이 필요하다.

## 보안과 실패 규칙

- Gateway는 기본적으로 `127.0.0.1`에만 바인딩한다.
- Codex OAuth 자격 증명을 저장소, Docker image, EC2, 로그, 모델 payload에 복사하지 않는다.
- `codex login`은 사용자가 직접 수행한다.
- 모델은 현재 `model/list`와 환경 allowlist의 교집합에서만 선택한다.
- 허용 모델이 없으면 닫힌 실패로 종료하며 임의 모델이나 API key 공급자로 fallback하지 않는다.
- MVP 기본 실행은 한 작업씩, 단계별 timeout, 구조화 출력 복구 최대 1회다.

Gateway는 업무 상태와 사용자 프로필 원본을 영속화하지 않는다. 필요한 최소 투영과 상관 ID만 받는다.

## 사용자 확인

로그인과 실제 카탈로그에서 허용할 모델 선택은 코드가 대신할 수 없다. 해당 두 항목만 [MVP 출시 게이트](../operations/mvp-release-gates.md)에 남긴다.
