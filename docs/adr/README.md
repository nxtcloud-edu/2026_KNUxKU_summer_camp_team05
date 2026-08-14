# MOA MVP Architecture Decision Records

- 기준일: 2026-08-14
- 적용 범위: 로컬 개발용 오사카 숙소 수직 경로
- 권위: 이 목록의 `Accepted (MVP)` ADR은 README와 기존 목표 설계 문서보다 우선한다.

## 확정 목록

| ADR | 상태 | 결정 |
| --- | --- | --- |
| [0001](0001-mvp-product-flow.md) | Accepted (MVP) | 오사카·성인 3명·3박·숙소 한 카테고리를 종단 검증한다. |
| [0002](0002-agent-roles.md) | Accepted (MVP) | 모델 호출은 사용자 Proxy, 숙소 Arbiter, Trip Supervisor로 제한한다. |
| [0003](0003-orchestrator-authority.md) | Accepted (MVP) | TypeScript Worker가 유일한 업무 오케스트레이터다. |
| [0004](0004-survey-profile.md) | Accepted (MVP) | Survey v4는 고정 11문항만 쓰고 장기 프로필 저장을 하지 않는다. |
| [0005](0005-fairness-selection.md) | Accepted (MVP) | 하드 제약 통과 후 결정론적 leximin으로 선택한다. |
| [0006](0006-data-evidence-state.md) | Accepted (MVP) | 상태는 네 가지로 제한하고 예약 가능·완료를 주장하지 않는다. |
| [0007](0007-local-codex-oauth-runtime.md) | Accepted (MVP) | 모델은 로컬 Codex OAuth Gateway로만 호출한다. |
| [0008](0008-contract-module-ownership.md) | Accepted (MVP) | TypeScript Zod 계약을 제품·통신 계약의 기준으로 삼는다. |

## 해석 규칙

- `Accepted (MVP)`는 현재 구현 판단에 바로 적용한다.
- 전체 0~6단계, 네 도시, 다섯 카테고리, 예약은 제품 목표이며 현재 MVP 완료 조건이 아니다.
- EC2, ECS, EKS, AgentCore와 서버용 모델 API key는 현재 MVP 경로에서 제외한다.
- 사용자만 할 수 있는 확인은 [MVP 출시 게이트](../operations/mvp-release-gates.md)에만 남긴다.
- 문서 간 충돌은 [문서 권위와 변경 규칙](../operations/document-authority.md)에 따라 해소한다.
