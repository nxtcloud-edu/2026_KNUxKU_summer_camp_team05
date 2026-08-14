/**
 * Provider 중립 요청 어휘 — QueryPlan과 어댑터 사이의 유일한 공용 단어장.
 *
 * 조달 계획(CandidateEvidence)이 `adultNum`·`checkinDate`처럼 특정 Provider의
 * 필드 이름을 말하기 시작하면, Provider를 하나 바꿀 때 계획 계층까지 따라 바뀐다.
 * 그러면 "Provider-neutral QueryPlan"이라는 말이 이름만 남는다.
 *
 * 그래서 방향을 하나로 고정한다:
 *
 *   계획 계층은 **중립 어휘만 발화**하고 (`assertNeutralParams`)
 *   어댑터가 **자기 방언으로 번역**한다 (`readParam`)
 *
 * 번역표는 어댑터 안에 있다. 여기에 Provider별 필드 이름을 모아두지 않는 이유도
 * 같다 — 모아두면 이 파일이 곧 Provider 목록이 되고, 어댑터를 추가할 때마다
 * 공용 파일을 고쳐야 한다.
 */

/**
 * 숙소 조달의 중립 파라미터.
 *
 * 이름은 임의로 고르지 않았다. `policy.ts`의 `keyParams`가 캐시 키로 요구하는
 * 이름(`packId`·`area`·`type`·`guests`·`checkIn`·`checkOut`·`rooms`)을 그대로 쓴다.
 * 캐시 키와 요청 어휘가 어긋나면 같은 조회가 다른 키로 갈라진다.
 */
export const NEUTRAL_STAY_PARAMS = [
  'packId',
  'area',
  'type',
  'guests',
  'rooms',
  'checkIn',
  'checkOut',
  'latitude',
  'longitude',
  'radiusKm',
  'limit',
] as const;

export type NeutralStayParam = (typeof NEUTRAL_STAY_PARAMS)[number];

/**
 * Provider 방언. 계획 계층이 발화하면 경계가 무너진 것이다.
 *
 * 전부 위 중립 이름의 별칭이다 — 뜻이 다른 파라미터가 아니라 **같은 뜻의 다른 이름**이라
 * 둘 다 실려 나가면 캐시 키만 쪼개지고 얻는 것이 없다.
 */
const DIALECT_TO_NEUTRAL: Readonly<Record<string, NeutralStayParam>> = {
  adultNum: 'guests',
  pax: 'guests',
  roomNum: 'rooms',
  checkinDate: 'checkIn',
  checkoutDate: 'checkOut',
  lat: 'latitude',
  lng: 'longitude',
  searchRadius: 'radiusKm',
  radius: 'radiusKm',
  hits: 'limit',
};

/** 방언 이름 전체. 테스트와 경계 검사가 같은 목록을 본다 */
export const PROVIDER_DIALECT_PARAMS: readonly string[] = Object.keys(DIALECT_TO_NEUTRAL);

export class NeutralParamViolationError extends Error {
  constructor(
    readonly context: string,
    readonly offendingParams: readonly string[],
  ) {
    super(
      `${context}: Provider 고유 파라미터를 중립 계층에서 발화했습니다 — ${offendingParams
        .map((name) => `${name}(→${DIALECT_TO_NEUTRAL[name]})`)
        .join(', ')}`,
    );
    this.name = 'NeutralParamViolationError';
  }
}

/**
 * 나가는 요청이 중립 어휘만 쓰는지 검사한다.
 *
 * 계획 계층이 만든 params를 Gateway에 넘기기 **직전에** 부른다. 어댑터를 부른 뒤에
 * 확인하면 이미 방언이 캐시 키에 들어간 뒤다.
 */
export function assertNeutralParams(
  params: Readonly<Record<string, unknown>>,
  context: string,
): void {
  const offending = Object.keys(params).filter((name) => DIALECT_TO_NEUTRAL[name] !== undefined);
  if (offending.length > 0) throw new NeutralParamViolationError(context, offending.sort());
}

/**
 * 어댑터가 중립 파라미터를 읽는다. **중립 이름이 우선이다.**
 *
 * 방언 별칭을 함께 받는 이유는 실호출 검증(live-smoke)이나 어댑터 계약 테스트처럼
 * 계획 계층을 거치지 않고 Provider 용어로 직접 부르는 호출자가 있기 때문이다.
 * 우선순위를 뒤집지 않는다 — 둘 다 있으면 중립 값이 진실이다.
 */
export function readParam(
  params: Readonly<Record<string, unknown>>,
  neutral: NeutralStayParam,
  dialectAliases: readonly string[] = [],
): unknown {
  const value = params[neutral];
  if (value !== undefined && value !== null) return value;
  for (const alias of dialectAliases) {
    const fallback = params[alias];
    if (fallback !== undefined && fallback !== null) return fallback;
  }
  return undefined;
}

/**
 * 수로 읽는다. 값이 없거나 수가 아니면 `undefined`다.
 *
 * 기본값을 지어내지 않는 것이 요점이다 — 인원을 모르는 채 2인으로 채워 물으면
 * 3인이 묵을 수 없는 방이 후보로 올라온다.
 */
export function numberOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
