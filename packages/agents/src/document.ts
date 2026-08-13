import {
  candidateSchema,
  planDocumentSchema,
  type PlanDocument,
  type PlanningNodeId,
  type RoundId,
  type Verdict,
} from '@tm/contracts';
import { categoryToNode, type ItineraryItem } from '@tm/core';
import { z } from 'zod';
import type { LlmClient } from './client.js';

/**
 * 마무리(문서 생성) 에이전트.
 *
 * 페르소나와 같은 분리다: **항목은 코드가, 문장은 LLM이.**
 *
 * 계획서에 실리는 모든 항목은 판결이 고른 후보의 `external_id`를 그대로 참조해야
 * 한다. Validation Pass 1번이 `candidates` 테이블과 전수 대조하기 때문에, 문서
 * 에이전트가 항목을 지어내면 계획서가 통째로 PARTIAL로 떨어진다 —
 * 그러니 애초에 지어낼 수 없게 만든다 (agent-architecture.md 9.1).
 */

/** 워커가 구현하는 좁은 읽기 포트 */
export interface DocumentStore {
  listVerdicts(): Promise<readonly { roundId: RoundId; verdict: Verdict }[]>;
  listCandidates(
    roundId: RoundId,
  ): Promise<readonly { externalId: string; payload: unknown }[]>;
}

export interface DocumentInput {
  runId: string;
  roomId: string;
  /** DateResolver가 확정한 구간. 없으면 날짜 없는 계획서가 된다 */
  dateRange: { start: string; end: string } | null;
  /** 그룹 상한 = 최저 예산 참여자의 상한 */
  groupCapPerPersonKrw: number;
}

export interface DocumentDraft {
  document: PlanDocument;
  /** Validation Pass 입력. document.days의 항목과 1:1이다 */
  items: ItineraryItem[];
}

/** 판결이 고른 항목 1건. 여기까지는 전부 코드가 만든다 */
interface DecidedItem {
  itemId: string;
  nodeId: PlanningNodeId;
  externalId: string;
  headline: string;
  costPerPersonKrw: number;
  startAt: string | null;
  endAt: string | null;
  /** 확인하지 못한 것. 판결의 uncertainties를 그대로 가져온다 */
  caution: string | null;
  bookingUrl: string | null;
}

/** 후보 payload에서 화면에 쓸 최소 정보만. 원본 JSON은 계획서에 넣지 않는다 */
function describeCandidate(payload: unknown): {
  headline: string;
  startAt: string | null;
  endAt: string | null;
  bookingUrl: string | null;
} {
  const parsed = candidateSchema.safeParse(payload);
  if (!parsed.success) {
    return { headline: '', startAt: null, endAt: null, bookingUrl: null };
  }
  const candidate = parsed.data;

  if (candidate.kind === 'flight') {
    return {
      headline: `${candidate.outbound.carrier.name} ${candidate.outbound.flightNumber}`,
      startAt: candidate.outbound.departure.at,
      endAt: candidate.outbound.arrival.at,
      bookingUrl: candidate.bookingUrl,
    };
  }
  if (candidate.kind === 'hotel') {
    return {
      headline: `${candidate.name} (${candidate.location.area})`,
      startAt: null,
      endAt: null,
      bookingUrl: candidate.bookingUrl,
    };
  }
  return {
    headline: candidate.label,
    startAt: candidate.segments[0]?.departAt ?? null,
    endAt: candidate.segments[candidate.segments.length - 1]?.arriveAt ?? null,
    bookingUrl: candidate.bookingUrl,
  };
}

/**
 * 판결 → 항목. LLM을 부르지 않는다.
 *
 * 판결이 없거나 승자가 없는 라운드는 건너뛴다. 계획서에 빈 자리가 생기는 것이
 * 없는 항목을 채워 넣는 것보다 낫다.
 */
