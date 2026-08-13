import type { RoundId } from '@tm/contracts';

/**
 * 발화 단위 팩트체크 — 감시자가 문장 하나를 때리는 지점.
 *
 * `runValidationPass`는 문서 생성 직전에 계획서 전체를 검사한다. 그때 잡으면 늦다:
 * 환각이 섞인 발화가 이미 회의록에 남고, 다른 에이전트가 그 값을 인용해 논의가
 * 오염된 뒤다. 그래서 조달된 후보와 대조하는 검사를 발화 단위로 따로 둔다.
 *
 * 원칙은 하나다: **'주소'와 '비용'은 결정론적으로만 말한다.**
 * 에이전트는 조달된 후보 안의 값만 인용할 수 있고, 코드가 계산한 값(합계·1인당
 * 금액·만족도)은 호출자가 `allowedNumbers`로 명시해야 통과한다.
 *
 * 이 모듈은 LLM을 호출하지 않는다. 판정은 전부 대조와 산술이다.
 * 근거: agent-architecture.md 7장 · travel-mediation-plan.md 19.6
 */

export interface GroundedCandidate {
  /** 제공자 후보 식별자 (`candidates.external_id`) */
  externalId: string;
  /** 이 후보가 제시하는 모든 금액 (KRW) */
  amountsKrw?: readonly number[];
  /** 주소·지명. 대소문자·공백을 정규화해 비교한다 */
  addresses?: readonly string[];
  /** ISO 시각 또는 `HH:MM` */
  times?: readonly string[];
  /** 소요시간(분) */
  durationsMin?: readonly number[];
  /** 근거가 웹·RAG인가. advisory 값은 사실 확정에 쓸 수 없다 (6.9) */
  advisory?: boolean;
  /** 하드 제약 위반 등으로 실격된 후보인가 */
  disqualified?: boolean;
}

export interface GroundedIndex {
  byExternalId: Map<string, GroundedCandidate>;
  /** 인덱스 전체의 금액 집합. unsourced_number 판정의 기준이 된다 */
  allAmountsKrw: Set<number>;
  allDurationsMin: Set<number>;
  allTimes: Set<string>;
}

const normalizeAddress = (value: string): string => value.replace(/\s+/g, '').toLowerCase();

/** `HH:MM` 부분만 남긴다. `2026-10-16T08:30:00Z` → `08:30` */
const normalizeTime = (value: string): string => {
  const match = /([0-9]{1,2}):([0-9]{2})/.exec(value);
  if (match === null) return value.trim();
  return `${match[1]?.padStart(2, '0') ?? '00'}:${match[2] ?? '00'}`;
};

export function buildGroundedIndex(candidates: readonly GroundedCandidate[]): GroundedIndex {
  const byExternalId = new Map<string, GroundedCandidate>();
  const allAmountsKrw = new Set<number>();
  const allDurationsMin = new Set<number>();
  const allTimes = new Set<string>();

  for (const candidate of candidates) {
    byExternalId.set(candidate.externalId, candidate);
    for (const amount of candidate.amountsKrw ?? []) allAmountsKrw.add(amount);
    for (const duration of candidate.durationsMin ?? []) allDurationsMin.add(duration);
    for (const time of candidate.times ?? []) allTimes.add(normalizeTime(time));
  }

  return { byExternalId, allAmountsKrw, allDurationsMin, allTimes };
}

export type ClaimKind = 'price' | 'address' | 'time' | 'duration' | 'reference';

/**
 * 에이전트가 발화와 함께 제출하는 구조화된 주장.
 * 자연어에서 추출하는 것이 아니라 **에이전트가 명시**한다 — 파싱에 의존하면
 * 파서가 못 읽은 주장이 검사를 통과해버린다.
 */
export interface Claim {
  kind: ClaimKind;
  /** 이 주장의 근거가 되는 후보 */
  externalId: string;
  /** price = KRW 금액, duration = 분, time = 시각, address = 주소 문자열 */
  value?: number | string;
}

export type SpeakerRole = 'persona' | 'referee' | 'supervisor' | 'system';

