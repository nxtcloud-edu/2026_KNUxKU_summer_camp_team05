# ADR-0003: 오케스트레이터와 상태 권한

- 상태: Accepted (MVP)
- 결정일: 2026-08-14

## 결정

`apps/worker`의 TypeScript `RunController`가 유일한 업무 오케스트레이터이자 상태 전이 권한자다.

RunController는 다음을 소유한다.

- 실행 순서, 시간·호출 상한, 입력 스냅샷과 계약 버전
- 제안 집합 잠금, 투표 완전성, 검증 결과 적용
- leximin 선택, 감사 게이트, 결과 상태와 `DecisionLedger`
- 중복 실행 방지와 명시적 완료·차단

로컬 Codex OAuth Gateway는 모델 실행 서비스다. OAuth 세션, 현재 모델 목록, 모델 allowlist, thread, 구조화 출력 파싱, 최대 1회 복구, 요청 멱등성만 소유하며 제품 상태를 저장하거나 다음 Agent를 선택하지 않는다.

Python Worker나 별도 오케스트레이터를 추가하지 않는다. 다른 브랜치의 Python 구현은 Gateway·Agent 계약만 선별 이식하며 기존 TypeScript Worker를 대체하지 않는다.

## 실행 순서

```text
RunController -> Proxy 호출들 -> Validator/Leximin -> StayArbiter -> TripSupervisor -> 상태 봉인
```

각 단계는 `runId`, `inputVersion`, `proposalSetVersion`, `promptVersion`, `model`을 영수증으로 남긴다. 실패 후 암묵적으로 다음 단계로 넘어가지 않는다.
