# 외부 데이터 공급자와 검증 정책

- 문서 상태: MVP 채택안
- 기준일: 2026-08-14
- 대상: 서울·부산·도쿄·오사카
- 범위: 후보 수집, 사실 검증, 예약 준비 상태, 약관·저장 경계

## 1. 결론

기존 6개 공급자만으로 일본 중심 후보 탐색 데모는 가능하지만, 네 도시의 “팩트체크되고 예약 가능한 계획” 전체를 만들기에는 부족하다. MVP에서는 Kakao Maps를 추가하고, 한국 관광 메타데이터는 TourAPI 4.0을 사용한다. 서울↔부산 장거리 일정 시연이 필요할 때만 TAGO 열차 정보를 조건부로 붙인다.

공급자가 없는 기능은 빈 배열로 남긴다. 웹 검색 결과나 에이전트 추론으로 날짜별 재고를 만들어 `BOOKABLE`로 올리지 않는다.

```json
{
  "providers": {
    "poi": {
      "KR": ["tourapi_kr", "google_places"],
      "JP": ["google_places"]
    },
    "dining_metadata": {
      "KR": ["google_places", "tourapi_kr"],
      "JP": ["hotpepper", "google_places"]
    },
    "dining_slot_inventory": { "KR": [], "JP": [] },
    "hotel_metadata": {
      "KR": ["tourapi_kr", "google_places"],
      "JP": ["rakuten_travel", "google_places"]
    },
    "hotel_inventory": {
      "KR": [],
      "JP": ["rakuten_travel"]
    },
    "local_routing": {
      "KR": ["kakao_maps", "google_routes"],
      "JP": ["google_routes_walk_drive"]
    },
    "public_transit": {
      "KR": ["kakao_maps"],
      "JP": []
    },
    "long_distance_schedule": {
      "KR": ["tago_kr"],
      "JP": []
    },
    "long_distance_inventory": { "KR": [], "JP": [] },
    "activity_ticket_inventory": { "KR": [], "JP": [] },
    "weather": ["open_meteo"],
    "fx": ["frankfurter_v2"]
  }
}
```

## 1.1 2026-08-14 재조사 — 실제로 붙인 어댑터

위 1절은 목표 배치다. 아래는 **키를 넣으면 지금 도는 코드**이며, `packages/data-agents/src/providers/`에 어댑터가 있다. 목표와 구현을 같은 표에 섞지 않는다.

| 어댑터 | 담당 QueryClass | 무료 조건 | 이 공급자가 답하지 않는 것 |
| --- | --- | --- | --- |
| `rakuten_travel` | `hotel.search` · `hotel.vacancy_price` · `hotel.room_combination` · `hotel.all_in_price` | 무료 · **1 req/sec** · 서버앱 IP 제한 | 취소 조건, 잔여 객실 수, 침대 타입 |
| `hotpepper` | `dining.search` · `dining.hours` · `dining.diet_support` | 무료 · **크레딧 표시 의무** · 점포정보 재판매 금지 · **한국에서 키 발급 실패(아래)** | 예약 슬롯, 실시간 공석 |
| `tourapi` | `poi.search` · `dining.search` · `geo.place_details` · `hotel.search` · `hotel.room_combination` | 개발계정 1,000건/일 · 이용 제한 없음 | 날짜별 재고·가격 (시즌 밴드뿐) |
| `kakao` | `poi.search` · `dining.search` · `geo.place_details` · `geo.geocode` | 각 100,000건/일 · 상업 이용 가능 | 영업시간, 가격, 정원 |
| `odsay` | `transit.route` · `transit.airport_transfer` | 1,000건/일 · **비상업 목적 한정** | 계단·엘리베이터, 막차 |
| `travelpayouts` | `flight.cheapest_date` | 무료 토큰 · 200 req/hour/IP | 좌석 수, 도착 시각, 예약 가능성 |
| `demo-fixture` | 위 슬롯 + 공백 슬롯 전부 | — | **전부. 실제 데이터가 아니다** |

