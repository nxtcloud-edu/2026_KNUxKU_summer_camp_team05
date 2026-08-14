import { readStorage, writeStorage } from '../../../utils/storage'
import type { CityId, SurveyPlanV4, SurveyProgressV4, SurveyQuestion, SurveySubmissionV4 } from '../types/survey'
import { mockSurveyPlans, type MockCityId } from '../mocks/surveyPlans'
import { assertSurveySubmissionV4, parseSurveyPlanV4 } from '../validation/surveySchema'

export type SurveySubmitResult = {
  submissionId?: string
}

export interface SurveyRepository {
  getPlan(destinationId: CityId): Promise<SurveyPlanV4>
  loadProgress(plan: SurveyPlanV4): Promise<SurveySubmissionV4 | null>
  saveProgress(submission: SurveySubmissionV4): Promise<SurveyProgressV4>
  submit(submission: SurveySubmissionV4): Promise<SurveySubmitResult>
}

export const destinationCityIds = {
  seoul: 'KR-SEL',
  busan: 'KR-PUS',
  tokyo: 'JP-TYO',
  osaka: 'JP-OSA',
} as const satisfies Record<string, CityId>

export function cityIdForDestination(destinationId: string): CityId {
  return destinationCityIds[destinationId as keyof typeof destinationCityIds] ?? destinationId
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const mockPlanFor = (destinationId: CityId) => {
  const plan = mockSurveyPlans[destinationId as MockCityId]
  if (!plan) throw new Error(`No development survey plan exists for ${destinationId}.`)
  return plan
}
const progressStorageKey = (submission: SurveySubmissionV4) => `moa-survey-v4:progress:${submission.planId}`
const completedStorageKey = (submission: SurveySubmissionV4) => `moa-survey-v4:completed:${submission.planId}`

export class MockSurveyRepository implements SurveyRepository {
  async getPlan(destinationId: CityId): Promise<SurveyPlanV4> {
    return clone(mockPlanFor(destinationId))
  }

  async loadProgress(plan: SurveyPlanV4): Promise<SurveySubmissionV4 | null> {
    const raw = readStorage('local', `moa-survey-v4:progress:${plan.planId}`)
    if (!raw) return null
    try {
      const submission = JSON.parse(raw) as SurveySubmissionV4
      assertSurveySubmissionV4(submission, plan)
      return submission
    } catch {
      return null
    }
  }

  async saveProgress(submission: SurveySubmissionV4): Promise<SurveyProgressV4> {
    const plan = mockPlanFor(submission.destinationId)
    assertSurveySubmissionV4(submission, plan)
    if (!writeStorage('local', progressStorageKey(submission), JSON.stringify(submission))) {
      throw new Error('Survey progress could not be saved in this browser.')
    }
    return {}
  }

  async submit(submission: SurveySubmissionV4): Promise<SurveySubmitResult> {
    const plan = mockPlanFor(submission.destinationId)
    assertSurveySubmissionV4(submission, plan)
    if (submission.status !== 'complete') throw new Error('Only a complete survey can be submitted.')
    if (!writeStorage('local', completedStorageKey(submission), JSON.stringify(submission))) {
      throw new Error('Survey submission could not be saved in this browser.')
    }
    return { submissionId: `local-${submission.planId}` }
  }
}

type SurveyApiConfig = {
  baseUrl: string
  planPath: string
  progressPath: string
  submitPath: string
}

function readApiConfig(): SurveyApiConfig {
  const config = {
    baseUrl: import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, ''),
    planPath: import.meta.env.VITE_SURVEY_PLAN_PATH,
    progressPath: import.meta.env.VITE_SURVEY_PROGRESS_PATH,
    submitPath: import.meta.env.VITE_SURVEY_SUBMIT_PATH,
  }
  const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key)
  if (missing.length) throw new Error(`Survey API is not configured: missing ${missing.join(', ')}.`)
  return config as SurveyApiConfig
}

const applyPathParams = (path: string, values: Record<string, string>) =>
  Object.entries(values).reduce((resolved, [key, value]) => resolved.replaceAll(`{${key}}`, encodeURIComponent(value)), path)

async function readJson(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  const text = await response.text()
  return text ? JSON.parse(text) as unknown : null
}

