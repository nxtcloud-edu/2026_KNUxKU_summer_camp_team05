import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ItineraryItem } from '@tm/core';
import { createMemoryRepositories, type Repositories } from '@tm/db';
import { finalizeRun, type PlanDraft } from './finalize.js';

/**
 * 계획서 발행. 근거: agent-architecture.md 9.1 · 테스트 A20
 *
 * 확인하는 것: 검증에 실패한 계획서는 저장은 되되 **발행되지 않는다.**
 * PARTIAL은 예약 행동을 유도하지 않는다.
 */

const item = (overrides: Partial<ItineraryItem> = {}): ItineraryItem => ({
  itemId: 'it_1',
  externalId: 'H1',
  nodeId: 'accommodation',
  startAt: '2026-10-16T15:00:00.000Z',
  endAt: '2026-10-16T16:00:00.000Z',
  travelMinutesFromPrev: null,
  openAtVisitTime: true,
  costPerPersonKrw: 82_000,
  ...overrides,
});

const draft = (overrides: Partial<PlanDraft> = {}): PlanDraft => ({
  items: [item()],
  budget: { declaredTotalPerPersonKrw: 82_000, groupCapPerPersonKrw: 900_000 },
  plan: { title: '오사카 2박 3일' },
  ...overrides,
});

/** 조달된 후보가 있는 run을 만든다 */
async function seed(repos: Repositories, externalIds: string[]): Promise<void> {
  const room = await repos.rooms.create('jp-osaka');
  await repos.runs.start({ runId: 'run_1', roomId: room.roomId, trigger: 'all_done' });
  await repos.runs.recordRound({
    runId: 'run_1',
    roundId: 'r_2',
    category: 'accommodation',
    seq: 1,
    phase: 'SETTLED',
  });
  await repos.candidates.saveMany(
    { runId: 'run_1', roundId: 'r_2' },
    externalIds.map((externalId) => ({ externalId, provider: 'fixture', payload: {} })),
  );
}

test('문서 에이전트가 없으면 계획서를 만들지 않고 사유를 남긴다', async () => {
  const repos = createMemoryRepositories();
  const result = await finalizeRun(repos, { runId: 'run_1', roomId: 'rm_1', draft: null });

  assert.equal(result.itineraryId, null);
  assert.equal(result.badge, 'NONE');
  assert.equal(result.published, false);
  assert.match(result.reason ?? '', /문서 생성 에이전트/);
  await repos.close();
});

test('검증을 통과하면 VERIFIED로 발행된다', async () => {
  const repos = createMemoryRepositories();
  await seed(repos, ['H1']);

  const result = await finalizeRun(repos, { runId: 'run_1', roomId: 'rm_1', draft: draft() });

  assert.equal(result.badge, 'VERIFIED');
  assert.equal(result.published, true);
  assert.equal(result.report?.passed, true);
  await repos.close();
});

test('조달되지 않은 항목이 있으면 발행하지 않는다', async () => {
  // 후보 밖 항목이 계획서에 들어오는 경로는 환각뿐이다.
  const repos = createMemoryRepositories();
  await seed(repos, ['H1']);

  const result = await finalizeRun(repos, {
    runId: 'run_1',
    roomId: 'rm_1',
    draft: draft({ items: [item({ externalId: 'GHOST' })] }),
  });

  assert.equal(result.badge, 'PARTIAL');
  assert.equal(result.published, false);
  assert.ok(result.report?.blockers.some((blocker) => blocker.kind === 'unknown_external_id'));
  await repos.close();
});

test('검증에 실패해도 저장은 한다 — 아무것도 못 받는 것보다 낫다', async () => {
  const repos = createMemoryRepositories();
  await seed(repos, ['H1']);

  const result = await finalizeRun(repos, {
    runId: 'run_1',
    roomId: 'rm_1',
    draft: draft({ items: [item({ externalId: null })] }),
  });

  assert.notEqual(result.itineraryId, null);
  const latest = await repos.itineraries.latest('rm_1');
  assert.equal(latest?.publishedAt, null, '저장은 됐지만 발행되지 않았다');
  assert.notEqual(latest?.validationReport, undefined, '검증 결과가 함께 남는다');
  await repos.close();
});

test('예산이 최저 예산자 상한을 넘으면 발행하지 않는다', async () => {
  const repos = createMemoryRepositories();
  await seed(repos, ['H1']);

  const result = await finalizeRun(repos, {
    runId: 'run_1',
    roomId: 'rm_1',
    draft: draft({
      items: [item({ costPerPersonKrw: 1_200_000 })],
      budget: { declaredTotalPerPersonKrw: 1_200_000, groupCapPerPersonKrw: 900_000 },
    }),
  });

  assert.equal(result.published, false);
  assert.ok(result.report?.blockers.some((blocker) => blocker.kind === 'budget_over_cap'));
  await repos.close();
});

test('조달 근거는 에이전트 주장이 아니라 candidates 테이블에서 읽는다', async () => {
  const repos = createMemoryRepositories();
  await seed(repos, ['H1', 'H2']);

  const result = await finalizeRun(repos, { runId: 'run_1', roomId: 'rm_1', draft: draft() });

  assert.equal(result.report?.checked.externalIds, 2, '실제 조달된 후보 수');
  await repos.close();
});

test('재발행하면 버전이 올라간다', async () => {
  const repos = createMemoryRepositories();
  await seed(repos, ['H1']);

  await finalizeRun(repos, { runId: 'run_1', roomId: 'rm_1', draft: draft() });
  await finalizeRun(repos, { runId: 'run_1', roomId: 'rm_1', draft: draft() });

  assert.equal((await repos.itineraries.latest('rm_1'))?.version, 2);
  await repos.close();
});
