import type { QueryClass, RoundId } from '@tm/contracts';

/**
 * 조달 계획의 **바닥값** — 후보탐색 에이전트가 없거나 실패했을 때.
 *
 * 원칙은 여전히 "무엇을 찾을지는 에이전트가"다. 다만 라운드마다 어떤 종류의 데이터가
 * 필요한지는 도메인이 이미 정해둔 사실이고(R1a는 항공, R2는 숙소), 그것까지 없으면
 * LLM이 없을 때 파이프라인이 아무것도 조달하지 못한 채 완주한다.
 *
 * 그래서 **바닥은 코드가 깔고, 그 위의 판단(어떤 지역을, 어떤 조건으로 몇 번)은
 * 에이전트가 한다.** 이 계획이 쓰였다는 사실은 항상 로그에 남는다 — 조용히
 * 대체하지 않는다.
 */

export interface SearchFacts {
  packId: string;
  dateRange: { start: string; end: string } | null;
  groupSize: number;
  originAirport: string | null;
  destinationAirport: string | null;
  nights: number;
  /** Pack이 정한 지역 목록. 조달 조건의 필수 키다 */
  areas: readonly string[];
  /**
   * Pack의 중심 좌표. 지역명을 좌표로 받는 공급자(라쿠텐)를 위한 것이다.
   * 지역별 좌표는 Pack에 없으므로 도시 중심 + 반경으로 대신한다 — 값을 지어내는
   * 것이 아니라 "이 도시 안에서 찾는다"는 사실 그대로다.
   */
  center: { lat: number; lng: number } | null;
}

export interface PlannedSearch {
  queryClass: QueryClass;
  params: Record<string, unknown>;
  note: string;
}

/**
 * 라운드별 기본 조달.
 *
 * 날짜가 확정되지 않았으면 날짜가 필요한 클래스를 요청하지 않는다 —
 * 없는 값을 지어내면 조달이 실패하거나, 더 나쁘게는 엉뚱한 후보가 들어온다.
 */
export function defaultSearchPlan(roundId: RoundId, facts: SearchFacts): PlannedSearch[] {
  const dated = facts.dateRange !== null;

  switch (roundId) {
    case 'r_1a':
      if (!dated || facts.originAirport === null || facts.destinationAirport === null) return [];
      return [
        {
          queryClass: 'flight.offers_search',
          params: {
            origin: facts.originAirport,
            destination: facts.destinationAirport,
            departureDate: facts.dateRange?.start,
            returnDate: facts.dateRange?.end,
            pax: facts.groupSize,
            cabin: 'ECONOMY',
          },
          note: '기본 조달 — 확정 구간의 왕복 항공',
        },
      ];

    case 'r_1b': {
      // 공항이 없으면 시내 이동 자체가 성립하지 않는다. 지역은 Pack이 원본이다.
      const area = facts.areas[0];
      if (facts.destinationAirport === null || area === undefined) return [];
      return [
        {
          queryClass: 'transit.airport_transfer',
          // keyParams(airport·area·mode)를 모두 채워야 캐시 키가 만들어진다.
          params: {
            airport: facts.destinationAirport,
            area,
            mode: 'transit',
            pax: facts.groupSize,
            packId: facts.packId,
          },
          note: '기본 조달 — 공항에서 시내로 들어가는 경로',
        },
      ];
    }

    case 'r_2': {
      if (!dated) return [];
      // 지역별로 나눠 요청한다. 한 지역만 보면 비교할 것이 없다.
      const areas = facts.areas.length === 0 ? ['중심가'] : facts.areas.slice(0, 2);
      return areas.map((area) => ({
        queryClass: 'hotel.search' as const,
        params: {
          packId: facts.packId,
          area,
          type: 'any',
          guests: facts.groupSize,
          checkIn: facts.dateRange?.start,
          checkOut: facts.dateRange?.end,
          nights: facts.nights,
          pax: facts.groupSize,
          /**
           * 인원 전원이 한 객실에 들어가는지부터 묻는다. 라쿠텐은 이 조건을
           * 검색에 걸어주므로, 결과가 비면 "그 인원이 한 방에 못 들어간다"는
           * 사실이 된다 — 추정이 아니라 공급자가 답한 것이다. 객실을 나누는
           * 조합 탐색은 그 사실을 받은 뒤 에이전트가 할 판단이다.
           */
          rooms: 1,
          // 좌표를 받는 공급자용. 지역별 좌표가 없으므로 도시 중심 + 반경이다.
          ...(facts.center === null
            ? {}
            : { lat: facts.center.lat, lng: facts.center.lng, radiusKm: 3 }),
        },
        note: `기본 조달 — ${area} 숙소`,
      }));
    }

    // R0(프레이밍)·R3~R6은 앞 라운드의 결과에 의존한다. 바닥값으로 요청할 수 있는
    // 것이 없으므로 비워 둔다 — 에이전트가 붙으면 여기서 제안이 들어온다.
    default:
      return [];
  }
}
