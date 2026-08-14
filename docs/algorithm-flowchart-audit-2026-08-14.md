# MOA 알고리즘·Agent·Flowchart 감사 및 반영 기록

- 감사일: 2026-08-14
- 범위: 설문 UI, 공통 TypeScript 계약, Python Agent 계약, Worker 상태 머신, 최종 결과 무결성, 설계 문서 Mermaid 검토
- 결론: 확인된 고위험 우회 경로와 계약 불일치를 구현·테스트·문서에 반영했다. Provider Data Gateway와 범용 SymbolicReasoner는 아직 미구현이므로 현재 결과는 preloaded fixture/정규화 후보 범위에서만 유효하다.
- 문제별 판단 근거와 대안 비교: [문제별 논의·근거·의도·해결책](problem-discussions-and-rationale-2026-08-14.md)

## 1. 반영한 핵심 수정

### 1.1 Worker 상태 머신

- Category Watcher의 `BLOCK`을 Supervisor의 `WAIT_FOR_USER` 또는 사용자 승인으로 우회할 수 없게 우선순위를 고정했다.
- 승인 재개 시 저장된 `selectedProposalId`를 복원하고, 해당 계획이 여전히 `VERIFIED`, fresh, hard-safe인지 확인한 뒤 Watcher를 다시 실행한다.
- 각 라운드는 같은 계획을 반복하지 않고 검증된 계획을 leximin, 비용, 이동시간, canonical ID 순으로 평가한다.
- `REQUEST_REBUTTAL`, `PROPOSE_COMPROMISE`, `CALL_VOTE`는 다음의 서로 다른 검증 계획이 있을 때만 다음 라운드로 이동한다.
- Supervisor가 입력에 없는 participant/proposal을 참조하거나 사용자 권한 사유 없이 `WAIT_FOR_USER`를 반환하면 실패 처리한다.
- 동일 evidence ID가 Agent별로 다른 사실·상태를 가지면 Job 입력 경계에서 거부한다.

### 1.2 Candidate Search

- QueryPlan의 완화 조건이 입력의 `allowedRelaxations` 부분집합인지 검사한다.
- 알레르기, 건강, 안전, 접근성, 휠체어·유모차, 필수·절대 조건 완화는 한국어·영어 키워드 모두 fail-closed 처리한다.
- QueryPlan이 `canonicalConstraints` filter를 누락하거나 값을 바꾸면 실패 처리한다.
- 현재 QueryPlan은 실제 Provider 호출 결과가 아니라 preloaded `PlanOption` 집합에 연결되며 결과에 `PRELOADED_NORMALIZED_OPTIONS`로 명시한다.

### 1.3 Logic Auditor와 Agent 계약

- 주장에 `claimedParticipantId`, `claimedProposalId`, `claimedDecision`을 추가했다.
- 자연어 결론 문구가 아니라 구조화 claim과 같은 라운드의 `expectedVotes`가 정확히 일치하는지 판정한다.
- premise fact가 참조하는 evidence가 주장 evidence에 포함되는지도 검사한다.
- 찬성/수용 투표는 `reasonCode: NONE`, 반대/확인 요청은 non-NONE 사유를 요구한다.
- `ProofReview`, Watcher, Supervisor, Search, Finalizer의 상태–사유 교차 필드 불변식을 Pydantic validator로 고정했다.

### 1.4 Finalizer 무결성

- Finalizer 입력의 선택 계획은 토론 계획의 전체 내용과 일치해야 한다.
- itinerary의 candidate 집합은 선택 계획 candidate 집합과 정확히 같아야 한다. 추가와 누락을 모두 거부한다.
- 참가자 ID와 만족도는 선택 계획의 참가자별 만족도와 정확히 같아야 한다.
- 선택 계획이 참조하는 evidence는 모두 존재하고 `VERIFIED`여야 한다.
- Agent 출력도 Worker가 proposal, candidate, participant satisfaction, evidence 기준으로 다시 대조한다.

### 1.5 TypeScript 공통 계약

- Zod 3의 enum record가 일부 키를 허용하는 문제를 피하기 위해 11개 여행 스타일 축을 strict object로 명시했다.
- 만족도 격차 계산 전에 런타임 스키마, 중복 participant ID, 재토론 횟수를 검증한다.
- 빈 변경 사유 집합은 자동 변경으로 분류하지 않고 거부한다.
- 계획 노드 상태 전이, version +1, 잠금, `BOOKABLE + live confidence` 불변식을 추가했다.
- 테스트는 Node 20 이상에서도 동작하도록 TypeScript를 먼저 빌드한 뒤 표준 `node:test`로 실행한다.

### 1.6 설문 UI와 payload

- 여행 스타일 11개 항목을 연속 숫자 slider 대신 각각 의미가 명확한 3개 텍스트 버튼으로 변경했다.
- 여행 페이스는 `휴식형(하루 1개) / 보통형(하루 2개) / 활동형(하루 3개)`이며 내부 값은 `1 / 4 / 7`이다.
- 활동 선호는 `관심 적어요 / 괜찮아요 / 꼭 하고 싶어요`이며 내부 값은 `1 / 5 / 10`이다.
- 스타일 축은 공통 계약의 대문자 canonical ID를 사용한다.
- payload를 schema v4로 올리고 두 척도 버전을 명시했다.
- 활동 카드는 선택 목적지에 따라 바뀌며 Osaka 전용 타입·공개 변수 의존을 제거했다.

