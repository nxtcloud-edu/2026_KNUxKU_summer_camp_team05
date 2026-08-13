import { candidateSchema, type Candidate } from '@tm/contracts';
import { buildGroundedIndex, type GroundedCandidate, type GroundedIndex } from './factcheck.js';

/**
 * 정규화 후보 → 팩트체크 근거.
 *
 * 감시자는 발화의 금액·주소·시각이 실제 조달된 후보에 있는지 대조해야 하는데,
 * 그러려면 후보 스키마(항공/숙소/교통이 각각 다르다)에서 **대조 가능한 값만** 뽑아야 한다.
 * 그 추출이 여기 있다. 에이전트가 직접 매핑하면 카테고리마다 규칙이 갈라지고,
 * 빠뜨린 필드는 검사 없이 통과한다.
 *
 * 근거: agent-architecture.md 7장 · packages/core/src/factcheck.ts
 */

const numbers = (...values: (number | null | undefined)[]): number[] =>
  values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

const strings = (...values: (string | null | undefined)[]): string[] =>
  values.filter((value): value is string => typeof value === 'string' && value.trim() !== '');

export interface GroundedOptions {
  /** 통화 코드 → 원화 환율. 후보 통화가 KRW가 아니면 환산값도 근거로 인정한다 */
  fxToKrw?: Readonly<Record<string, number>>;
  /** 실격 여부. `candidates` 테이블의 값을 그대로 넘긴다 */
  disqualified?: boolean;
  /** 웹·RAG에서 온 값인가. advisory 근거로는 사실을 단정할 수 없다 (6.9) */
  advisory?: boolean;
}

/**
 * 후보 하나에서 대조 가능한 값을 뽑는다.
 *
 * 환산은 심판이 `ref.fx`로 하는 일이지만, 후보 통화가 원화가 아니면 발화의 원화
 * 금액이 무엇과도 일치하지 않아 전부 "근거 없는 금액"이 된다. 환율을 주면
 * 환산값도 근거로 인정한다 — 주지 않으면 원 통화 금액만 인정한다.
 */
export function groundedFromCandidate(
  candidate: Candidate,
  options: GroundedOptions = {},
): GroundedCandidate {
  const amounts: number[] = [];
  const addresses: string[] = [];
  const times: string[] = [];
  const durations: number[] = [];
  let currency = 'KRW';

  if (candidate.kind === 'flight') {
    currency = candidate.price.currency;
    amounts.push(
      ...numbers(
        candidate.price.amount,
        candidate.price.perPersonRoundTrip,
        candidate.price.groupTotal,
        candidate.effectiveTotal.perPerson,
        candidate.baggage.extraCheckedFeePerPerson,
      ),
    );
    times.push(
      ...strings(
        candidate.outbound.departure.at,
        candidate.outbound.arrival.at,
        candidate.inbound.departure.at,
        candidate.inbound.arrival.at,
      ),
    );
    durations.push(...numbers(candidate.outbound.durationMin, candidate.inbound.durationMin));
  }

  if (candidate.kind === 'hotel') {
    currency = candidate.price.currency;
    amounts.push(
      ...numbers(
        candidate.price.amount,
        candidate.price.perNightPerPerson,
        candidate.price.totalPerPerson,
        candidate.price.groupTotal,
        candidate.meals.mealValuePerPersonPerNight,
        candidate.meals.effectiveLodgingCost,
        ...candidate.capacity.roomOptions.map((option) => option.pricePerNight),
      ),
    );
    addresses.push(...strings(candidate.name, candidate.location.address, candidate.location.area));
    times.push(...strings(candidate.cancelPolicy.freeUntil, candidate.cancelPolicy.penaltyAfter));
    durations.push(
      ...numbers(...Object.values(candidate.locationMetrics).map((metric) => metric.minutes)),
    );
  }

  if (candidate.kind === 'transport') {
    // 교통 후보의 요금은 계약상 원화다 (farePerPersonKrw).
    amounts.push(
      ...numbers(
        candidate.totals?.farePerPersonKrw,
        candidate.policy?.estimatedDailyCostPerPersonKrw,
        candidate.policy?.contingencyPerPersonKrw,
        ...candidate.segments.map((segment) => segment.farePerPersonKrw),
      ),
    );
    addresses.push(
      ...strings(
        candidate.label,
        ...candidate.segments.flatMap((segment) => [segment.from, segment.to]),
      ),
    );
    times.push(
      ...strings(
        ...candidate.segments.flatMap((segment) => [segment.departAt, segment.arriveAt]),
      ),
    );
    durations.push(
      ...numbers(
        candidate.totals?.durationMin,
        ...candidate.segments.map((segment) => segment.durationMin),
      ),
    );
  }

  // 원 통화가 아니면 환산값도 근거로 인정한다. 환율이 없으면 원 통화 금액만 남는다.
  const rate = options.fxToKrw?.[currency];
  const converted =
    currency !== 'KRW' && typeof rate === 'number' && rate > 0
      ? amounts.map((amount) => Math.round(amount * rate))
      : [];

  return {
    externalId: candidate.id,
    amountsKrw: [...new Set([...amounts, ...converted])],
    addresses: [...new Set(addresses)],
    times: [...new Set(times)],
    durationsMin: [...new Set(durations)],
    advisory: options.advisory ?? false,
    disqualified: options.disqualified ?? false,
  };
}

export interface CandidateRowLike {
  externalId: string;
  /** `candidates.payload`. 정규화 스키마를 통과한 값이어야 한다 */
  payload: unknown;
  disqualified?: boolean;
  advisory?: boolean;
}

export interface GroundedBuildResult {
  index: GroundedIndex;
  /**
   * 스키마를 통과하지 못해 근거로 쓸 수 없는 후보.
   * 조용히 버리면 감시자가 "근거 없음"으로 오판한다.
   */
  skipped: { externalId: string; reason: string }[];
}

/**
 * `candidates` 테이블의 행들로 팩트체크 인덱스를 만든다.
 * 감시자는 라운드 시작 시 한 번 만들어 두고 발화마다 재사용하면 된다.
 */
export function buildGroundedIndexFromRows(
  rows: readonly CandidateRowLike[],
  options: { fxToKrw?: Readonly<Record<string, number>> } = {},
): GroundedBuildResult {
  const grounded: GroundedCandidate[] = [];
  const skipped: GroundedBuildResult['skipped'] = [];

  for (const row of rows) {
    const parsed = candidateSchema.safeParse(row.payload);
    if (!parsed.success) {
      skipped.push({
        externalId: row.externalId,
        reason: parsed.error.issues[0]?.message ?? '정규화 스키마 불일치',
      });
      continue;
    }
    grounded.push(
      groundedFromCandidate(parsed.data, {
        ...(options.fxToKrw === undefined ? {} : { fxToKrw: options.fxToKrw }),
        disqualified: row.disqualified ?? false,
        advisory: row.advisory ?? false,
      }),
    );
  }

  return { index: buildGroundedIndex(grounded), skipped };
}