async function decidedItems(
  store: DocumentStore,
  verdicts: readonly { roundId: RoundId; verdict: Verdict }[],
): Promise<DecidedItem[]> {
  const items: DecidedItem[] = [];

  for (const row of verdicts) {
    const externalId = row.verdict.winner.candidateIds[0];
    if (externalId === undefined || row.verdict.winner.type === 'none') continue;

    const nodeId = categoryToNode[row.verdict.category];
    const candidates = await store.listCandidates(row.roundId);
    const matched = candidates.find((candidate) => candidate.externalId === externalId);
    const described =
      matched === undefined
        ? { headline: row.verdict.winner.detail, startAt: null, endAt: null, bookingUrl: null }
        : describeCandidate(matched.payload);

    items.push({
      itemId: `${row.roundId}:${externalId}`,
      nodeId,
      externalId,
      headline: described.headline.length > 0 ? described.headline : row.verdict.winner.detail,
      costPerPersonKrw: row.verdict.budgetImpact.actual,
      startAt: described.startAt,
      endAt: described.endAt,
      caution: row.verdict.uncertainties[0] ?? null,
      bookingUrl: described.bookingUrl,
    });
  }

  return items;
}

/** 여행 구간의 날짜 목록. 구간이 없으면 빈 배열 */
function datesOf(range: { start: string; end: string } | null): string[] {
  if (range === null) return [];
  const start = new Date(range.start);
  const end = new Date(range.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];

  const dates: string[] = [];
  for (let at = new Date(start); at <= end; at.setDate(at.getDate() + 1)) {
    dates.push(at.toISOString().slice(0, 10));
    if (dates.length > 30) break; // 방어. 30박을 넘는 방은 없다
  }
  return dates;
}

const SYSTEM = `너는 확정된 여행 계획서의 문장을 쓴다.

**항목은 이미 정해져 있다.** 너는 제목과 설명만 쓴다.

지켜야 할 것:
- 항목을 추가하거나 빼지 않는다. 주어진 itemId만 쓴다.
- 금액·시각을 새로 만들지 않는다. 문장에 숫자를 넣지 않는다.
- "확인 필요"로 표시된 항목은 그 사실을 설명에 남긴다. 미화하지 않는다.
- 한국어 존댓말. 이모지를 쓰지 않는다.`;

const proseSchema = z.object({
  headline: z.string().max(60),
  dayTitles: z.array(z.object({ day: z.number().int(), title: z.string().max(40) })).default([]),
  itemDetails: z.array(z.object({ itemId: z.string(), detail: z.string().max(120) })).default([]),
});

const proseResponseSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    dayTitles: {
      type: 'array',
      items: {
        type: 'object',
        properties: { day: { type: 'number' }, title: { type: 'string' } },
        required: ['day', 'title'],
      },
    },
    itemDetails: {
      type: 'array',
      items: {
        type: 'object',
        properties: { itemId: { type: 'string' }, detail: { type: 'string' } },
        required: ['itemId', 'detail'],
      },
    },
  },
  required: ['headline'],
} as const;

