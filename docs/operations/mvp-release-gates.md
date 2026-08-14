# MVP 실행 및 출시 게이트

- 문서 버전: v1.0 / 2026-08-14
- 대상: 로컬 오사카 숙소 수직 경로

## 자동 검증

- [ ] Node test, typecheck, build가 모두 통과한다.
- [ ] Python Agent test, demo, compile 검사가 통과한다.
- [ ] Markdown은 문서당 H1 하나이며 상대 링크가 모두 유효하다.
- [ ] OAuth 파일, API key, 사용자 원문 프로필이 저장소와 로그에 없다.
- [ ] 하드 제약 위반 후보 통과 0건, 다른 사용자 프로필 참조 0건이다.
- [ ] Evidence 없는 `PASS` 0건, Arbiter의 결정론 선택 변경 0건이다.
- [ ] 결과 상태는 `PROVISIONAL`, `VERIFIED`, `NEEDS_USER_CHOICE`, `BLOCKED` 중 하나다.
- [ ] 자동 재토론 없이 구조화 출력 복구 최대 1회를 지킨다.

## 수동 시나리오

같은 오사카·성인 3명·3박·숙소 fixture에서 다음을 직접 관찰한다.

1. 정상 후보: 참여자별 투표, leximin trace, 선택 이유, Evidence ID가 보인다.
2. 정원 초과: 후보가 탈락하고 `VERIFIED`가 되지 않는다.
3. 근거 누락: `PROVISIONAL` 또는 `BLOCKED`이며 값이 생성되지 않는다.
4. 객실 분리: 사전 동의가 없으면 `NEEDS_USER_CHOICE`다.
5. 보호 목표 또는 공정성 임계값 위반: 자동 확정하지 않는다.

로컬 목표 wall-clock은 120초 이내다. 초과 시 안전한 부분 결과나 차단으로 끝내며 더 비싼 모델로 자동 전환하지 않는다.

## Codex OAuth 확인

- [ ] 사용자가 로컬에서 `codex login`을 완료했다.
- [ ] Gateway가 반환한 현재 모델 목록과 allowlist의 교집합이 정확히 하나 이상이다.
- [ ] 실제 선택 모델로 정상 시나리오를 1회 실행하고 모델·prompt·schema·시간 영수증을 확인했다.
- [ ] Gateway가 localhost에만 열리고 임의 API key fallback이 없음을 확인했다.

## 결과 화면

결과에는 `fixture`/`live`/`estimated` 배지, Evidence ID, 조회 시각, 입력 날짜·인원, 미확인 항목, 사용자 선택 필요 여부가 보여야 한다. `BOOKABLE`, `BOOKED`, `deployed`를 표시하지 않는다.

## 사용자만 확정할 항목

다음 외에는 권장 기본값으로 진행한다.

1. 본인 Codex 계정의 로컬 OAuth 로그인
2. 로그인 후 실제 카탈로그에서 MVP allowlist에 넣을 모델
3. fixture가 아닌 live 공급자 smoke test를 할 경우의 개인 API key 제공 여부
4. session 종료 뒤 프로필을 저장하려는 경우의 별도 보존·삭제 동의

기본값은 **fixture-first, session-only, localhost-only, 원격 배포 없음**이다.

## 완료 라벨

- `VALIDATED_LOCAL_FIXTURE_MVP`: fixture로 자동·수동 시나리오를 모두 관찰함
- `VALIDATED_LOCAL_OAUTH_MVP`: 위 조건에 더해 실제 Codex OAuth 모델 실행을 관찰함

두 라벨 모두 AWS 배포, live inventory, 예약 가능, 전체 여행 완성을 뜻하지 않는다.
