/**
 * DateResolver — 일정 자동 확정 (R0 전처리).
 *
 * **날짜 결정은 토론이 아니라 계산이다.** LLM에게 캘린더 교집합을 맡기면 반드시 틀린다.
 * 결정론적으로 후보를 뽑고, 후보가 여럿이고 점수가 비슷할 때만 R0에서 짧게 논의한다.
 *
 * 입력은 **가능일 화이트리스트뿐이다.** 설문에서 불가일을 받지 않기로 했으므로
 * "찍지 않은 날 = 불가"로 본다. 안전한 방향이다 — 모르는 날에 배정하는 일이 없다.
 * 대신 후보 구간이 훨씬 빡빡해지므로 **완화 경로가 예외가 아니라 기본 경로**다.
 *
 * 미응답자는 계산에서 제외한다. 다른 항목은 중립값으로 대체할 수 있지만 가용 일정은
 * 안 된다 — 갈 수 없는 날에 배정하면 여행 자체가 불가능하다 (기획서 3.2).
 *
 * 근거: travel-mediation-plan.md 7.2 · 3.3
 */

export interface ParticipantAvailability {
  userId: string;
  /** 가능일 화이트리스트 (YYYY-MM-DD). 여기 없는 날은 불가다 */
  availableDates: readonly string[];
  /** 희망 박수. null이면 최빈값 계산에서 빠진다 */
  preferredNights: number | null;
  /** ±1박 허용 여부. 완화 1단계의 대상을 가른다 */
  nightFlexible: boolean;
}

export interface PackDateHints {
  recommendedNights: number;
  /** `2026-12-24~2027-01-02` 형태 */
  peakSeasons?: readonly string[];
  /** 이 날짜가 포함된 구간은 후보에서 제외한다 */
  avoidDates?: readonly string[];
  weatherProfile?: { bestMonths: readonly number[]; rainyMonths: readonly number[] };
  /** 항공이 필요 없는 국내 Pack이면 항공료 가중치를 요일로 이관한다 */
  requiresAirTravel?: boolean;
}

export interface DateResolverInput {
  participants: readonly ParticipantAvailability[];
  pack: PackDateHints;
  /** 오늘 (YYYY-MM-DD). 후보는 내일부터 탐색한다 */
  today: string;
  /** 탐색 범위(일). 기본 180 */
  horizonDays?: number;
  /**
   * 출발일 → 항공료. Amadeus `flight.cheapest_date` 결과를 그대로 넣는다.
   * 없으면 항공료 가중치를 요일 적합도로 이관한다 (없는 값을 추정하지 않는다).
   */
  flightPrices?: Readonly<Record<string, number>>;
  /** 최소 참석 인원. 기본 2 — 1명은 중재할 것이 없다 */
  minAttendees?: number;
}

export interface DateWindow {
  start: string;
  end: string;
  nights: number;
  attendees: string[];
  absentees: string[];
  score: number;
  /** 점수 구성. 회의록에 "왜 이 날짜인가"로 그대로 실린다 */
  breakdown: Record<string, number>;
}

export type DateResolutionStatus =
  /** 후보 1개이거나 1위가 확실히 앞선다 — 토론 없이 확정 */
  | 'confirmed'
  /** 후보 2~3개가 접전 — R0에서 짧게 논의 */
  | 'needs_discussion'
  /** 전원 가능한 구간이 없다 — 방장이 계산된 선택지 중 고른다 */
  | 'needs_host_choice'
  /** 최소 인원조차 모을 수 없다 */
  | 'impossible';

export type Relaxation = 'none' | 'fewer_nights' | 'partial_attendance';

export interface DateResolution {
  status: DateResolutionStatus;
  /** 상위 3개 후보 */
  windows: DateWindow[];
  /** 즉시 확정된 구간. status가 confirmed일 때만 채워진다 */
  chosen: DateWindow | null;
  relaxation: Relaxation;
  nights: number;
  /** 사용자에게 그대로 보여줄 설명 */
  reason: string;
}

