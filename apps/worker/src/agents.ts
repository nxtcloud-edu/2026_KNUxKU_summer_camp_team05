import type { PersonaCard } from '@tm/contracts';
import {
  buildPersonaCard,
  createGeminiClient,
  modelConfigFromEnv,
  registerFreeTierPricing,
  type DocumentStore,
  type LlmClient,
  type ModelConfig,
  type RefereeStore,
  type RoundParticipant,
} from '@tm/agents';
import {
  costOfUsage,
  resolveDates,
  weightsForRoom,
  type DateResolution,
  type HardConstraintContext,
  type RunMeter,
} from '@tm/core';
import type { Repositories, RoomRow, SurveyRow } from '@tm/db';

/**
 * 에이전트 배선 — `@tm/agents`를 실제 저장소·미터에 붙인다.
 *
 * `@tm/agents`는 DB를 알지 않는다. 좁은 포트만 두고 여기서 구현하는 이유는
 * LLM 계층이 저장소 스키마에 묶이면 프롬프트 하나 고칠 때마다 마이그레이션을
 * 걱정하게 되기 때문이다.
 *
 * 키가 없으면 **아무것도 만들지 않는다.** 조용히 목 데이터로 대체하면 후보 없는
 * 회의가 정상처럼 끝난다.
 */

export interface LegacyGeminiRuntime {
  client: LlmClient;
  config: ModelConfig;
}

/** 키가 없으면 null. 무엇이 빠졌는지는 호출자가 로그로 남긴다 */
export function createLegacyGeminiRuntime(): { runtime: LegacyGeminiRuntime } | { missing: string[] } {
  const loaded = modelConfigFromEnv();
  if ('missing' in loaded) return loaded;

  // 단가를 등록하지 않으면 costOfUsage가 예외를 던진다. 무료 티어라도 0을 명시한다.
  registerFreeTierPricing();

  return {
    runtime: {
      config: loaded.config,
      client: createGeminiClient({
        apiKey: loaded.config.apiKey,
        requestsPerMinute: loaded.config.requestsPerMinute,
        requestsPerDay: loaded.config.requestsPerDay,
      }),
    },
  };
}

/**
 * LLM 호출 1건을 원장에 남기고 미터에 청구한다.
 *
 * 무료 티어라 원가는 0이지만 토큰은 계속 쌓는다 — 레이트리밋을 조정하려면
 * 실측값이 필요하고, 그 원본이 이 테이블이다 (llm-runtime-config 3.3).
 */
export function createUsageRecorder(
  repos: Repositories,
  meter: RunMeter,
  scope: { runId: string; roomId: string },
) {
  return async (usage: {
    requestId: string;
    purpose: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
  }): Promise<void> => {
    const costUsd = costOfUsage({
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheTokens,
    });

    meter.charge({
      requestId: usage.requestId,
      purpose: usage.purpose,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheTokens,
    });

    await repos.llmUsage.record({
      requestId: usage.requestId,
      roomId: scope.roomId,
      runId: scope.runId,
      roundId: null,
      purpose: usage.purpose,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheTokens: usage.cacheTokens,
      costUsd,
    });
  };
}

/** 심판이 쓰는 저장 포트. run 하나에 묶인다 */
export function createRefereeStore(repos: Repositories, runId: string): RefereeStore {
  return {
    async listCandidates(roundId) {
      const rows = await repos.candidates.listByRound({ runId, roundId });
      return rows.map((row) => ({
        externalId: row.externalId,
        payload: row.payload,
        disqualified: row.disqualified,
      }));
    },
    async appendMessage(roundId, message) {
      await repos.messages.append({ runId, roundId }, message);
    },
    async saveScores(roundId, rows) {
      await repos.scores.replaceRound({ runId, roundId }, rows);
    },
    async saveVerdict(roundId, verdict) {
      await repos.verdicts.save({ runId, roundId }, verdict);
    },
    async disqualify(roundId, externalId, reason) {
      await repos.candidates.disqualify({ runId, roundId }, externalId, reason);
    },
  };
}

export function createDocumentStore(repos: Repositories, runId: string): DocumentStore {
  return {
    async listVerdicts() {
      const rows = await repos.verdicts.listByRun(runId);
      return rows.map((row) => ({ roundId: row.roundId, verdict: row.verdict }));
    },
    async listCandidates(roundId) {
      const rows = await repos.candidates.listByRound({ runId, roundId });
      return rows.map((row) => ({ externalId: row.externalId, payload: row.payload }));
    },
  };
}

