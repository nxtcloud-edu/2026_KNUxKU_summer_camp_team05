import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import {
  createGeminiClient,
  LlmIncompleteError,
  LlmRequestError,
} from './client.js';
import { registerFreeTierPricing } from './models.js';
import { costOfUsage, knownModels } from '@tm/core';

/**
 * 키 없이 도는 계약 테스트. fetch를 주입해 응답 형태만 검증한다.
 * 실제 호출 검증은 키가 생긴 뒤 별도 스모크로 한다.
 */

const okBody = (text: string, finishReason = 'STOP'): unknown => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason }],
  usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 45, cachedContentTokenCount: 80 },
});

function stubFetch(
  responses: { status: number; body: unknown; headers?: Record<string, string> }[],
): { impl: typeof fetch; calls: { url: string; body: unknown }[] } {
  const calls: { url: string; body: unknown }[] = [];
  let index = 0;

  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')) as unknown,
    });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return new Response(JSON.stringify(next?.body ?? {}), {
      status: next?.status ?? 200,
      headers: { 'content-type': 'application/json', ...(next?.headers ?? {}) },
    });
  }) as unknown as typeof fetch;

  return { impl, calls };
}

const baseOptions = {
  apiKey: 'test-key',
  requestsPerMinute: 100,
  requestsPerDay: 100,
  sleep: async () => {},
};

const request = {
  purpose: 'referee.flight.verdict',
  model: 'gemini-2.5-flash',
  system: '너는 항공 심판이다',
  prompt: '후보를 판정하라',
};

test('정상 응답에서 본문과 토큰 사용량을 꺼낸다', async () => {
  const { impl } = stubFetch([{ status: 200, body: okBody('판결문') }]);
  const client = createGeminiClient({ ...baseOptions, fetchImpl: impl });

  const response = await client.generate(request);

  assert.equal(response.text, '판결문');
  assert.equal(response.usage.inputTokens, 120);
  assert.equal(response.usage.outputTokens, 45);
  assert.equal(response.usage.cacheTokens, 80, '캐시 토큰을 잃지 않는다 — 0이면 캐싱이 안 걸린 것이다');
  assert.equal(response.finishReason, 'STOP');
  assert.ok(response.requestId.length > 0, '미터 청구의 멱등 키가 있어야 한다');
});

test('시스템 지시와 프롬프트가 Gemini 형식으로 나간다', async () => {
  const { impl, calls } = stubFetch([{ status: 200, body: okBody('ok') }]);
  const client = createGeminiClient({ ...baseOptions, fetchImpl: impl });

  await client.generate(request);

  const sent = calls[0]?.body as Record<string, any>;
  assert.equal(sent['systemInstruction'].parts[0].text, '너는 항공 심판이다');
  assert.equal(sent['contents'][0].parts[0].text, '후보를 판정하라');
  assert.ok(calls[0]?.url.includes('gemini-2.5-flash:generateContent'));
});

test('안전 필터로 후보가 비면 빈 문자열로 위장하지 않고 던진다', async () => {
  const { impl } = stubFetch([
    { status: 200, body: { candidates: [], promptFeedback: { blockReason: 'SAFETY' } } },
  ]);
  const client = createGeminiClient({ ...baseOptions, fetchImpl: impl });

  await assert.rejects(() => client.generate(request), LlmIncompleteError);
});

test('본문 없이 잘린 응답은 정상 응답이 아니다', async () => {
  const { impl } = stubFetch([{ status: 200, body: okBody('', 'MAX_TOKENS') }]);
  const client = createGeminiClient({ ...baseOptions, fetchImpl: impl });

  await assert.rejects(() => client.generate(request), LlmIncompleteError);
});

test('429는 재시도하고, 서버가 알려준 대기 시간을 리미터에 반영한다', async () => {
  const { impl, calls } = stubFetch([
    {
      status: 429,
      body: {
        error: {
          code: 429,
          message: '한도 초과',
          details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7s' }],
        },
      },
    },
    { status: 200, body: okBody('두 번째에 성공') },
  ]);
  const client = createGeminiClient({ ...baseOptions, fetchImpl: impl });

  const response = await client.generate(request);

  assert.equal(response.text, '두 번째에 성공');
  assert.equal(calls.length, 2, '한 번 재시도한다');
});

