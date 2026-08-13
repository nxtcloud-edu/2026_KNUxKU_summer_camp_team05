import {
  negotiationStyles,
  parseBudgetKrw,
  personaVoiceSchema,
  type PersonaCard,
  type PersonaConstraint,
  type PersonaFacts,
  type PersonaVoice,
  type SurveySubmission,
} from '@tm/contracts';
import type { ParticipantWeights } from '@tm/core';
import type { LlmClient } from './client.js';

/**
 * 페르소나 에이전트.
 *
 * **도구를 주지 않는다.** 웹검색을 포함한 모든 조달은 심판이 Data Agent를 통해서만
 * 한다. 개인 에이전트가 각자 검색하면 그라운딩·공정성·비용이 동시에 무너진다
 * (agent-architecture.md · team-assignments T3).
 *
 * 그리고 이 파일의 핵심 분리: **사실은 코드가, 말투는 LLM이.**
 * `buildPersonaFacts`는 LLM을 부르지 않는다. 예산·알레르기·제약·가중치는 설문에서
 * 결정론적으로 유도되며, LLM은 그것을 읽고 별명과 한 줄 소개만 쓴다.
 */

/** 식이 제약의 "없음" 표기. 프론트(`formState.ts`)와 같은 값이어야 한다 */
const DIETARY_NONE = '없음';

const SLIDER_CENTER = 4;

function paceLabel(value: number | null): string {
  if (value === null) return '아직 선택 전';
  if (value <= 3) return '느긋한 편';
  if (value >= 6) return '알찬 일정';
  return '균형 잡힌 편';
}

/**
 * 제약 목록. **알레르기가 항상 맨 앞이다.**
 *
 * 정렬을 LLM이나 화면에 맡기지 않는다 — 페르소나 확인이 사용자의 마지막 통제
 * 지점이고, 안전 항목을 놓치면 회복 경로가 이의 제기밖에 없다.
 */
function constraintsOf(survey: SurveySubmission): PersonaConstraint[] {
  const hard = survey.hardConstraints;
  return [
    ...hard.allergies.map((label): PersonaConstraint => ({
      label: `${label} 알레르기`,
      kind: 'allergy',
      safety: true,
    })),
    ...hard.mobilityNeeds.map((label): PersonaConstraint => ({
      label,
      kind: 'mobility',
      safety: true,
    })),
    ...hard.dietary
      .filter((label) => label !== DIETARY_NONE)
      .map((label): PersonaConstraint => ({ label, kind: 'dietary', safety: false })),
    ...hard.beliefs.map((label): PersonaConstraint => ({ label, kind: 'belief', safety: false })),
    ...hard.noGoItems.map((label): PersonaConstraint => ({ label, kind: 'nogo', safety: false })),
  ];
}

const rankInterests = (
  scores: Record<string, number | null>,
): { top: { cardId: string; score: number }[]; bottom: { cardId: string; score: number }[] } => {
  const answered = Object.entries(scores)
    .filter((entry): entry is [string, number] => entry[1] !== null)
    .map(([cardId, score]) => ({ cardId, score }));

  const descending = [...answered].sort((a, b) => b.score - a.score);
  return { top: descending.slice(0, 3), bottom: [...descending].reverse().slice(0, 2) };
};

export interface PersonaFactsInput {
  userId: string;
  survey: SurveySubmission;
  /** `weightsForRoom`이 만든 값. 회의에서 이 사람을 대표하는 숫자다 */
  weights: ParticipantWeights;
  /** 변환 과정에서 반영하지 못한 것 (`weightsForRoom`의 notesByUser) */
  notes?: readonly string[];
}

/**
 * 설문 → 페르소나 사실. LLM을 부르지 않는다.
 *
 * 같은 설문이면 항상 같은 결과가 나와야 한다 — 사용자가 확인한 카드와 회의에서
 * 쓰이는 값이 다르면 확인 게이트가 아무것도 보장하지 못한다.
 */
export function buildPersonaFacts(input: PersonaFactsInput): PersonaFacts {
  const { survey } = input;
  const pace = survey.travelStyles['pace'] ?? null;
  const { top, bottom } = rankInterests(survey.activityScores);

  return {
    userId: input.userId,
    constraints: constraintsOf(survey),
    budget: {
      perPersonKrw: parseBudgetKrw(survey.hardConstraints.budgetLimit),
      includesFlight: survey.hardConstraints.includesFlight,
    },
    pace: { value: pace, label: paceLabel(pace) },
    nights: {
      preferred: survey.availability.preferredNights,
      flexible: survey.availability.nightFlexibility === 'plus-minus-one',
    },
    topInterests: top,
    bottomInterests: bottom,
    mustDo: survey.mustDo,
    avoid: survey.avoid,
    weights: input.weights.weights,
    notes: [...(input.notes ?? [])],
  };
}

