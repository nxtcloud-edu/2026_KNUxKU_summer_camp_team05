import type { SurveyAnswerV4, SurveyPlanV4, SurveyProgressV4, SurveyQuestion } from './types/survey'
import { isSurveyAnswerValid, parseSurveyPlanV4 } from './validation/surveySchema'

export const sortSurveyQuestions = (questions: SurveyQuestion[]) => [...questions].sort((first, second) =>
  first.displayOrder - second.displayOrder || first.id.localeCompare(second.id),
)

export function mergeSurveyProgress(plan: SurveyPlanV4, progress: SurveyProgressV4): SurveyPlanV4 {
  if (progress.plan) return parseSurveyPlanV4(progress.plan)
  if (!progress.appendedQuestions?.length && !progress.replacedQuestions?.length) return plan

  const replacements = new Map((progress.replacedQuestions ?? []).map((question) => [question.id, question]))
  const retained = plan.questions.map((question) => replacements.get(question.id) ?? question)
  const existingIds = new Set(retained.map((question) => question.id))
  const appended = (progress.appendedQuestions ?? []).filter((question) => !existingIds.has(question.id))
  return parseSurveyPlanV4({ ...plan, questions: [...retained, ...appended] })
}

export function reconcileSurveyAnswers(plan: SurveyPlanV4, answerState: Record<string, SurveyAnswerV4>) {
  const questionById = new Map(plan.questions.map((question) => [question.id, question]))
  return Object.fromEntries(Object.entries(answerState).filter(([questionId, answer]) => {
    const question = questionById.get(questionId)
    return question ? isSurveyAnswerValid(answer, question) : false
  }))
}

export function adjacentSurveyQuestionId(previousPlan: SurveyPlanV4, nextPlan: SurveyPlanV4, activeQuestionId: string, direction: 1 | -1) {
  const ordered = sortSurveyQuestions(nextPlan.questions)
  const currentIndex = ordered.findIndex(({ id }) => id === activeQuestionId)
  if (currentIndex >= 0) return ordered[Math.min(ordered.length - 1, Math.max(0, currentIndex + direction))]?.id ?? activeQuestionId

  const previousQuestion = previousPlan.questions.find(({ id }) => id === activeQuestionId)
  if (previousQuestion) {
    const candidate = direction === 1
      ? ordered.find((question) => question.displayOrder > previousQuestion.displayOrder)
      : [...ordered].reverse().find((question) => question.displayOrder < previousQuestion.displayOrder)
    if (candidate) return candidate.id
  }
  return ordered[direction === 1 ? 0 : ordered.length - 1]?.id ?? activeQuestionId
}
