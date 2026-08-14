# ADR-0008: 계약 기준과 모듈 소유권

- 상태: Accepted (MVP)
- 결정일: 2026-08-14

## 결정

`packages/contracts`의 TypeScript Zod 스키마를 제품·통신 계약의 기준으로 삼는다. Python 수동 Pydantic/dataclass 계약을 사용하는 동안에는 같은 golden JSON fixture를 양쪽에서 통과해야 한다. MVP에서는 코드 생성 도구를 새로 도입하지 않는다.

| 경계 | 소유권 |
| --- | --- |
| `apps/worker` | TypeScript RunController와 제품 상태 전이 |
| `packages/contracts/src/agent-runtime.ts` | 공식 5역할·5카테고리 wire schema, 버전, ID 형식 |
| `packages/core` | 검증, 정규화, leximin, 상태 규칙 |
| `apps/codex-runtime-gateway` | 로컬 OAuth, 모델 카탈로그·allowlist, thread·schema 호출 |
| `prototypes/python-agents` | 오프라인 Agent 계약 실험, 제품 상태 권한 없음 |

`packages/contracts/src/mvp-agent-runtime.ts`와 `packages/agents/src/mvp-runtime.ts`는 이전 3역할 fixture의 migration 호환 파일이다. 공식 제품 계약이나 신규 호출에서 사용하지 않으며 제거는 새 경로의 동등성 검증 뒤 별도 승인으로 진행한다.

다른 브랜치의 Python `apps/worker`나 `packages/agents`를 통째로 병합하지 않는다. Gateway와 Agent 호출 계약만 파일별 차이표, 입력·출력 fixture, 실패 의미가 준비된 뒤 선별 이식한다.

## 계약 규칙

- 모든 wire payload는 `schemaVersion`을 갖는다.
- 알 수 없는 enum과 필수 필드 누락은 조용히 보정하지 않고 실패한다.
- 동일 실행에는 `runId`, `inputVersion`, `proposalSetVersion`을 고정한다.
- Python/TypeScript 중 한쪽의 계약을 바꾸면 golden fixture와 양쪽 validator를 함께 갱신한다.
- 이름이 Agent여도 검증·상태 전이 로직을 LLM 호출로 옮기지 않는다.