export type FactcheckViolationKind =
  | 'unknown_candidate'
  | 'disqualified_candidate'
  | 'price_mismatch'
  | 'address_not_grounded'
  | 'time_mismatch'
  | 'duration_mismatch'
  | 'advisory_as_fact'
  | 'unsourced_number';

export type Severity = 'block' | 'warn';

export interface FactcheckViolation {
  kind: FactcheckViolationKind;
  severity: Severity;
  detail: string;
  externalId?: string;
  /** 텍스트에서 발견한 근거 없는 값 */
  observed?: number | string;
}

export interface UtteranceInput {
  speaker: SpeakerRole;
  /** 발화 원문. 숫자 스캔 대상이다 */
  text: string;
  claims?: readonly Claim[];
  index: GroundedIndex;
  roundId?: RoundId;
  /**
   * 코드가 계산해 발화에 넣도록 허용한 값 (합계·1인당 금액·만족도 등).
   * 이 목록에 없는 금액이 문장에 나오면 근거 없는 수치로 본다.
   */
  allowedNumbers?: readonly number[];
  /** 금액 허용 오차(원). 환율·반올림 차이를 흡수한다. 기본 1,000 */
  priceToleranceKrw?: number;
  /** 소요시간 허용 오차(분). 기본 5 */
  durationToleranceMin?: number;
}

export interface FactcheckResult {
  ok: boolean;
  violations: FactcheckViolation[];
  checked: {
    claims: number;
    numbersInText: number;
    referencedCandidates: number;
  };
}

const DEFAULT_PRICE_TOLERANCE_KRW = 1000;
const DEFAULT_DURATION_TOLERANCE_MIN = 5;

/**
 * 발화에서 금액을 뽑는다. `12,000원` · `3만원` · `1.5만원` · `8000엔`을 인식한다.
 * 엔화는 환산하지 않는다 — 환산은 코드가 하고, 발화에는 환산된 값이 오는 게 계약이다.
 */
function extractAmounts(text: string): number[] {
  const amounts: number[] = [];
  const pattern = /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(만원|만\s*원|원|엔|円)/g;

  for (const match of text.matchAll(pattern)) {
    const raw = Number((match[1] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(raw)) continue;
    const unit = (match[2] ?? '').replace(/\s+/g, '');
    amounts.push(unit === '만원' ? raw * 10_000 : raw);
  }
  return amounts;
}

/** `08:30` 형태의 시각 */
function extractTimes(text: string): string[] {
  return [...text.matchAll(/([0-9]{1,2}):([0-9]{2})/g)].map(
    (match) => `${(match[1] ?? '').padStart(2, '0')}:${match[2] ?? '00'}`,
  );
}

/** `45분` · `2시간` · `1.5시간` */
function extractDurations(text: string): number[] {
  const durations: number[] = [];
  for (const match of text.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*시간/g)) {
    durations.push(Number(match[1]) * 60);
  }
  for (const match of text.matchAll(/([0-9]+)\s*분/g)) {
    durations.push(Number(match[1]));
  }
  return durations.filter((value) => Number.isFinite(value));
}

const near = (value: number, pool: Iterable<number>, tolerance: number): boolean => {
  for (const candidate of pool) {
    if (Math.abs(candidate - value) <= tolerance) return true;
  }
  return false;
};

/**
 * 근거 없는 수치의 심각도.
 *
 * 심판·Supervisor는 **판정을 서술**하므로 근거 없는 수치가 곧 판결 오염이다 → 차단.
 * 페르소나는 선호를 말하는 자리라 모든 숫자를 차단하면 토론이 서지 않는다 → 경고로
 * 남기고 회의록에 표기한다. 대신 후보 참조·가격 불일치는 페르소나도 차단이다.
 */
function severityOf(kind: FactcheckViolationKind, speaker: SpeakerRole): Severity {
  if (kind === 'duration_mismatch') return 'warn';
  if (kind === 'unsourced_number' || kind === 'advisory_as_fact') {
    return speaker === 'persona' ? 'warn' : 'block';
  }
  return 'block';
}

