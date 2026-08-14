import type { DataRequest, QueryClass } from '@tm/contracts';
import { candidateSchema } from '@tm/contracts';
import { ProviderError, type ProviderAdapter } from '../provider.js';
import { providersFromEnv } from './registry.js';

/**
 * 제공자 **실호출** 검증. 스텁이 아니라 진짜 API를 한 번씩 부른다.
 *
 *   npm run smoke:providers --workspace @tm/data-agents
 *
 * 어댑터의 계약 테스트(providers.test.ts)는 응답 형태를 고정해두고 정규화만 본다.
 * 그래서 **실제 API가 그 형태로 주는지는 검증하지 않는다.** 이 스크립트가 그 간극을 메운다.
 *
 * 키가 없는 제공자는 건너뛰고 무엇이 빠졌는지 보고한다 — 조용히 빠지면
 * "후보가 하나도 없는 이유"를 아무도 모른다.
 *
 * 확인하는 것:
 *   · 인증이 통과하는가 (공공데이터포털·리쿠르트는 실패도 200으로 준다)
 *   · 응답이 정규화 스키마를 통과하는가
 *   · 좌표·요금 단위가 우리 가정과 맞는가 (라쿠텐 좌표는 초 단위, chargeFlag는 1실/1인)
 *   · fail-closed 플래그가 함부로 올라가지 않는가
 *
 * **쿼터를 쓴다.** 제공자당 1~2회 호출이지만 TourAPI 숙박은 목록 1 + 상세 N이다.
 * 무료 한도가 하루 1,000건이므로 반복 실행에 주의한다.
 */

let failures = 0;
let skipped = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
}

function note(label: string, detail: string): void {
  console.log(`  ·    ${label}: ${detail}`);
}

/** 오늘부터 n일 뒤. 과거 날짜로 물으면 공실이 0건이라 검증이 안 된다 */
function daysFromNow(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

/** 두 달 뒤 YYYY-MM. 항공 최저가는 월 단위로 묻는 편이 결과가 잘 나온다 */
function monthFromNow(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 7);
}

const request = (queryClass: QueryClass, params: Record<string, unknown>): DataRequest => ({
  requestId: `live_${Date.now()}`,
  runId: 'run_live_smoke',
  roundId: 'r_0',
  callerId: 'orchestrator:live_smoke',
  queryClass,
  purpose: 'exploration',
  packId: 'jp-osaka',
  params,
});

/** 난바 한복판. 라쿠텐·HotPepper 둘 다 이 좌표 반경으로 묻는다 */
const NAMBA = { lat: 34.6659, lng: 135.5017 };

interface Probe {
  id: string;
  label: string;
  queryClass: QueryClass;
  params: Record<string, unknown>;
  /** 응답을 받은 뒤 어댑터별로 확인할 것 */
  inspect(payload: Record<string, unknown>): void;
}

/** 정규화 후보 배열을 스키마에 넣어본다. 실호출에서 깨지는 곳이 진짜 계약 위반이다 */
function checkCandidates(id: string, payload: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = (payload['candidates'] ?? []) as Record<string, unknown>[];
  check(`${id}: 후보를 받았다 (${candidates.length}건)`, candidates.length > 0);

  if (candidates.length === 0) return [];
  const parsed = candidateSchema.safeParse(candidates[0]);
  check(
    `${id}: 실응답이 정규화 Candidate 스키마를 통과한다`,
    parsed.success,
    parsed.success ? undefined : parsed.error.issues.slice(0, 3),
  );
  return candidates;
}