export interface DocumentDeps {
  client: LlmClient;
  model: string;
  store: DocumentStore;
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
 * 계획서 초안. 판결이 하나도 없으면 null — 빈 계획서를 만들지 않는다.
 *
 * 문장 생성이 실패해도 초안은 나온다. 항목이 이미 코드로 확정되어 있기 때문이다.
 */
export async function draftPlan(
  deps: DocumentDeps,
  input: DocumentInput,
): Promise<DocumentDraft | null> {
  const verdicts = await deps.store.listVerdicts();
  const decided = await decidedItems(deps.store, verdicts);
  if (decided.length === 0) return null;

  const dates = datesOf(input.dateRange);
  const dayCount = Math.max(1, dates.length);

  /**
   * 항목을 날짜에 배치한다.
   *
   * 시각이 있는 항목만 그 날짜로 간다. 시각이 없는 항목(숙소·교통 정책)은
   * 첫날에 모으고 `startAt`을 null로 둔다 — 없는 시각을 지어내면 Validation Pass의
   * 시간대 검증이 거짓 통과한다.
   */
  const dayOf = (item: DecidedItem): number => {
    if (item.startAt === null || dates.length === 0) return 1;
    const date = item.startAt.slice(0, 10);
    const index = dates.indexOf(date);
    return index === -1 ? 1 : index + 1;
  };

  /** LLM이 채우는 부분. 실패해도 빈 값으로 계획서가 성립한다 */
  let prose: {
    headline: string;
    dayTitles: { day: number; title: string }[];
    itemDetails: { itemId: string; detail: string }[];
  } = { headline: '', dayTitles: [], itemDetails: [] };
  try {
    const call = await deps.client.generateJson(proseSchema, {
      purpose: 'document.draft',
      model: deps.model,
      system: SYSTEM,
      prompt: [
        `[여행 구간]\n${input.dateRange === null ? '미확정' : `${input.dateRange.start} ~ ${input.dateRange.end} (${dayCount}일)`}`,
        `[확정된 항목]\n${decided
          .map(
            (item) =>
              `- ${item.itemId} | ${item.nodeId} | ${item.headline} | ${dayOf(item)}일차${
                item.caution === null ? '' : ` | 확인 필요: ${item.caution}`
              }`,
          )
          .join('\n')}`,
        '계획서 제목, 일자별 제목, 항목별 한 줄 설명을 JSON으로 써라.',
      ].join('\n\n'),
      responseSchema: proseResponseSchema,
      maxOutputTokens: 900,
    });

    await deps.onUsage?.({
      requestId: call.requestId,
      purpose: 'document.draft',
      model: call.model,
      inputTokens: call.usage.inputTokens,
      outputTokens: call.usage.outputTokens,
      cacheTokens: call.usage.cacheTokens,
    });
    prose = {
      headline: call.value.headline,
      dayTitles: call.value.dayTitles ?? [],
      itemDetails: call.value.itemDetails ?? [],
    };
  } catch (error) {
    // 문장이 없어도 계획서는 성립한다. 항목은 이미 코드가 확정했다.
    console.warn(
      `[document] 문장 생성 실패 — 항목만으로 계획서를 만듭니다: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const detailById = new Map(prose.itemDetails.map((entry) => [entry.itemId, entry.detail]));
  const titleByDay = new Map(prose.dayTitles.map((entry) => [entry.day, entry.title]));

  const days = Array.from({ length: dayCount }, (_, index) => {
    const day = index + 1;
    const dayItems = decided.filter((item) => dayOf(item) === day);
    return {
      day,
      date: dates[index] ?? null,
      title: titleByDay.get(day) ?? `${day}일차`,
      items: dayItems.map((item) => ({
        itemId: item.itemId,
        nodeId: item.nodeId,
        externalId: item.externalId,
        title: item.headline,
        detail: detailById.get(item.itemId) ?? '',
        startAt: item.startAt,
        endAt: item.endAt,
        costPerPersonKrw: item.costPerPersonKrw,
        bookingUrl: item.bookingUrl,
        // 이동시간은 아직 측정하지 않는다. 0으로 위장하지 않고 미측정으로 둔다.
        travelMinutesFromPrev: null,
        caution: item.caution,
      })),
    };
  });

  const declaredTotal = decided.reduce((sum, item) => sum + item.costPerPersonKrw, 0);
  const byNode: Partial<Record<PlanningNodeId, number>> = {};
  for (const item of decided) {
    byNode[item.nodeId] = (byNode[item.nodeId] ?? 0) + item.costPerPersonKrw;
  }

  const document = planDocumentSchema.parse({
    headline: prose.headline.length > 0 ? prose.headline : '확정된 여행 계획',
    dateRange: input.dateRange,
    days,
    budget: {
      declaredTotalPerPersonKrw: declaredTotal,
      groupCapPerPersonKrw: input.groupCapPerPersonKrw,
      byNode,
    },
    // 확인하지 못한 것을 계획서 상단에 모은다. 숨기면 잘못된 예약으로 이어진다.
    uncertainties: [
      ...new Set(verdicts.flatMap((row) => row.verdict.uncertainties)),
    ],
  });

  const items: ItineraryItem[] = decided.map((item) => ({
    itemId: item.itemId,
    externalId: item.externalId,
    nodeId: item.nodeId,
    startAt: item.startAt,
    endAt: item.endAt,
    travelMinutesFromPrev: null,
    // 영업시간을 확인하지 않았다. null은 미확인이며 확인 실패와 같게 취급된다.
    openAtVisitTime: null,
    costPerPersonKrw: item.costPerPersonKrw,
    requiresFailClosedCheck: item.caution !== null,
    failClosedVerified: false,
  }));

  return { document, items };
}
