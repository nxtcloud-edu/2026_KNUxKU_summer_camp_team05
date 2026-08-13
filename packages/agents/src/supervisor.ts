import {
  dispatchProposalSchema,
  type DispatchProposal,
  type LegalMove,
} from '@tm/contracts';
import { z } from 'zod';
import type { LlmClient } from './client.js';

/**
 * Supervisor — 합법 수 **집합 안에서** 순서를 고른다.
 *
 * 고를 수 있는 것이 이미 코드로 좁혀져 있다는 점이 이 설계의 전부다
 * (constrained dispatch, agent-architecture.md 4장). Supervisor는 실행하지 않고,
 * 수치를 계산하지 않고, 상한을 집행하지 않는다. 제안만 한다.
 *
 * 제안은 반드시 V1~V10 검증을 통과해야 채택된다. 거부되면 오케스트레이터가 기본
 * 위상 순서로 폴백하고 그 사실이 `dispatch_decisions`에 남는다 — 폴백률이 곧
 * 프롬프트 회귀 지표다 (12.2).
 *
 * 실패는 던지지 않고 null이다. Supervisor가 죽었다고 회의가 멈추면 안 된다.
 */

const SYSTEM = `너는 여행 계획 회의의 진행 순서를 정하는 감독자다.

**주어진 합법 수 목록 안에서만 고른다.** 목록에 없는 moveId를 만들면 제안 전체가 거부된다.

판단 기준:
- 의존성이 충족된 수를 먼저 고른다 (dependencies.missing이 비어 있는 것)
- 남은 예산·턴이 적으면 꼭 필요한 수를 먼저 고른다
- 같은 parallelGroup에 속한 수는 함께 제안할 수 있다
- 확신이 없으면 목록의 첫 번째 수 하나만 고른다. 억지로 여러 개를 묶지 않는다

너는 실행하지 않는다. 순서만 제안한다.`;

const proposalResponseSchema = {
  type: 'object',
  properties: {
    sequence: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          moveId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['moveId', 'reason'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['sequence'],
} as const;

/** LLM에서 받는 부분. runId 같은 코드 소유 필드는 받지 않는다 */
const rawProposalSchema = z.object({
  sequence: z
    .array(z.object({ moveId: z.string(), reason: z.string() }))
    .min(1),
  notes: z.string().default(''),
});

const movesBrief = (moves: readonly LegalMove[]): string =>
  moves
    .map((move) => {
      const target = [move.target.round, move.target.category, move.target.nodeId]
        .filter((value) => value !== undefined)
        .join('/');
      const missing =
        move.dependencies.missing.length === 0
          ? '의존성 충족'
          : `대기: ${move.dependencies.missing.join(', ')}`;
      return `- ${move.moveId} | ${move.type}${target === '' ? '' : ` → ${target}`} | ${missing} | 예상 ${move.estimated.latencySec}초 | 병렬군 ${move.parallelGroup ?? '없음'}`;
    })
    .join('\n');

export interface SupervisorState {
  runId: string;
  completedRounds: readonly string[];
  turnsRemaining: number;
  usdRemaining: number;
  /** 축약 모드인가. 켜져 있으면 최소한의 수만 제안해야 한다 */
  reducedMode: boolean;
}

export interface SupervisorDeps {
  client: LlmClient;
  model: string;
  onUsage?: (usage: {
    requestId: string;
    purpose: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
  }) => Promise<void>;
}

/**
 * 순서를 제안한다.
 *
 * 목록에 없는 moveId가 하나라도 섞이면 **제안 전체를 버린다.** 부분적으로 살리면
 * Supervisor가 만들어낸 수가 실행 경로에 들어올 수 있다.
 */
export async function proposeDispatch(
  deps: SupervisorDeps,
  moves: readonly LegalMove[],
  state: SupervisorState,
): Promise<DispatchProposal | null> {
  if (moves.length === 0) return null;

  try {
    const call = await deps.client.generateJson(rawProposalSchema, {
      purpose: 'supervisor.dispatch',
      model: deps.model,
      system: SYSTEM,
      prompt: [
        `[합법 수 목록]\n${movesBrief(moves)}`,
        `[현재 상태]\n완료 라운드: ${state.completedRounds.length === 0 ? '없음' : state.completedRounds.join(', ')}\n남은 턴: ${state.turnsRemaining}\n축약 모드: ${state.reducedMode ? '예 — 꼭 필요한 수만 고른다' : '아니오'}`,
        '다음에 실행할 수를 JSON으로 제안하라. moveId는 위 목록에 있는 것만 쓴다.',
      ].join('\n\n'),
      responseSchema: proposalResponseSchema,
      maxOutputTokens: 500,
    });

    await deps.onUsage?.({
      requestId: call.requestId,
      purpose: 'supervisor.dispatch',
      model: call.model,
      inputTokens: call.usage.inputTokens,
      outputTokens: call.usage.outputTokens,
      cacheTokens: call.usage.cacheTokens,
    });

    // 존재하지 않는 moveId는 V1이 어차피 잡지만, 여기서 먼저 버려야 폴백 사유가
    // "환각된 수"로 정확히 남는다.
    const known = new Set(moves.map((move) => move.moveId));
    const invalid = call.value.sequence.filter((entry) => !known.has(entry.moveId));
    if (invalid.length > 0) {
      console.warn(
        `[supervisor] 합법 수에 없는 제안을 버립니다: ${invalid.map((entry) => entry.moveId).join(', ')}`,
      );
      return null;
    }

    const proposal: DispatchProposal = {
      runId: state.runId,
      sequence: call.value.sequence,
      reviewDecisions: [],
      budgetTransferRequest: null,
      notes: call.value.notes ?? '',
    };
    // 계약 자체로 한 번 더 검증한다. 여기서 깨지면 실행 경로에 들이지 않는다.
    const parsed = dispatchProposalSchema.safeParse(proposal);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    // 침묵 금지. 폴백은 정상 경로지만 왜 폴백했는지는 남아야 한다.
    console.warn(
      `[supervisor] 제안 실패 — 기본 위상 순서로 진행합니다: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}
