import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SurveyRepository, SurveySubmitResult } from '../api/surveyRepository'
import { adjacentSurveyQuestionId, mergeSurveyProgress, reconcileSurveyAnswers, sortSurveyQuestions } from '../surveyPlan'
import type {
  CityId,
  SurveyAnswerV4,
  SurveyAnswerValue,
  SurveyPlanV4,
  SurveySubmissionV4,
} from '../types/survey'
import { assertSurveySubmissionV4, parseSurveyPlanV4 } from '../validation/surveySchema'

const errorMessage = (error: unknown) => error instanceof Error ? error.message : '설문을 불러오지 못했어요.'

type UseSurveyOptions = {
  destinationId: CityId
  repository: SurveyRepository
}

export function useSurvey({ destinationId, repository }: UseSurveyOptions) {
  const [plan, setPlan] = useState<SurveyPlanV4 | null>(null)
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, SurveyAnswerV4>>({})
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString())
  const [loading, setLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const planRef = useRef<SurveyPlanV4 | null>(null)
  const answersRef = useRef<Record<string, SurveyAnswerV4>>({})
  const currentQuestionIdRef = useRef<string | null>(null)
  const startedAtRef = useRef(startedAt)
  const navigationInFlightRef = useRef(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setPlan(null)
    setAnswers({})
    answersRef.current = {}

    void (async () => {
      try {
        const loadedPlan = parseSurveyPlanV4(await repository.getPlan(destinationId))
        const progress = await repository.loadProgress(loadedPlan)
        if (!active) return

        const restoredAnswers: Record<string, SurveyAnswerV4> = {}
        if (progress) {
          assertSurveySubmissionV4(progress, loadedPlan)
          progress.answers.forEach((answer) => { restoredAnswers[answer.questionId] = answer })
        }
        const questions = sortSurveyQuestions(loadedPlan.questions)
        const restoredQuestionId = progress?.currentQuestionId && questions.some(({ id }) => id === progress.currentQuestionId)
          ? progress.currentQuestionId
          : questions[0]?.id ?? null
        const restoredStartedAt = progress?.startedAt ?? new Date().toISOString()

        planRef.current = loadedPlan
        answersRef.current = restoredAnswers
        currentQuestionIdRef.current = restoredQuestionId
        startedAtRef.current = restoredStartedAt
        setPlan(loadedPlan)
        setAnswers(restoredAnswers)
        setCurrentQuestionId(restoredQuestionId)
        setStartedAt(restoredStartedAt)
      } catch (loadError) {
        if (active) setError(errorMessage(loadError))
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => { active = false }
  }, [destinationId, repository])

  const questions = useMemo(() => plan ? sortSurveyQuestions(plan.questions) : [], [plan])
  const currentIndex = questions.findIndex(({ id }) => id === currentQuestionId)
  const currentQuestion = currentIndex >= 0 ? questions[currentIndex] : null
  const currentAnswer = currentQuestion ? answers[currentQuestion.id]?.value : undefined

  const commitAnswer = useCallback((questionId: string, value: SurveyAnswerValue) => {
    const next = {
      ...answersRef.current,
      [questionId]: { questionId, value, answeredAt: new Date().toISOString() },
    }
    answersRef.current = next
    setAnswers(next)
    return next
  }, [])

  const createSubmission = useCallback((
    status: SurveySubmissionV4['status'],
    answerState = answersRef.current,
    activePlan = planRef.current,
  ): SurveySubmissionV4 => {
    if (!activePlan) throw new Error('Survey plan is not loaded.')
    const questionIds = new Set(activePlan.questions.map(({ id }) => id))
    const now = new Date().toISOString()
    const submission: SurveySubmissionV4 = {
      schemaVersion: 4,
      planId: activePlan.planId,
      planRevision: activePlan.revision,
      destinationId: activePlan.destinationId,
      tripRoomId: null,
      participantId: null,
      status,
      currentQuestionId: currentQuestionIdRef.current,
      answers: Object.values(answerState)
        .filter((answer) => questionIds.has(answer.questionId))
        .sort((first, second) => {
          const firstOrder = activePlan.questions.find(({ id }) => id === first.questionId)?.displayOrder ?? 0
          const secondOrder = activePlan.questions.find(({ id }) => id === second.questionId)?.displayOrder ?? 0
          return firstOrder - secondOrder
        }),
      startedAt: startedAtRef.current,
      updatedAt: now,
      completedAt: status === 'complete' ? now : null,
    }
    assertSurveySubmissionV4(submission, activePlan)
    return submission
  }, [])

  const move = useCallback(async (direction: 1 | -1) => {
    const activePlan = planRef.current
    const activeQuestionId = currentQuestionIdRef.current
    if (!activePlan || !activeQuestionId || navigationInFlightRef.current) return

    navigationInFlightRef.current = true
    setIsSaving(true)
    setError(null)
    try {
      const progress = await repository.saveProgress(createSubmission('draft'))
      const nextPlan = mergeSurveyProgress(activePlan, progress)
      const nextAnswers = reconcileSurveyAnswers(nextPlan, answersRef.current)
      const target = adjacentSurveyQuestionId(activePlan, nextPlan, activeQuestionId, direction)
      currentQuestionIdRef.current = target

      try {
        const navigatedProgress = await repository.saveProgress(createSubmission('draft', nextAnswers, nextPlan))
        const finalPlan = mergeSurveyProgress(nextPlan, navigatedProgress)
        const finalAnswers = reconcileSurveyAnswers(finalPlan, nextAnswers)
        const finalTarget = finalPlan.questions.some(({ id }) => id === target)
          ? target
          : adjacentSurveyQuestionId(nextPlan, finalPlan, target, direction)

        planRef.current = finalPlan
        answersRef.current = finalAnswers
        currentQuestionIdRef.current = finalTarget
        setPlan(finalPlan)
        setAnswers(finalAnswers)
        setCurrentQuestionId(finalTarget)
      } catch (navigationError) {
        currentQuestionIdRef.current = activeQuestionId
        throw navigationError
      }
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      navigationInFlightRef.current = false
      setIsSaving(false)
    }
  }, [createSubmission, repository])

  const skip = useCallback(async (reason: 'user-skipped' | 'not-applicable' | 'unknown' = 'user-skipped') => {
    if (navigationInFlightRef.current) return
    const questionId = currentQuestionIdRef.current
    if (!questionId) return
    commitAnswer(questionId, { kind: 'skipped', reason })
    await move(1)
  }, [commitAnswer, move])

  const submit = useCallback(async (answer?: SurveyAnswerValue): Promise<SurveySubmitResult | null> => {
    if (navigationInFlightRef.current) return null
    const questionId = currentQuestionIdRef.current
    let answerState = answersRef.current
    if (answer && questionId) answerState = commitAnswer(questionId, answer)

    setSubmitting(true)
    setError(null)
    try {
      return await repository.submit(createSubmission('complete', answerState))
    } catch (submitError) {
      setError(errorMessage(submitError))
      return null
    } finally {
      setSubmitting(false)
    }
  }, [commitAnswer, createSubmission, repository])

  const answer = useCallback((value: SurveyAnswerValue) => {
    if (navigationInFlightRef.current) return
    const questionId = currentQuestionIdRef.current
    if (questionId) commitAnswer(questionId, value)
  }, [commitAnswer])

  return {
    plan,
    questions,
    currentQuestion,
    currentQuestionId,
    currentIndex,
    currentAnswer,
    answers,
    startedAt,
    loading,
    isSaving,
    submitting,
    error,
    answer,
    next: () => move(1),
    back: () => move(-1),
    skip,
    submit,
    createSubmission,
  }
}
