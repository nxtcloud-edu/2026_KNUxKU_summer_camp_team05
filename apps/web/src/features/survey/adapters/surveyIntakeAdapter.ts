import type { SurveyIntakePayload } from '../../../api/backendContracts'
import type { ConstraintAnswerItem, SurveyAnswerV4, SurveySubmissionV4 } from '../types/survey'

/**
 * Survey v4 answers -> `POST /api/survey-responses` body (schemaVersion 2).
 *
 * The survey UI is question-shaped; the backend mandate is axis-shaped. This
 * adapter is the seam. Two rules it must never break:
 *
 *   1. allergies and dietary preferences stay separate. An allergy is a safety
 *      axis that disqualifies candidates in code; a preference is negotiable.
 *      Merging them makes the fail-closed check meaningless.
 *   2. nothing is invented. An unanswered question becomes `null`, not a
 *      plausible default — a guessed walking limit is a wrong hard constraint.
 *
 * Contract: packages/contracts/src/survey.ts
 */

const CONSTRAINT_TAG_MAX = 40
const FREE_TEXT_MAX = 200

const tag = (value: string): string => value.trim().slice(0, CONSTRAINT_TAG_MAX)
const tags = (values: string[]): string[] => [...new Set(values.map(tag).filter((value) => value.length > 0))]

const answerMap = (answers: SurveyAnswerV4[]): Map<string, SurveyAnswerV4['value']> =>
  new Map(answers.map((answer) => [answer.questionId, answer.value]))

