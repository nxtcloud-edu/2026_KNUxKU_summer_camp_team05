import {
  candidateSchema,
  executionCaps,
  stanceSchema,
  type Candidate,
  type CandidateCard,
  type PersonaCard,
  type RefereeCategory,
  type RoundId,
  type Stance,
  type Verdict,
} from '@tm/contracts';
import {
  assessCandidates,
  buildGroundedIndexFromRows,
  checkUtterance,
  factcheckGate,
  scoreCandidates,
  selectWinner,
  type CandidateAssessment,
  type ConcessionLedger,
  type HardConstraintContext,
  type ParticipantWeights,
  type Selection,
} from '@tm/core';
import { z } from 'zod';
import type { LlmClient } from './client.js';

/**
 * 카테고리 심판.
 *
 * 순서가 계약이다 (agent-architecture.md 3.1 INV-2):
 *
 *   후보 읽기(코드) → 속성 산출(코드) → 만족도·승자 선택(코드)
 *     → 페르소나 발화(LLM) → 팩트체크(코드) → 판결문 서술(LLM) → 저장(코드)
 *
 * **심판은 후보를 고르지 않고 수치를 만들지 않는다.** 승자는 `selectWinner`가
 * Maximin으로 정하고, 심판은 그 결정을 사람이 읽을 문장으로 옮긴다. 이 순서를
 * 뒤집으면 "왜 이 숙소인가"가 설명이 아니라 사후 정당화가 된다.
 *
 * 심판은 제공자 원본 JSON을 보지 않는다. `CandidateCard`로 투영된 것만 본다 (6.6).
 */

/** 워커가 구현하는 좁은 저장 포트. `@tm/agents`는 DB를 직접 알지 않는다 */
export interface RefereeStore {
  listCandidates(
    roundId: RoundId,
  ): Promise<readonly { externalId: string; payload: unknown; disqualified: boolean }[]>;
  appendMessage(
    roundId: RoundId,
    message: {
      speakerType: 'persona' | 'referee' | 'system';
      speakerId: string | null;
      content: string;
      refs: Record<string, unknown>;
    },
  ): Promise<void>;
  saveScores(
    roundId: RoundId,
    rows: readonly { candidateId: string; userId: string; satisfaction: number; breakdown: Record<string, number> }[],
  ): Promise<void>;
  saveVerdict(roundId: RoundId, verdict: Verdict): Promise<void>;
  disqualify(roundId: RoundId, externalId: string, reason: string): Promise<void>;
}

export interface RoundParticipant {
  userId: string;
  weights: ParticipantWeights;
  persona: PersonaCard;
}

export interface RoundInput {
  runId: string;
  roundId: RoundId;
  category: RefereeCategory;
  participants: readonly RoundParticipant[];
  ledger: ConcessionLedger;
  hard: HardConstraintContext;
  groupSize: number;
  /** 이의 재실행 지시문. 있으면 판결이 반드시 이 지점을 다시 본다 */
  instruction: string | null;
  /** 이 라운드에 배정된 1인 예산. 없으면 예산 정합성을 판정하지 않는다 */
  budgetAllocatedPerPersonKrw: number | null;
}

export interface RoundOutcome {
  verdict: Verdict | null;
  selection: Selection | null;
  /** fail-closed 미확인 항목. 비어 있지 않으면 노드를 VERIFIED로 올릴 수 없다 */
  unverified: string[];
  /** 회의록에 남긴 발화 수 */
  messages: number;
  /** 라운드를 진행하지 못한 이유. 성공이면 null */
  skipped: string | null;
}

/**
 * 후보 → LLM 컨텍스트 투영.
 *
 * 제공자 원본 JSON은 절대 넣지 않는다. 쟁점과 무관한 필드를 넣으면 토큰만 쓰고
 * 환각 표면적만 넓어진다.
 */
