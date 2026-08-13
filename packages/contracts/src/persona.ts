import { z } from 'zod';

/**
 * 페르소나 카드 — 사용자가 개입할 수 있는 **마지막 지점**에 표시되는 것.
 *
 * 이 파일의 구조가 곧 계약이다: `facts`는 설문에서 결정론적으로 유도되고,
 * `voice`만 LLM이 쓴다. 섞으면 안 되는 이유는 두 가지다.
 *
 *   1. 예산·알레르기·제약을 LLM이 만들면 **환각이 안전 축에 들어온다.**
 *      "새우 알레르기"가 "해산물 주의"로 바뀌는 순간 fail-closed 검증이 무의미해진다.
 *   2. 사용자가 "이대로 나를 대표해요"를 누르는 것은 facts에 대한 동의다.
 *      그 값이 매번 달라지면 확인 게이트가 게이트가 아니다.
 *
 * 근거: travel-mediation-plan.md 8.1 · team-assignments T1 3번 (건너뛸 수 없는 게이트)
 */

/**
 * 협상 스타일 4종.
 *
 * 온도(temperature)로 흉내 내지 않고 프롬프트로 지시한다 —
 * 스타일이 같은 입력에서 재현되지 않으면 회의록을 신뢰할 수 없다.
 */
export const negotiationStyles = ['주장형', '조정형', '실속형', '관조형'] as const;
export type NegotiationStyle = (typeof negotiationStyles)[number];

/** 카드에 실리는 제약 1건. 안전 축과 취향 축을 태그로 구분한다 */
export const personaConstraintSchema = z.object({
  label: z.string(),
  kind: z.enum(['allergy', 'dietary', 'belief', 'mobility', 'nogo']),
  /** 안전 축인가. true면 목록 맨 앞에 오고 fail-closed 재검증 대상이 된다 */
  safety: z.boolean(),
});

export type PersonaConstraint = z.infer<typeof personaConstraintSchema>;

/**
 * 설문에서 **계산된** 값. LLM은 이 객체를 읽기만 하고 바꿀 수 없다.
 */
export const personaFactsSchema = z.object({
  userId: z.string(),
  /** 알레르기가 항상 맨 앞이다. 정렬은 코드가 보장한다 */
  constraints: z.array(personaConstraintSchema),
  budget: z.object({
    perPersonKrw: z.number().nullable(),
    includesFlight: z.boolean(),
  }),
  pace: z.object({
    /** 1~7 슬라이더 원값. null은 미응답 */
    value: z.number().nullable(),
    label: z.string(),
  }),
  nights: z.object({
    preferred: z.string().nullable(),
    flexible: z.boolean(),
  }),
  /** 카드 점수 상위. 라벨은 Pack의 카드덱이 원본이라 여기엔 id와 점수만 담는다 */
  topInterests: z.array(z.object({ cardId: z.string(), score: z.number() })),
  bottomInterests: z.array(z.object({ cardId: z.string(), score: z.number() })),
  mustDo: z.string(),
  avoid: z.string(),
  /** 스코어링에 실제로 들어가는 가중치. 회의에서 이 사람을 대표하는 값이다 */
  weights: z.record(z.string(), z.number()),
  /**
   * 설문에서 받았지만 반영하지 못한 것. 조용히 버리지 않는다 —
   * 카드덱 축 매핑이 없어 activityScores가 빠졌다면 그 사실이 여기 남는다.
   */
  notes: z.array(z.string()),
});

export type PersonaFacts = z.infer<typeof personaFactsSchema>;

/**
 * LLM이 쓰는 부분. 사실을 담지 않는다 — 숫자도 제약도 여기 오면 안 된다.
 */
export const personaVoiceSchema = z.object({
  /** 별명. "맛집은 포기 못하는 느긋한 탐험가" 같은 한 줄 */
  headline: z.string().max(40),
  /** 한 문장 소개. 사용자가 "얘 나 좀 아는데?"라고 느껴야 하는 부분 */
  summary: z.string().max(120),
  style: z.enum(negotiationStyles),
  /** 왜 이 스타일인지. 회의록에 남고 사용자가 반박할 수 있어야 한다 */
  styleReason: z.string().max(120),
});

export type PersonaVoice = z.infer<typeof personaVoiceSchema>;

export const personaCardSchema = z.object({
  facts: personaFactsSchema,
  voice: personaVoiceSchema,
  /** voice를 만든 모델. 프롬프트 회귀를 추적하려면 필요하다 */
  generatedBy: z.string(),
  generatedAt: z.string(),
});

export type PersonaCard = z.infer<typeof personaCardSchema>;
