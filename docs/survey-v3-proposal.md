# 설문 v3 제안 검토: 폐기된 레거시

- 상태: `SUPERSEDED`
- 대체 문서: [Survey v4 + Profile Schema v1](survey-v4-profile-v1.md)
- 기준일: 2026-08-14

이 파일은 기존 링크를 깨지 않기 위한 마이그레이션 안내다. 설문 v3의 12개 양극 슬라이더, 목적지별 20장 카드, `5/3/1/0 → 1.0/0.6/0.2/실격` 고정 변환, 방장 예산·교통 기준선은 더 이상 목표 제품 사양이 아니다.

## v4로 바뀐 내용

| v3 | Survey v4 + Profile Schema v1 |
| --- | --- |
| 방별 Persona 중심 | `CanonicalProfile`, `AgentBelief`, `TripEffectiveProfile`, `ConstraintProfile` 분리 |
| 12개 슬라이더 + 20장 카드 | 고정 11개 질문 블록 + 적응형 0~2개 |
| 모든 목적지에 같은 질문 | 공통 5축 + 도시별 초기 6축, 후보 분산에 따라 최대 2개 교체 |
| 5·3·1·0을 고정 가중치로 사용 | 5·3·1, 피하고 싶음, 모름, 하드 제약을 서로 다른 신호로 저장 |
| 예산 비율 입력 | 우선 보호할 1·2순위 + 선택형 추가 지불 가능 금액 |
| 자유서술을 바로 프로필화 | 최대 5개 `ProfilePatchCandidate`, 확인 전 장기 저장 금지 |
| 에이전트 추론도 프로필처럼 사용 | 사용자가 체크한 항목만 `CanonicalProfile`에 저장 |

## 구현 주의

현재 프론트엔드와 `packages/contracts/src/preference-v3.ts`는 레거시 구현이다. 문서를 v4로 바꿨다는 사실만으로 FE·백엔드 스키마가 마이그레이션된 것은 아니다. 구현 PR은 최소한 다음을 함께 바꿔야 한다.

1. 질문·선택지 ID와 버전된 신호 매핑
2. 필수 입력과 11개 취향 질문 블록의 분리
3. `ProfilePatchCandidate` 확인 화면
4. 프로필 권위·범위·출처 필드
5. 적응형 질문 중단 및 상한
6. FE/백엔드 동일 fixture 계약 테스트

새 설문 결정은 이 문서가 아니라 [survey-v4-profile-v1.md](survey-v4-profile-v1.md)만 인용한다.