### 1.7 Mermaid 공개 경로 검토 결과

- `kim1188_md`의 일부 Mermaid에서 `HOLD`와 `CLEAR`가 같은 최종 공개 노드로 합쳐지는 오류 가능성을 확인했다.
- 해당 폴더는 다른 팀원 소유 문서이므로 이번 `dawnkim` 변경에서는 수정하거나 삭제하지 않고 원상복구했다.
- 권고안은 정상 공개를 `연속성 PASS AND 통합 검증 PASS AND 가드 CLEAR`로 제한하고, `BLOCKED/HOLD` 부분 공개 경로를 별도 레코드로 분리하는 것이다.
- 문서 소유자가 동의한 별도 PR 또는 공동 편집에서 반영해야 한다.

## 2. 추가한 회귀·공격 테스트

- Watcher `BLOCK` → Supervisor `WAIT` 조작이 승인 대기로 바뀌지 않는지
- Finalizer가 선택 계획에 없는 candidate를 추가하는 경우
- 무효 고득점 계획이 투표 전에 제거되는지
- 실제 반대 라운드가 서로 다른 검증 절충안으로 이동하는지
- 사용자 권한 사유 없는 `WAIT_FOR_USER` 조작
- Candidate Search의 canonical filter 삭제 조작
- 동일 evidence ID의 상충 payload
- 주장 claim과 실제 투표의 불일치
- 반복 한도 마지막 index에서 추가 라운드를 시작하지 않는지
- Finalizer 참가자 만족도 변조
- Zod 전체 스타일 축, 투표 사유, 만족도 경계, 변경 권한, 계획 상태 전이

## 3. 최종 검증 결과

| 검증 | 결과 |
| --- | --- |
| Python 전체 테스트 | `32 passed` |
| Agent + Worker 집중 테스트 | `25 passed` |
| TypeScript 계약 테스트 | `5 passed` |
| 모든 workspace typecheck | 통과 |
| 모든 workspace production build | 통과 |
| 브라우저 UI 클릭 검증 | 스타일 11×3 버튼, 활동 3버튼, disabled/활성화/다음 카드 전환 정상 |
| 브라우저 console error | 없음 |
| `git diff --check` | whitespace 오류 없음 |

Vite는 JavaScript chunk가 500KB를 넘는 성능 경고를 출력한다. 기능·계약 오류는 아니며 추후 route/component 단위 code splitting 대상으로 남긴다.

## 4. 아직 남은 구현 경계

- 실제 Provider API를 호출하고 QueryPlan을 `CandidateRecord`로 정규화하는 Data Gateway
- 일반 자연어 규칙을 기계 증명으로 바꾸는 범용 SymbolicReasoner
- PostgreSQL/Redis/SQS 운영 adapter와 API 서버
- 실제 Codex 인증 계정으로 수행하는 end-to-end Agent 호출
- 번들 code splitting과 성능 예산 자동 검사

이 항목들은 현재 구현이 완료됐다고 표시하지 않으며 [README](README.md)와 [Agent 구현 문서](agents-implementation.md)에도 같은 경계를 명시한다.

## 5. GitHub 공유 방법

현재 저장소 기준 작업 위치는 다음과 같다.

- 원격 저장소: `https://github.com/nxtcloud-edu/2026_KNUxKU_summer_camp_team05`
- 작업 브랜치: `dawnkim`
- 병합 기준 브랜치: `main`
- 변경 상세 댓글 파일: [github-pr-comment.md](github-pr-comment.md)

`/tree/dawnkim`은 브랜치의 파일을 보는 URL이므로 팀 리뷰 댓글을 모으는 장소로는 적합하지 않다. 변경 사항을 push한 뒤 `main ← dawnkim` Pull Request를 만들고, PR 설명 또는 PR 댓글로 기록한다.

### 5.1 GitHub CLI 인증

현재 로컬 `gh`의 기존 토큰이 만료된 상태이므로 먼저 다시 로그인한다.

```powershell
gh auth login -h github.com
gh auth status
```

브라우저 인증 질문이 나오면 `Y`를 선택하고 `EastDawnK` 계정 또는 저장소 쓰기 권한이 있는 계정으로 인증한다.

### 5.2 커밋과 push

가상환경은 테스트 실행 환경일 뿐 Git push 대상이 아니다. `.venv/`, `node_modules/`, `dist/`는 `.gitignore`로 제외된 상태에서 소스·테스트·문서만 커밋한다.

```powershell
git status --short
git add apps packages docs
git diff --cached --check
git commit -m "feat: harden mediation flow and simplify survey choices"
git push -u origin dawnkim
```

### 5.3 PR 생성과 댓글

PR이 아직 없다면 다음처럼 draft PR을 만든다.

```powershell
gh pr create `
  --base main `
  --head dawnkim `
  --draft `
  --title "MOA 중재 알고리즘 안전성 및 3단계 설문 UI 개선" `
  --body-file docs/github-pr-comment.md
```

이미 PR이 있다면 번호를 확인하고 변경 요약을 댓글로 남긴다.

```powershell
gh pr list --head dawnkim
gh pr comment <PR번호> --body-file docs/github-pr-comment.md
gh pr view <PR번호> --web
```

웹에서 직접 만들 경우 [main...dawnkim 비교 화면](https://github.com/nxtcloud-edu/2026_KNUxKU_summer_camp_team05/compare/main...dawnkim?expand=1)에서 PR을 생성하고 `docs/github-pr-comment.md` 내용을 붙여 넣는다.
