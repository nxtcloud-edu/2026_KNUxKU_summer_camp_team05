# MOA: 멀티 에이전트 그룹 여행 계획 서비스

> 2026 강원대×고려대 Summer Agentic AI 심화 몰입 캠프 5팀

## 한 줄 소개

목적지와 목표 페이스를 정한 방에 지인들이 모여 취향·가치 정책·개인 예산·제약을 입력하면, 각자를 대변하는 AI 에이전트들이 카테고리별로 토론하고 실제 여행 데이터로 검증해 나중에 근거와 결과만 확인하게 하는 비동기 그룹 여행 계획 서비스입니다.

## MVP 범위

- 사용자: 한국어를 쓰는 20대 그룹 여행자
- 목적지·카테고리: 오사카의 체류 거점·숙소
- 고정 시나리오: 성인 3명, 3박
- 방장 권한: 목적지와 설명용 목표 페이스 확정
- 참여자 입력: 가용 날짜, 하드 제약, 개인 목표·절대상한 예산, 가치 정책, 취향, 같은 객실·테이블·회차 이용과 분리 허용 범위
- 토론 중 사용자 개입: 없음
- 결과: 근거가 표시된 숙소 카테고리 결과, 사용자 선택 필요 또는 정직한 차단
- 실행: localhost의 Codex OAuth Gateway만 사용하며 EC2·ECS·AgentCore·예약은 범위 밖

## 목표 제품 흐름

아래 0~6단계는 전체 제품의 목표다. 현재 MVP는 0단계의 확정 입력 스냅샷과 2단계 숙소 결과까지만 종단 검증하며 `FinalPlanRecord`를 완료 조건으로 삼지 않는다.

| 단계 | 사용자에게 보이는 범위 | 시스템 처리 | 핵심 출력 |
| --- | --- | --- | --- |
| 0 | 여행 헌장·리스크 설정 | 프로필 스냅샷, 결정론적 `DateResolver`, `TripCharter` 생성 | `DateDecision`, `TripCharter` |
| 1 | 오는 길·가는 길 | 대리인 토론·중재·검증 | `CategoryDecisionContract` |
| 2 | 체류 거점·숙소 | 대리인 토론·중재·검증 | `CategoryDecisionContract` |
| 3 | 갈 곳·할 일 | 대리인 토론·중재·검증 | `CategoryDecisionContract` |
| 4 | 식사 | 대리인 토론·중재·검증 | `CategoryDecisionContract` |
| 5 | 날짜별 일정·현지 이동 | 대리인 토론·중재·검증 | `CategoryDecisionContract` |
| 6 | 통합 확정·실행 준비 | 별도 토론 없이 연속성·예산·날씨·예약·시간 통합 검사 | `FinalPlanRecord` 또는 차단 사유 |

예산, 날씨, 예약 가능성, 취소 조건은 6단계에서 처음 확인하지 않습니다. 각 후보와 계약을 만들 때 계속 검사하고, 6단계에서 결합 결과를 다시 검사합니다.

## 목표 역할과 MVP 권한

### LLM 에이전트 5종

| 역할 | 책임 |
| --- | --- |
| `UserProxyAgent` | 확정 프로필과 이번 여행 예외를 근거로 한 사용자를 대변 |
| `CandidateEvidenceAgent` | 승인된 공급자로 후보와 출처 있는 근거를 수집 |
| `CategoryArbiterAgent` | 1~5단계의 토론을 중재하고 종료·카테고리 결론 계약을 작성 |
| `TripOrchestratorAgent` | 날짜·페이스·개인별 예산·근거·전역 제약 이탈을 감사 |
| `PlanFinalizerAgent` | 승인 계약들의 의미 연속성을 대조하고 사용자용 최종 초안을 구성 |

이 다섯 역할은 목표 아키텍처다. MVP에서 실제 모델을 호출하는 역할은 참여자별 `UserProxyAgent`, 숙소 전용 `StayArbiterAgent`, 감사용 `TripSupervisorAgent` 세 종류다. 후보 조달과 최종 표시는 결정론적 데이터 게이트웨이와 렌더러가 담당한다.

### 결정론적 제어 3종