const PROBES: Probe[] = [
  {
    id: 'rakuten_travel',
    label: '라쿠텐 공실 검색 (난바 반경 2km · 3인 1실 3박)',
    queryClass: 'hotel.vacancy_price',
    params: {
      latitude: NAMBA.lat,
      longitude: NAMBA.lng,
      searchRadius: 2.0,
      checkinDate: daysFromNow(60),
      checkoutDate: daysFromNow(63),
      adultNum: 3,
      roomNum: 1,
      limit: 5,
    },
    inspect(payload) {
      const candidates = checkCandidates('rakuten', payload);
      const first = candidates[0];
      if (first === undefined) return;

      // 좌표를 3600으로 나누는 가정이 맞는지. 틀리면 오사카가 아닌 곳이 나온다.
      const location = first['location'] as Record<string, number>;
      const nearOsaka =
        Math.abs(location['lat']! - NAMBA.lat) < 0.5 && Math.abs(location['lng']! - NAMBA.lng) < 0.5;
      check('rakuten: 좌표가 오사카 범위 안이다 (초→도 변환 가정 확인)', nearOsaka, location);

      // chargeFlag 해석이 맞는지. 1인당/1실당을 뒤집으면 3인 총액이 3배 틀린다.
      const price = first['price'] as Record<string, number>;
      note('rakuten 요금', `그룹 총액 ${price['groupTotal']}엔 · 1인 ${price['totalPerPerson']}엔`);
      check('rakuten: 그룹 총액이 1인 요금보다 크거나 같다', price['groupTotal']! >= price['totalPerPerson']!);

      check('rakuten: 정확한 인원으로 물었으므로 객실 조합이 확인됐다', first['roomCombinationVerified'] === true);
      check('rakuten: 취소 조건이 없으므로 총액을 확정하지 않는다', first['allInPriceVerified'] === false);
      note('rakuten 숙소', String(first['name']));
    },
  },
  {
    id: 'hotpepper',
    label: 'HotPepper 식당 검색 (난바 반경 1km · 3인)',
    queryClass: 'dining.search',
    params: { lat: NAMBA.lat, lng: NAMBA.lng, range: 3, pax: 3, limit: 5 },
    inspect(payload) {
      const places = (payload['places'] ?? []) as Record<string, unknown>[];
      check(`hotpepper: 식당을 받았다 (${places.length}건)`, places.length > 0);

      const first = places[0];
      if (first === undefined) return;

      // 좌표가 문자열로 올 때가 있다. numeric()이 처리하는지 실응답으로 본다.
      check('hotpepper: 좌표가 숫자다', typeof first['lat'] === 'number' && typeof first['lng'] === 'number', {
        lat: first['lat'],
        lng: first['lng'],
      });
      check('hotpepper: 예약을 확인했다고 하지 않는다', first['reservationVerified'] === false);
      note('hotpepper 식당', `${String(first['name'])} · 총 좌석 ${String(first['totalSeats'])} · 연회 ${String(first['partyCapacity'])}`);
      note('hotpepper 영업시간', String(first['openHours']));
    },
  },
  {
    id: 'tourapi',
    label: 'TourAPI 관광지 (부산 areaCode=6)',
    queryClass: 'poi.search',
    params: { areaCode: 6, limit: 5 },
    inspect(payload) {
      const places = (payload['places'] ?? []) as Record<string, unknown>[];
      check(`tourapi: 관광지를 받았다 (${places.length}건)`, places.length > 0);
      const first = places[0];
      if (first !== undefined) note('tourapi 관광지', `${String(first['name'])} · ${String(first['address'])}`);
    },
  },
  {
    id: 'tourapi',
    label: 'TourAPI 숙박 객실 정원 (부산 areaCode=6)',
    queryClass: 'hotel.room_combination',
    params: { areaCode: 6, pax: 3, nights: 3, limit: 3 },
    inspect(payload) {
      const candidates = checkCandidates('tourapi 숙박', payload);
      const first = candidates[0];
      if (first === undefined) {
        // 이것이 비면 국내 정원 검증 경로가 통째로 무너진다. 조용히 넘기지 않는다.
        console.error('  FAIL tourapi: detailInfo2에 roommaxcount가 채워진 숙소가 하나도 없다 — 국내 정원 검증 불가');
        failures += 1;
        return;
      }
      const capacity = first['capacity'] as Record<string, unknown>;
      note('tourapi 숙박', `${String(first['name'])} · 최대 ${String(capacity['maxGuests'])}인 · 객실 ${(capacity['roomOptions'] as unknown[]).length}종`);
      check('tourapi: 날짜별 재고가 없으므로 객실 조합을 확인했다고 하지 않는다', first['roomCombinationVerified'] === false);
    },
  },
  {
    id: 'kakao',
    label: '카카오 로컬 키워드 검색',
    queryClass: 'poi.search',
    params: { keyword: '광안리 해수욕장', limit: 5 },
    inspect(payload) {
      const places = (payload['places'] ?? []) as Record<string, unknown>[];
      check(`kakao: 장소를 받았다 (${places.length}건)`, places.length > 0);
      const first = places[0];
      if (first === undefined) return;

      // x=경도, y=위도 가정. 뒤집으면 후보가 전부 바다로 간다.
      const lat = first['lat'] as number;
      const lng = first['lng'] as number;
      check('kakao: 위도/경도가 뒤바뀌지 않았다 (한국 범위)', lat > 33 && lat < 39 && lng > 124 && lng < 132, { lat, lng });
      note('kakao 장소', `${String(first['name'])} · ${String(first['address'])}`);
    },
  },
  {
    id: 'odsay',
    label: 'ODsay 대중교통 경로 (서울역 → 강남역)',
    queryClass: 'transit.route',
    params: { startX: 126.9707, startY: 37.5547, endX: 127.0276, endY: 37.4979 },
    inspect(payload) {
      const candidates = checkCandidates('odsay', payload);
      const first = candidates[0];
      if (first === undefined) return;
      const totals = first['totals'] as Record<string, number>;
      note('odsay 경로', `${String(first['label'])} · ${totals['durationMin']}분 · ${totals['farePerPersonKrw']}원`);
      check('odsay: 접근성을 확인했다고 하지 않는다', (first['accessibility'] as Record<string, unknown>)['verified'] === false);
    },
  },
  {
    id: 'travelpayouts',
    label: 'Travelpayouts 최저가 (ICN → KIX)',
    queryClass: 'flight.cheapest_date',
    params: { origin: 'ICN', destination: 'KIX', departureDate: monthFromNow(2) },
    inspect(payload) {
      const quotes = (payload['quotes'] ?? []) as Record<string, unknown>[];
      check(`travelpayouts: 최저가를 받았다 (${quotes.length}건)`, quotes.length > 0);
      const first = quotes[0];
      if (first === undefined) return;
      note('travelpayouts 최저가', `${String(first['pricePerPerson'])}${String(first['currency'])} · ${String(first['airline'])} · ${String(first['departureAt'])}`);
      check('travelpayouts: 그룹 좌석을 확인했다고 하지 않는다', first['groupInventoryVerified'] === false);
    },
  },
];