/** Inclusive ISO date range. The backend expects the explicit list of days. */
function enumerateDates(start: string | undefined, end: string | undefined): string[] {
  if (!start) return []
  const from = new Date(`${start}T00:00:00Z`)
  const to = new Date(`${end ?? start}T00:00:00Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return []

  const dates: string[] = []
  for (let cursor = from; cursor <= to; cursor = new Date(cursor.getTime() + 86_400_000)) {
    dates.push(cursor.toISOString().slice(0, 10))
    if (dates.length > 60) break
  }
  return dates
}

/** Single-choice option ids mapped onto the backend's 1–7 slider. */
const styleScale: Record<string, Record<string, number>> = {
  pace: { relaxed: 2, balanced: 4, full: 6 },
  planning: { loose: 2, balanced: 4, fixed: 6 },
  togetherness: { 'split-ok': 2, 'core-together': 4, together: 6 },
  timing: { early: 2, day: 4, night: 6 },
  convenience: { save: 2, balanced: 4, comfort: 6 },
  transport: { lowest: 2, balanced: 4, comfort: 6 },
  lodging: { 'spacious-quiet': 2, 'central-basic': 5, special: 7 },
  'city-day': { local: 2, culture: 4, trend: 6, city: 6, coast: 6, 'old-town': 4, slow: 2 },
  'food-style': { easy: 2, market: 4, destination: 6 },
  movement: { 'one-area': 2, 'two-areas': 4, 'many-areas': 6 },
  'adaptive-lodging': { second: 2, similar: 4, neither: 4, first: 6 },
}

const policyScale: Record<string, number> = { separate: 2, 'same-place': 4, together: 6 }
const groupStyleScale: Record<string, number> = { 'split-ok': 2, 'core-together': 4, together: 6 }
/** Food ratings on the backend's 1–10 card score. `unknown` stays unanswered. */
const foodRatingScore: Record<string, number> = { must: 10, like: 8, okay: 5, avoid: 1 }

const flightTimeByTiming: Record<string, SurveyIntakePayload['availability']['flightTimeFlexibility']> = {
  early: 'early-morning',
  day: 'morning-onward',
  night: 'any-time',
}

const isAllergy = (item: ConstraintAnswerItem): boolean =>
  item.confirmationOptionId !== 'preference-only'
  && (item.id.includes('allergy') || item.label.includes('알레르기'))

export function toSurveyIntakePayload(
  submission: SurveySubmissionV4,
  destinationId: string,
): SurveyIntakePayload {
  const values = answerMap(submission.answers)

  const dates = values.get('dates')
  const dateAnswer = dates?.kind === 'date-range' ? dates : null
  const nights = dateAnswer?.nights
  const preferredNights: SurveyIntakePayload['availability']['preferredNights'] =
    typeof nights === 'number' ? (nights >= 4 ? '4+' : (String(nights) as '1' | '2' | '3')) : null

  const budget = values.get('budget')
  const budgetAnswer = budget?.kind === 'money-range' ? budget : null
  const budgetAmount = budgetAnswer?.maximumAmount ?? budgetAnswer?.targetAmount

  const constraints = values.get('constraints')
  const constraintGroups = constraints?.kind === 'constraints' ? constraints.groups : {}
  const foodConstraints = constraintGroups['food'] ?? []
  const mobilityNeeds = tags((constraintGroups['mobility'] ?? []).map((item) => item.label))

  const timing = values.get('timing')
  const timingOption = timing?.kind === 'single-choice' ? timing.optionId : null
  const noEarlyDeparture = mobilityNeeds.some((need) => need.includes('새벽 출발 불가'))

  const travelStyles: Record<string, number | null> = {}
  for (const [questionId, scale] of Object.entries(styleScale)) {
    const answer = values.get(questionId)
    travelStyles[questionId] = answer?.kind === 'single-choice' ? scale[answer.optionId] ?? null : null
  }

  const group = values.get('group')
  if (group?.kind === 'resource-policies') {
    travelStyles['group'] = group.styleOptionId ? groupStyleScale[group.styleOptionId] ?? null : null
    for (const [resourceId, policyId] of Object.entries(group.policies)) {
      travelStyles[`policy:${resourceId}`] = policyScale[policyId] ?? null
    }
  }

  const priorities = values.get('budget-priorities')
  if (priorities?.kind === 'ranked-choice') {
    priorities.optionIds.forEach((optionId, index) => {
      travelStyles[`priority:${optionId}`] = index === 0 ? 7 : 5
    })
  }

  const activityScores: Record<string, number | null> = {}
  const foods = values.get('foods')
  if (foods?.kind === 'tag-ratings') {
    for (const [itemId, rating] of Object.entries(foods.ratings)) {
      activityScores[`food:${itemId}`] = rating.rating ? foodRatingScore[rating.rating] ?? null : null
    }
  }

  const mustAvoid = values.get('must-avoid')
  const mustAvoidAnswer = mustAvoid?.kind === 'tag-groups' ? mustAvoid : null
  const mustDo = [
    ...(mustAvoidAnswer?.groups['must-do'] ?? []),
    ...(mustAvoidAnswer?.note ? [mustAvoidAnswer.note] : []),
  ].join(', ').slice(0, FREE_TEXT_MAX)
  const avoid = (mustAvoidAnswer?.groups['avoid'] ?? []).join(', ').slice(0, FREE_TEXT_MAX)

  return {
    schemaVersion: 2,
    destinationId,
    availability: {
      availableDates: enumerateDates(dateAnswer?.startDate, dateAnswer?.endDate),
      unavailableDates: [],
      preferredNights,
      nightFlexibility: nights === 'unknown' ? 'plus-minus-one' : nights === undefined ? null : 'fixed',
      // Not asked in survey v4. Left unanswered instead of guessed.
      weekdayFlexibility: null,
      flightTimeFlexibility: noEarlyDeparture
        ? 'morning-onward'
        : timingOption
          ? flightTimeByTiming[timingOption] ?? null
          : null,
    },
    hardConstraints: {
      budgetLimit: budgetAmount === undefined ? '' : String(budgetAmount),
      includesFlight: budgetAnswer?.includesLongDistanceTransport ?? false,
      dietary: tags(foodConstraints.filter((item) => !isAllergy(item)).map((item) => item.label)),
      allergies: tags(foodConstraints.filter(isAllergy).map((item) => item.label)),
      beliefs: tags((constraintGroups['principles'] ?? []).map((item) => item.label)),
      // The survey asks about difficulty, not kilometres. A number here would be invented.
      walkingDistanceKm: null,
      mobilityNeeds,
      noGoItems: tags((constraintGroups['other'] ?? []).map((item) => item.label)),
    },
    travelStyles,
    activityScores,
    mustDo,
    avoid,
  }
}