| 구성요소 | 책임 |
| --- | --- |
| `DateResolver` | 참여자의 가용 날짜·박수·유연성으로 날짜를 계산 |
| `FactConstraintValidator` | 가격·재고·주소·시간·동선·예산·제약을 기계적으로 검사 |
| `RunController` | 호출 순서, 큐, 상한, 계약 버전·잠금, 상태 전이를 집행 |

후보 조달, 사실 판정, 카테고리 결론은 한 에이전트가 동시에 소유하지 않습니다. LLM은 검증 실패를 덮어쓸 수 없고 DB 상태를 직접 바꾸지 않습니다.

## 공정성과 계약

1. 안전·접근성·개인 절대예산·실행 가능성을 먼저 통과시킵니다.
2. 같은 `proposalSetVersion`의 `CategoryProposal`에 모든 대리인이 `ProxyBallot`을 냅니다.
3. 만족도 벡터에 `leximin`을 적용해 최저 만족 사용자부터 차례로 보호합니다.
4. 동률이면 평균 만족도, 양보 불균형, 비용·동선·취소 가능성, 근거 품질 순으로 풉니다.
5. 양보 크레딧은 원장과 최종 동률 해소에만 쓰며 발언권·성격·점수를 강화하지 않습니다.

`CategoryDecisionContract`는 불변입니다. 검증 결과와 생명주기는 `CategoryContractView`로 투영하고, 상태 사건은 append-only `DecisionLedger`에 기록합니다. `CONTINUE`는 체크포인트만 저장하며, `NO_SAFE_DECISION`은 선택안 없이 `blockReason`을 가진 차단 계약을 남깁니다.

인원 수 적합성은 취향 점수가 아니라 하드 제약입니다. 숙소 객실 정원, 식당 예약 인원, 활동 회차 정원, 교통 좌석·차량 정원을 정확한 날짜·시간·인원 요청에서 검증합니다. 장소의 총 좌석 수나 객실 수만으로 그룹 전체가 함께 이용할 수 있다고 추정하지 않으며, 확인되지 않은 분리는 `PASS`가 아닙니다.

## Survey v4 + Profile Schema v1

- 행동축 47개는 질문 47개가 아니라 백엔드 후보 라이브러리입니다.
- 최초에는 공통 핵심축 5개와 도시별 초기축 6개를 사용합니다.
- 도시별 축은 후보 순위를 가를 가능성이 큰 초기 가설이며, 실제 후보 분산에 따라 최대 2개를 교체합니다.
- 취향 질문은 정확히 11개 블록이며 MVP에서는 적응형 질문을 사용하지 않습니다.
- 날짜·하드 제약·개인 예산·가치 정책은 11개 취향 질문과 별도 필수 입력입니다.
- 예산은 비율이 아니라 보호할 1·2순위와 선택형 추가 지불 가능 금액으로 받습니다.
- 자유서술은 최대 5개 `ProfilePatchCandidate`로 바꾸되 MVP에서는 session-only로 사용하며 장기 `CanonicalProfile`에 저장하지 않습니다.
- `approval_required`는 선호 강도가 아니라 에이전트의 자동 확정 권한을 막는 상태입니다.

자세한 문항·매핑·데이터 계약은 [Survey v4 + Profile Schema v1](docs/survey-v4-profile-v1.md)에 있습니다.

## 외부 데이터와 예약 상태

MVP의 기본 공급자는 공개·셀프서비스 범위 안에서 사용합니다. 빈 공급자 슬롯은 사실처럼 메우지 않습니다.

아래는 2026-08-14 재조사 기준으로 **키만 넣으면 도는 어댑터**입니다. 무료·셀프서비스 범위만 씁니다.

| 범위 | 한국 | 일본 |
| --- | --- | --- |
| POI·장소 메타데이터 | TourAPI, Kakao 로컬 | 미확보 |
| 식당 메타데이터 | TourAPI, Kakao 로컬 | HotPepper |
| 숙소 메타데이터 | TourAPI | Rakuten Travel |
| 숙소 날짜별 재고 | 미확보 (시즌 밴드뿐) | Rakuten Travel |
| 숙소 객실 정원 | TourAPI `detailInfo2` | Rakuten Travel (인원 조건 검색) |
| 대중교통 | ODsay | 미확보 |
| 항공 최저가 | Travelpayouts (캐시가) | Travelpayouts (캐시가) |
| 항공 좌석·확정 운임 | 미확보 | 미확보 |
| 식당 예약 슬롯 | 미확보 | 미확보 |
| 날씨·환율 | Open-Meteo, Frankfurter | Open-Meteo, Frankfurter |