test('400은 재시도하지 않는다 — 다시 보내도 같은 답이 온다', async () => {
  const { impl, calls } = stubFetch([
    { status: 400, body: { error: { code: 400, message: '잘못된 요청' } } },
  ]);
  const client = createGeminiClient({ ...baseOptions, fetchImpl: impl });

  await assert.rejects(() => client.generate(request), LlmRequestError);
  assert.equal(calls.length, 1);
});

test('재시도를 다 쓰면 상태코드와 사유를 담아 던진다', async () => {
  const { impl, calls } = stubFetch([{ status: 503, body: { error: { message: '일시 장애' } } }]);
  const client = createGeminiClient({ ...baseOptions, fetchImpl: impl, maxRetries: 2 });

  await assert.rejects(
    () => client.generate(request),
    (error: unknown) => {
      assert.ok(error instanceof LlmRequestError);
      assert.equal(error.status, 503);
      assert.ok(error.message.includes('일시 장애'));
      return true;
    },
  );
  assert.equal(calls.length, 3, '최초 1회 + 재시도 2회');
});

test('generateJson은 스키마로 검증한 값을 돌려준다', async () => {
  const schema = z.object({ winner: z.string(), reason: z.string() });
  const { impl } = stubFetch([
    { status: 200, body: okBody('{"winner":"c_1","reason":"최소 만족도가 가장 높다"}') },
  ]);
  const client = createGeminiClient({ ...baseOptions, fetchImpl: impl });

  const { value, usage } = await client.generateJson(schema, request);

  assert.equal(value.winner, 'c_1');
  assert.equal(usage.inputTokens, 120);
});

test('형식이 어긋나면 무엇이 틀렸는지 알려주고 한 번 다시 묻는다', async () => {
  const schema = z.object({ winner: z.string() });
  const { impl, calls } = stubFetch([
    { status: 200, body: okBody('그냥 문장입니다') },
    { status: 200, body: okBody('{"winner":"c_2"}') },
  ]);
  const client = createGeminiClient({ ...baseOptions, fetchImpl: impl });

  const { value } = await client.generateJson(schema, request);

  assert.equal(value.winner, 'c_2');
  assert.equal(calls.length, 2);
  const retryPrompt = String((calls[1]?.body as Record<string, any>)['contents'][0].parts[0].text);
  assert.ok(retryPrompt.includes('형식에 맞지 않았습니다'), '무엇이 틀렸는지 알려줘야 한다');
});

test('두 번째도 형식이 틀리면 깨진 값을 위로 넘기지 않고 던진다', async () => {
  const schema = z.object({ winner: z.string() });
  const { impl } = stubFetch([{ status: 200, body: okBody('{"nope":1}') }]);
  const client = createGeminiClient({ ...baseOptions, fetchImpl: impl });

  await assert.rejects(() => client.generateJson(schema, request), LlmRequestError);
});

test('일일 한도가 소진되면 호출 자체를 하지 않는다', async () => {
  const { impl, calls } = stubFetch([{ status: 200, body: okBody('ok') }]);
  const client = createGeminiClient({
    ...baseOptions,
    requestsPerDay: 1,
    fetchImpl: impl,
  });

  await client.generate(request);
  await assert.rejects(() => client.generate(request));
  assert.equal(calls.length, 1, '한도를 넘은 요청은 네트워크로 나가지 않는다');
});

test('무료 티어 모델은 단가 0으로 등록된다 — 모르는 모델 예외를 우회하지 않는다', () => {
  registerFreeTierPricing();

  assert.ok(knownModels().includes('gemini-2.5-flash'));
  assert.equal(
    costOfUsage({ model: 'gemini-2.5-flash', inputTokens: 100_000, outputTokens: 50_000 }),
    0,
  );
  assert.throws(
    () => costOfUsage({ model: 'gemini-9-imaginary', inputTokens: 1, outputTokens: 1 }),
    /단가를 모르는 모델/,
    '등록하지 않은 모델은 여전히 예외다',
  );
});