### 왜 라쿠텐이 첫 수직 경로를 성립시키는가

정원 검증의 계약은 "장소의 총 수용량이 아니라 정확한 날짜·시간·인원 요청의 응답"이다(5절). 라쿠텐 공실 검색은 `checkinDate`·`checkoutDate`·`adultNum`·`roomNum`을 **검색 조건으로** 받으므로, 돌아온 플랜은 그 인원이 그 날짜에 실제로 묵을 수 있는 플랜이다. 그래서 `roomCombinationVerified`를 **정확한 인원·객실 수로 물었을 때만** 올린다.

반대로 취소 조건이 응답에 없으므로 `allInPriceVerified`는 항상 false이고, 오사카 숙소는 `VERIFIED`까지만 간다. **`BOOKABLE`은 이 공급자 조합으로 도달할 수 없다.**

### 라쿠텐 2026 개편 — 앱 종류를 잘못 고르면 키가 나와도 전부 403이다

라쿠텐은 2026-05-14에 구 API를 폐지하면서 세 가지를 함께 바꿨다.

| 항목 | 구버전 | 현행 |
| --- | --- | --- |
| 엔드포인트 | `app.rakuten.co.jp/services/api/…` | `openapi.rakuten.co.jp/engine/api/Travel/…` |
| 인증 | `applicationId` | `applicationId` + `accessKey` |
| 호출 제한 | 없음 | 앱 종류별 Referer 또는 IP 검사 |

세 번째가 함정이다. 앱 등록 시 `アプリケーションタイプ`를 고르는데 검사 방식이 갈린다.

| 타입 | 등록 항목 | 검사 | 어댑터 설정 |
| --- | --- | --- | --- |
| `Webアプリケーション` | `許可されたWebサイト` (도메인) | `Referer` 헤더 | `RAKUTEN_REFERER`에 같은 도메인 |
| `サーバーアプリ` | `許可されたIPアドレス` | 호출 IP | `RAKUTEN_REFERER` 비움 |

**Web 타입을 권한다.** `Referer`는 브라우저 전용 헤더가 아니라 HTTP 클라이언트가 직접 설정할 수 있으므로, 서버에서 호출해도 Web 타입을 쓸 수 있다. 반대로 서버 타입은 공인 IP를 등록하는데 가정용 회선은 IP가 바뀌어 **데모 도중에 `CLIENT_IP_NOT_ALLOWED`로 죽는다.** 도메인은 바뀌지 않는다.

서버 타입을 쓴다면 허용 IP는 `curl -s https://api.ipify.org`로 확인하고, 배포 시에는 고정 IP를 쓴다.

어댑터는 이 403들을 원문 그대로 두지 않고 무엇을 고쳐야 하는지 문장으로 바꿔 던진다 — "HTTP 403"만 보면 키가 틀린 줄 알고 엉뚱한 곳을 고친다. `REFERRER_MISSING`이면 `RAKUTEN_REFERER`를 넣으라고, `REFERRER_NOT_ALLOWED`면 보낸 값과 등록 도메인이 다르다고 알려준다.

### 라쿠텐 실호출로 확인한 것 (2026-08-14)

문서만 보고 만든 어댑터가 실제로는 세 군데 틀렸다. 스텁 테스트는 전부 통과하고 있었다.

| 가정 | 실제 |
| --- | --- |
| 요청 좌표는 초(秒) = 도×3600 | **십진 도**. 3600을 곱하면 `wrong_parameter: specify valid latitude` |
| 응답 좌표는 초(秒) | **십진 도**. 3600으로 나누면 적도 근처로 무너진다 |
| `roomInfo[i]`에 플랜과 요금이 함께 | **따로 온다.** `[{roomBasicInfo}, {dailyCharge}]`가 번갈아 오는 배열이라, 한 칸에 둘 다 있다고 가정하면 후보가 0건이 된다 |

