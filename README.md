# 멀티 에이전트 여행 계획 중재 서비스

> 2026 강원대x고려대 Summer Agentic AI 심화 몰입 캠프 5팀 레포지토리

## 한 줄 소개

목적지가 정해진 방에 지인들이 모여 각자의 취향·신념·예산을 설문으로 입력해두면, 각자를 대변하는 AI 에이전트들이 알아서 토론하고 카테고리별 심판 에이전트가 실제 여행 API로 팩트체크하며 조정해, 나중에 결과만 확인하면 되는 여행 계획 서비스입니다.

## 왜 만드나

3~8명 규모의 지인 여행에서 계획이 무산되는 이유는 정보 부족이 아니라 **의사결정 비용**입니다. 총무 한 명이 과부하되고, "아무거나 괜찮아"라고 말한 사람이 가장 불만족하며, 단톡방에는 링크만 쌓입니다. 무엇보다 **6명이 동시에 모여 논의할 시간대는 존재하지 않습니다.**

그래서 이 서비스는 실시간 합의를 요구하지 않습니다. 각자 편한 시간에 7분 설문만 하고 잊어버리면, 나중에 결과가 도착해 있습니다.

## 어떻게 동작하나

```
방장     목적지만 선택 → 초대 링크 공유                       30초
참여자   설문 응답 → 페르소나 카드 확인 → 앱을 닫는다          7분
시스템   날짜 자동 확정 → R0~R6 라운드 자동 실행 (백그라운드)   5~20분
알림     "여행 계획이 완성되었습니다"
결과     최종 계획서 + 회의록 전문 + 만족도·양보 기록 확인      5분
```

- **날짜는 방장이 정하지 않습니다.** 설문으로 모은 가용 일정에서 DateResolver가 전원 가능한 구간을 계산하고, 항공료·요일·계절을 점수화해 자동 확정합니다.
- **7개 라운드**(프레이밍 / 이동 / 숙소 / 액티비티 / 식사 / 동선 / 예산)를 순차 실행하며, 라운드마다 전용 심판 에이전트가 실제 API로 후보를 조달하고 판결합니다.
- **총괄 심판(Chief)** 이 만족도·예산·제약 위반을 검사해 기준 미달이면 해당 라운드를 자동 재개최합니다.
- 결과를 본 참여자는 **이의를 제기해 다시 토론시킬 수 있습니다.** 방 3회, 1인 1회. 회의록의 특정 발언·판결을 지목하면 심판이 그 지점을 다시 검증합니다.

## 핵심 설계

| 항목 | 내용 |
| --- | --- |
| 완전 비동기 | 실시간 개입 채널 없음. 설문이 유일한 입력, 페르소나 확인이 마지막 통제 지점 |
| 환각 없는 그라운딩 | 에이전트는 심판이 API로 가져온 실제 후보 안에서만 논쟁 |
| 평등주의 합의 | 총합이 아니라 **최소 만족도 극대화(Maximin)** 로 후보 선택 |
| 양보 크레딧 | 많이 양보한 사람에게 다음 라운드 발언 우선권과 가중치 부여 |
| Destination Pack | 목적지 하나 = 데이터 패키지 하나. 코드 배포 없이 DB 추가로 확장 |
| 관전 가능한 의사결정 | "왜 이 숙소인가"가 회의록으로 남고, 소수 의견도 기록 |

MVP 대상은 한국 5곳 + 일본 6곳, 총 11개 Destination Pack입니다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [travel-mediation-plan.md](docs/travel-mediation-plan.md) | 종합 기획서 — 문제 정의, 설문 설계, 에이전트 아키텍처, 합의 알고리즘, 시스템 구성, 로드맵 |
| [agent-architecture.md](docs/agent-architecture.md) | 에이전트 아키텍처와 제어 계약 — 제어 평면 분리, 심판 호출 순서 디스패치 프로토콜, Data Agent 캐시 계약 |
| [development-and-deployment.md](docs/development-and-deployment.md) | 개발 환경과 배포 계획 — 저장소 구조, 스택 결정, 로컬 실행, 프론트–백엔드 계약, AWS EC2 배포 |
| [objection-and-rerun.md](docs/objection-and-rerun.md) | 이의 제기와 재토론 — 횟수 상한, 심사·승인 규칙, 재실행 범위 산출, 늦은 하드 제약 등록 |
| [team-assignments.md](docs/team-assignments.md) | 팀 역할과 작업 폴더 — 4개 트랙의 소유 범위, 첫 과제, 트랙 간 접점 |
| [survey-v3-proposal.md](docs/survey-v3-proposal.md) | 설문 v3 제안 검토 — 4단계 중요도 척도, 기존 설계와의 충돌과 결정 |
| [llm-runtime-config.md](docs/llm-runtime-config.md) | LLM 런타임 설정 — 모델 티어, 프롬프트 캐싱 제약, 원가 상한과 실측 항목 |
| [flight-referee-implementation.md](docs/flight-referee-implementation.md) | 항공권 심판 — Amadeus API 활용, 항공료 지수, 시간대 제약 처리 |
| [transport-referee-implementation.md](docs/transport-referee-implementation.md) | 교통편 심판 — 국내/일본 대중교통, 교통패스 손익분기 엔진 |
| [accommodation-referee-implementation.md](docs/accommodation-referee-implementation.md) | 숙소 심판 — 숙소 후보 조달, 방 배정 서브문제, 한국 숙박 데이터 공백 대응 |

## 포지셔닝

> **"모두의 의견이 반영된 납득 가능한 초안을, 아무도 고생하지 않고 얻는다."**

