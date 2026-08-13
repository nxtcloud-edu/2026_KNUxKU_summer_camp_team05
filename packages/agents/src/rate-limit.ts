/**
 * 레이트리밋 — 무료 티어의 진짜 상한.
 *
 * 종량제에서는 원가가 상한이었다. 무료 티어에서는 돈이 0이므로 `RUN_COST_CAP_USD`가
 * 아무것도 막지 못하고, run을 죽이는 것은 429다. 그래서 상한 집행이 여기로 옮겨온다.
 *
 * 코드가 집행한다는 원칙은 그대로다 (INV-1). 에이전트가 "한 번만 더"라고 해도
 * 분당 한도를 넘으면 여기서 기다리게 하고, 일일 한도를 넘으면 **던진다.**
 * 조용히 건너뛰면 후보 없는 라운드가 정상처럼 보인다.
 */

export interface RateLimitSnapshot {
  minuteUsed: number;
  minuteLimit: number;
  dayUsed: number;
  dayLimit: number;
  /** 일일 한도를 다 썼는가. 기다려서 해결되지 않는 상태다 */
  exhausted: boolean;
}

export interface RateLimiter {
  /** 호출 직전에 부른다. 분당 한도에 걸리면 창이 열릴 때까지 기다린다 */
  acquire(): Promise<{ waitedMs: number }>;
  /** 429를 맞았을 때. 서버가 알려준 대기 시간을 반영해 다음 호출을 늦춘다 */
  penalize(retryAfterMs: number): void;
  snapshot(): RateLimitSnapshot;
}

/** 일일 한도 소진. 기다려도 풀리지 않으므로 던진다 */
export class RateLimitExhaustedError extends Error {
  constructor(
    readonly dayUsed: number,
    readonly dayLimit: number,
  ) {
    super(`일일 요청 한도 소진: ${dayUsed}/${dayLimit}. 한도가 초기화될 때까지 실행할 수 없습니다.`);
    this.name = 'RateLimitExhaustedError';
  }
}

export interface RateLimiterOptions {
  requestsPerMinute: number;
  requestsPerDay: number;
  /** 테스트에서 시간을 고정하기 위한 주입점 */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * 슬라이딩 윈도우 한도.
 *
 * 고정 윈도우(매 분 0초에 초기화)를 쓰면 경계에서 순간적으로 2배가 나가 429를 맞는다.
 * 그래서 최근 60초 안의 호출 시각을 그대로 들고 있다가, 한도에 차면 가장 오래된
 * 호출이 창을 벗어나는 시각까지 기다린다.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;

  /** 최근 호출 시각. 분 단위 창 밖으로 나가면 버린다 */
  let recent: number[] = [];
  let dayUsed = 0;
  let dayWindowStart = now();
  /** 429를 맞았을 때 이 시각 전에는 호출하지 않는다 */
  let blockedUntil = 0;

  const prune = (at: number): void => {
    recent = recent.filter((stamp) => at - stamp < MINUTE_MS);
    if (at - dayWindowStart >= DAY_MS) {
      dayWindowStart = at;
      dayUsed = 0;
    }
  };

  const snapshot = (): RateLimitSnapshot => {
    prune(now());
    return {
      minuteUsed: recent.length,
      minuteLimit: options.requestsPerMinute,
      dayUsed,
      dayLimit: options.requestsPerDay,
      exhausted: dayUsed >= options.requestsPerDay,
    };
  };

  return {
    async acquire() {
      let waitedMs = 0;

      for (;;) {
        const at = now();
        prune(at);

        // 일일 한도는 기다려서 풀리지 않는다. 부분 결과 + 사유로 끝내야 한다.
        if (dayUsed >= options.requestsPerDay) {
          throw new RateLimitExhaustedError(dayUsed, options.requestsPerDay);
        }

        // 429 페널티가 남아 있으면 그것부터 소화한다.
        if (blockedUntil > at) {
          const wait = blockedUntil - at;
          waitedMs += wait;
          await sleep(wait);
          continue;
        }

        if (recent.length < options.requestsPerMinute) {
          recent.push(at);
          dayUsed += 1;
          return { waitedMs };
        }

        // 창이 가득 찼다. 가장 오래된 호출이 빠질 때까지 기다린다.
        const oldest = recent[0] ?? at;
        const wait = Math.max(1, MINUTE_MS - (at - oldest));
        waitedMs += wait;
        await sleep(wait);
      }
    },

    penalize(retryAfterMs) {
      blockedUntil = Math.max(blockedUntil, now() + Math.max(0, retryAfterMs));
    },

    snapshot,
  };
}
