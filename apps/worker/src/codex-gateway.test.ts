import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkerCodexGateway } from './codex-gateway.js';

test('Worker 기본 Gateway는 localhost 모델 카탈로그만 호출한다', async () => {
  let requestedUrl = '';
  const client = createWorkerCodexGateway(
    {},
    (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return new Response(
        JSON.stringify({
          fetchedAt: '2026-08-14T00:00:00Z',
          models: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch,
  );

  await client.listModels();

  assert.equal(requestedUrl, 'http://127.0.0.1:4600/internal/v1/models');
});
