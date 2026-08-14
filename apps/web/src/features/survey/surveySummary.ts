import { getAnswerLabels } from './answerPresentation'
import type { SurveyAnswerV4, SurveyPlanV4 } from './types/survey'

/**
 * The plain list of what the user chose, in question order.
 *
 * Used by the persona confirmation gate: it must show the answers themselves,
 * never a model's interpretation of them, so this only reads labels the survey
 * already rendered.
 */
export function surveyCriteriaLabels(plan: SurveyPlanV4, answers: SurveyAnswerV4[]): string[] {
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer.value]))
  return [...plan.questions]
    .sort((first, second) => first.displayOrder - second.displayOrder)
    .flatMap((question) => getAnswerLabels(question, byQuestion.get(question.id)))
    .filter((label) => label !== '건너뜀')
}