종료·제외된 공급자와 그 근거는 [외부 데이터·검증 정책 2.1](docs/provider-evidence-policy.md)에 있습니다. 요약하면 **Amadeus Self-Service는 2026-07-17에 종료**됐고, ぐるなび 무료 API는 2021년에 끝났으며, NAVITIME은 유료고, Google Places·Routes는 무료 한도가 있어도 결제 계정이 전제입니다.

미확보 슬롯은 발표를 위해 `demo-fixture`가 채웁니다. 후보 id가 `demo_`로 시작하고 이름에 "(데모)"가 붙고 배지가 `estimated`이며 예약 URL이 없으므로 실데이터와 구분됩니다.

무료 티어의 제약 두 가지는 배포 전에 반드시 처리해야 합니다. **Open-Meteo와 ODsay의 무료 티어는 비상업 목적 한정**이고, **HotPepper는 결과 화면에 크레딧 표시가 의무**입니다.

타베로그는 공개 셀프서비스 API가 확인되지 않았고 이용약관상 영리 목적 접근과 리뷰 무단 이용 제한이 있으므로 자동 수집·DB 적재 공급자에서 제외합니다. 사용자가 직접 여는 링크는 참고용일 뿐 검증 근거가 아닙니다. 세부 출처와 공급자별 한계는 [외부 데이터·검증 정책](docs/provider-evidence-policy.md)을 참고하세요.

MVP 상태는 다음 네 가지로 제한합니다.

- `PROVISIONAL`: 메타데이터는 있으나 날짜별 가격·재고 등 핵심 사실 미확인
- `VERIFIED`: 하드 제약과 핵심 사실이 검증됐지만 예약 가능성을 뜻하지 않음
- `NEEDS_USER_CHOICE` / `BLOCKED`: 사용자 권한 또는 외부 상태 없이는 안전하게 확정할 수 없음

`BOOKABLE`과 `BOOKED`는 목표 계약에만 남아 있으며 현재 MVP는 생성·표시하지 않습니다.

## 첫 수직 경로

첫 해커톤 수직 경로는 **오사카·3인·3박·체류 거점·숙소**로 고정합니다. 날짜·인원·객실 조합·침대·총액·공실 근거가 같은 요청을 가리키는지 검증하며, 정원 초과·동의 없는 객실 분리·일부 인원만 확인된 재고는 통과시키지 않습니다.

MVP는 `MULTI_PROXY`만 구현합니다. 참여자별 `UserProxyAgent`가 자기 프로필만 읽고 같은 `proposalSetVersion`에 투표하며, 결정론적 `SatisfactionNormalizer`와 `LeximinSelector`가 선택합니다. `CENTRAL_BASELINE` 비교 실험과 자동 재토론은 후속 범위입니다.

## 문서 지도

