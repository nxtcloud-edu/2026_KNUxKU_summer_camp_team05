import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BATCH_MULTIPLIER,
  BudgetExceededError,
  CACHE_READ_MULTIPLIER,
  cacheWillEngage,
  costOfUsage,
  createRunMeter,
} from './budget.js';

/**
 * 토큰·비용 미터. 근거: llm-runtime-config.md 2장·3장
 *
 * 상한 집행은 코드가 한다. 이 테스트가 깨지면 `RUN_COST_CAP_USD`가 상한이 아니게 된다.
 */

test('입력·출력 토큰 단가로 원가를 계산한다', () => {
  // opus-5: 입력 $5 / 출력 $25 (100만 토큰)
  const cost = costOfUsage({ model: 'claude-opus-5', inputTokens: 1_000_000, outputTokens: 0 });
  assert.equal(cost, 5);

  const output = costOfUsage({ model: 'claude-opus-5', inputTokens: 0, outputTokens: 1_000_000 });
  assert.equal(output, 25);
});

test('캐시 읽기는 입력 단가의 0.1배다', () => {
  const cost = costOfUsage({
    model: 'claude-sonnet-5',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 1_000_000,
  });
  // 부동소수 오차는 무시한다. 확인하려는 것은 배율이다.
  assert.ok(Math.abs(cost - 3 * CACHE_READ_MULTIPLIER) < 1e-9, `${cost}`);
});

test('캐시 쓰기는 입력 단가의 1.25배다', () => {
  const cost = costOfUsage({
    model: 'claude-sonnet-5',
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 1_000_000,
  });
  assert.equal(cost, 3 * 1.25);
});

test('배치는 모든 토큰이 절반 단가다', () => {
  const sync = costOfUsage({ model: 'claude-haiku-4-5', inputTokens: 100_000, outputTokens: 20_000 });
  const batch = costOfUsage({
    model: 'claude-haiku-4-5',
    inputTokens: 100_000,
    outputTokens: 20_000,
    batch: true,
  });
  assert.equal(batch, sync * BATCH_MULTIPLIER);
});

test('단가를 모르는 모델은 0원이 아니라 예외다', () => {
  // 조용히 0으로 세면 상한이 무력화된다.
  assert.throws(
    () => costOfUsage({ model: 'gpt-invented', inputTokens: 1000, outputTokens: 100 }),
    /단가를 모르는 모델/,
  );
});

test('페르소나 모델(haiku)은 프리픽스 4,096토큰을 넘어야 캐시가 걸린다', () => {
  assert.equal(cacheWillEngage('claude-haiku-4-5', 4000), false);
  assert.equal(cacheWillEngage('claude-haiku-4-5', 4096), true);
  // 같은 프리픽스라도 opus는 걸린다 — 티어 배분과 캐싱이 충돌하는 지점이다
  assert.equal(cacheWillEngage('claude-opus-5', 1000), true);
});

const sample = (requestId: string, outputTokens = 1000) => ({
  requestId,
  purpose: 'persona.statement',
  model: 'claude-haiku-4-5',
  inputTokens: 10_000,
  outputTokens,
});

test('지출이 누적되고 잔액이 줄어든다', () => {
  const meter = createRunMeter({ usdCap: 0.6, turnsCap: 32 });
  const before = meter.snapshot().usdRemaining;

  meter.charge(sample('req_1'));
  const after = meter.snapshot();

  assert.ok(after.usdSpent > 0);
  assert.ok(after.usdRemaining < before);
  assert.equal(after.calls, 1);
});

test('같은 requestId는 두 번 청구되지 않는다 (잡 재시도 멱등)', () => {
  const meter = createRunMeter({ usdCap: 0.6, turnsCap: 32 });
  meter.charge(sample('req_1'));
  const spent = meter.snapshot().usdSpent;

  const second = meter.charge(sample('req_1'));

  assert.equal(second.duplicate, true);
  assert.equal(meter.snapshot().usdSpent, spent);
  assert.equal(meter.snapshot().calls, 1);
});

test('상한의 80%를 넘으면 축약 모드로 강등한다 (V6)', () => {
  const meter = createRunMeter({ usdCap: 0.01, turnsCap: 32 });
  assert.equal(meter.snapshot().mode, 'normal');

  // 입력 10만 + 출력 1만 (haiku) = $0.15 → 상한 $0.01을 넘긴다
  meter.charge({ ...sample('req_1'), inputTokens: 100_000, outputTokens: 10_000 });

  assert.equal(meter.snapshot().mode, 'exhausted');
});

test('턴을 다 쓰면 예산이 남아도 exhausted다', () => {
  const meter = createRunMeter({ usdCap: 100, turnsCap: 2 });
  meter.charge(sample('req_1'));
  meter.charge(sample('req_2'));

  assert.equal(meter.snapshot().turnsRemaining, 0);
  assert.equal(meter.snapshot().mode, 'exhausted');
});

test('wouldExceed는 호출 전에 초과 여부를 알려준다', () => {
  const meter = createRunMeter({ usdCap: 0.02, turnsCap: 32 });
  const big = { model: 'claude-opus-5', inputTokens: 1_000_000, outputTokens: 0 };

  assert.equal(meter.wouldExceed(big), true);
  assert.equal(meter.wouldExceed({ model: 'claude-haiku-4-5', inputTokens: 100, outputTokens: 10 }), false);
});

test('guard는 상한을 넘길 호출 앞에서 던진다', () => {
  const meter = createRunMeter({ usdCap: 0.001, turnsCap: 32 });
  assert.throws(
    () => meter.guard({ model: 'claude-opus-5', inputTokens: 1_000_000, outputTokens: 0 }),
    BudgetExceededError,
  );
});

test('원장에 넣을 형태를 그대로 돌려준다', () => {
  const meter = createRunMeter({ usdCap: 0.6, turnsCap: 32 });
  const { charge } = meter.charge({
    ...sample('req_1'),
    cacheReadTokens: 2000,
    cacheWriteTokens: 500,
    promptVersion: 'persona.v1',
  });

  assert.equal(charge.requestId, 'req_1');
  assert.equal(charge.cacheTokens, 2500);
  assert.equal(charge.promptVersion, 'persona.v1');
  assert.ok(charge.costUsd > 0);
});
