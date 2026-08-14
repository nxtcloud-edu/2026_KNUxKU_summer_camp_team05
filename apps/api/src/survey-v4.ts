import { z } from 'zod';
import type { SurveySubmission } from '@tm/contracts';

const answerValueSchema = z.object({ kind: z.string().min(1) }).passthrough();

export const surveySubmissionV4Schema = z.object({
  schemaVersion: z.literal(4),
  planId: z.string().min(1),
  planRevision: z.string().min(1),
  destinationId: z.string().min(1),
  tripRoomId: z.string().min(1).nullable(),
  participantId: z.string().min(1).nullable(),
  status: z.enum(['draft', 'complete']),
  currentQuestionId: z.string().min(1).nullable(),
  answers: z.array(z.object({
    questionId: z.string().min(1),
    value: answerValueSchema,
    answeredAt: z.string().datetime(),
  })),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export type SurveySubmissionV4 = z.infer<typeof surveySubmissionV4Schema>;
export type SurveyPlanV4 = ReturnType<typeof surveyPlanFor>;

const dateOnly = (date: Date): string => date.toISOString().slice(0, 10);

export function surveyPlanFor(destinationId: string, today = new Date()): {
  schemaVersion: 4;
  planId: string;
  revision: string;
  destinationId: string;
  locale: string;
  title: string;
  sections: Array<{ id: string; label: string; shortLabel: string; displayOrder: number }>;
  questions: Array<Record<string, unknown>>;
} {
  const min = new Date(today);
  min.setUTCDate(min.getUTCDate() + 1);
  const max = new Date(today);
  max.setUTCDate(max.getUTCDate() + 180);

  return {
    schemaVersion: 4,
    planId: `survey-v4-${destinationId.toLowerCase()}`,
    revision: 'canonical-v4-2026-08-14',
    destinationId,
    locale: 'ko-KR',
    title: `${destinationId} 여행 설문`,
    sections: [
      { id: 'basics', label: '01 여행 기본 설정', shortLabel: '기본 설정', displayOrder: 10 },
      { id: 'constraints', label: '02 꼭 지킬 조건', shortLabel: '필수 조건', displayOrder: 20 },
      { id: 'preferences', label: '03 여행 취향', shortLabel: '여행 취향', displayOrder: 30 },
      { id: 'finish', label: '04 마지막 확인', shortLabel: '확인', displayOrder: 40 },
    ],
    questions: [
      {
        id: 'intro', sectionId: 'basics', displayOrder: 0, uiType: 'intro',
        title: '이번 여행의 기준을 알려주세요.', required: false,
        actionLabel: '시작하기', footnote: '모르는 항목은 건너뛸 수 있어요.',
      },
      {
        id: 'dates', sectionId: 'basics', displayOrder: 10, uiType: 'date-range',
        title: '언제 여행할 수 있나요?', required: true,
        minDate: dateOnly(min), maxDate: dateOnly(max),
        nightOptions: [
          { id: '1', label: '1박', value: 1 }, { id: '2', label: '2박', value: 2 },
          { id: '3', label: '3박', value: 3 }, { id: '4', label: '4박 이상', value: 4 },
          { id: 'unknown', label: '아직 모르겠어요', value: 'unknown' },
        ],
      },
      {
        id: 'budget', sectionId: 'basics', displayOrder: 20, uiType: 'money-range',
        title: '예산 범위는 어느 정도인가요?', required: true, currency: 'KRW', step: 50000,
        targetLabel: '목표 예산', maximumLabel: '절대 상한', includeTransportLabel: '장거리 교통비',
        includeTransportOptions: [
          { id: 'included', label: '예산에 포함', value: true },
          { id: 'separate', label: '별도', value: false },
        ],
      },
      {
        id: 'constraints', sectionId: 'constraints', displayOrder: 30, uiType: 'constraints',
        title: '반드시 지켜야 할 조건이 있나요?', required: false, allowSkip: true,
        levels: [
          { id: 'preferred', label: '선호' }, { id: 'required', label: '필수' },
        ],
        confirmationOptions: [{ id: 'confirmed', label: '직접 확인했어요' }],
        confirmationRequiredForLevelIds: ['required'],
        groups: [
          { id: 'allergies', label: '알레르기', emptyLabel: '없어요', defaultLevelId: 'required', safetyCritical: true, suggestions: [] },
          { id: 'dietary', label: '식단', emptyLabel: '없어요', defaultLevelId: 'preferred', suggestions: [] },
          { id: 'beliefs', label: '종교·신념', emptyLabel: '없어요', defaultLevelId: 'required', suggestions: [] },
          { id: 'mobility', label: '이동·접근성', emptyLabel: '없어요', defaultLevelId: 'required', suggestions: [] },
          { id: 'no-go', label: '피해야 할 것', emptyLabel: '없어요', defaultLevelId: 'required', suggestions: [] },
        ],
      },
      {
        id: 'travel-styles', sectionId: 'preferences', displayOrder: 40, uiType: 'tag-ratings',
        title: '여행 스타일은 어느 쪽인가요?', required: false, allowSkip: true,
        items: [{ id: 'pace', label: '일정 밀도' }, { id: 'spontaneity', label: '즉흥성' }, { id: 'comfort', label: '이동 편의' }],
        choices: [
          { id: 'low', label: '낮음', answer: { rating: '1' } },
          { id: 'middle', label: '보통', answer: { rating: '4' } },
          { id: 'high', label: '높음', answer: { rating: '7' } },
        ],
      },
      {
        id: 'activity-scores', sectionId: 'preferences', displayOrder: 50, uiType: 'tag-ratings',
        title: '하고 싶은 활동의 우선순위를 알려주세요.', required: false, allowSkip: true,
        items: [{ id: 'food', label: '미식' }, { id: 'culture', label: '문화' }, { id: 'nature', label: '자연' }, { id: 'shopping', label: '쇼핑' }],
        choices: [
          { id: 'low', label: '낮음', answer: { rating: '1' } },
          { id: 'middle', label: '보통', answer: { rating: '5' } },
          { id: 'high', label: '높음', answer: { rating: '10' } },
        ],
      },
      { id: 'must-do', sectionId: 'preferences', displayOrder: 60, uiType: 'free-text', title: '꼭 하고 싶은 것이 있나요?', required: false, allowSkip: true, maximumLength: 200 },
      { id: 'avoid', sectionId: 'preferences', displayOrder: 70, uiType: 'free-text', title: '피하고 싶은 것이 있나요?', required: false, allowSkip: true, maximumLength: 200 },
      {
        id: 'profile-confirmation', sectionId: 'finish', displayOrder: 80, uiType: 'profile-confirmation',
        title: '선택한 여행 기준을 확인해 주세요.', required: true,
        rememberLabel: '다음 여행에도 기억', rememberDescription: '확인한 답변만 다시 사용해요.', submitLabel: '제출하기',
      },
    ],
  };
}

export function destinationFromPlanId(planId: string): string | null {
  const prefix = 'survey-v4-';
  return planId.startsWith(prefix) && planId.length > prefix.length
    ? planId.slice(prefix.length)
    : null;
}

export interface SurveyProgressStore {
  get(planId: string, userId: string): SurveySubmissionV4 | undefined;
  set(planId: string, userId: string, submission: SurveySubmissionV4): void;
}

export function createSurveyProgressStore(): SurveyProgressStore {
  const values = new Map<string, SurveySubmissionV4>();
  const key = (planId: string, userId: string) => `${planId}\u0000${userId}`;
  return {
    get: (planId, userId) => values.get(key(planId, userId)),
    set: (planId, userId, submission) => values.set(key(planId, userId), submission),
  };
}

const answer = (submission: SurveySubmissionV4, questionId: string) =>
  submission.answers.find((entry) => entry.questionId === questionId)?.value as Record<string, unknown> | undefined;

function dateRange(start: unknown, end: unknown): string[] {
  if (typeof start !== 'string' || typeof end !== 'string' || start > end) return [];
  const values: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(last.getTime())) return [];
  while (cursor <= last && values.length <= 366) {
    values.push(dateOnly(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return values;
}

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

function constraintLabels(value: Record<string, unknown> | undefined, groupId: string): string[] {
  if (value?.kind !== 'constraints' || typeof value.groups !== 'object' || value.groups === null) return [];
  const group = (value.groups as Record<string, unknown>)[groupId];
  if (!Array.isArray(group)) return [];
  return group.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const label = (item as Record<string, unknown>).label;
    return typeof label === 'string' && label.trim().length > 0 ? [label.trim()] : [];
  });
}

function ratings(value: Record<string, unknown> | undefined, max: number): Record<string, number | null> {
  if (value?.kind !== 'tag-ratings' || typeof value.ratings !== 'object' || value.ratings === null) return {};
  return Object.fromEntries(Object.entries(value.ratings as Record<string, unknown>).map(([id, raw]) => {
    const rating = typeof raw === 'object' && raw !== null ? Number((raw as Record<string, unknown>).rating) : NaN;
    return [id, Number.isInteger(rating) && rating >= 1 && rating <= max ? rating : null];
  }));
}

function freeText(value: Record<string, unknown> | undefined): string {
  return value?.kind === 'free-text' && typeof value.text === 'string' ? value.text : '';
}

export function toCanonicalSurvey(submission: SurveySubmissionV4): SurveySubmission {
  const dates = answer(submission, 'dates');
  const budget = answer(submission, 'budget');
  const constraints = answer(submission, 'constraints');
  const nights = dates?.nights;
  const preferredNights = typeof nights === 'number'
    ? (nights >= 4 ? '4+' : String(nights) as '1' | '2' | '3')
    : null;
  const maximum = typeof budget?.maximumAmount === 'number'
    ? budget.maximumAmount
    : typeof budget?.targetAmount === 'number' ? budget.targetAmount : null;

  return {
    schemaVersion: 2,
    destinationId: submission.destinationId,
    availability: {
      availableDates: dateRange(dates?.startDate, dates?.endDate),
      unavailableDates: [],
      preferredNights,
      nightFlexibility: null,
      weekdayFlexibility: null,
      flightTimeFlexibility: null,
    },
    hardConstraints: {
      budgetLimit: maximum === null ? '' : String(maximum),
      includesFlight: budget?.includesLongDistanceTransport === true,
      dietary: constraintLabels(constraints, 'dietary'),
      allergies: constraintLabels(constraints, 'allergies'),
      beliefs: constraintLabels(constraints, 'beliefs'),
      walkingDistanceKm: null,
      mobilityNeeds: constraintLabels(constraints, 'mobility'),
      noGoItems: constraintLabels(constraints, 'no-go'),
    },
    travelStyles: ratings(answer(submission, 'travel-styles'), 7),
    activityScores: ratings(answer(submission, 'activity-scores'), 10),
    mustDo: freeText(answer(submission, 'must-do')),
    avoid: freeText(answer(submission, 'avoid')),
  };
}

export function validateV4AgainstPlan(submission: SurveySubmissionV4): string[] {
  const plan = surveyPlanFor(submission.destinationId);
  const issues: string[] = [];
  if (submission.planId !== plan.planId) issues.push('planId does not match destinationId');
  if (submission.planRevision !== plan.revision) issues.push('planRevision is stale');
  const questionIds = new Set(plan.questions.map((question) => String(question.id)));
  const answeredQuestionIds = new Set<string>();
  const expectedKinds: Record<string, string> = {
    dates: 'date-range',
    budget: 'money-range',
    constraints: 'constraints',
    'travel-styles': 'tag-ratings',
    'activity-scores': 'tag-ratings',
    'must-do': 'free-text',
    avoid: 'free-text',
    'profile-confirmation': 'profile-confirmation',
  };
  for (const entry of submission.answers) {
    if (answeredQuestionIds.has(entry.questionId)) issues.push(`duplicate answer: ${entry.questionId}`);
    answeredQuestionIds.add(entry.questionId);
    if (!questionIds.has(entry.questionId)) issues.push(`unknown questionId: ${entry.questionId}`);
    const expected = expectedKinds[entry.questionId];
    if (expected === undefined) issues.push(`question does not accept an answer: ${entry.questionId}`);
    else if (entry.value.kind !== expected && entry.value.kind !== 'unknown' && entry.value.kind !== 'skipped') {
      issues.push(`answer ${entry.questionId} must use kind ${expected}`);
    }
  }
  if (submission.status === 'complete') {
    if (submission.completedAt === null) issues.push('completedAt is required for a complete submission');
    for (const questionId of ['dates', 'budget', 'profile-confirmation']) {
      const requiredAnswer = answer(submission, questionId);
      if (requiredAnswer === undefined || requiredAnswer.kind !== expectedKinds[questionId]) {
        issues.push(`required answer is missing: ${questionId}`);
      }
    }
  }
  return issues;
}