const VOICE_SYSTEM = `너는 여행 계획 회의에서 한 사람을 대변할 대리인의 소개문을 쓴다.

지켜야 할 것:
- 주어진 사실만 쓴다. 숫자·금액·제약을 새로 만들지 않는다.
- 소개문에 금액이나 구체적 수치를 넣지 않는다. 그건 카드의 다른 칸이 보여준다.
- 사용자가 읽고 "얘 나 좀 아는데?"라고 느껴야 한다. 과장하거나 미화하지 않는다.
- 한국어 존댓말. 이모지를 쓰지 않는다.

협상 스타일은 다음 중 하나를 고르고 근거를 댄다:
- 주장형: 양보하기 어려운 조건이 많고 선호가 뚜렷하다
- 조정형: 선호는 있지만 합의를 우선한다
- 실속형: 가격·효율을 우선한다
- 관조형: 대부분 무던하고 강한 선호가 적다`;

const voiceResponseSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    summary: { type: 'string' },
    style: { type: 'string', enum: [...negotiationStyles] },
    styleReason: { type: 'string' },
  },
  required: ['headline', 'summary', 'style', 'styleReason'],
} as const;

/** LLM에 넘길 사실 요약. 가중치 원본은 넣지 않는다 — 소개문에 숫자가 새는 통로다 */
function factsBrief(facts: PersonaFacts): string {
  const constraints =
    facts.constraints.length === 0
      ? '없음'
      : facts.constraints.map((entry) => `${entry.label}${entry.safety ? '(안전)' : ''}`).join(', ');
  const top = facts.topInterests.map((entry) => entry.cardId).join(', ') || '평가 없음';
  const bottom = facts.bottomInterests.map((entry) => entry.cardId).join(', ') || '평가 없음';
  const strongestAxes = Object.entries(facts.weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([axis]) => axis)
    .join(', ');

  return [
    `여행 속도: ${facts.pace.label}`,
    `숙박: ${facts.nights.preferred ?? '미정'}박${facts.nights.flexible ? ' (±1박 가능)' : ' (고정)'}`,
    `양보 어려운 조건: ${constraints}`,
    `기대하는 것: ${top}`,
    `안 끌리는 것: ${bottom}`,
    `중요하게 보는 축: ${strongestAxes || '뚜렷하지 않음'}`,
    `꼭 하고 싶은 말: ${facts.mustDo || '없음'}`,
    `피하고 싶은 것: ${facts.avoid || '없음'}`,
  ].join('\n');
}

/**
 * 소개문 생성. 실패하면 던지지 않고 결정론적 대체 문구를 돌려준다.
 *
 * 페르소나 확인은 건너뛸 수 없는 게이트다. LLM이 죽었다고 사용자가 게이트를
 * 통과하지 못하면 방 전체가 멈춘다 — 여기서는 말투가 없어도 진행되는 편이 낫다.
 */
export async function describePersona(
  client: LlmClient,
  facts: PersonaFacts,
  model: string,
): Promise<{ voice: PersonaVoice; model: string; fallback: string | null }> {
  try {
    const { value } = await client.generateJson(personaVoiceSchema, {
      purpose: 'persona.describe',
      model,
      system: VOICE_SYSTEM,
      prompt: `다음 사실을 바탕으로 대리인 소개를 JSON으로 써라.\n\n${factsBrief(facts)}`,
      responseSchema: voiceResponseSchema,
      maxOutputTokens: 400,
    });
    return { voice: value, model, fallback: null };
  } catch (error) {
    // 조용히 실패하지 않는다. 대체 문구를 썼다는 사실이 카드에 남는다.
    return {
      voice: fallbackVoice(facts),
      model,
      fallback: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 소개문 없이도 카드가 성립해야 한다. 사실만으로 만든 최소 문구 */
export function fallbackVoice(facts: PersonaFacts): PersonaVoice {
  const safety = facts.constraints.filter((entry) => entry.safety).length;
  const style = safety > 0 || facts.constraints.length >= 4 ? '주장형' : '조정형';
  return {
    headline: `${facts.pace.label} 여행자`,
    summary: '설문 답변을 그대로 반영한 대리인입니다. 소개 문구는 만들지 못했습니다.',
    style,
    styleReason:
      safety > 0
        ? '양보할 수 없는 안전 조건이 있어 주장형으로 둡니다.'
        : '뚜렷한 하드 제약이 적어 조정형으로 둡니다.',
  };
}

export interface PersonaCardInput extends PersonaFactsInput {
  model: string;
}

/** 카드 한 장. 사실은 코드가 만들고 말투만 LLM이 붙인다 */
export async function buildPersonaCard(
  client: LlmClient,
  input: PersonaCardInput,
): Promise<{ card: PersonaCard; fallback: string | null }> {
  const facts = buildPersonaFacts(input);
  const described = await describePersona(client, facts, input.model);

  return {
    card: {
      facts,
      voice: described.voice,
      generatedBy: described.fallback === null ? described.model : `${described.model} (fallback)`,
      generatedAt: new Date().toISOString(),
    },
    fallback: described.fallback,
  };
}
