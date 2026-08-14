import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkerAgentRuntime, createWorkerCodexGateway } from './codex-gateway.js';

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

test('Worker 공식 AgentRuntime은 5역할 요청을 localhost Codex Gateway로 보낸다', async () => {
  let requestedUrl = '';
  const runtime = createWorkerAgentRuntime(
    {},
    (async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return new Response(
        JSON.stringify({
          runId: 'run:1',
          status: 'SUCCEEDED',
          authContext: { loginMethod: 'CHATGPT', authFingerprint: 'fixture' },
          modelContext: {
            model: 'fixture-model',
            reasoningEffort: 'low',
            catalogFetchedAt: '2026-08-14T00:00:00.000Z',
          },
          threadId: 'thread:1',
          output: {
            schemaVersion: 1,
            role: 'USER_PROXY',
            task: 'CREATE_SEARCH_BRIEF',
            brief: {
              schemaVersion: 1,
              briefId: 'brief:u1:stay:1',
              participantId: 'u1',
              category: 'stay',
              profileVersion: 'profile:u1:1',
              mustKeepRefs: [],
              preferenceTargetRefs: ['fact:u1:1'],
              desiredTraits: ['난바 접근성'],
              avoidTraits: [],
              tradeoffs: [],
              searchTerms: ['난바 숙소'],
            },
          },
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
          repairUsed: false,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch,
  );
  const result = await runtime.run({
    schemaVersion: 1,
    role: 'USER_PROXY',
    task: 'CREATE_SEARCH_BRIEF',
    runId: 'run:1',
    tripId: 'trip:1',
    inputVersion: 1,
    category: 'stay',
    participant: {
      participantId: 'u1',
      profileVersion: 'profile:u1:1',
      facts: [
        {
          factId: 'fact:u1:1',
          statement: '난바 접근성',
          importance: 5,
          hard: false,
          polarity: 'PREFER',
        },
      ],
      budgetMaxKrw: 300_000,
    },
    charter: {
      schemaVersion: 1,
      charterVersion: 'charter:1',
      destination: '오사카',
      startDate: '2026-10-16',
      endDate: '2026-10-19',
      participantIds: ['u1'],
      partySize: 1,
      pace: 'balanced',
      budgetMaxByParticipantKrw: { u1: 300_000 },
    },
    priorContractRefs: [],
  });
  assert.equal(result.role, 'USER_PROXY');
  assert.equal(requestedUrl, 'http://127.0.0.1:4600/internal/v1/agent-runs');
});