관측된 응답 예 (오사카 난바 반경 2km · 3인 1실 3박):

```
hotelName      アパホテル＆リゾート〈大阪なんば駅前タワー〉
latitude       34.66605673472163
dailyCharge    { stayDate: 2026-10-13, rakutenCharge: 7650, total: 22950, chargeFlag: 0 }
```

`chargeFlag: 0`은 1실당이므로 그룹 총액은 `total × roomNum = 22,950엔`이고 1인 7,650엔(3박), 1인 1박 2,550엔이다. `chargeFlag`를 무시하고 인원을 곱했다면 68,850엔으로 3배 틀렸을 것이다.

### HotPepper 키 발급이 한국에서 막힌다 (2026-08-14 확인)

어댑터는 만들었지만 **키를 받지 못했다.** 등록 폼 제출이 서버에서 거부된다.

| 확인 | 결과 |
| --- | --- |
| `webservice.recruit.co.jp/register/` GET | HTTP 200 |
| 폼 구조 | 순수 HTML(`_csrf` · `agree` · `email` · `termSetId`), JS 개입 없음 |
| 신선한 CSRF 토큰으로 POST | 302 → `/common/errors/forbidden.html` |
| 브라우저에서 수동 제출 | 동일한 `アクセスできません` |

브라우저와 curl 양쪽에서, 유효한 토큰으로, 동의 체크를 포함해 같은 결과다. 남은 공통 변수는 출발지 IP다. **정황상 지역 제한으로 보이지만 일본 IP에서 대조할 수 없어 단정하지는 않는다.**

MVP 처리: 일본 식당은 `demo-fixture`로 둔다. 우회 접속은 서비스가 의도적으로 건 접근 제어를 무력화하는 것이므로 쓰지 않는다. 정식 문의 창구는 <https://rws.zendesk.com/hc/ja/requests/new>이며, 키를 받게 되면 어댑터는 그대로 쓸 수 있다 — 등록만 남았지 구현은 끝나 있다.

### 비상업 제약 — 배포 전 반드시 확인

두 공급자의 무료 티어는 **비상업 목적 한정**이다. 캠프 산출물로는 문제없지만 서비스로 공개하면 약관 위반이다.

- **Open-Meteo**: 비상업 한정. <10,000/일 · 300,000/월. **CC-BY 4.0 출처 표기 의무.**
- **ODsay**: 비상업 한정. 개인·학생·5인 이하 스타트업만. 상업 전환 시 Standard(100,000/일) 유료 계약 필요.

**HotPepper는 상업 이용이 가능하지만 크레딧 표시가 의무다.** 로고 또는 텍스트를 결과 화면에 넣어야 한다 — T1 화면 작업 항목이다. 점포 정보 자체의 재판매만 금지되고, API로 만든 서비스의 유료 제공은 허용된다.

## 2. 공급자별 사용 범위

