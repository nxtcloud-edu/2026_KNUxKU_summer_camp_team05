import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NodeStatus, PlanningNodeId, RoundId } from '@tm/contracts';
import { buildGraph, emptyNode, type Graph, type GraphNode } from './graph.js';
import { computeLegalMoves } from './moves.js';

/**
 * LegalMove 산출. 근거: agent-architecture.md 4.1 · 5.1
 *
 * 확인하는 것은 두 가지다.
 *   1. 지금 실행 가능한 라운드를 **전부** 만드는가 (하나만 만들면 Supervisor에게 선택지가 없다)
 *   2. 서로 의존하지 않는 라운드를 같은 병렬 그룹으로 묶는가
 */

const allRounds: RoundId[] = ['r_0', 'r_1a', 'r_1b', 'r_2', 'r_3', 'r_4', 'r_5', 'r_6'];

const node = (
  nodeId: PlanningNodeId,
  status: NodeStatus,
  overrides: Partial<GraphNode> = {},
): GraphNode => ({ ...emptyNode(nodeId), version: 1, status, ...overrides });

const base = {
  allowedRounds: allRounds,
  completedRounds: [] as RoundId[],
  turnsRemaining: 32,
  usdRemaining: 0.6,
};

test('빈 그래프에서는 의존성이 없는 date(r_0)만 실행 가능하다', () => {
  const result = computeLegalMoves({ ...base, graph: buildGraph([]) });

  assert.deepEqual(
    result.moves.map((move) => move.target.round),
    ['r_0'],
  );
  assert.equal(result.moves[0]?.type, 'run_referee');
  assert.deepEqual(result.moves[0]?.dependencies.missing, []);
});

test('의존성이 풀리면 실행 가능한 라운드를 전부 만든다', () => {
  // 숙소·액티비티까지 확정되면 transit_pass(r_1b)와 dining(r_4)이 동시에 열린다
  const graph: Graph = buildGraph([
    node('date', 'VERIFIED'),
    node('flight', 'VERIFIED'),
    node('transport_policy', 'VERIFIED'),
    node('accommodation_area', 'VERIFIED'),
    node('accommodation', 'VERIFIED'),
    node('activity', 'VERIFIED'),
  ]);

  const result = computeLegalMoves({
    ...base,
    graph,
    completedRounds: ['r_0', 'r_1a', 'r_2', 'r_3'],
  });
  const rounds = result.moves.map((move) => move.target.round);

  assert.ok(rounds.includes('r_1b'), '교통패스 라운드가 열려야 한다');
  assert.ok(rounds.includes('r_4'), '식사 라운드가 열려야 한다');
  assert.ok(rounds.length >= 2, `수가 하나뿐이다: ${rounds.join(', ')}`);
});

test('서로 의존하지 않는 라운드는 같은 병렬 그룹이다', () => {
  const graph: Graph = buildGraph([
    node('date', 'VERIFIED'),
    node('flight', 'VERIFIED'),
    node('transport_policy', 'VERIFIED'),
    node('accommodation_area', 'VERIFIED'),
    node('accommodation', 'VERIFIED'),
    node('activity', 'VERIFIED'),
  ]);

  const result = computeLegalMoves({
    ...base,
    graph,
    completedRounds: ['r_0', 'r_1a', 'r_2', 'r_3'],
  });

  const passMove = result.moves.find((move) => move.target.round === 'r_1b');
  const diningMove = result.moves.find((move) => move.target.round === 'r_4');

  assert.notEqual(passMove?.parallelGroup, null);
  assert.equal(passMove?.parallelGroup, diningMove?.parallelGroup);
});

test('의존 관계가 있는 라운드는 다른 병렬 그룹으로 갈린다', () => {
  // schedule(r_5)은 dining(r_4)에 의존한다. 둘이 동시에 열릴 수 없으므로
  // 여기서는 dining만 ready이고 schedule은 나오지 않아야 한다.
  const graph: Graph = buildGraph([
    node('date', 'VERIFIED'),
    node('flight', 'VERIFIED'),
    node('transport_policy', 'VERIFIED'),
    node('accommodation_area', 'VERIFIED'),
    node('accommodation', 'VERIFIED'),
    node('activity', 'VERIFIED'),
    node('transit_pass', 'VERIFIED'),
  ]);

  const result = computeLegalMoves({
    ...base,
    graph,
    completedRounds: ['r_0', 'r_1a', 'r_1b', 'r_2', 'r_3'],
  });
  const rounds = result.moves.map((move) => move.target.round);

  assert.ok(rounds.includes('r_4'));
  assert.equal(rounds.includes('r_5'), false, '식사가 끝나기 전에 동선을 열 수 없다');
});