/** 설문의 '4+' 같은 표기를 숫자로. 파싱 실패는 null이며 최빈값 계산에서 빠진다 */
function nightsOf(value: string | null): number | null {
  if (value === null) return null;
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length === 0) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * 참여자 준비 — 설문 → 가중치 → 페르소나 카드.
 *
 * 카드가 이미 저장되어 있으면 다시 만들지 않는다. **사용자가 확인한 카드와 회의에서
 * 쓰는 카드가 달라지면 확인 게이트가 아무것도 보장하지 못한다.**
 */
export async function prepareParticipants(
  repos: Repositories,
  runtime: LegacyGeminiRuntime,
  room: RoomRow,
  surveys: readonly SurveyRow[],
  onUsage: (usage: {
    requestId: string;
    purpose: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
  }) => Promise<void>,
): Promise<RoundParticipant[]> {
  const { weights, notesByUser } = weightsForRoom(
    surveys.map((survey) => ({ userId: survey.userId, survey: survey.payload })),
  );
  const weightById = new Map(weights.map((entry) => [entry.userId, entry]));

  const participants: RoundParticipant[] = [];
  for (const survey of surveys) {
    const weight = weightById.get(survey.userId);
    if (weight === undefined) continue;

    const existing = await repos.personas.latest(room.roomId, survey.userId);
    let card: PersonaCard;

    if (existing !== undefined) {
      card = existing.card;
    } else {
      const built = await buildPersonaCard(runtime.client, {
        userId: survey.userId,
        survey: survey.payload,
        weights: weight,
        notes: notesByUser[survey.userId] ?? [],
        model: runtime.config.models.persona,
      });
      if (built.fallback !== null) {
        console.warn(`[persona] ${survey.userId} 소개문 생성 실패 — 대체 문구 사용: ${built.fallback}`);
      }
      card = built.card;
      await repos.personas.save({ roomId: room.roomId, userId: survey.userId, card });
    }

    participants.push({ userId: survey.userId, weights: weight, persona: card });
    void onUsage;
  }

  return participants;
}

/** 참여자 전원의 하드 제약 합집합. 후보 실격 판정의 입력이다 */
export function hardConstraintsOf(surveys: readonly SurveyRow[]): HardConstraintContext {
  const allergens = new Set<string>();
  const mobilityNeeds = new Set<string>();
  const noGoItems = new Set<string>();
  const budgets: number[] = [];

  for (const survey of surveys) {
    const hard = survey.payload.hardConstraints;
    for (const item of hard.allergies) allergens.add(item);
    for (const item of hard.mobilityNeeds) mobilityNeeds.add(item);
    for (const item of hard.noGoItems) noGoItems.add(item);
    const budget = Number(hard.budgetLimit.replace(/[^0-9]/g, ''));
    if (Number.isFinite(budget) && budget > 0) budgets.push(budget);
  }

  return {
    allergens: [...allergens],
    mobilityNeeds: [...mobilityNeeds],
    noGoItems: [...noGoItems],
    // 그룹 상한은 **최저 예산 참여자**의 상한이다. 평균이 아니다 (기획서 8.4).
    budgetCapPerPersonKrw: budgets.length === 0 ? null : Math.min(...budgets),
  };
}

/**
 * 날짜 확정. 방장이 아니라 설문이 정한다 (기획서 7장).
 *
 * 확정되지 않으면 null을 돌려주고 그 사실을 로그로 남긴다 — 날짜를 지어내면
 * 조달 파라미터 전체가 틀어진다.
 */
export function resolveRoomDates(
  surveys: readonly SurveyRow[],
  recommendedNights: number,
  today = new Date().toISOString().slice(0, 10),
): { resolution: DateResolution; range: { start: string; end: string } | null } {
  const resolution = resolveDates({
    participants: surveys.map((survey) => ({
      userId: survey.userId,
      availableDates: survey.payload.availability.availableDates,
      preferredNights: nightsOf(survey.payload.availability.preferredNights),
      nightFlexible: survey.payload.availability.nightFlexibility === 'plus-minus-one',
    })),
    pack: { recommendedNights },
    today,
  });

  /**
   * 어느 구간으로 갈 것인가.
   *
   * `confirmed`면 그대로 쓴다. `needs_discussion`은 **후보가 접전이라는 뜻이지
   * 고를 수 없다는 뜻이 아니다** — R0가 정리하는 상황이고(7.2.3), 선택 규칙은
   * 코드가 갖는다: 점수 1위 구간을 쓴다. 그 사실은 회의록에 남는다.
   *
   * `needs_host_choice`·`impossible`은 자동으로 정할 수 없다. 방장 개입이
   * 필요하므로 null을 돌려주고 이후 조달이 날짜 없이 진행된다.
   */
  const chosen =
    resolution.chosen ??
    (resolution.status === 'needs_discussion' ? (resolution.windows[0] ?? null) : null);

  return {
    resolution,
    range: chosen === null ? null : { start: chosen.start, end: chosen.end },
  };
}