사용자가 중간에 개입할 수 없는 서비스는 "완벽한 계획"을 약속하면 안 됩니다. 대신 결과에 불만이 있으면 카테고리를 지정해 재개최(rerun)를 요청할 수 있습니다.


## 로컬에서 실행하기

Node 20.10+ (`.nvmrc` = 20.20.2), npm 10+, Docker Desktop이 필요합니다.

```bash
npm install        # 워크스페이스 전체 설치
npm run local:up   # PostgreSQL 16 · Redis 7 (docker compose)
npm run dev        # 프론트엔드 개발 서버 → http://localhost:5173
npm run typecheck  # 워크스페이스 전체 검증
```

백엔드를 붙일 때는 DB를 먼저 준비하고 실행 검증을 통과시킨다.

```bash
export DATABASE_URL=postgres://tm:tm_local@localhost:5432/travel_mediation
npm run migrate --workspace @tm/db   # 스키마 적용
npm run smoke   --workspace @tm/db   # 리포지토리 왕복 검증
```

`VITE_API_BASE_URL`을 비워두면 폼 제출이 `sessionStorage`에 적재되어, 백엔드 없이도 전체 화면 흐름을 확인할 수 있습니다. 구조·스택·환경변수·배포는 [development-and-deployment.md](docs/development-and-deployment.md)를 참고하세요.

```text
apps/web/          MOA 프론트엔드 (React 19 + Vite 7 + Tailwind)
packages/contracts/ 공용 타입·zod 스키마
docs/              설계 문서
```

## 현재 제공 상태

이 저장소는 **설계 문서 단계**입니다. 문서에 적힌 `Must` 항목은 MVP에 포함할 범위이며, 구현·통합·운영 검증이 끝났다는 뜻이 아닙니다.

| 기능 | 설계 | 구현 | 검증 |
| --- | --- | --- | --- |
| DateResolver·전역 계획 그래프 | 완료 | 미착수 | 미착수 |
| Orchestrator·Supervisor 제어 분리 · Data Agent 캐시 계약 | 완료 | 미착수 | 미착수 |
| 프론트엔드 화면 흐름 (MOA MVP) | 완료 | 진행 | 미착수 |
| API·Worker 골격 (방·설문·이의 접수, 잡 큐) | 완료 | 진행 | API 경로 실행 검증 |
| PostgreSQL 스키마·리포지토리 | 완료 | 진행 | 로컬 실행 검증 통과 |
| Data Agent 게이트웨이·캐시 정책 | 완료 | 진행 | 테스트 26개 통과 |
| 제공자 어댑터 (Amadeus·Rakuten·ODsay 등) | 완료 | 미착수 | 미착수 |
| 심판·Supervisor·페르소나 구현 | 완료 | 미착수 | 미착수 |
| 이의 제기·재토론 (상한·영향 산출·재실행) | 완료 | 진행 | 접수→큐→워커→기록 한 바퀴 검증 |
| Flight / Transport / Accommodation 심판 | 완료 | 미착수 | 미착수 |
| Activity / Dining / Scheduler / Budget / Chief 상세 구현 | 담당 팀 진행 | 미착수 | 미착수 |
| 예약 상태·재계획·사용자 결과 UX | 완료 | 미착수 | 미착수 |

## 신뢰할 수 있는 대리인 원칙

MVP의 에이전트는 항공사·호텔과 가격을 직접 협상하지 않는다. 검증된 공급자 데이터를 비교하고, 사용자가 사전에 위임한 범위 안에서 후보·객실 조합·이동 정책을 다시 탐색하는 **사용자 대리인**이다. 모든 최종 결정에는 `주장 → 근거 → 바뀐 제약 또는 점수 → 대안 → 최종 계획 변화`의 감사 기록을 남긴다.

계획은 다음 상태를 명확히 구분한다.

- **초안**: 후보는 있으나 핵심 검증이 끝나지 않은 상태
- **검증됨**: 하드 제약, 시간, 동선, 예산을 통과한 상태
- **예약 가능**: 가격·재고·시간 슬롯 등 예약 전 필수 확인을 통과한 상태
- **예약 완료**: 사용자가 링크아웃 예약을 확인했거나 향후 공급자 연동으로 확정된 상태

알레르기 대응, 그룹 수용 인원·객실 조합, 접근성, 필수 영업·시간 슬롯처럼 안전 또는 실행 가능성에 직결되는 조건은 확인 전 최종 후보가 될 수 없다.

## 개발·협업 기준

- `main`에는 PR로만 병합하고, 브랜치 보호·필수 검사·최소 1인 승인은 GitHub 저장소 설정에서 활성화한다.
- 작은 기능 브랜치와 단일 목적 PR을 사용한다. 프롬프트·점수·스키마 변경 PR은 영향받는 Planning Graph 노드와 재현/eval 결과를 명시한다.
- 외부 API 호출은 mock/fixture 계약 테스트로 기본 검증하고, 실제 API 호출은 비용 상한이 있는 sandbox 또는 nightly 작업으로 분리한다.
- 민감한 설문·객실 배정 정보·API 키는 커밋하지 않는다. 로컬 값은 `.env`에 두고, 운영 비밀은 GitHub Actions Secrets 또는 배포 환경의 시크릿 저장소로 관리한다.
- 문서 링크와 구조 검증은 GitHub Actions에서 실행한다. 코드 도입 후 lint, typecheck, unit, schema/contract, provider mock, deterministic replay, prompt regression, build를 필수 검사로 확장한다.

`CODEOWNERS`의 실제 사용자/팀 매핑은 조직의 GitHub 계정이 확정된 뒤 추가한다. 잘못된 소유자를 임의로 지정하지 않는다.
