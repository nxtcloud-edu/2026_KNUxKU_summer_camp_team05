import {
  SURVEY_SCHEMA_VERSION,
  type SurveyAnswerV4,
  type SurveyAnswerValue,
  type SurveyPlanV4,
  type SurveyOption,
  type SurveyQuestion,
  type SurveySubmissionV4,
  type SurveyUiType,
} from '../types/survey'

const supportedUiTypes: SurveyUiType[] = [
  'intro',
  'date-range',
  'money-range',
  'ranked-choice',
  'constraints',
  'resource-policies',
  'single-choice',
  'transition',
  'tag-ratings',
  'tag-groups',
  'free-text',
  'profile-confirmation',
]

const answerKinds = new Set<SurveyAnswerValue['kind']>([
  'single-choice',
  'ranked-choice',
  'tag-ratings',
  'constraints',
  'resource-policies',
  'tag-groups',
  'free-text',
  'profile-confirmation',
  'unknown',
  'skipped',
  'date-range',
  'money-range',
])

const answerKindByUiType: Partial<Record<SurveyUiType, SurveyAnswerValue['kind']>> = {
  'date-range': 'date-range',
  'money-range': 'money-range',
  'ranked-choice': 'ranked-choice',
  constraints: 'constraints',
  'resource-policies': 'resource-policies',
  'single-choice': 'single-choice',
  'tag-ratings': 'tag-ratings',
  'tag-groups': 'tag-groups',
  'free-text': 'free-text',
  'profile-confirmation': 'profile-confirmation',
}

