import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRateLimiter, RateLimitExhaustedError } from './rate-limit.js';

/**
 * 시간을 주입해 결정론적으로 검증한다. 실제로 기다리면 테스트가 분 단위로 늘어난다.
 */
function fakeClock(start = 1_000_000): { now: () => number; sleep: (ms: number) => Promise<void>; slept: number[] } {
  let current = start;
  const slept: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number) => {
      slept.push(ms);
      current += ms;
    },
    slept,
  };
}

test('분당 한도 안에서는 기다리지 않는다', async () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ requestsPerMinute: 3, requestsPerDay: 100, now: clock.now, sleep: clock.sleep });

  for (let i = 0; i < 3; i += 1) {
    const { waitedMs } = await limiter.acquire();
    assert.equal(waitedMs, 0);
  }
  assert.equal(clock.slept.length, 0);
  assert.equal(limiter.snapshot().minuteUsed, 3);
});

test('분당 한도를 넘으면 창이 열릴 때까지 기다린다', async () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ requestsPerMinute: 2, requestsPerDay: 100, now: clock.now, sleep: clock.sleep });

  await limiter.acquire();
  await limiter.acquire();
  const third = await limiter.acquire();

  assert.ok(third.waitedMs > 0, '세 번째 호출은 기다려야 한다');
  assert.equal(third.waitedMs, 60_000, '가장 오래된 호출이 창을 벗어나는 시각까지');
});

test('창이 지나면 다시 쓸 수 있다 — 슬라이딩이라 경계에서 2배가 나가지 않는다', async () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ requestsPerMinute: 2, requestsPerDay: 100, now: clock.now, sleep: clock.sleep });

  await limiter.acquire();
  await limiter.acquire();
  await limiter.acquire(); // 60초 대기 발생

  // 60초를 기다렸으므로 앞의 두 건은 창 밖으로 나갔다. 방금 것만 남는다.
  assert.equal(limiter.snapshot().minuteUsed, 1);

  // 그래서 곧바로 한 번 더 쓸 수 있다 — 대기가 창을 실제로 비운다.
  const next = await limiter.acquire();
  assert.equal(next.waitedMs, 0);
});

test('일일 한도는 기다려서 풀리지 않는다 — 던진다', async () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ requestsPerMinute: 100, requestsPerDay: 2, now: clock.now, sleep: clock.sleep });

  await limiter.acquire();
  await limiter.acquire();

  await assert.rejects(() => limiter.acquire(), RateLimitExhaustedError);
});

test('일일 한도 소진은 snapshot에 드러난다', async () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ requestsPerMinute: 100, requestsPerDay: 1, now: clock.now, sleep: clock.sleep });

  assert.equal(limiter.snapshot().exhausted, false);
  await limiter.acquire();
  assert.equal(limiter.snapshot().exhausted, true);
});

test('429 페널티는 다음 호출을 늦춘다', async () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ requestsPerMinute: 100, requestsPerDay: 100, now: clock.now, sleep: clock.sleep });

  limiter.penalize(5_000);
  const { waitedMs } = await limiter.acquire();

  assert.equal(waitedMs, 5_000, '서버가 알려준 시간만큼 기다린다');
});

test('하루가 지나면 일일 카운터가 초기화된다', async () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ requestsPerMinute: 100, requestsPerDay: 1, now: clock.now, sleep: clock.sleep });

  await limiter.acquire();
  assert.equal(limiter.snapshot().exhausted, true);

  await clock.sleep(24 * 60 * 60 * 1000 + 1);
  assert.equal(limiter.snapshot().exhausted, false);
});