/** 1위가 2위를 이만큼 앞서면 토론을 생략한다 (7.2.3) */
export const AUTO_CONFIRM_MARGIN = 0.15;

const DEFAULT_HORIZON_DAYS = 180;
const DEFAULT_MIN_ATTENDEES = 2;
/** 이 안에 출발하면 항공·숙소가 비싸다 */
const IMMINENT_DAYS = 21;
const TOP_N = 3;

const DAY_MS = 86_400_000;

const toUtc = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** 구간에 포함된 날짜 전부 (박수 + 1일) */
export function datesInWindow(start: string, nights: number): string[] {
  const base = toUtc(start);
  return Array.from({ length: nights + 1 }, (_, index) => toIso(base + index * DAY_MS));
}

/** `2026-12-24~2027-01-02` → 포함 여부 판정 */
function inRanges(date: string, ranges: readonly string[]): boolean {
  for (const range of ranges) {
    const [from, to] = range.split('~').map((part) => part.trim());
    if (from === undefined) continue;
    if (to === undefined) {
      if (date === from) return true;
      continue;
    }
    if (date >= from && date <= to) return true;
  }
  return false;
}

/** 희망 박수의 최빈값. 응답이 없으면 Pack 권장값 */
export function resolveNights(
  participants: readonly ParticipantAvailability[],
  fallback: number,
): number {
  const counts = new Map<number, number>();
  for (const participant of participants) {
    const nights = participant.preferredNights;
    if (nights === null || nights <= 0) continue;
    counts.set(nights, (counts.get(nights) ?? 0) + 1);
  }
  if (counts.size === 0) return fallback;

  // 동률이면 짧은 쪽. 일정이 짧을수록 성립 가능성이 높다.
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? fallback;
}

interface Candidate {
  start: string;
  dates: string[];
  attendees: string[];
  absentees: string[];
}

/** 구간별 참석 가능자 산출. 가능일 집합이 구간 전체를 덮어야 참석이다 */
function findWindows(
  participants: readonly ParticipantAvailability[],
  nights: number,
  input: DateResolverInput,
): Candidate[] {
  const horizon = input.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const avoid = input.pack.avoidDates ?? [];
  const base = toUtc(input.today);
  const sets = new Map(
    participants.map((participant) => [participant.userId, new Set(participant.availableDates)]),
  );

  const windows: Candidate[] = [];
  // 오늘은 제외하고 내일부터. 오늘 출발하는 여행 계획은 의미가 없다.
  for (let offset = 1; offset + nights <= horizon; offset += 1) {
    const start = toIso(base + offset * DAY_MS);
    const dates = datesInWindow(start, nights);
    if (dates.some((date) => avoid.includes(date))) continue;

    const attendees: string[] = [];
    const absentees: string[] = [];
    for (const participant of participants) {
      const available = sets.get(participant.userId) as Set<string>;
      if (dates.every((date) => available.has(date))) attendees.push(participant.userId);
      else absentees.push(participant.userId);
    }

    if (attendees.length > 0) windows.push({ start, dates, attendees, absentees });
  }
  return windows;
}

/** 금·토·일 비중. 토·일은 1점, 금요일은 연차 반나절로 보고 0.5점 */
function weekdayFit(dates: readonly string[]): number {
  let score = 0;
  for (const date of dates) {
    const day = new Date(toUtc(date)).getUTCDay();
    if (day === 0 || day === 6) score += 1;
    else if (day === 5) score += 0.5;
  }
  return Math.min(1, score / dates.length);
}

/**
 * 여유도 — 구간 앞뒤로 하루씩 넓혀도 참석자가 여전히 가능한 비율.
 *
 * 원래 이 자리는 "개인 선호일 포함 비율"이었다. 가능일만 받으면 선호와 가능을
 * 구분할 수 없으므로 대체 지표를 쓴다. 가용 구간 한가운데를 고르면 항공 시간대가
 * 바뀌거나 하루 밀려도 대응할 수 있다 — 실제로 쓸모 있는 버퍼다.
 */
