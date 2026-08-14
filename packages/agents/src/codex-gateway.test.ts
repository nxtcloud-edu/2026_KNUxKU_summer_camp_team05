import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { codexGatewayAgentRunRequestSchema } from '@tm/contracts';
import {
  CodexGatewayHttpError,
  CodexGatewayResponseError,
  createCodexGatewayClient,
} from './codex-gateway.js';

const runRequest = codexGatewayAgentRunRequestSchema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../contracts/fixtures/codex-gateway/user-proxy-run.v1.json', import.meta.url),
      'utf8',
    ),
  ) as unknown,
);

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('localhost 모델 카탈로그를 strict 계약으로 읽는다', async () => {
  const calls: string[] = [];
  const client = createCodexGatewayClient({
    baseUrl: 'http://127.0.0.1:4600',
    fetchImpl: (async (url: string | URL | Request) => {
      calls.push(String(url));
      return response({
        fetchedAt: '2026-08-14T00:00:00Z',
        models: [
          {
            model: 'fake-balanced',
            isDefault: true,
            supportedEfforts: ['medium'],
            allowedProfiles: ['BALANCED'],
          },
        ],
      });
    }) as typeof fetch,
  });

  const result = await client.listModels();

  assert.equal(result.models[0]?.model, 'fake-balanced');
  assert.equal(calls[0], 'http://127.0.0.1:4600/internal/v1/models');
});

test('Worker 요청을 검증한 뒤 Gateway에 그대로 전송한다', async () => {
  let sent: unknown;
  const client = createCodexGatewayClient({
    baseUrl: 'http://localhost:4600/',
    fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return response({
        runId: 'run-1',
        status: 'SUCCEEDED',
        authContext: { loginMethod: 'CHATGPT', authFingerprint: 'fingerprint' },
        modelContext: {
          model: 'fake-balanced',
          reasoningEffort: 'medium',
          catalogFetchedAt: '2026-08-14T00:00:00Z',
        },
        threadId: 'thread-1',
        output: { role: 'USER_PROXY' },
        usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 },
        repairUsed: false,
      });
    }) as typeof fetch,
  });

  const result = await client.run(runRequest);

  assert.deepEqual(sent, runRequest);
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.modelContext?.model, 'fake-balanced');
});

test('외부 호스트 Gateway는 생성 단계에서 거부한다', () => {
  assert.throws(
    () => createCodexGatewayClient({ baseUrl: 'https://gateway.example.com' }),
    /loopback/,
  );
});

test('HTTP 오류 본문은 상위 계층에 노출하지 않는다', async () => {
  const client = createCodexGatewayClient({
    baseUrl: 'http://127.0.0.1:4600',
    fetchImpl: (async () => response({ detail: 'token=secret' }, 500)) as typeof fetch,
  });

  await assert.rejects(
    () => client.listModels(),
    (error: unknown) => {
      assert.ok(error instanceof CodexGatewayHttpError);
      assert.equal(error.status, 500);
      assert.ok(!error.message.includes('secret'));
      return true;
    },
  );
});

test('계약 밖 응답은 정상 결과로 전달하지 않는다', async () => {
  const client = createCodexGatewayClient({
    baseUrl: 'http://127.0.0.1:4600',
    fetchImpl: (async () => response({ models: [] })) as typeof fetch,
  });

  await assert.rejects(() => client.listModels(), CodexGatewayResponseError);
});
