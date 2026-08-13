import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nodeDependencies, roundIds, type NodeStatus, type PlanningNodeId } from '@tm/contracts';
import {
  applyNodeUpdate,
  buildGraph,
  canFinalize,
  emptyNode,
  lockedNodesOf,
  nodeOf,
  pendingRoundsOf,
  readyNodes,
  staleNodes,
  unverifiedNodesOf,
  withChange,
  type Graph,
  type GraphNode,
} from './graph.js';

/**
 * Planning Graph 상태 연산. 근거: agent-architecture.md 5.1 / 5.2 · 테스트 A8
 */

const node = (
  nodeId: PlanningNodeId,
  status: NodeStatus,
  overrides: Partial<GraphNode> = {},
): GraphNode => ({ ...emptyNode(nodeId), version: 1, status, ...overrides });

/** date → flight → transport_policy → accommodation_area → accommodation 까지 확정된 그래프 */
const settledChain = (): Graph =>
  buildGraph([
    node('date', 'VERIFIED'),
    node('flight', 'VERIFIED'),
    node('transport_policy', 'VERIFIED'),
    node('accommodation_area', 'VERIFIED'),
    node('accommodation', 'VERIFIED'),
    node('activity', 'VERIFIED'),
    node('dining', 'VERIFIED'),
  ]);

test('노드를 갱신하면 버전이 오른다', () => {
  const graph = settledChain();
  const change = applyNodeUpdate(graph, { nodeId: 'accommodation', status: 'VERIFIED' });
  const updated = change.updated.find((n) => n.nodeId === 'accommodation');
  assert.equal(updated?.version, 2);
});

test('A8: 숙소가 바뀌면 하위 노드가 STALE로 내려간다', () => {
  const graph = settledChain();
  const change = applyNodeUpdate(graph, { nodeId: 'accommodation', status: 'VERIFIED' });

  // 숙소 → 액티비티 → 식사·교통패스 → 동선 → 예산 …
  assert.ok(change.staled.includes('activity'));
  assert.ok(change.staled.includes('dining'));
  assert.equal(change.staled.includes('accommodation'), false, '자기 자신은 STALE이 아니다');
});

test('아직 계산된 적 없는 하위 노드는 STALE 대상이 아니다', () => {
  const graph = settledChain();
  const change = applyNodeUpdate(graph, { nodeId: 'accommodation', status: 'VERIFIED' });
  // schedule은 version 0 (미계산) → 낡을 것이 없다
  assert.equal(change.staled.includes('schedule'), false);
});

test('INV-5: 예약 완료 노드는 STALE로 내리지 않고 승인 대상으로 올린다', () => {
  const graph = buildGraph([
    node('date', 'VERIFIED'),
    node('flight', 'VERIFIED'),
    node('transport_policy', 'VERIFIED'),
    node('accommodation_area', 'VERIFIED'),
    node('accommodation', 'BOOKED', { locked: true }),
    node('activity', 'VERIFIED'),
  ]);
  const change = applyNodeUpdate(graph, { nodeId: 'transport_policy', status: 'VERIFIED' });

  assert.equal(change.staled.includes('accommodation'), false, '예약한 것을 조용히 무효화하면 안 된다');
  assert.ok(change.lockedDescendants.includes('accommodation'));
});

test('이미 STALE인 노드를 다시 STALE로 만들지 않는다', () => {
  const graph = buildGraph([
    node('date', 'VERIFIED'),
    node('flight', 'VERIFIED'),
    node('transport_policy', 'STALE'),
  ]);
  const change = applyNodeUpdate(graph, { nodeId: 'flight', status: 'VERIFIED' });
  assert.equal(change.staled.includes('transport_policy'), false);
});