function slackFit(
  candidate: Candidate,
  participants: readonly ParticipantAvailability[],
): number {
  const sets = new Map(
    participants.map((participant) => [participant.userId, new Set(participant.availableDates)]),
  );
  const before = toIso(toUtc(candidate.start) - DAY_MS);
  const last = candidate.dates[candidate.dates.length - 1] as string;
  const after = toIso(toUtc(last) + DAY_MS);

  let slack = 0;
  for (const userId of candidate.attendees) {
    const available = sets.get(userId) as Set<string>;
    if (available.has(before)) slack += 0.5;
    if (available.has(after)) slack += 0.5;
  }
  return candidate.attendees.length === 0 ? 0 : slack / candidate.attendees.length;
}

/** 성수기 겹침 비율 */
function peakRatio(dates: readonly string[], peakSeasons: readonly string[]): number {
  if (peakSeasons.length === 0) return 0;
  const hits = dates.filter((date) => inRanges(date, peakSeasons)).length;
  return hits / dates.length;
}

/** 계절 적합도. 좋은 달 1, 우기 0, 나머지 0.5 */
function seasonFit(dates: readonly string[], profile: PackDateHints['weatherProfile']): number {
  if (profile === undefined) return 0.5;
  let total = 0;
  for (const date of dates) {
    const month = new Date(toUtc(date)).getUTCMonth() + 1;
    if (profile.bestMonths.includes(month)) total += 1;
    else if (profile.rainyMonths.includes(month)) total += 0;
    else total += 0.5;
  }
  return total / dates.length;
}

function imminencePenalty(start: string, today: string): number {
  const days = (toUtc(start) - toUtc(today)) / DAY_MS;
  if (days >= IMMINENT_DAYS) return 0;
  return (IMMINENT_DAYS - days) / IMMINENT_DAYS;
}

/**
 * 후보 스코어링 (7.2.1의 [5]).
 *
 * 가중치 이관 규칙:
 *   - 항공료 데이터가 없거나 국내 Pack이면 0.30을 요일 적합도로 넘긴다
 *   - 선호 신호(0.20)는 가용일만 받는 설계에서 여유도로 대체한다
 */
function scoreWindows(
  candidates: readonly Candidate[],
  input: DateResolverInput,
  participants: readonly ParticipantAvailability[],
): DateWindow[] {
  const usesFlight =
    input.pack.requiresAirTravel !== false &&
    input.flightPrices !== undefined &&
    Object.keys(input.flightPrices).length > 0;

  const weights = {
    flight: usesFlight ? 0.3 : 0,
    weekday: usesFlight ? 0.2 : 0.5,
    slack: 0.2,
    season: 0.15,
  };

  // 항공료는 후보들 사이의 상대값이다. 최저가 1, 최고가 0.
  const prices = usesFlight
    ? candidates
        .map((candidate) => input.flightPrices?.[candidate.start])
        .filter((price): price is number => typeof price === 'number')
    : [];
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const spread = maxPrice - minPrice;

  return candidates.map((candidate) => {
    const price = input.flightPrices?.[candidate.start];
    const flight =
      !usesFlight || price === undefined ? 0 : spread === 0 ? 1 : (maxPrice - price) / spread;
    const weekday = weekdayFit(candidate.dates);
    const slack = slackFit(candidate, participants);
    const season = seasonFit(candidate.dates, input.pack.weatherProfile);
    const peak = peakRatio(candidate.dates, input.pack.peakSeasons ?? []);
    const imminence = imminencePenalty(candidate.start, input.today);

    const score =
      weights.flight * flight +
      weights.weekday * weekday +
      weights.slack * slack +
      weights.season * season -
      0.1 * peak -
      0.05 * imminence;

    const breakdown: Record<string, number> = {
      weekday: Number((weights.weekday * weekday).toFixed(3)),
      slack: Number((weights.slack * slack).toFixed(3)),
      season: Number((weights.season * season).toFixed(3)),
      peakPenalty: Number((-0.1 * peak).toFixed(3)),
      imminencePenalty: Number((-0.05 * imminence).toFixed(3)),
    };
    if (usesFlight) breakdown['flight'] = Number((weights.flight * flight).toFixed(3));

    return {
      start: candidate.start,
      end: candidate.dates[candidate.dates.length - 1] as string,
      nights: candidate.dates.length - 1,
      attendees: candidate.attendees,
      absentees: candidate.absentees,
      score: Number(score.toFixed(3)),
      breakdown,
    };
  });
}