export function toCandidateCard(
  candidate: Candidate,
  assessment: CandidateAssessment,
): CandidateCard {
  const attributes: Record<string, string | number | boolean | null> = {
    '1인 비용(원)': assessment.costPerPersonKrw,
  };

  if (candidate.kind === 'flight') {
    attributes['출발'] = candidate.outbound.departure.at;
    attributes['소요(분)'] = candidate.outbound.durationMin;
    attributes['경유'] = candidate.outbound.connections;
    attributes['수하물 포함'] = candidate.baggage.checkedIncluded;
  } else if (candidate.kind === 'hotel') {
    attributes['지역'] = candidate.location.area;
    attributes['유형'] = candidate.type;
    attributes['평점'] = candidate.rating?.score ?? null;
    attributes['조식'] = candidate.meals.breakfastIncluded;
    const nearest = Object.values(candidate.locationMetrics)[0];
    if (nearest !== undefined) attributes[`${nearest.label}까지(분)`] = nearest.minutes;
  } else {
    attributes['소요(분)'] = candidate.totals?.durationMin ?? null;
    attributes['환승'] = candidate.totals?.transfers ?? null;
    attributes['도보(m)'] = candidate.totals?.walkMeters ?? null;
  }

  return {
    id: candidate.id,
    headline: assessment.headline,
    attributes,
    evidenceIds: [candidate.id],
    confidenceBadge:
      assessment.unverified.length > 0
        ? 'needs_check'
        : candidate.kind === 'hotel' && candidate.price.confidence === 'estimated'
          ? 'estimated'
          : 'live',
    disqualifyReason: assessment.attributes.disqualifyReason ?? null,
  };
}

const cardsBrief = (cards: readonly CandidateCard[]): string =>
  cards
    .map((card) => {
      const attributes = Object.entries(card.attributes)
        .filter(([, value]) => value !== null)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(', ');
      const flag = card.disqualifyReason === null ? '' : ` [실격: ${card.disqualifyReason}]`;
      const check = card.confidenceBadge === 'needs_check' ? ' [확인 필요]' : '';
      return `- ${card.id} | ${card.headline} | ${attributes}${flag}${check}`;
    })
    .join('\n');

const PERSONA_SYSTEM = `너는 여행 계획 회의에서 한 사람을 대변하는 대리인이다.

지켜야 할 것:
- **주어진 후보 목록 안에서만 말한다.** 목록에 없는 장소·항공편·가격을 언급하지 않는다.
- 숫자는 후보 목록에 적힌 값을 그대로 쓴다. 계산하거나 어림잡지 않는다.
- 네가 대변하는 사람의 조건과 선호에 근거해 말한다. 다른 사람을 대신 판단하지 않는다.
- 양보할 수 없는 조건(안전 축)은 반드시 언급한다.
- 한국어 존댓말, 두 문장 이내. 이모지를 쓰지 않는다.

너는 최종 결정권이 없다. 의견과 근거만 낸다.`;

const REFEREE_SYSTEM = `너는 여행 계획 회의의 카테고리 심판이다.

**결정은 이미 내려져 있다.** 승자는 최소 만족도 극대화(Maximin) 규칙에 따라
코드가 계산했고, 너는 그 결정을 참여자가 읽고 납득할 문장으로 옮긴다.

지켜야 할 것:
- 승자를 바꾸지 않는다. 다른 후보를 추천하지 않는다.
- 주어진 숫자만 쓴다. 만족도·금액을 새로 계산하지 않는다.
- 왜 이 후보가 선택됐는지, 누가 무엇을 양보했는지 쓴다.
- 확인하지 못한 항목이 있으면 숨기지 않고 적는다.
- 한국어 존댓말, 400자 이내. 이모지를 쓰지 않는다.`;

const rationaleSchema = z.object({
  rationale: z.string().max(executionCaps.maxVerdictChars),
  /** 확인하지 못한 것. 심판이 추가로 발견한 것만 */
  uncertainties: z.array(z.string()).max(5).default([]),
});

const stanceResponseSchema = {
  type: 'object',
  properties: {
    stance: { type: 'string', enum: ['support', 'oppose', 'conditional'] },
    candidateIds: { type: 'array', items: { type: 'string' } },
    condition: { type: 'string', nullable: true },
    message: { type: 'string' },
  },
  required: ['stance', 'candidateIds', 'message'],
} as const;