| 문서 | 권위 범위 |
| --- | --- |
| [MVP ADR](docs/adr/README.md) | 현재 MVP의 제품 흐름, 역할, 권한, 공정성, 데이터·런타임·계약 결정 |
| [문서 권위](docs/operations/document-authority.md), [MVP 출시 게이트](docs/operations/mvp-release-gates.md) | 충돌 해소 순서, 실행·검증·완료 라벨 |
| [Codex Runtime Gateway](apps/codex-runtime-gateway/README.md) | localhost OAuth·모델 allowlist·구조화 출력 실행과 오프라인 검증 |
| [종합 기획서](docs/travel-mediation-plan.md) | 제품 목표, 0/1~5/6단계, 프로필·공정성·계약·평가 |
| [에이전트 아키텍처](docs/agent-architecture.md) | 공식 역할, 책임, 권한, 데이터 계약 |
| [Survey v4 + Profile Schema v1](docs/survey-v4-profile-v1.md) | 질문·축·태그 매핑, 프로필 저장, 적응형 중단·검증 |
| [외부 데이터·검증 정책](docs/provider-evidence-policy.md) | 공급자 허용 범위, 팩트체크·예약 상태·약관 경계 |
| [이의 제기와 재토론](docs/objection-and-rerun.md) | 재논의 권한·상한·영향 범위·프로필 반영 |
| [개발·배포](docs/development-and-deployment.md) | 현재 구현과 목표 계약의 차이, 런타임·배포 경계 |
| [팀 역할](docs/team-assignments.md) | 새 공식 역할 기준의 담당 범위 |
| [LLM 런타임](docs/llm-runtime-config.md) | 역할별 모델·비용·프롬프트 관리 원칙 |
| [항공](docs/flight-referee-implementation.md), [교통](docs/transport-referee-implementation.md), [숙소](docs/accommodation-referee-implementation.md) | 카테고리 도메인 자료와 새 공통 파이프라인 적용 메모 |

## 현재 구현 상태

Accepted MVP 결정은 [ADR 목록](docs/adr/README.md)에 있습니다. 현재 코드는 이전 `R0~R6`, Persona·Referee·Supervisor, 설문 v2/v3 계약을 포함하므로 문서 확정이 새 수직 경로의 구현·검증을 뜻하지 않습니다.

`dawnkim`에서 [Codex Runtime Gateway](apps/codex-runtime-gateway/README.md)의 로컬 실행 경계만 선별 이식했습니다. Python Worker·AgentCore·Docker 구성은 가져오지 않았고, TypeScript 계약과 Worker HTTP 포트가 role·schema·version을 소유합니다. 가짜 Backend 기반 계약 검증은 실제 OAuth 모델 실행의 증거가 아닙니다.

[Python 에이전트 초안](prototypes/python-agents/README.md)의 Proxy·중재자·감독관 계약과 오프라인 fixture는 참고할 수 있습니다. 그 안의 ECS·AgentCore 코드는 과거 실험이며 MVP 선택 경로가 아닙니다. 선택 런타임은 로컬 Codex OAuth Gateway이고, 기존 TypeScript Worker가 업무 오케스트레이터입니다.

MVP 완결 기준은 다음 모두입니다.

1. 오사카·성인 3명·3박 입력과 헌장 스냅샷
2. 참여자별 Proxy 투표와 근거 있는 숙소 후보
3. 하드 제약·leximin·Arbiter·Supervisor 게이트
4. 사용자에게 `CategoryContractView`, 선택 요청 또는 정직한 차단 공개

fixture와 실제 OAuth 실행의 완료 라벨은 [MVP 출시 게이트](docs/operations/mvp-release-gates.md)를 따르며 어느 쪽도 전체 제품·원격 배포·`BOOKABLE`의 증거가 아닙니다.

## 로컬 실행

Node 20.10+, npm 10+, Docker Desktop이 필요합니다.

```bash
npm install
npm run local:up
npm run dev
npm run typecheck
npm run test
npm run build
```

`VITE_API_BASE_URL`을 비워두면 기존 프론트 흐름이 `sessionStorage`에 저장됩니다. 이는 UI 목업 경로이며 새 백엔드 계약이 연결됐다는 뜻은 아닙니다.

Gateway 계약은 추가됐지만 기존 레거시 Agent 흐름을 자동으로 교체하지 않습니다. 사용자가 `codex login`을 완료하고 현재 모델 목록에서 allowlist를 확정하기 전에는 가짜 Backend와 fixture 기반 검증만 수행합니다.

## 협업 원칙

- `main`에는 PR로만 병합하고, 프롬프트·점수·스키마 변경은 영향 계약과 평가 결과를 명시합니다.
- 외부 API 호출은 fixture 계약 테스트와 실제 sandbox 검증을 구분합니다.
- 민감한 프로필·건강·가치·개인 예산과 API 키를 커밋하지 않습니다.
- 공급자 응답에 없는 값을 만들지 않고, 출처·조회 시각·유효기간·약관 참조를 보존합니다.
- 문서, 코드, 테스트, 실데이터 검증을 서로 다른 완료 증거로 표시합니다.
