# Destination Pack 데이터

목적지 하나 = 파일 하나. 코드 배포 없이 이 폴더에 JSON을 추가하면 신규 목적지가 열린다.
스키마의 유일한 출처는 [`packages/contracts/src/pack.ts`](../packages/contracts/src/pack.ts)이며, 설계 근거는 [기획서 4장](../docs/travel-mediation-plan.md)이다.

## 파일 규칙

```
packs/<packId>.json        packId = <국가코드 소문자>-<도시>   예: jp-osaka, kr-gangneung
```

MVP 목표는 11개다. 한국 5(`kr-gangneung`, `kr-busan`, `kr-jeju`, `kr-seoul`, `kr-yeosu`) + 일본 6(`jp-osaka`, `jp-tokyo`, `jp-kyoto`, `jp-fukuoka`, `jp-sapporo`, `jp-osaka-kyoto`).

`jp-osaka.json`이 작성 예시다. 구조는 채워져 있고 확인이 필요한 값은 `verification`에 나열되어 있다.

## 채우는 순서

1. **구조 먼저** — `packId`, `displayName`, `country`, `center`, `areas`, `roundPreset`, `typicalDurations`, `recommendedNights`
2. **제공자 조사** — `providers`. 각 API가 이 도시를 실제로 커버하는지 테스트 호출로 확인한다
3. **현지 상수** — `config`. `timezone`은 IANA 문자열이어야 한다 (일정 실행 가능성 판정에 쓰인다)
4. **시기 정보** — `peakSeasons`, `avoidDates`, `weatherProfile`. DateResolver가 날짜 후보를 점수화할 때 쓴다
5. **교통패스** — `transitPasses`. 공개 API가 없어 직접 만들어야 하는 자산이다
6. **가격 밴드** — `priceBands`. 실시간 가격을 못 얻는 지역(주로 한국 숙소)만
7. **등급 판정** — `coverage`

## 등급 판정 규칙

`coverage: "A"`는 숙소 가격·로컬 미식·대중교통 상세가 **모두 현재 데이터로 검증 가능할 때만** 쓴다.
가격이 밴드 추정이면 기본 `B`다. `verification`에 `status !== "verified"` 항목이 하나라도 남아 있으면 A로 올릴 수 없다.

`maxAllowedCoverage()` / `assertCoverageIsHonest()`가 이 규칙을 코드로 강제한다. 등급을 낙관적으로 적으면 DateResolver와 Budget이 더 좁은 오차 구간을 쓰게 되어 예산이 틀어진다.

## verification 블록 — 이 폴더에서 가장 중요한 필드

확인하지 못한 값은 **지우지 말고 남긴다.** 사용자는 회의에 개입할 수 없으므로, 불확실성을 숨기면 여행지에서 사고가 난다.

```json
{ "field": "transitPasses[osaka-amazing-pass-1d].priceMinor",
  "status": "unverified",
  "source": "https://…",
  "checkedAt": "2026-08-20",
  "note": "공식 사이트 가격 확인" }
```

`status`를 `verified`로 바꿀 때는 `source`와 `checkedAt`을 함께 적는다. 출처 없는 `verified`는 검증이 아니다.

## 조사 시 주의

- **요금·쿼터·약관은 수시로 바뀐다.** 상업적 이용 조건을 반드시 확인하고 `verification`에 조회 시각을 남긴다.
- 값을 추측해서 채우지 않는다. 모르면 `unverified`로 남기는 것이 비어 있는 것보다 낫다.
- 스폰서드 항목이 카드덱에 들어가면 선호도 신호가 오염된다. 제휴 Pack은 반드시 명시하고 스코어링 가중치에 영향을 주지 않아야 한다 (기획서 17.2).
- 카드덱(20장)은 이 폴더가 아니라 설문 담당이 만든다. 여기서는 `cardDeck` ID만 참조한다.

## Pack별로 반드시 조사할 것

| Pack | 핵심 쟁점 |
| --- | --- |
| `kr-gangneung` | KTX vs 자차. 시내 대중교통이 약해 도착 후 이동이 문제 — 렌터카·택시 예산 반영 |
| `kr-jeju` | 렌터카 사실상 필수. 면허 보유자 0명일 때의 대안, 주차 가능 여부 |
| `kr-busan` / `kr-seoul` | 지하철 커버리지. 자차는 주차난 |
| `kr-yeosu` | 시내 이동 취약, 택시 의존도 |
| `jp-osaka` | 주유패스 손익분기. 포함 관광지가 R3 결과에 따라 가치가 달라진다 |
| `jp-tokyo` | HND vs NRT 실효 총액 비교. 메트로/도에이/JR 혼재 |
| `jp-kyoto` | 성수기(단풍·벚꽃) 숙소 조기 마감. 버스 정시성 낮음 |
| `jp-sapporo` | 겨울 결항·적설기 도보 시간 1.3~1.5배 보정 |
| `jp-fukuoka` | 공항↔시내 지하철 5분. 단거리 노선 |
| `jp-osaka-kyoto` | 복합 팩. 도시간 이동(한큐/게이한/JR)과 분할 숙박 |