const rationaleResponseSchema = {
  type: 'object',
  properties: {
    rationale: { type: 'string' },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
  required: ['rationale'],
} as const;

/** 페르소나가 회의에서 쓸 자기소개 한 줄. 카드의 사실만 옮긴다 */
function personaBrief(persona: PersonaCard): string {
  const safety = persona.facts.constraints
    .filter((entry) => entry.safety)
    .map((entry) => entry.label);
  const other = persona.facts.constraints
    .filter((entry) => !entry.safety)
    .map((entry) => entry.label);

  return [
    `협상 스타일: ${persona.voice.style}`,
    `양보 불가(안전): ${safety.length === 0 ? '없음' : safety.join(', ')}`,
    `그 외 조건: ${other.length === 0 ? '없음' : other.join(', ')}`,
    `여행 속도: ${persona.facts.pace.label}`,
    `꼭 하고 싶은 것: ${persona.facts.mustDo || '없음'}`,
    `피하고 싶은 것: ${persona.facts.avoid || '없음'}`,
  ].join('\n');
}

export interface RefereeDeps {
  client: LlmClient;
  models: { referee: string; persona: string };
  store: RefereeStore;
  /** 발화·판결 1건마다 호출된다. 원장 기록과 미터 청구를 워커가 한다 */
  onUsage?: (usage: {
    requestId: string;
    purpose: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
  }) => Promise<void>;
}

/** 호출 1건의 사용량을 워커에 넘긴다. 원장 기록과 미터 청구는 워커가 한다 */
async function reportUsage(
  deps: RefereeDeps,
  call: { requestId: string; model: string; usage: { inputTokens: number; outputTokens: number; cacheTokens: number } },
  purpose: string,
): Promise<void> {
  await deps.onUsage?.({
    requestId: call.requestId,
    purpose,
    model: call.model,
    inputTokens: call.usage.inputTokens,
    outputTokens: call.usage.outputTokens,
    cacheTokens: call.usage.cacheTokens,
  });
}

/**
 * 라운드 1회 실행.
 *
 * 후보가 없으면 아무것도 지어내지 않고 사유와 함께 끝낸다. 조달이 실패한 라운드를
 * 성공처럼 마감하면 사용자는 근거 없는 계획서를 받는다.
 */
export async function runRound(deps: RefereeDeps, input: RoundInput): Promise<RoundOutcome> {
  const rows = await deps.store.listCandidates(input.roundId);
  if (rows.length === 0) {
    const reason = '조달된 후보가 없어 판정할 수 없습니다.';
    await deps.store.appendMessage(input.roundId, {
      speakerType: 'system',
      speakerId: null,
      content: reason,
      refs: {},
    });
    return { verdict: null, selection: null, unverified: [], messages: 1, skipped: reason };
  }

  // 정규화 스키마를 통과하지 못한 후보는 근거로 쓸 수 없다. 조용히 버리지 않는다.
  const parsed: Candidate[] = [];
  const malformed: string[] = [];
  for (const row of rows) {
    const result = candidateSchema.safeParse(row.payload);
    if (result.success) parsed.push(result.data);
    else malformed.push(row.externalId);
  }
  if (parsed.length === 0) {
    const reason = `후보 ${rows.length}건이 모두 정규화 스키마를 통과하지 못했습니다.`;
    await deps.store.appendMessage(input.roundId, {
      speakerType: 'system',
      speakerId: null,
      content: reason,
      refs: { malformed },
    });
    return { verdict: null, selection: null, unverified: [], messages: 1, skipped: reason };
  }

  // ── 코드 구간: 속성 → 만족도 → 승자 ─────────────────────────────────────
  const assessments = assessCandidates(parsed, { hard: input.hard, groupSize: input.groupSize });
  const byId = new Map(assessments.map((entry) => [entry.attributes.candidateId, entry]));

  // 실격은 삭제가 아니다. 왜 탈락했는지가 회의록에 남아야 한다.
  for (const assessment of assessments) {
    const reason = assessment.attributes.disqualifyReason;
    if (reason !== undefined) {
      await deps.store.disqualify(input.roundId, assessment.attributes.candidateId, reason);
    }
  }

  const board = scoreCandidates(
    input.participants.map((participant) => participant.weights),
    assessments.map((entry) => entry.attributes),
    input.ledger,
  );
  const selection = selectWinner(board);

  if (selection === null) {
    const reason = `후보 ${parsed.length}건이 모두 하드 제약으로 실격되어 선택할 수 있는 안이 없습니다.`;
    await deps.store.appendMessage(input.roundId, {
      speakerType: 'system',
      speakerId: null,
      content: reason,
      refs: { disqualified: board.disqualified },
    });
    return {
      verdict: null,
      selection: null,
      unverified: assessments.flatMap((entry) => entry.unverified),
      messages: 1,
      skipped: reason,
    };
  }

  await deps.store.saveScores(
    input.roundId,
    board.scored.flatMap((score) =>
      Object.entries(score.byUser).map(([userId, satisfaction]) => ({
        candidateId: score.candidateId,
        userId,
        satisfaction,
        breakdown: byId.get(score.candidateId)?.attributes.match ?? {},
      })),
    ),
  );

  // ── 팩트체크 기반. 발화가 인용할 수 있는 값의 원본이다 ────────────────────
  const grounded = buildGroundedIndexFromRows(
    rows.map((row) => ({
      externalId: row.externalId,
      payload: row.payload,
      disqualified: row.disqualified,
    })),
  );
  const cards = parsed.map((candidate) =>
    toCandidateCard(candidate, byId.get(candidate.id) as CandidateAssessment),
  );
  /** 코드가 계산해 발화에 넣도록 허용한 숫자. 이 밖의 금액은 근거 없는 수치다 */
  const allowedNumbers = [
    ...board.scored.flatMap((score) => [score.min, score.sum, ...Object.values(score.byUser)]),
    ...assessments.map((entry) => entry.costPerPersonKrw ?? 0),
  ];

  let messages = 0;

  const speak = async (
    speakerType: 'persona' | 'referee',
    speakerId: string | null,
    text: string,
    refs: Record<string, unknown>,
  ): Promise<void> => {
    const result = checkUtterance({
      speaker: speakerType,
      text,
      index: grounded.index,
      roundId: input.roundId,
      allowedNumbers,
    });
    const gate = factcheckGate(result);

    // 차단이어도 발화를 지우지 않는다. "근거 미확인" 표기를 붙여 남긴다 —
    // 숨기면 감시자가 무엇을 걸렀는지 아무도 알 수 없다.
    await deps.store.appendMessage(input.roundId, {
      speakerType,
      speakerId,
      content: gate.decision === 'accept' ? text : `${text}\n\n[근거 미확인] ${gate.retryHint ?? '일부 수치를 후보에서 확인하지 못했습니다.'}`,
      refs: { ...refs, factcheck: gate.decision, violations: gate.blocking.length + gate.warnings.length },
    });
    messages += 1;
  };

  // ── 페르소나 발화 (LLM). 도구 없음 ────────────────────────────────────────
  const stances: { userId: string; stance: Stance }[] = [];
  for (const participant of input.participants) {
    try {
      const stanceCall = await deps.client.generateJson(stanceSchema, {
        purpose: 'persona.statement',
        model: deps.models.persona,
        system: PERSONA_SYSTEM,
        prompt: [
          `[내가 대변하는 사람]\n${personaBrief(participant.persona)}`,
          `[후보 목록]\n${cardsBrief(cards)}`,
          input.instruction === null ? '' : `[다시 논의하게 된 이유]\n${input.instruction}`,
          '위 후보 중 어떤 것을 지지하는지 JSON으로 답하라. candidateIds에는 후보 목록의 id만 쓴다.',
        ]
          .filter((part) => part.length > 0)
          .join('\n\n'),
        responseSchema: stanceResponseSchema,
        maxOutputTokens: executionCaps.maxUtteranceTokens * 4,
      });

      await reportUsage(deps, stanceCall, 'persona.statement');
      const value = stanceCall.value;
      stances.push({ userId: participant.userId, stance: value });
      await speak('persona', participant.userId, value.message, {
        stance: value.stance,
        candidateIds: value.candidateIds,
      });
    } catch (error) {
      // 한 사람의 대리인이 실패해도 회의는 계속된다. 빠진 사실은 회의록에 남는다.
      await deps.store.appendMessage(input.roundId, {
        speakerType: 'system',
        speakerId: participant.userId,
        content: `${participant.userId}의 대리인이 발언하지 못했습니다: ${
          error instanceof Error ? error.message : String(error)
        }`,
        refs: {},
      });
      messages += 1;
    }
  }

  // ── 판결문 (LLM). 결정을 바꾸지 않고 서술만 한다 ─────────────────────────
  const winnerCard = cards.find((card) => card.id === selection.winner.candidateId);
  const winnerAssessment = byId.get(selection.winner.candidateId);
  const satisfactions = Object.values(selection.winner.byUser);
  const gap =
    satisfactions.length === 0 ? null : Math.max(...satisfactions) - Math.min(...satisfactions);

  let rationale = `최소 만족도가 가장 높은 ${selection.winner.candidateId}를 선택했습니다.`;
  let extraUncertainties: string[] = [];

  try {
    const rationaleCall = await deps.client.generateJson(rationaleSchema, {
      purpose: `referee.${input.category}.verdict`,
      model: deps.models.referee,
      system: REFEREE_SYSTEM,
      prompt: [
        `[코드가 정한 결과]\n선택: ${selection.winner.candidateId} (${winnerCard?.headline ?? ''})\n` +
          `결정 기준: ${selection.decidedBy}\n` +
          `최소 만족도: ${selection.winner.min}\n` +
          `참여자별 만족도: ${Object.entries(selection.winner.byUser)
            .map(([userId, value_]) => `${userId}=${value_}`)
            .join(', ')}`,
        `[후보 목록]\n${cardsBrief(cards)}`,
        board.disqualified.length === 0
          ? ''
          : `[실격]\n${board.disqualified.map((entry) => `${entry.candidateId}: ${entry.reason}`).join('\n')}`,
        stances.length === 0
          ? ''
          : `[참여자 의견]\n${stances
              .map((entry) => `${entry.userId}: ${entry.stance.stance} — ${entry.stance.message}`)
              .join('\n')}`,
        (winnerAssessment?.unverified.length ?? 0) === 0
          ? ''
          : `[확인하지 못한 것]\n${winnerAssessment?.unverified.join('\n') ?? ''}`,
        '이 결정을 설명하는 판결문을 JSON으로 써라.',
      ]
        .filter((part) => part.length > 0)
        .join('\n\n'),
      responseSchema: rationaleResponseSchema,
      maxOutputTokens: 600,
    });

    await reportUsage(deps, rationaleCall, `referee.${input.category}.verdict`);
    rationale = rationaleCall.value.rationale;
    extraUncertainties = rationaleCall.value.uncertainties ?? [];
  } catch (error) {
    // 판결문이 없어도 판결은 성립한다. 결정은 코드가 이미 했다.
    extraUncertainties = [
      `판결문을 생성하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }

  await speak('referee', input.category, rationale, { winner: selection.winner.candidateId });

  const actual = winnerAssessment?.costPerPersonKrw ?? 0;
  const allocated = input.budgetAllocatedPerPersonKrw ?? 0;
  const unverified = winnerAssessment?.unverified ?? [];

  const verdict: Verdict = {
    roundId: input.roundId,
    category: input.category,
    winner: {
      type: 'single',
      candidateIds: [selection.winner.candidateId],
      detail: winnerCard?.headline ?? selection.winner.candidateId,
    },
    rationale: rationale.slice(0, executionCaps.maxVerdictChars),
    runnerUp: selection.tiedWith.find((id) => id !== selection.winner.candidateId) ?? null,
    disqualified: board.disqualified.map((entry) => ({
      candidateId: entry.candidateId,
      reason: entry.reason,
    })),
    intensityProfile: [],
    dissent: stances
      .filter((entry) => entry.stance.stance === 'oppose')
      .map((entry) => ({
        userId: entry.userId,
        reason: entry.stance.message,
        mitigation: entry.stance.condition,
      })),
    scores: selection.winner.byUser,
    minSatisfaction: selection.winner.min,
    satisfactionGap: gap,
    budgetImpact: { allocated, actual, delta: actual - allocated },
    handoff: {},
    // 확인하지 못한 것을 숨기면 사용자가 잘못된 예약을 한다.
    uncertainties: [...unverified, ...extraUncertainties],
    warnings:
      malformed.length === 0
        ? []
        : [{ type: 'malformed_candidate', message: `정규화 실패 후보 ${malformed.length}건` }],
    followups: [],
    toolCalls: [],
    // 미확인 항목이 남았으면 예약 체크리스트를 발행할 근거가 되지 못한다.
    partialSourcing: unverified.length > 0 || malformed.length > 0,
    detail: {
      decidedBy: selection.decidedBy,
      intensityFloorUnmet: selection.intensityFloorUnmet,
      candidatesConsidered: parsed.length,
    },
  };

  await deps.store.saveVerdict(input.roundId, verdict);

  return { verdict, selection, unverified, messages, skipped: null };
}