test('dependencyVersions에 상위 노드의 현재 버전이 기록된다', () => {
  const graph = buildGraph([node('date', 'VERIFIED', { version: 3 })]);
  const change = applyNodeUpdate(graph, { nodeId: 'flight', status: 'VERIFIED' });
  const flight = change.updated.find((n) => n.nodeId === 'flight');
  assert.equal(flight?.dependencyVersions['date'], 3);
});

test('의존성이 확정된 노드만 실행 가능하다', () => {
  const graph = buildGraph([node('date', 'VERIFIED')]);
  const ready = readyNodes(graph);
  assert.ok(ready.includes('flight'), 'date가 확정됐으니 flight는 실행 가능하다');
  assert.equal(ready.includes('accommodation'), false, '상위가 아직 미확정이다');
});

test('동시에 실행 가능한 노드끼리는 의존 관계가 없다', () => {
  // 실행 가능 = 의존성이 전부 확정됨. 확정된 노드는 실행 대상이 아니므로
  // ready 집합 안에 의존 간선이 존재할 수 없다. 이게 병렬 실행의 근거다.
  const graph = buildGraph([node('date', 'VERIFIED'), node('flight', 'VERIFIED')]);
  const ready = new Set(readyNodes(graph));

  for (const nodeId of ready) {
    for (const dep of nodeDependencies[nodeId]) {
      assert.equal(ready.has(dep), false, `${nodeId}가 같은 배치의 ${dep}에 의존한다`);
    }
  }
  assert.ok(ready.has('transport_policy'));
});

test('빈 그래프에서는 뿌리 노드만 실행 가능하다', () => {
  assert.deepEqual(readyNodes(buildGraph([])), ['date']);
});

test('잠긴 노드는 실행 대상에서 빠진다', () => {
  const graph = buildGraph([
    node('date', 'VERIFIED'),
    node('flight', 'PROVISIONAL', { locked: true }),
  ]);
  assert.equal(readyNodes(graph).includes('flight'), false);
  assert.deepEqual(lockedNodesOf(graph), ['flight']);
});

test('BLOCKED·FAILED 노드가 V9 입력이 된다', () => {
  const graph = buildGraph([
    node('dining', 'BLOCKED'),
    node('activity', 'FAILED'),
    node('flight', 'VERIFIED'),
  ]);
  assert.deepEqual(unverifiedNodesOf(graph).sort(), ['activity', 'dining']);
});

test('미검증 노드가 있으면 finalize할 수 없다', () => {
  const graph = buildGraph([node('dining', 'BLOCKED')]);
  const result = canFinalize(graph);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /미검증 노드/);
});

test('재계산이 남았으면 finalize할 수 없다', () => {
  const graph = buildGraph([node('dining', 'STALE')]);
  const result = canFinalize(graph);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /재계산이 필요한 노드/);
});

test('확정된 라운드는 pending에서 빠진다', () => {
  const graph = buildGraph([node('flight', 'VERIFIED'), node('accommodation', 'VERIFIED')]);
  const pending = pendingRoundsOf(graph, roundIds);
  assert.equal(pending.includes('r_1a'), false, 'flight는 r_1a를 확정한다');
  assert.equal(pending.includes('r_2'), false, 'accommodation은 r_2를 확정한다');
  assert.ok(pending.includes('r_5'));
});

test('withChange는 원본 그래프를 건드리지 않는다', () => {
  const graph = settledChain();
  const change = applyNodeUpdate(graph, { nodeId: 'accommodation', status: 'BLOCKED' });
  const next = withChange(graph, change);

  assert.equal(nodeOf(graph, 'accommodation').status, 'VERIFIED', '원본은 그대로');
  assert.equal(nodeOf(next, 'accommodation').status, 'BLOCKED');
  assert.ok(staleNodes(next).includes('activity'));
});

test('그래프에 없는 노드는 미계산(version 0)으로 취급한다', () => {
  const graph = buildGraph([]);
  assert.equal(nodeOf(graph, 'budget').version, 0);
  assert.equal(nodeOf(graph, 'budget').status, 'PROVISIONAL');
});