| 공급자 | MVP에서 맡길 사실 | 맡기지 않을 사실 | 주요 운영 경계 |
| --- | --- | --- | --- |
| Google Places API (New) | POI·식당·숙소 메타데이터, 주소, 좌표, 영업시간, 제한된 리뷰·사진 | 날짜별 예약 슬롯·객실 재고 | 결제 계정 필요. `reservable`은 예약 지원 여부이지 실시간 슬롯이 아님. 콘텐츠 저장 정책 준수 |
| Google Routes API | 도보·자동차 경로, 거리·소요시간, 행렬 | 일본 대중교통 | 결제 계정 필요. 일본 대중교통 파트너 데이터 제외 범위 확인 |
| HotPepper Gourmet Search API | 일본 식당 검색, 예산대, 좌석 총수, 영업시간, 편의시설 | 날짜·시간별 빈 좌석 | `capacity`는 빈 좌석이 아님. 캐시·상업 이용 조건과 표시 의무 준수 |
| Rakuten Travel API | 일본 숙소 검색과 날짜별 공실·요금 후보 | 한국 숙소, 실제 예약 완료 | App ID·Access Key, 표시·저장·수익화 조건 준수 |
| Kakao Maps REST API | 한국 장소와 길찾기, 대중교통·도보 보조 | 일본 경로 | 호출 쿼터와 표시 정책 확인 |
| TourAPI 4.0 | 한국 관광지·숙박·행사·이미지 메타데이터 | 객실 실시간 재고·가격 보장 | 개발 활용신청과 운영계정 심사 경계를 구분 |
| TAGO 열차 정보 | 서울↔부산 등 열차 운행 일정 | 잔여 좌석·예약 완료 | 조건부 MVP. 일정과 재고를 분리 |
| Open-Meteo | 최대 16일 예보, 기온·강수·체감 | 장기 여행일의 확정 날씨 | 무료 비상업·상업 플랜 조건 구분 |
| Frankfurter v2 | 일일 기준 환율 | 카드 청구·환전소 체결 환율 | 결제 금액이 아닌 추정 기준율로 표시 |

## 2.1 종료·제외된 공급자 (2026-08-14 확인)

계획 문서와 Pack에 이름이 남아 있던 공급자 중 **지금은 쓸 수 없는 것들**이다. 코드에서 제거했고 Pack의 `providers`에서도 뺐다. 죽은 엔드포인트로 폴백하면 "후보 0건"의 원인이 가려진다.

| 공급자 | 상태 | 확인 근거 |
| --- | --- | --- |
| **Amadeus Self-Service** | **2026-07-17 완전 종료.** 신규 등록 중단, 기존 키 비활성화, 포털 접근 불가. Enterprise 포털만 존속 | 공식 사용자 공지 및 업계 보도 |
| **ぐるなび(Gurunavi)** | 무료 API **2021-06-30 종료**. 현재 법인 전용 유료(3개월 트라이얼) | 공식 API 사이트 |
| **NAVITIME** | 상용 유료. 무료 티어 없음 | 제품 페이지 |
| **JNTO** | 공개 셀프서비스 API가 확인되지 않음 | 슬롯을 비우는 것이 정답 |
| **Google Places / Routes** | 2025-03 개편으로 $200 통합 크레딧 폐지 → SKU별 무료(Essentials 10,000·Pro 5,000·Enterprise 1,000/월). **결제 계정(카드) 등록이 전제** | 공식 요금 문서 |
| **Kiwi.com Tequila** | 초대제로 전환. 신규 셀프서비스 등록 불가 | 공식 파트너십 공지 |
| **Duffel** | 무료 테스트 모드가 가상 항공사(Duffel Airways) 샌드박스라 실가격이 아님 | 공식 문서 |

### 항공 슬롯은 무료로 채워지지 않는다

Amadeus 종료 이후 **무료로 실제 운임을 주는 경로는 Travelpayouts 하나뿐**이고, 그것도 캐시된 과거 검색가다. 따라서:

- `flight.cheapest_date` — Travelpayouts. `confidence`는 항상 `estimated`. 날짜 선택 신호로만 쓴다.
- `flight.offers_search` · `flight.offer_price` · `flight.group_inventory` — **무료 공급자 없음.** 어댑터가 이 클래스를 지원한다고 선언하지 않는다. 3인 동시 좌석 확보 검증은 무료 범위 밖이다.

발표를 위해서는 `demo-fixture`가 이 슬롯을 채우되, `demo_` id와 "(데모)" 이름과 `estimated` 배지로 가짜임을 드러낸다.

### 일본 대중교통 슬롯도 비어 있다

ODPT(公共交通オープンデータセンター)는 무료지만 **간사이 커버리지가 사실상 없다** — 오사카 검색 결과가 한큐페리 하나뿐이고 도쿄 중심이다. 국토교통성 GTFS-JP 리포지토리는 버스 중심이며 오사카메트로는 GTFS를 공개하지 않는다. 결제 계정을 여는 것 외에는 실경로 공급자가 없다.

