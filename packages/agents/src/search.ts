import { queryClasses, type QueryClass, type RoundId } from '@tm/contracts';
import { z } from 'zod';
import type { LlmClient } from './client.js';

/**
 * 후보탐색 에이전트 — **무엇을 찾을지**만 정한다.
 *
 * 어떻게 가져올지는 코드가 정한다. 캐시·쿼터·정규화·적재·정책(fail-closed·
 * advisory·호출자 화이트리스트)은 전부 Data Agent 게이트웨이가 강제하고,
 * 에이전트는 `{queryClass, params}` 목록만 돌려준다.
 *
 * 정책이 막은 클래스는 `plan.skipped`에 사유가 남는다 — 조용히 빠지지 않는다.
 * 제안이 없으면 조달을 건너뛴다. 코드가 대신 추측하지 않는다.
 *
 * 근거: team-assignments.md 4.2 · packages/data-agents/README.md
 */

const SYSTEM = `너는 여행 계획 회의에서 후보를 조달할 조건을 정한다.

**허용된 queryClass 목록 안에서만 고른다.** 목록에 없는 값을 쓰면 그 요청은 버려진다.

지켜야 할 것:
- 이번 라운드에 필요한 것만 요청한다. 나중 라운드 몫을 미리 당기지 않는다.
- params에는 확실히 아는 값만 넣는다. 모르는 값을 지어내면 조달이 실패한다.
- 날짜·인원·출발지는 주어진 방 정보에서 그대로 가져온다.
- 같은 클래스를 조건만 바꿔 여러 번 요청해도 된다 (예: 지역별 숙소 검색).
- 요청은 최대 4건. 많이 넣는다고 좋은 후보가 나오지 않는다.

각 요청에 왜 필요한지 note를 붙인다. 회의록과 로그에 남는다.`;

const requestListSchema = z.object({
  requests: z
    .array(
      z.object({
        queryClass: z.string(),
        params: z.record(z.string(), z.unknown()).default({}),
        note: z.string().default(''),
      }),
    )
    .max(8)
    .default([]),
});

const searchResponseSchema = {
  type: 'object',
  properties: {
    requests: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          queryClass: { type: 'string' },
          params: { type: 'object' },
          note: { type: 'string' },
        },
        required: ['queryClass', 'note'],
      },
    },
  },
  required: ['requests'],
} as const;

/** 조달 요청 1건. `@tm/data-agents`의 SearchRequest와 같은 형태다 */
export interface ProposedSearch {
  queryClass: QueryClass;
  params: Record<string, unknown>;
  note: string;
}

export interface SearchInput {
  roundId: RoundId;
  /** 정책이 허용하는 클래스. `prefetchableClasses()`가 원본이다 */
  allowedClasses: readonly QueryClass[];
  /** 방의 사실. 에이전트가 지어내면 안 되는 값들 */
  facts: {
    packId: string;
    /** DateResolver가 확정한 구간. 없으면 날짜가 필요한 클래스를 요청할 수 없다 */
    dateRange: { start: string; end: string } | null;
    groupSize: number;
    originAirport: string | null;
    destinationAirport: string | null;
    /** 그룹 1인 예산 상한 */
    budgetCapPerPersonKrw: number | null;
  };
  /** 이의 재실행이면 왜 다시 찾는지 */
  instruction: string | null;
}

export interface SearchDeps {
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

const isQueryClass = (value: string): value is QueryClass =>
  (queryClasses as readonly string[]).includes(value);

/**
 * 이번 라운드에 조달할 것을 제안한다.
 *
 * 허용 목록에 없는 클래스는 **버리고 사유를 남긴다.** 게이트웨이가 어차피 막지만,
 * 여기서 먼저 걸러야 "에이전트가 없는 클래스를 요청했다"는 사실이 로그에 정확히 남는다.
 */
export async function proposeSearches(
  deps: SearchDeps,
  input: SearchInput,
): Promise<ProposedSearch[]> {
  if (input.allowedClasses.length === 0) {
    console.warn(`[search] ${input.roundId} 허용된 조달 클래스가 없습니다`);
    return [];
  }

  try {
    const call = await deps.client.generateJson(requestListSchema, {
      purpose: `search.${input.roundId}`,
      model: deps.model,
      system: SYSTEM,
      prompt: [
        `[이번 라운드]\n${input.roundId}`,
        `[허용된 queryClass]\n${input.allowedClasses.join(', ')}`,
        `[방 정보]\n` +
          `목적지 Pack: ${input.facts.packId}\n` +
          `여행 구간: ${input.facts.dateRange === null ? '미확정 — 날짜가 필요한 요청은 하지 않는다' : `${input.facts.dateRange.start} ~ ${input.facts.dateRange.end}`}\n` +
          `인원: ${input.facts.groupSize}명\n` +
          `출발 공항: ${input.facts.originAirport ?? '미정'}\n` +
          `도착 공항: ${input.facts.destinationAirport ?? '미정'}\n` +
          `1인 예산 상한: ${input.facts.budgetCapPerPersonKrw === null ? '미정' : `${input.facts.budgetCapPerPersonKrw}원`}`,
        input.instruction === null ? '' : `[다시 찾는 이유]\n${input.instruction}`,
        '이번 라운드에 조달할 요청을 JSON으로 제안하라.',
      ]
        .filter((part) => part.length > 0)
        .join('\n\n'),
      responseSchema: searchResponseSchema,
      maxOutputTokens: 700,
    });

    await deps.onUsage?.({
      requestId: call.requestId,
      purpose: `search.${input.roundId}`,
      model: call.model,
      inputTokens: call.usage.inputTokens,
      outputTokens: call.usage.outputTokens,
      cacheTokens: call.usage.cacheTokens,
    });

    const allowed = new Set<string>(input.allowedClasses);
    const accepted: ProposedSearch[] = [];
    const rejected: string[] = [];

    for (const request of call.value.requests ?? []) {
      if (!isQueryClass(request.queryClass) || !allowed.has(request.queryClass)) {
        rejected.push(request.queryClass);
        continue;
      }
      accepted.push({
        queryClass: request.queryClass,
        params: request.params ?? {},
        note: request.note ?? '',
      });
    }

    if (rejected.length > 0) {
      console.warn(
        `[search] ${input.roundId} 허용되지 않은 클래스를 버립니다: ${rejected.join(', ')}`,
      );
    }
    // 상한은 코드가 집행한다. 에이전트가 4건이라고 들었어도 여기서 자른다.
    return accepted.slice(0, 4);
  } catch (error) {
    console.warn(
      `[search] ${input.roundId} 조달 제안 실패 — 이 라운드는 조달을 건너뜁니다: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return [];
  }
}
