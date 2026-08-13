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

| 확인 상태 | 결과 상태 상한 |
| --- | --- |
| 기본 메타데이터와 출처·신선도 확인 | `VERIFIED` 가능 |
| 날짜별 가격·재고가 없음 | `PROVISIONAL` |
| 링크를 열어 사용자가 선택해야 함 | `NEEDS_USER_CHOICE` |
| 날짜별 재고·가격·시간·취소 조건을 유효기간 내 조회 | `BOOKABLE` 가능 |
| 예약 확인 번호 또는 공급자 확인 수신 | 별도 `ReservationRecord`의 `BOOKED` |

`BOOKABLE`의 `statusValidUntil`은 사용한 근거 중 가장 빠른 `validUntil`을 넘을 수 없다. 주소·영업시간·가격·재고 중 하나라도 `FAIL`, `UNKNOWN`, `STALE`, `CONTRADICTED`이면 해당 사실에 의존한 승격을 막는다.

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