## 3. 타베로그 판단

### 3.1 자동 공급자로는 사용하지 않는다

2026-08-14 확인 범위에서 일반 개발자가 계정과 키를 즉시 발급받는 공개 검색·예약 API 문서는 찾지 못했다. 타베로그 내부와 제휴사 사이의 API 연동은 존재하지만 공식 기술 블로그는 외부 시스템과의 사전 조율, 인증·인가, 사용 시퀀스 합의가 필요하다고 설명한다. 이는 해커톤 팀이 무승인 공개 API처럼 사용할 수 있다는 증거가 아니다.

또한 타베로그 이용약관은 서비스의 전부 또는 일부를 영리 활동이나 그 준비 목적으로 이용·접근하는 행위와 리뷰 무단 이용을 금지한다. 따라서 다음을 MVP에서 금지한다.

- 타베로그 HTML 또는 내부 API 스크래핑
- 타베로그 점수·리뷰·사진·메뉴·예약 슬롯의 자동 DB 적재
- 타베로그 정보를 `EvidenceSnapshot`의 기계 검증 근거로 사용
- 비공식 래퍼를 공개 API처럼 취급

### 3.2 허용할 수 있는 범위

- 최종 결과에서 사용자가 직접 여는 타베로그 검색·식당 페이지 링크
- 사용자가 직접 확인했다는 사실을 `user_confirmed`로 별도 기록

이 링크는 `advisory`이며 후보를 `VERIFIED` 또는 `BOOKABLE`로 승격시키지 못한다. 추후 카카쿠컴과 서면 제휴 또는 명시적 데이터 사용 허가를 받으면 별도 공급자 심사를 거쳐 다시 평가한다.

근거:

