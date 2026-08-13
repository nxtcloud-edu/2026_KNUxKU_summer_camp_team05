import {
  executionCaps,
  type DispatchProposal,
  type DispatchValidationResult,
  type LegalMove,
  type RoundId,
} from '@tm/contracts';
import type { JobPayload } from '../queue.js';

/**
 * Orchestrator 루프 — 결정론. LLM을 호출하지 않는다.
 *
 * computeLegalMoves(코드) → Supervisor 제안(LLM) → validate(코드) → execute(코드)
 * Supervisor가 실패하거나 제안이 2회 거부되면 기본 위상 순서로 진행한다.
 * 근거: docs/agent-architecture.md 3장 · 4장
 */

/** 기본 위상 순서. Supervisor 실패 시의 폴백이자 참조 순서다 (agent-architecture.md 4.5) */
export const defaultRoundOrder: RoundId[] = [
  'r_0',
  'r_1a',
  'r_1b',
  'r_2',
  'r_3',
  'r_4',
  'r_5',
  'r_6',
];

export interface RunState {
  runId: string;
  roomId: string;
  completedRounds: RoundId[];
  rerunCountByRound: Partial<Record<RoundId, number>>;
  globalRecalcUsed: number;
  turnsRemaining: number;
  usdRemaining: number;
  /** Supervisor 제안이 거부된 누적 횟수 */
  dispatchRejections: number;
  fallbackCount: number;
}

export interface SupervisorPort {
  /** 합법 수 집합 안에서 순서를 고른다. 실패하면 null을 반환해도 된다 */
  propose(moves: LegalMove[], state: RunState): Promise<DispatchProposal | null>;
}

export interface RefereePort {
  run(roundId: RoundId, instruction: string | null): Promise<void>;
}

/**
 * TODO(orchestrator): LegalMove 산출을 Planning Graph 상태와 연결한다.
 * 지금은 다음에 실행할 라운드 하나만 만들어 파이프라인 형태를 고정한다.
 */
export function computeLegalMoves(state: RunState, allowed: RoundId[]): LegalMove[] {
  const pending = allowed.filter((round) => !state.completedRounds.includes(round));
  const next = pending[0];
  if (next === undefined) return [];

  const rerunUsed = state.rerunCountByRound[next] ?? 0;
  return [
    {
      moveId: `mv_${next}`,
      type: 'run_referee',
      target: { round: next },
      dependencies: { satisfied: state.completedRounds, missing: [] },
      guards: {
        roundRerunUsed: rerunUsed,
        roundRerunCap: executionCaps.rerunsPerRound,
        globalRecalcUsed: state.globalRecalcUsed,
        globalRecalcCap: executionCaps.globalRecalcs,
        turnsRemaining: state.turnsRemaining,
      },
      budget: { tokensRemaining: 0, usdRemaining: state.usdRemaining, toolCallsRemaining: {} },
      parallelGroup: null,
      estimated: { latencySec: 150, usd: 0.05 },
    },
  ];
}

/** V1~V10 중 지금 구현된 것: V1(합법 수), V2(위상 순서), V5(상한), V7(라운드 스킵 금지) */
export function validateProposal(
  proposal: DispatchProposal,
  moves: LegalMove[],
): DispatchValidationResult {
  const violations: DispatchValidationResult['violations'] = [];
  const legalIds = new Set(moves.map((move) => move.moveId));

  for (const step of proposal.sequence) {
    if (!legalIds.has(step.moveId)) {
      violations.push({ rule: 'V1', moveId: step.moveId, detail: '합법 수 집합에 없습니다' });
    }
  }

  for (const move of moves) {
    if (move.guards.roundRerunUsed > move.guards.roundRerunCap) {
      violations.push({ rule: 'V5', moveId: move.moveId, detail: '재심 상한 초과' });
    }
    if (move.guards.globalRecalcUsed > move.guards.globalRecalcCap) {
      violations.push({ rule: 'V5', moveId: move.moveId, detail: '전역 재계산 상한 초과' });
    }
  }

  // TODO(orchestrator): V3·V4·V6·V8·V9·V10 구현. 특히 V9(fail-closed 미검증 노드 승격 금지)는
  // 안전과 직결되므로 Validation Pass 착수와 함께 반드시 추가한다.
  return { accepted: violations.length === 0, violations, serialized: [] };
}

/**
 * 한 run을 끝까지 진행한다. 이의 재실행이면 대상 라운드만 다시 돈다.
 */
export async function runPipeline(
  payload: JobPayload,
  ports: { supervisor: SupervisorPort; referee: RefereePort },
  state: RunState,
): Promise<RunState> {
  const allowed =
    payload.kind === 'full_run' ? defaultRoundOrder : orderRerunRounds(payload.rerunRounds);
  const instruction = payload.kind === 'rerun_from_objection' ? payload.instruction : null;

  let current = state;
  for (;;) {
    const moves = computeLegalMoves(current, allowed);
    if (moves.length === 0) break;

    const proposal = await ports.supervisor.propose(moves, current);
    let chosen = moves[0];

    if (proposal !== null) {
      const result = validateProposal(proposal, moves);
      if (result.accepted) {
        const target = moves.find((move) => move.moveId === proposal.sequence[0]?.moveId);
        if (target !== undefined) chosen = target;
      } else {
        current = { ...current, dispatchRejections: current.dispatchRejections + 1 };
        if (current.dispatchRejections >= 2) {
          current = { ...current, fallbackCount: current.fallbackCount + 1 };
        }
      }
    } else {
      current = { ...current, fallbackCount: current.fallbackCount + 1 };
    }

    const round = chosen?.target.round;
    if (round === undefined) break;

    await ports.referee.run(round, instruction);
    current = { ...current, completedRounds: [...current.completedRounds, round] };
  }

  return current;
}

/** 재실행 라운드를 의존성 순서대로 정렬한다. defaultRoundOrder가 이미 위상 순서다. */
function orderRerunRounds(rounds: RoundId[]): RoundId[] {
  return defaultRoundOrder.filter((round) => rounds.includes(round));
}