test('이의 재실행이면 대상 라운드 밖의 수는 만들지 않는다', () => {
  const graph: Graph = buildGraph([
    node('date', 'VERIFIED'),
    node('flight', 'VERIFIED'),
    node('transport_policy', 'VERIFIED'),
    node('accommodation_area', 'VERIFIED'),
    node('accommodation', 'STALE'),
  ]);

  const result = computeLegalMoves({ ...base, graph, allowedRounds: ['r_2'] });

  assert.deepEqual(
    result.moves.map((move) => move.target.round),
    ['r_2'],
  );
});

test('이전에 판결이 있던 라운드는 rerun_round로 나온다', () => {
  const graph: Graph = buildGraph([
    node('date', 'VERIFIED'),
    node('flight', 'VERIFIED'),
    node('transport_policy', 'VERIFIED'),
    node('accommodation_area', 'VERIFIED'),
    node('accommodation', 'STALE', { version: 3 }),
  ]);

  const result = computeLegalMoves({ ...base, graph, allowedRounds: ['r_2'] });

  assert.equal(result.moves[0]?.type, 'rerun_round');
  assert.equal(result.moves[0]?.guards.roundRerunCap, 2);
});

test('실행할 라운드가 없고 검증도 끝났으면 finalize_plan을 낸다', () => {
  const graph: Graph = buildGraph([
    node('date', 'VERIFIED'),
    node('flight', 'VERIFIED'),
    node('transport_policy', 'VERIFIED'),
    node('accommodation_area', 'VERIFIED'),
    node('accommodation', 'VERIFIED'),
    node('activity', 'VERIFIED'),
    node('transit_pass', 'VERIFIED'),
    node('dining', 'VERIFIED'),
    node('schedule', 'VERIFIED'),
    node('budget', 'VERIFIED'),
    node('validation', 'VERIFIED'),
    node('booking_readiness', 'VERIFIED'),
    node('document', 'VERIFIED'),
  ]);

  const result = computeLegalMoves({ ...base, graph, completedRounds: allRounds });

  assert.equal(result.moves.length, 1);
  assert.equal(result.moves[0]?.type, 'finalize_plan');
});

test('미검증 노드가 남아 있으면 finalize 대신 block_run이다', () => {
  const graph: Graph = buildGraph([
    node('date', 'VERIFIED'),
    node('flight', 'BLOCKED'),
  ]);

  const result = computeLegalMoves({ ...base, graph, completedRounds: allRounds });

  assert.equal(result.moves[0]?.type, 'block_run');
});

test('빈 수 집합은 절대 반환하지 않는다 — 조용히 멈추면 안 된다', () => {
  const result = computeLegalMoves({
    ...base,
    graph: buildGraph([]),
    allowedRounds: [],
    completedRounds: [],
  });

  assert.ok(result.moves.length > 0);
});

test('승인 대기 노드는 실행 대상에서 빠지고 raise_approval로 바뀐다', () => {
  const graph: Graph = buildGraph([
    node('date', 'VERIFIED'),
    node('flight', 'STALE'),
  ]);

  const result = computeLegalMoves({
    ...base,
    graph,
    allowedRounds: ['r_1a'],
    pendingApprovalNodes: ['flight'],
  });

  assert.equal(result.moves.every((move) => move.type !== 'run_referee'), true);
  assert.ok(result.moves.some((move) => move.type === 'raise_approval'));
});

test('남은 예산·턴이 수의 guards와 budget에 그대로 실린다', () => {
  const result = computeLegalMoves({
    ...base,
    graph: buildGraph([]),
    turnsRemaining: 5,
    usdRemaining: 0.12,
  });

  assert.equal(result.moves[0]?.guards.turnsRemaining, 5);
  assert.equal(result.moves[0]?.budget.usdRemaining, 0.12);
});

test('음수 잔량은 0으로 내린다 (스키마가 음수를 거부한다)', () => {
  const result = computeLegalMoves({
    ...base,
    graph: buildGraph([]),
    turnsRemaining: -3,
    usdRemaining: -0.5,
  });

  assert.equal(result.moves[0]?.guards.turnsRemaining, 0);
  assert.equal(result.moves[0]?.budget.usdRemaining, 0);
});