export function checkUtterance(input: UtteranceInput): FactcheckResult {
  const violations: FactcheckViolation[] = [];
  const claims = input.claims ?? [];
  const priceTolerance = input.priceToleranceKrw ?? DEFAULT_PRICE_TOLERANCE_KRW;
  const durationTolerance = input.durationToleranceMin ?? DEFAULT_DURATION_TOLERANCE_MIN;

  const push = (kind: FactcheckViolationKind, detail: string, extra: Partial<FactcheckViolation> = {}): void => {
    violations.push({ kind, severity: severityOf(kind, input.speaker), detail, ...extra });
  };

  const referenced = new Set<string>();
  const allowedAmounts = new Set<number>(input.allowedNumbers ?? []);
  const allowedTimes = new Set<string>();
  const allowedDurations = new Set<number>();

  // 주장으로 제출된 값은 이미 위에서 대조된다. 본문 스캔에서 같은 값을 다시
  // 'unsourced'로 잡으면 한 실수가 두 번, 그것도 더 무거운 등급으로 계산된다.
  const claimedAmounts = new Set<number>();
  const claimedTimes = new Set<string>();
  const claimedDurations = new Set<number>();
  for (const claim of claims) {
    if (claim.kind === 'price' && Number.isFinite(Number(claim.value))) {
      claimedAmounts.add(Number(claim.value));
    }
    if (claim.kind === 'time') claimedTimes.add(normalizeTime(String(claim.value ?? '')));
    if (claim.kind === 'duration' && Number.isFinite(Number(claim.value))) {
      claimedDurations.add(Number(claim.value));
    }
  }

  // ── 1. 주장 대조 ─────────────────────────────────────────────────────────
  for (const claim of claims) {
    const candidate = input.index.byExternalId.get(claim.externalId);

    if (candidate === undefined) {
      // 조달되지 않은 후보를 근거로 든다 = 환각. 여기가 가장 중요한 차단이다.
      push('unknown_candidate', `조달된 후보에 없는 참조입니다: ${claim.externalId}`, {
        externalId: claim.externalId,
      });
      continue;
    }

    referenced.add(claim.externalId);

    if (candidate.disqualified === true) {
      push('disqualified_candidate', `실격된 후보를 근거로 삼았습니다: ${claim.externalId}`, {
        externalId: claim.externalId,
      });
    }

    if (candidate.advisory === true && claim.kind !== 'reference') {
      // 웹·RAG 결과는 정황이지 사실이 아니다. 판정 근거가 될 수 없다.
      push('advisory_as_fact', `advisory 근거로 사실을 단정했습니다: ${claim.externalId}`, {
        externalId: claim.externalId,
      });
    }

    switch (claim.kind) {
      case 'price': {
        const value = Number(claim.value);
        if (!Number.isFinite(value)) {
          push('price_mismatch', `금액이 수치가 아닙니다: ${String(claim.value)}`, {
            externalId: claim.externalId,
          });
          break;
        }
        if (!near(value, candidate.amountsKrw ?? [], priceTolerance)) {
          push(
            'price_mismatch',
            `후보 ${claim.externalId}에 없는 금액입니다: ${value.toLocaleString()}원`,
            { externalId: claim.externalId, observed: value },
          );
          break;
        }
        allowedAmounts.add(value);
        break;
      }

      case 'address': {
        const value = normalizeAddress(String(claim.value ?? ''));
        const known = (candidate.addresses ?? []).map(normalizeAddress);
        if (value.length === 0 || !known.includes(value)) {
          push('address_not_grounded', `후보 ${claim.externalId}의 주소와 다릅니다: ${String(claim.value)}`, {
            externalId: claim.externalId,
            observed: String(claim.value),
          });
        }
        break;
      }

      case 'time': {
        const value = normalizeTime(String(claim.value ?? ''));
        const known = (candidate.times ?? []).map(normalizeTime);
        if (!known.includes(value)) {
          push('time_mismatch', `후보 ${claim.externalId}에 없는 시각입니다: ${value}`, {
            externalId: claim.externalId,
            observed: value,
          });
          break;
        }
        allowedTimes.add(value);
        break;
      }

      case 'duration': {
        const value = Number(claim.value);
        if (!Number.isFinite(value) || !near(value, candidate.durationsMin ?? [], durationTolerance)) {
          push('duration_mismatch', `후보 ${claim.externalId}의 소요시간과 다릅니다: ${String(claim.value)}분`, {
            externalId: claim.externalId,
            observed: claim.value,
          });
          break;
        }
        allowedDurations.add(value);
        break;
      }

      case 'reference':
        break;
    }
  }

  // ── 2. 본문 수치 스캔 ────────────────────────────────────────────────────
  // 주장으로 제출하지 않은 숫자가 문장에 섞여 들어오는 것이 실제 환각 경로다.
  // 참조한 후보의 값 ∪ 코드가 계산해 허용한 값 밖이면 근거가 없다.
  const groundedAmounts = new Set<number>(allowedAmounts);
  const groundedTimes = new Set<string>(allowedTimes);
  const groundedDurations = new Set<number>(allowedDurations);

  for (const externalId of referenced) {
    const candidate = input.index.byExternalId.get(externalId);
    for (const amount of candidate?.amountsKrw ?? []) groundedAmounts.add(amount);
    for (const time of candidate?.times ?? []) groundedTimes.add(normalizeTime(time));
    for (const duration of candidate?.durationsMin ?? []) groundedDurations.add(duration);
  }

  const amounts = extractAmounts(input.text);
  const times = extractTimes(input.text);
  const durations = extractDurations(input.text);

  for (const amount of amounts) {
    if (near(amount, groundedAmounts, priceTolerance)) continue;
    if (near(amount, claimedAmounts, priceTolerance)) continue;
    push('unsourced_number', `근거 없는 금액입니다: ${amount.toLocaleString()}원`, { observed: amount });
  }

  for (const time of times) {
    if (groundedTimes.has(time) || claimedTimes.has(time)) continue;
    push('unsourced_number', `근거 없는 시각입니다: ${time}`, { observed: time });
  }

  for (const duration of durations) {
    if (near(duration, groundedDurations, durationTolerance)) continue;
    if (near(duration, claimedDurations, durationTolerance)) continue;
    push('unsourced_number', `근거 없는 소요시간입니다: ${duration}분`, { observed: duration });
  }

  return {
    ok: violations.every((violation) => violation.severity !== 'block'),
    violations,
    checked: {
      claims: claims.length,
      numbersInText: amounts.length + times.length + durations.length,
      referencedCandidates: referenced.size,
    },
  };
}