export class ApiSurveyRepository implements SurveyRepository {
  private readonly plans = new Map<string, SurveyPlanV4>()

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const { baseUrl } = readApiConfig()
    const response = await fetch(`${baseUrl}${path}`, {
      credentials: 'include',
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
    if (!response.ok) throw new Error(`Survey API request failed: ${response.status}`)
    return readJson(response)
  }

  async getPlan(destinationId: CityId): Promise<SurveyPlanV4> {
    const { planPath } = readApiConfig()
    const value = await this.request(applyPathParams(planPath, { destinationId }))
    const plan = parseSurveyPlanV4(value)
    if (plan.destinationId !== destinationId) throw new Error('Survey API returned a plan for a different destination.')
    this.plans.set(plan.planId, plan)
    return plan
  }

  async loadProgress(plan: SurveyPlanV4): Promise<SurveySubmissionV4 | null> {
    this.plans.set(plan.planId, plan)
    const { progressPath } = readApiConfig()
    const value = await this.request(applyPathParams(progressPath, { planId: plan.planId }))
    if (value === null || value === undefined) return null
    const submission = value as SurveySubmissionV4
    assertSurveySubmissionV4(submission, plan)
    return submission
  }

  async saveProgress(submission: SurveySubmissionV4): Promise<SurveyProgressV4> {
    const plan = this.plans.get(submission.planId)
    if (!plan) throw new Error('Survey progress cannot be saved before its plan is loaded.')
    assertSurveySubmissionV4(submission, plan)
    const { progressPath } = readApiConfig()
    const value = await this.request(applyPathParams(progressPath, { planId: submission.planId }), {
      method: 'POST',
      body: JSON.stringify(submission),
    })
    return this.parseProgress(value, plan)
  }

  async submit(submission: SurveySubmissionV4): Promise<SurveySubmitResult> {
    const plan = this.plans.get(submission.planId)
    if (!plan) throw new Error('Survey cannot be submitted before its plan is loaded.')
    assertSurveySubmissionV4(submission, plan)
    const { submitPath } = readApiConfig()
    const value = await this.request(applyPathParams(submitPath, { planId: submission.planId }), {
      method: 'POST',
      body: JSON.stringify(submission),
    })
    if (!value || typeof value !== 'object') return {}
    const submissionId = 'submissionId' in value && typeof value.submissionId === 'string' ? value.submissionId : undefined
    return { submissionId }
  }

  private parseProgress(value: unknown, currentPlan: SurveyPlanV4): SurveyProgressV4 {
    if (value === null || value === undefined) return {}
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Survey progress response must be an object.')

    const response = value as Record<string, unknown>
    if (response.plan !== undefined) {
      const plan = parseSurveyPlanV4(response.plan)
      this.plans.set(plan.planId, plan)
      return { plan }
    }

    const appended = Array.isArray(response.appendedQuestions) ? response.appendedQuestions : []
    const replaced = Array.isArray(response.replacedQuestions) ? response.replacedQuestions : []
    if (appended.length === 0 && replaced.length === 0) return {}

    const replacements = new Map(replaced.map((question) => [typeof question === 'object' && question !== null && 'id' in question ? String(question.id) : '', question]))
    const retained = currentPlan.questions.map((question) => replacements.get(question.id) ?? question)
    const validated = parseSurveyPlanV4({ ...currentPlan, questions: [...retained, ...appended] })
    const questionById = new Map(validated.questions.map((question) => [question.id, question]))
    const selectValidated = (questions: unknown[]): SurveyQuestion[] => questions.map((question) => {
      const id = typeof question === 'object' && question !== null && 'id' in question ? String(question.id) : ''
      const validatedQuestion = questionById.get(id)
      if (!validatedQuestion) throw new Error('Survey progress response contains an invalid question.')
      return validatedQuestion
    })

    this.plans.set(validated.planId, validated)
    return { appendedQuestions: selectValidated(appended), replacedQuestions: selectValidated(replaced) }
  }
}

export function createSurveyRepository(): SurveyRepository {
  const mockSetting = import.meta.env.VITE_USE_MOCK_SURVEY
  if (mockSetting === 'true') return new MockSurveyRepository()
  if (mockSetting === 'false') return new ApiSurveyRepository()
  if (import.meta.env.DEV) return new MockSurveyRepository()
  return new ApiSurveyRepository()
}

export const surveyRepository = createSurveyRepository()

export function readMockSurveyProgress(planId: string): SurveySubmissionV4 | null {
  const raw = readStorage('local', `moa-survey-v4:progress:${planId}`)
  if (!raw) return null
  try {
    return JSON.parse(raw) as SurveySubmissionV4
  } catch {
    return null
  }
}