async function probe(adapter: ProviderAdapter, spec: Probe): Promise<void> {
  console.log(`\n${spec.label}`);
  try {
    const result = await adapter.fetch(request(spec.queryClass, spec.params));
    check(`${spec.id}: 호출이 성공했다`, true);
    note('confidence', String(result.confidence));
    note('termsRef', String(result.termsRef ?? '(없음)'));
    if (result.validUntil !== undefined && result.validUntil !== null) {
      note('validUntil', result.validUntil);
    }
    spec.inspect(result.payload as Record<string, unknown>);
  } catch (error) {
    failures += 1;
    const detail = error instanceof ProviderError ? `${error.reason} (retryable=${error.retryable})` : (error as Error).message;
    console.error(`  FAIL ${spec.id}: 호출 실패 — ${detail}`);
  }
}

/**
 * 저장소 루트의 `.env`를 읽는다. 키가 6개라 매번 export 하는 것은 실수를 부른다.
 * 파일이 없어도 그냥 진행한다 — 이미 환경변수로 넣었을 수 있다.
 */
function loadDotEnv(): void {
  const root = new URL('../../../../.env', import.meta.url);
  try {
    process.loadEnvFile(root);
    console.log(`  .env 읽음: ${root.pathname.slice(1)}`);
  } catch {
    console.log('  .env가 없습니다 — 환경변수에서 직접 읽습니다');
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const setup = providersFromEnv();
  const byId = new Map(setup.adapters.map((adapter) => [adapter.id, adapter]));

  console.log('제공자 실호출 검증');
  console.log(`  등록된 어댑터: ${setup.adapters.length === 0 ? '(없음)' : setup.adapters.map((a) => a.id).join(', ')}`);

  if (setup.missing.length > 0) {
    console.log('\n키가 없어 건너뛰는 제공자');
    for (const row of setup.missing) {
      console.log(`  -    ${row.id} (${row.envVars.join(', ')})`);
    }
  }

  for (const spec of PROBES) {
    const adapter = byId.get(spec.id);
    if (adapter === undefined) {
      skipped += 1;
      continue;
    }
    if (!adapter.supports(spec.queryClass)) {
      failures += 1;
      console.error(`\n  FAIL ${spec.id}: ${spec.queryClass}를 지원하지 않는다`);
      continue;
    }
    await probe(adapter, spec);
    // 라쿠텐은 1 req/sec가 상한이다. 다른 제공자도 여유를 둔다.
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }

  console.log('');
  if (setup.adapters.length === 0) {
    console.log('키가 하나도 없습니다. .env를 채우고 다시 실행하세요.');
    console.log('  발급 안내: docs/provider-evidence-policy.md 1.1');
    process.exit(0);
  }

  if (failures > 0) {
    console.error(`\n실호출 검증 실패 ${failures}건 (건너뜀 ${skipped}건)`);
    process.exit(1);
  }
  console.log(`실호출 검증 통과 (건너뜀 ${skipped}건)`);
}

void main().catch((error: unknown) => {
  console.error('실호출 검증이 중단됐습니다:', (error as Error).message);
  process.exit(1);
});
