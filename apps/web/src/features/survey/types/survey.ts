export const SURVEY_SCHEMA_VERSION = 4 as const

export type CityId = string

export type SurveyUiType =
  | 'intro'
  | 'date-range'
  | 'money-range'
  | 'ranked-choice'
  | 'constraints'
  | 'resource-policies'
  | 'single-choice'
  | 'transition'
  | 'tag-ratings'
  | 'tag-groups'
  | 'free-text'
  | 'profile-confirmation'

export type SurveyOption = {
  id: string
  label: string
  detail?: string
  visual?: string
}

export type SurveySection = {
  id: string
  label: string
  shortLabel: string
  displayOrder: number
}

type SurveyQuestionBase<TUiType extends SurveyUiType> = {
  id: string
  sectionId: string
  displayOrder: number
  uiType: TUiType
  title: string
  eyebrow?: string
  description?: string
  required: boolean
}

export type IntroQuestion = SurveyQuestionBase<'intro'> & {
  actionLabel: string
  footnote?: string
}

export type DateRangeQuestion = SurveyQuestionBase<'date-range'> & {
  minDate: string
  maxDate: string
  nightOptions: Array<{ id: string; label: string; value: number | 'unknown' }>
  nextLabel?: string
}

export type MoneyRangeQuestion = SurveyQuestionBase<'money-range'> & {
  currency: string
  step: number
  targetLabel: string
  targetPlaceholder?: string
  maximumLabel: string
  maximumPlaceholder?: string
  includeTransportLabel: string
  includeTransportOptions: Array<SurveyOption & { value: boolean }>
  precisionFields?: Array<{ id: string; label: string }>
  nextLabel?: string
}

export type RankedChoiceQuestion = SurveyQuestionBase<'ranked-choice'> & {
  options: SurveyOption[]
  minimumSelections?: number
  maximumSelections: number
  allowSkip?: boolean
  nextLabel?: string
}

export type ConstraintSuggestion = {
  id: string
  label: string
  initialLevelId?: string
  initialConfirmationOptionId?: string
}

export type ConstraintGroup = {
  id: string
  label: string
  emptyLabel: string
  defaultLevelId: string
  suggestions: ConstraintSuggestion[]
  safetyCritical?: boolean
}

export type ConstraintsQuestion = SurveyQuestionBase<'constraints'> & {
  groups: ConstraintGroup[]
  levels: SurveyOption[]
  confirmationOptions: SurveyOption[]
  confirmationRequiredForLevelIds?: string[]
  allowSkip?: boolean
  nextLabel?: string
}

export type ResourcePoliciesQuestion = SurveyQuestionBase<'resource-policies'> & {
  styleOptions: SurveyOption[]
  resources: Array<{ id: string; label: string }>
  policyOptions: SurveyOption[]
  settingsLabel: string
  allowSkip?: boolean
  nextLabel?: string
}

export type SingleChoiceQuestion = SurveyQuestionBase<'single-choice'> & {
  options: SurveyOption[]
  presentation?: 'standard' | 'timeline' | 'people' | 'route' | 'ticket' | 'lodging' | 'city' | 'comparison'
  autoAdvance?: boolean
  allowSkip?: boolean
  nextLabel?: string
}

export type TransitionQuestion = SurveyQuestionBase<'transition'> & {
  imageUrl?: string
  actionLabel: string
}

export type TagRatingChoice = SurveyOption & {
  answer: {
    rating?: string
    stance?: string
  }
}

export type TagRatingsQuestion = SurveyQuestionBase<'tag-ratings'> & {
  items: Array<{ id: string; label: string }>
  choices: TagRatingChoice[]
  allowSkip?: boolean
  nextLabel?: string
}

export type TagGroupsQuestion = SurveyQuestionBase<'tag-groups'> & {
  groups: Array<{
    id: string
    label: string
    limit: number
    suggestions: string[]
    placeholder?: string
  }>
  noteLabel?: string
  notePlaceholder?: string
  allowSkip?: boolean
  nextLabel?: string
}

export type FreeTextQuestion = SurveyQuestionBase<'free-text'> & {
  placeholder?: string
  maximumLength?: number
  multiline?: boolean
  allowSkip?: boolean
  nextLabel?: string
}

export type ProfileConfirmationQuestion = SurveyQuestionBase<'profile-confirmation'> & {
  rememberLabel: string
  rememberDescription?: string
  submitLabel: string
}

export type SurveyQuestion =
  | IntroQuestion
  | DateRangeQuestion
  | MoneyRangeQuestion
  | RankedChoiceQuestion
  | ConstraintsQuestion
  | ResourcePoliciesQuestion
  | SingleChoiceQuestion
  | TransitionQuestion
  | TagRatingsQuestion
  | TagGroupsQuestion
  | FreeTextQuestion
  | ProfileConfirmationQuestion

export type DateRangeAnswer = {
  kind: 'date-range'
  startDate?: string
  endDate?: string
  nights?: number | 'unknown'
}

export type MoneyRangeAnswer = {
  kind: 'money-range'
  currency: string
  targetAmount?: number
  maximumAmount?: number
  includesLongDistanceTransport?: boolean
  precision?: Record<string, { kind: 'amount'; amount: number } | { kind: 'unknown' }>
}

export type ConstraintAnswerItem = {
  id: string
  label: string
  levelId: string
  confirmationOptionId?: string
}

export type SurveyAnswerValue =
  | { kind: 'single-choice'; optionId: string }
  | { kind: 'ranked-choice'; optionIds: string[] }
  | { kind: 'tag-ratings'; ratings: Record<string, { rating?: string; stance?: string }> }
  | { kind: 'constraints'; groups: Record<string, ConstraintAnswerItem[]> }
  | { kind: 'resource-policies'; styleOptionId?: string; policies: Record<string, string> }
  | { kind: 'tag-groups'; groups: Record<string, string[]>; note?: string }
  | { kind: 'free-text'; text: string }
  | { kind: 'profile-confirmation'; rememberForFuture: boolean }
  | { kind: 'unknown' }
  | { kind: 'skipped'; reason: 'user-skipped' | 'not-applicable' | 'unknown' }
  | DateRangeAnswer
  | MoneyRangeAnswer

export type SurveyAnswerV4 = {
  questionId: string
  value: SurveyAnswerValue
  answeredAt: string
}

export type SurveyPlanV4 = {
  schemaVersion: typeof SURVEY_SCHEMA_VERSION
  planId: string
  revision: string
  destinationId: CityId
  locale: string
  title: string
  sections: SurveySection[]
  questions: SurveyQuestion[]
}

export type SurveySubmissionV4 = {
  schemaVersion: typeof SURVEY_SCHEMA_VERSION
  planId: string
  planRevision: string
  destinationId: CityId
  tripRoomId: string | null
  participantId: string | null
  status: 'draft' | 'complete'
  currentQuestionId: string | null
  answers: SurveyAnswerV4[]
  startedAt: string
  updatedAt: string
  completedAt: string | null
}

export type SurveyProgressV4 = {
  plan?: SurveyPlanV4
  appendedQuestions?: SurveyQuestion[]
  replacedQuestions?: SurveyQuestion[]
}