export class SurveyValidationError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid SurveyPlanV4: ${issues.join('; ')}`)
    this.name = 'SurveyValidationError'
    this.issues = issues
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const duplicateIds = (items: Array<{ id: string }>) => {
  const seen = new Set<string>()
  return items.map(({ id }) => id).filter((id) => seen.size === seen.add(id).size)
}

function validateOptions(value: unknown, label: string, issues: string[], allowEmpty = false): value is SurveyOption[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    issues.push(`${label} must be ${allowEmpty ? 'an array' : 'a non-empty array'}`)
    return false
  }
  const valid = value.every((option) => isRecord(option) && isNonEmptyString(option.id) && isNonEmptyString(option.label) && (option.detail === undefined || typeof option.detail === 'string') && (option.visual === undefined || typeof option.visual === 'string'))
  if (!valid) issues.push(`${label} contains an invalid option`)
  const options = value.filter((option): option is Record<string, unknown> & { id: string; label: string } => isRecord(option) && isNonEmptyString(option.id) && isNonEmptyString(option.label))
  duplicateIds(options).forEach((id) => issues.push(`${label} has duplicate id ${id}`))
  return valid
}

const validIdLabelItems = (value: unknown) => Array.isArray(value) && value.length > 0 && value.every((item) => isRecord(item) && isNonEmptyString(item.id) && isNonEmptyString(item.label))
const validOptionalString = (value: unknown) => value === undefined || typeof value === 'string'
const validOptionalBoolean = (value: unknown) => value === undefined || typeof value === 'boolean'

function validateQuestion(question: unknown, index: number, issues: string[]): question is SurveyQuestion {
  if (!isRecord(question)) {
    issues.push(`questions[${index}] must be an object`)
    return false
  }

  const prefix = `questions[${index}]`
  if (!isNonEmptyString(question.id)) issues.push(`${prefix}.id is required`)
  if (!isNonEmptyString(question.sectionId)) issues.push(`${prefix}.sectionId is required`)
  if (!isFiniteNumber(question.displayOrder)) issues.push(`${prefix}.displayOrder must be a number`)
  if (!supportedUiTypes.includes(question.uiType as SurveyUiType)) issues.push(`${prefix}.uiType is unsupported`)
  if (!isNonEmptyString(question.title)) issues.push(`${prefix}.title is required`)
  if (typeof question.required !== 'boolean') issues.push(`${prefix}.required must be boolean`)
  if (!validOptionalString(question.eyebrow) || !validOptionalString(question.description)) issues.push(`${prefix} has invalid presentation text`)

  if (!supportedUiTypes.includes(question.uiType as SurveyUiType)) return false
  const label = `question ${String(question.id)}`

  switch (question.uiType as SurveyUiType) {
    case 'intro':
      if (!isNonEmptyString(question.actionLabel) || !validOptionalString(question.footnote)) issues.push(`${label} has invalid intro configuration`)
      break
    case 'transition':
      if (!isNonEmptyString(question.actionLabel) || !validOptionalString(question.imageUrl)) issues.push(`${label} has invalid transition configuration`)
      break
    case 'single-choice': {
      validateOptions(question.options, `${label}.options`, issues)
      const presentations = ['standard', 'timeline', 'people', 'route', 'ticket', 'lodging', 'city', 'comparison']
      if ((question.presentation !== undefined && !presentations.includes(String(question.presentation))) || !validOptionalBoolean(question.autoAdvance) || !validOptionalBoolean(question.allowSkip) || !validOptionalString(question.nextLabel)) issues.push(`${label} has invalid single-choice configuration`)
      break
    }
    case 'ranked-choice':
      validateOptions(question.options, `${label}.options`, issues)
      if (!Number.isInteger(question.maximumSelections) || Number(question.maximumSelections) < 1 || (question.minimumSelections !== undefined && (!Number.isInteger(question.minimumSelections) || Number(question.minimumSelections) < 0 || Number(question.minimumSelections) > Number(question.maximumSelections))) || !validOptionalBoolean(question.allowSkip) || !validOptionalString(question.nextLabel)) issues.push(`${label} has invalid ranking limits`)
      break
    case 'date-range':
      if (!isNonEmptyString(question.minDate) || !isNonEmptyString(question.maxDate) || question.minDate > question.maxDate || !Array.isArray(question.nightOptions) || question.nightOptions.length === 0 || question.nightOptions.some((option) => !isRecord(option) || !isNonEmptyString(option.id) || !isNonEmptyString(option.label) || (option.value !== 'unknown' && (!Number.isInteger(option.value) || Number(option.value) < 1))) || !validOptionalString(question.nextLabel)) issues.push(`${label} has invalid date configuration`)
      break
    case 'money-range':
      if (!isNonEmptyString(question.currency) || !isFiniteNumber(question.step) || question.step <= 0 || !isNonEmptyString(question.targetLabel) || !isNonEmptyString(question.maximumLabel) || !isNonEmptyString(question.includeTransportLabel) || !Array.isArray(question.includeTransportOptions) || question.includeTransportOptions.length === 0 || question.includeTransportOptions.some((option) => !isRecord(option) || !isNonEmptyString(option.id) || !isNonEmptyString(option.label) || typeof option.value !== 'boolean') || (question.precisionFields !== undefined && !validIdLabelItems(question.precisionFields)) || !validOptionalString(question.targetPlaceholder) || !validOptionalString(question.maximumPlaceholder) || !validOptionalString(question.nextLabel)) issues.push(`${label} has invalid money configuration`)
      break
    case 'constraints': {
      const levelsValid = validateOptions(question.levels, `${label}.levels`, issues)
      validateOptions(question.confirmationOptions, `${label}.confirmationOptions`, issues, true)
      const levelIds = new Set(levelsValid && Array.isArray(question.levels) ? question.levels.map((level) => level.id) : [])
      if (!Array.isArray(question.groups) || question.groups.length === 0 || question.groups.some((group) => !isRecord(group) || !isNonEmptyString(group.id) || !isNonEmptyString(group.label) || !isNonEmptyString(group.emptyLabel) || !isNonEmptyString(group.defaultLevelId) || !levelIds.has(group.defaultLevelId) || !Array.isArray(group.suggestions) || group.suggestions.some((suggestion) => !isRecord(suggestion) || !isNonEmptyString(suggestion.id) || !isNonEmptyString(suggestion.label) || (suggestion.initialLevelId !== undefined && (!isNonEmptyString(suggestion.initialLevelId) || !levelIds.has(suggestion.initialLevelId))) || !validOptionalString(suggestion.initialConfirmationOptionId)) || (group.safetyCritical !== undefined && typeof group.safetyCritical !== 'boolean')) || (question.confirmationRequiredForLevelIds !== undefined && (!Array.isArray(question.confirmationRequiredForLevelIds) || question.confirmationRequiredForLevelIds.some((id) => !isNonEmptyString(id) || !levelIds.has(id)))) || !validOptionalBoolean(question.allowSkip) || !validOptionalString(question.nextLabel)) issues.push(`${label} has invalid constraint configuration`)
      break
    }
    case 'resource-policies':
      validateOptions(question.styleOptions, `${label}.styleOptions`, issues)
      validateOptions(question.policyOptions, `${label}.policyOptions`, issues)
      if (!validIdLabelItems(question.resources) || !isNonEmptyString(question.settingsLabel) || !validOptionalBoolean(question.allowSkip) || !validOptionalString(question.nextLabel)) issues.push(`${label} has invalid resource policy configuration`)
      break
    case 'tag-ratings':
      if (!validIdLabelItems(question.items)) issues.push(`${label}.items is invalid`)
      if (!Array.isArray(question.choices) || question.choices.length === 0 || question.choices.some((choice) => !isRecord(choice) || !isNonEmptyString(choice.id) || !isNonEmptyString(choice.label) || !isRecord(choice.answer) || (choice.answer.rating === undefined && choice.answer.stance === undefined) || !validOptionalString(choice.answer.rating) || !validOptionalString(choice.answer.stance)) || !validOptionalBoolean(question.allowSkip) || !validOptionalString(question.nextLabel)) issues.push(`${label} has invalid tag rating configuration`)
      break
    case 'tag-groups':
      if (!Array.isArray(question.groups) || question.groups.length === 0 || question.groups.some((group) => !isRecord(group) || !isNonEmptyString(group.id) || !isNonEmptyString(group.label) || !Number.isInteger(group.limit) || Number(group.limit) < 1 || !Array.isArray(group.suggestions) || group.suggestions.some((suggestion) => typeof suggestion !== 'string') || !validOptionalString(group.placeholder)) || !validOptionalString(question.noteLabel) || !validOptionalString(question.notePlaceholder) || !validOptionalBoolean(question.allowSkip) || !validOptionalString(question.nextLabel)) issues.push(`${label} has invalid tag group configuration`)
      break
    case 'free-text':
      if (!validOptionalString(question.placeholder) || (question.maximumLength !== undefined && (!Number.isInteger(question.maximumLength) || Number(question.maximumLength) < 1)) || !validOptionalBoolean(question.multiline) || !validOptionalBoolean(question.allowSkip) || !validOptionalString(question.nextLabel)) issues.push(`${label} has invalid free-text configuration`)
      break
    case 'profile-confirmation':
      if (!isNonEmptyString(question.rememberLabel) || !isNonEmptyString(question.submitLabel) || !validOptionalString(question.rememberDescription)) issues.push(`${label} has invalid profile confirmation configuration`)
      break
  }

  return true
}

export function parseSurveyPlanV4(value: unknown): SurveyPlanV4 {
  const issues: string[] = []
  if (!isRecord(value)) throw new SurveyValidationError(['plan must be an object'])

  if (value.schemaVersion !== SURVEY_SCHEMA_VERSION) issues.push(`schemaVersion must be ${SURVEY_SCHEMA_VERSION}`)
  if (!isNonEmptyString(value.planId)) issues.push('planId is required')
  if (!isNonEmptyString(value.revision)) issues.push('revision is required')
  if (!isNonEmptyString(value.destinationId)) issues.push('destinationId is required')
  if (!isNonEmptyString(value.locale)) issues.push('locale is required')
  if (!isNonEmptyString(value.title)) issues.push('title is required')
  if (!Array.isArray(value.sections) || value.sections.length === 0) issues.push('sections must not be empty')
  if (!Array.isArray(value.questions) || value.questions.length === 0) issues.push('questions must not be empty')

  const sections = Array.isArray(value.sections) ? value.sections : []
  sections.forEach((section, index) => {
    if (!isRecord(section) || !isNonEmptyString(section.id) || !isNonEmptyString(section.label) || !isNonEmptyString(section.shortLabel) || !isFiniteNumber(section.displayOrder)) {
      issues.push(`sections[${index}] is invalid`)
    }
  })
  duplicateIds(sections.filter(isRecord).filter((section): section is Record<string, unknown> & { id: string } => isNonEmptyString(section.id))).forEach((id) => issues.push(`duplicate section id ${id}`))

  const questions: SurveyQuestion[] = []
  if (Array.isArray(value.questions)) {
    value.questions.forEach((question, index) => {
      if (validateQuestion(question, index, issues)) questions.push(question)
    })
  }

  duplicateIds(questions).forEach((id) => issues.push(`duplicate question id ${id}`))
  const sectionIds = new Set(sections.filter(isRecord).map((section) => section.id).filter(isNonEmptyString))
  questions.forEach((question) => {
    if (!sectionIds.has(question.sectionId)) issues.push(`question ${question.id} references unknown section ${question.sectionId}`)
  })

  if (issues.length) throw new SurveyValidationError(issues)
  return value as SurveyPlanV4
}

function validateAnswer(answer: SurveyAnswerV4, question: SurveyQuestion | undefined, issues: string[]) {
  if (!isRecord(answer) || !isNonEmptyString(answer.questionId) || !isRecord(answer.value) || !isNonEmptyString(answer.answeredAt)) {
    issues.push('submission contains a malformed answer')
    return
  }
  const kind = answer.value.kind
  if (!isNonEmptyString(kind) || !answerKinds.has(kind as SurveyAnswerValue['kind'])) {
    issues.push(`answer ${answer.questionId} has unsupported kind`)
    return
  }
  if (!question) {
    issues.push(`answer references unknown question ${answer.questionId}`)
    return
  }

  const value = answer.value as SurveyAnswerValue
  if (value.kind === 'skipped') {
    if (!['user-skipped', 'not-applicable', 'unknown'].includes(value.reason)) issues.push(`answer ${answer.questionId} has an invalid skip reason`)
    return
  }
  if (value.kind === 'unknown') return

  const expectedKind = answerKindByUiType[question.uiType]
  if (!expectedKind) {
    issues.push(`informational question ${question.id} cannot have an answer`)
    return
  }
  if (value.kind !== expectedKind) {
    issues.push(`answer ${answer.questionId} must use kind ${expectedKind}`)
    return
  }

  const optionExists = (options: Array<{ id: string }>, id: unknown) => typeof id === 'string' && options.some((option) => option.id === id)
  switch (question.uiType) {
    case 'single-choice':
      if (value.kind !== 'single-choice' || !optionExists(question.options, value.optionId)) issues.push(`answer ${answer.questionId} has an unknown option`)
      break
    case 'ranked-choice':
      if (value.kind !== 'ranked-choice' || !Array.isArray(value.optionIds) || new Set(value.optionIds).size !== value.optionIds.length || value.optionIds.length > question.maximumSelections || value.optionIds.some((id) => !optionExists(question.options, id))) {
        issues.push(`answer ${answer.questionId} has an invalid ranking`)
      }
      break
    case 'date-range':
      if (value.kind !== 'date-range') break
      if ((value.startDate !== undefined && (!isNonEmptyString(value.startDate) || value.startDate < question.minDate || value.startDate > question.maxDate)) ||
          (value.endDate !== undefined && (!isNonEmptyString(value.endDate) || value.endDate < question.minDate || value.endDate > question.maxDate)) ||
          (value.startDate && value.endDate && value.startDate > value.endDate) ||
          (value.nights !== undefined && value.nights !== 'unknown' && (!Number.isInteger(value.nights) || value.nights < 1))) {
        issues.push(`answer ${answer.questionId} has an invalid date range`)
      }
      break
    case 'money-range':
      if (value.kind !== 'money-range') break
      if (value.currency !== question.currency ||
          (value.targetAmount !== undefined && (!isFiniteNumber(value.targetAmount) || value.targetAmount < 0)) ||
          (value.maximumAmount !== undefined && (!isFiniteNumber(value.maximumAmount) || value.maximumAmount < 0)) ||
          (value.targetAmount !== undefined && value.maximumAmount !== undefined && value.maximumAmount < value.targetAmount) ||
          (value.includesLongDistanceTransport !== undefined && typeof value.includesLongDistanceTransport !== 'boolean') ||
          (value.precision !== undefined && (!isRecord(value.precision) || Object.entries(value.precision).some(([id, precision]) => !question.precisionFields?.some((field) => field.id === id) || !isRecord(precision) || (precision.kind !== 'unknown' && (precision.kind !== 'amount' || !isFiniteNumber(precision.amount) || precision.amount < 0)))))) {
        issues.push(`answer ${answer.questionId} has invalid money values`)
      }
      break
    case 'tag-ratings':
      if (value.kind !== 'tag-ratings' || !isRecord(value.ratings) || Object.entries(value.ratings).some(([itemId, rating]) => {
        if (!question.items.some((item) => item.id === itemId) || !isRecord(rating)) return true
        return !question.choices.some((choice) => choice.answer.rating === rating.rating && choice.answer.stance === rating.stance)
      })) issues.push(`answer ${answer.questionId} has invalid tag ratings`)
      break
    case 'constraints':
      if (value.kind !== 'constraints' || !isRecord(value.groups) || Object.entries(value.groups).some(([groupId, items]) => !question.groups.some((group) => group.id === groupId) || !Array.isArray(items) || items.some((item) => !isRecord(item) || !isNonEmptyString(item.id) || !isNonEmptyString(item.label) || !optionExists(question.levels, item.levelId) || (item.confirmationOptionId !== undefined && !optionExists(question.confirmationOptions, item.confirmationOptionId))))) {
        issues.push(`answer ${answer.questionId} has invalid constraints`)
      }
      break
    case 'resource-policies':
      if (value.kind !== 'resource-policies' || !isRecord(value.policies) || (value.styleOptionId !== undefined && !optionExists(question.styleOptions, value.styleOptionId)) || Object.entries(value.policies).some(([resourceId, policyId]) => !question.resources.some((resource) => resource.id === resourceId) || !optionExists(question.policyOptions, policyId))) {
        issues.push(`answer ${answer.questionId} has invalid resource policies`)
      }
      break
    case 'tag-groups':
      if (value.kind !== 'tag-groups' || !isRecord(value.groups) || Object.entries(value.groups).some(([groupId, items]) => { const group = question.groups.find((candidate) => candidate.id === groupId); return !group || !Array.isArray(items) || items.length > group.limit || items.some((item) => !isNonEmptyString(item)) }) || (value.note !== undefined && typeof value.note !== 'string')) {
        issues.push(`answer ${answer.questionId} has invalid tag groups`)
      }
      break
    case 'free-text':
      if (value.kind !== 'free-text' || typeof value.text !== 'string' || (question.maximumLength !== undefined && value.text.length > question.maximumLength)) issues.push(`answer ${answer.questionId} has invalid text`)
      break
    case 'profile-confirmation':
      if (value.kind !== 'profile-confirmation' || typeof value.rememberForFuture !== 'boolean') issues.push(`answer ${answer.questionId} has invalid confirmation`)
      break
    default:
      break
  }
}

export function isSurveyAnswerValid(answer: SurveyAnswerV4, question: SurveyQuestion): boolean {
  const issues: string[] = []
  validateAnswer(answer, question, issues)
  return issues.length === 0
}

function isRequiredAnswerComplete(question: SurveyQuestion, answer: SurveyAnswerV4 | undefined) {
  if (!answer || answer.value.kind === 'skipped') return false
  if (question.uiType === 'profile-confirmation') return answer.value.kind === 'profile-confirmation'
  if (answer.value.kind === 'unknown') return true
  switch (question.uiType) {
    case 'date-range': return answer.value.kind === 'date-range' && Boolean(answer.value.startDate && answer.value.endDate && answer.value.nights !== undefined)
    case 'money-range': return answer.value.kind === 'money-range' && answer.value.targetAmount !== undefined && answer.value.maximumAmount !== undefined && answer.value.includesLongDistanceTransport !== undefined
    case 'single-choice': return answer.value.kind === 'single-choice'
    case 'ranked-choice': return answer.value.kind === 'ranked-choice' && answer.value.optionIds.length >= (question.minimumSelections ?? 1)
    case 'free-text': return answer.value.kind === 'free-text' && Boolean(answer.value.text.trim())
    default: return true
  }
}

export function assertSurveySubmissionV4(value: SurveySubmissionV4, plan: SurveyPlanV4): void {
  const issues: string[] = []
  if (!isRecord(value)) throw new SurveyValidationError(['submission must be an object'])
  if (value.schemaVersion !== SURVEY_SCHEMA_VERSION) issues.push(`submission schemaVersion must be ${SURVEY_SCHEMA_VERSION}`)
  if (value.planId !== plan.planId || value.planRevision !== plan.revision) issues.push('submission does not match the loaded plan')
  if (value.destinationId !== plan.destinationId) issues.push('submission destination does not match the loaded plan')
  if (value.status !== 'draft' && value.status !== 'complete') issues.push('submission status is invalid')
  if (!Array.isArray(value.answers)) issues.push('submission answers must be an array')

  const questionById = new Map(plan.questions.map((question) => [question.id, question]))
  const answers = Array.isArray(value.answers) ? value.answers : []
  const answerIds = answers.map((answer) => isRecord(answer) && typeof answer.questionId === 'string' ? answer.questionId : '')
  const uniqueAnswerIds = new Set(answerIds)
  if (uniqueAnswerIds.size !== answerIds.length) issues.push('submission contains duplicate question answers')

  answers.forEach((answer) => validateAnswer(answer, questionById.get(answer.questionId), issues))
  if (value.currentQuestionId !== null && !questionById.has(value.currentQuestionId)) issues.push('currentQuestionId is not in the loaded plan')

  if (value.status === 'complete') {
    plan.questions.filter((question) => question.required && answerKindByUiType[question.uiType]).forEach((question) => {
      const answer = answers.find((item) => item.questionId === question.id)
      if (!isRequiredAnswerComplete(question, answer)) issues.push(`required question ${question.id} is unanswered`)
    })
  }

  if (issues.length) throw new SurveyValidationError(issues)
}