- [타베로그 이용약관](https://tabelog.com/help/rules/)
- [타베로그 예약 시스템의 외부 연동 기술 블로그](https://tech-blog.tabelog.com/entry/tabelog-reservation-system-external-integration)
- [타베로그 robots.txt](https://tabelog.com/robots.txt)

### 3.3 타베로그와 비슷한 후속 선택지

- **Rakuten Gurunavi API:** 공식 사이트에 API 신규 이용 신청 창구가 있으므로 제휴·유료 데이터 경로를 검토할 수 있다. 하지만 즉시 키를 발급받는 공개 API라는 근거는 아니므로 “무승인·즉시 사용” 기본 목록에서는 제외한다.
- **Google Actions Center 예약 연동:** 실제 식당 예약 슬롯을 다룰 수 있지만 파트너 신청과 초대가 필요하고, 포함 식당과 직접 계약 관계가 있어야 한다. 해커톤 MVP의 일반 검색 키로 사용할 수 없다.

따라서 일본 식당 메타데이터는 HotPepper + Google Places로 시작하고, live 예약 슬롯은 빈 공급자 슬롯으로 유지한다. Gurunavi 또는 예약 플랫폼 제휴가 성사된 뒤에만 `dining_slot_inventory.JP`에 추가한다.

## 4. 남아 있는 기능 공백

| 공백 | MVP 처리 |
| --- | --- |
| 일본 대중교통의 기계 판정 | 자동 `VERIFIED` 금지. 도보·자동차 경로 또는 사용자 확인 링크만 제공. 제휴형 ODPT/NAVITIME 등은 후속 |
| 한국 숙소 날짜별 가격·객실 재고 | 메타데이터 후보는 가능하지만 `PROVISIONAL`. 공급자 페이지에서 사용자 확인 필요 |
| 한·일 식당 날짜·시간별 빈 좌석 | `PROVISIONAL` 또는 `NEEDS_USER_CHOICE`. `reservable`·총 좌석 수로 추정 금지 |
| 장소·회차의 그룹 정원 | 총 좌석·정적 최대 인원을 live 그룹 슬롯으로 추정하지 않는다. 정확한 날짜·시간·인원 응답이 없으면 `UNKNOWN` |
| 복수 객실·테이블·차량 배정 | 단위별 정원과 참여자 전원 배정을 검증한다. 일부만 확인되거나 분리 동의가 없으면 `PASS` 금지 |
| 항공·JR·KTX·버스의 실시간 좌석·운임·취소 조건 | 일정과 재고를 분리. live inventory 공급자가 없으면 `BOOKABLE` 금지 |
| 활동 티켓 재고 | 메타데이터·영업시간까지만 검증, 날짜별 티켓은 사용자 확인 |

## 5. 증거와 상태 계약

모든 외부 사실은 최소한 다음 메타데이터를 가진다.

```ts
type EvidenceSnapshot = {
  provider: string;
  providerCandidateId: string;
  sourceUrl: string;
  fetchedAt: string;
  validUntil: string | null;
  termsRef: string;
  confidence: "live" | "official_static" | "estimated" | "unknown";
  fields: Record<string, unknown>;
};
```

인원·정원 사실의 `fields`에는 가능한 경우 `requestedPartySize`, `partyComposition`, `resourceUnitType`, `requestedUnitCount`, `confirmedCapacity`, `confirmedUnitCount`, `allocationPolicy`를 분리해 둔다. 정원 검증은 장소의 정적 총수용량이 아니라 정확한 날짜·시간·인원·객실 또는 회차 요청의 응답에 결합한다. 공급자가 반환하지 않은 침대 수, 테이블 배치, 인접 좌석, 수하물 포함 차량 정원을 에이전트가 채우지 않는다.

| 확인 상태 | 결과 상태 상한 |
| --- | --- |
| 기본 메타데이터와 출처·신선도 확인 | `VERIFIED` 가능 |
| 날짜별 가격·재고가 없음 | `PROVISIONAL` |
| 링크를 열어 사용자가 선택해야 함 | `NEEDS_USER_CHOICE` |
| 날짜별 재고·가격·시간·취소 조건과 전체 참여자 정원을 유효기간 내 조회 | `BOOKABLE` 가능 |
| 예약 확인 번호 또는 공급자 확인 수신 | 별도 `ReservationRecord`의 `BOOKED` |

`BOOKABLE`의 `statusValidUntil`은 사용한 근거 중 가장 빠른 `validUntil`을 넘을 수 없다. 주소·영업시간·가격·재고·인원 정원 중 하나라도 `FAIL`, `UNKNOWN`, `STALE`, `CONTRADICTED`이면 해당 사실에 의존한 승격을 막는다. `N`명 요청에서 일부 인원만 배정된 응답도 전체 계획의 `PASS`가 아니다.

## 6. 저장 원칙

- 제3자 원문을 장기 복제하지 않고 공급자 ID, 자체 태그, 출처, 조회·만료 시각을 우선 저장한다.
- 리뷰 전문과 사진은 공급자 정책이 허용하는 방식으로만 표시하고 학습·요약용 DB로 복제하지 않는다.
- 제공자별 TTL은 실제 약관과 데이터 의미 중 더 짧은 쪽을 따른다.
- 같은 장소라도 제공자 ID를 임의 병합하지 않고 주소·좌표·이름 일치 근거를 보존한다.
- 약관·요금·쿼터·운영 승인 상태는 변경 가능하므로 출시와 배포 전에 다시 확인한다.

## 7. 조사 신뢰도

| 결론 | 신뢰도 | 이유 |
| --- | --- | --- |
| 타베로그 일반 공개 셀프서비스 API를 MVP 공급자로 쓸 수 없음 | 중간~높음 | 공식 API 발급 문서는 찾지 못했고 공식 외부 연동 자료는 조율형이지만, 비공개 제휴 프로그램의 부재까지 증명할 수는 없음 |
| 타베로그 자동 영리 이용·리뷰 무단 이용을 피해야 함 | 높음 | 현재 공식 이용약관에 직접 명시 |
| Kakao Maps가 한국 대중교통·도보 경로를 제공 | 높음 | 공식 REST API 레퍼런스에 endpoint와 인증 방식 명시 |
| 기존 6개만으로 네 도시 `BOOKABLE` 전체를 보장할 수 없음 | 높음 | 일본 대중교통, 한국 숙소 live 재고, 한·일 식당 슬롯 등 명시적 공급자 공백 존재 |
| Rakuten Travel 공실 검색이 날짜·성인 인원·객실 수 조건을 받음 | 높음 | 공식 요청 파라미터가 명시되지만 침대 구성·동일 객실 요구 등은 별도 필드·사용자 확인이 필요 |
| 각 공급자의 운영 승인·쿼터·상업 조건 | 중간 | 정책과 요금은 변경 가능하므로 배포 직전 재확인 필요 |

## 8. 공식 출처

- [Google Places 리소스](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places)
- [Google Places 정책](https://developers.google.com/maps/documentation/places/web-service/policies)
- [Google Routes 대중교통](https://developers.google.com/maps/documentation/routes/transit-route)
- [Google Maps 일본 데이터 FAQ](https://developers.google.com/maps/faq?hl=ja)
- [HotPepper Gourmet API](https://webservice.recruit.co.jp/doc/hotpepper/reference.html)
- [Recruit Web Service 이용약관](https://cdn.p.recruit.co.jp/terms/rws-t-1001/index.html)
- [Rakuten Travel VacantHotelSearch](https://webservice.rakuten.co.jp/documentation/vacant-hotel-search)
- [Rakuten Web Service 이용규칙](https://webservice.rakuten.co.jp/guide/rule)
- [Kakao Map REST API](https://developers.kakao.com/docs/ko/kakaomap/rest-api)
- [Kakao API 쿼터](https://developers.kakao.com/docs/ko/getting-started/quota)
- [Rakuten Gurunavi API 신규 이용 신청](https://solution.gnavi.co.jp/form_api/)
- [Google Actions Center 예약 연동 자격](https://developers.google.com/actions-center/verticals/reservations/e2e/overview)
- [Open-Meteo 문서](https://open-meteo.com/en/docs)
- [Frankfurter v2](https://frankfurter.dev/)
- [TourAPI 4.0](https://www.data.go.kr/data/15101578/openapi.do)
- [TAGO 열차정보](https://www.data.go.kr/tcs/dss/selectApiDataDetailView.do?publicDataPk=15098552)

2026-08-14 재조사에서 추가된 출처:

- [Amadeus Self-Service 포털 종료 보도](https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers)
- [ぐるなびAPI 법인 유료 전환](https://solution.gnavi.co.jp/service/gnavi_api/)
- [Kiwi.com 파트너십 전환](https://media.kiwi.com/articles-and-interviews/better-for-business-kiwi-com-takes-a-new-approach-to-partnerships/)
- [Google Maps Platform 2025-03 요금 개편](https://developers.google.com/maps/billing-and-pricing/march-2025)
- [Travelpayouts 데이터 API](https://travelpayouts.github.io/slate/)
- [ODsay 운영정책 (무료 티어 비상업 한정)](https://lab.odsay.com/doc/totalPolicy)
- [Open-Meteo 이용약관 (비상업·CC-BY 4.0)](https://open-meteo.com/en/terms)
- [HotPepper 이용 안내 (크레딧 표시 의무)](https://webservice.recruit.co.jp/doc/hotpepper/guideline.html)
- [카카오맵 API 무료 쿼터 정책 변경 (2026-07-21)](https://devtalk.kakao.com/t/api-notice-on-new-kakao-map-api-features-and-free-quota-policy/150222)
- [公共交通オープンデータセンター 데이터 카탈로그](https://ckan.odpt.org/dataset)