export type FactcheckDecision = 'accept' | 'annotate' | 'reject';

export interface FactcheckGate {
  decision: FactcheckDecision;
  blocking: FactcheckViolation[];
  warnings: FactcheckViolation[];
  /** 재발화를 요청할 때 그대로 전달할 사유 */
  retryHint: string | null;
}

/**
 * 감시자의 처리 결정.
 *
 * - `accept`   그대로 회의록에 남긴다
 * - `annotate` 남기되 "근거 미확인" 표기를 붙인다. 숨기지 않는 것이 계약이다
 * - `reject`   재발화를 요청한다. 재시도 횟수 관리는 호출자(오케스트레이터)의 몫이다
 */
export function factcheckGate(result: FactcheckResult): FactcheckGate {
  const blocking = result.violations.filter((violation) => violation.severity === 'block');
  const warnings = result.violations.filter((violation) => violation.severity === 'warn');

  if (blocking.length > 0) {
    return {
      decision: 'reject',
      blocking,
      warnings,
      retryHint: `조달된 후보 안의 값만 인용하세요. 문제 ${blocking.length}건: ${blocking
        .slice(0, 3)
        .map((violation) => violation.detail)
        .join(' / ')}`,
    };
  }

  return {
    decision: warnings.length > 0 ? 'annotate' : 'accept',
    blocking,
    warnings,
    retryHint: null,
  };
}