/** 점수 내림차순, 동점이면 이른 날짜 우선 */
const byScore = (a: DateWindow, b: DateWindow): number =>
  b.score - a.score || a.start.localeCompare(b.start);

export function resolveDates(input: DateResolverInput): DateResolution {
  const participants = input.participants;
  const minAttendees = input.minAttendees ?? DEFAULT_MIN_ATTENDEES;
  const nights = resolveNights(participants, input.pack.recommendedNights);

  const empty = (reason: string): DateResolution => ({
    status: 'impossible',
    windows: [],
    chosen: null,
    relaxation: 'none',
    nights,
    reason,
  });

  if (participants.length < minAttendees) {
    return empty(`설문을 제출한 참여자가 ${minAttendees}명 미만입니다.`);
  }

  const finish = (
    candidates: readonly Candidate[],
    relaxation: Relaxation,
    reason: string,
  ): DateResolution => {
    const scored = scoreWindows(candidates, input, participants).sort(byScore).slice(0, TOP_N);
    const [first, second] = scored;
    if (first === undefined) return empty(reason);

    // 부분 참석 구간은 사람 결정이 필요하다. 자동 확정하지 않는다 (3.3).
    if (relaxation === 'partial_attendance') {
      return { status: 'needs_host_choice', windows: scored, chosen: null, relaxation, nights, reason };
    }

    const decisive = second === undefined || first.score - second.score >= AUTO_CONFIRM_MARGIN;
    return {
      status: decisive ? 'confirmed' : 'needs_discussion',
      windows: scored,
      chosen: decisive ? first : null,
      relaxation,
      nights,
      reason: decisive
        ? reason
        : `${reason} 후보 ${scored.length}개의 점수가 비슷해 R0에서 논의합니다.`,
    };
  };

  // [3] 전원 가능한 구간
  const all = findWindows(participants, nights, input);
  const full = all.filter((candidate) => candidate.attendees.length === participants.length);
  if (full.length > 0) {
    return finish(full, 'none', `${nights}박 기준 전원 가능한 구간을 찾았습니다.`);
  }

  // [4-a] 완화 1 — ±1박을 허용한 참여자 기준으로 하루 줄여 재탐색
  const flexible = participants.filter((participant) => participant.nightFlexible);
  if (nights > 1 && flexible.length >= minAttendees) {
    const shorter = findWindows(flexible, nights - 1, input).filter(
      (candidate) => candidate.attendees.length === flexible.length,
    );
    if (shorter.length > 0) {
      const rigid = participants
        .filter((participant) => !participant.nightFlexible)
        .map((participant) => participant.userId);
      // 박수 축소를 허용하지 않은 사람은 이 구간의 불참자다. 숨기지 않는다.
      const withRigid = shorter.map((candidate) => ({
        ...candidate,
        absentees: [...candidate.absentees, ...rigid],
      }));
      return finish(
        withRigid,
        'fewer_nights',
        `${nights}박으로는 전원 가능한 구간이 없어 ${nights - 1}박으로 줄였습니다.`,
      );
    }
  }

  // [4-b] 완화 2 — 부분 참석. 최대 참석 인원 기준 상위 구간
  const best = Math.max(0, ...all.map((candidate) => candidate.attendees.length));
  if (best >= minAttendees) {
    const partial = all.filter((candidate) => candidate.attendees.length === best);
    return finish(
      partial,
      'partial_attendance',
      `전원 가능한 날짜가 없습니다. 최대 ${best}명이 참석할 수 있는 구간입니다.`,
    );
  }

  return empty(
    `${minAttendees}명 이상 함께 갈 수 있는 ${nights}박 구간이 없습니다. 가능일을 더 입력해야 합니다.`,
  );
}
