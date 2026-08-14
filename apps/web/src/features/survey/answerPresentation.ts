import type { SurveyAnswerValue, SurveyOption, SurveyQuestion } from './types/survey'

const dateLabel = (value: string | undefined, includeYear = false) => {
  if (!value) return '선택해주세요'
  const date = new Date(`${value}T00:00:00`)
  return new Intl.DateTimeFormat('ko-KR', includeYear
    ? { year: 'numeric', month: 'long', day: 'numeric' }
    : { month: 'long', day: 'numeric' }).format(date)
}

const optionLabel = (options: SurveyOption[], id: string | undefined) =>
  options.find((option) => option.id === id)?.label ?? id

export function getAnswerLabels(question: SurveyQuestion, value: SurveyAnswerValue | undefined): string[] {
  if (!value) return []
  if (value.kind === 'skipped') return ['건너뜀']
  if (value.kind === 'unknown') return ['잘 모르겠어요']

  switch (question.uiType) {
    case 'date-range':
      return value.kind === 'date-range'
        ? [
            value.startDate && value.endDate ? `${dateLabel(value.startDate, true)} – ${dateLabel(value.endDate, true)}` : '날짜 선택 중',
            value.nights === 'unknown' ? '기간 미정' : value.nights !== undefined ? `${value.nights}박` : '',
          ].filter(Boolean)
        : []
    case 'money-range':
      return value.kind === 'money-range'
        ? [
            value.targetAmount !== undefined ? `목표 ₩${value.targetAmount.toLocaleString('ko-KR')}` : '',
            value.maximumAmount !== undefined ? `최대 ₩${value.maximumAmount.toLocaleString('ko-KR')}` : '',
            value.includesLongDistanceTransport === undefined ? '' : value.includesLongDistanceTransport ? '장거리 교통비 포함' : '장거리 교통비 별도',
          ].filter(Boolean)
        : []
    case 'ranked-choice':
      return value.kind === 'ranked-choice'
        ? value.optionIds.map((id, index) => `${index + 1}. ${optionLabel(question.options, id)}`)
        : []
    case 'single-choice':
      return value.kind === 'single-choice' ? [optionLabel(question.options, value.optionId) ?? value.optionId] : []
    case 'constraints':
      return value.kind === 'constraints' ? Object.values(value.groups).flat().map((item) => item.label) : []
    case 'resource-policies':
      return value.kind === 'resource-policies'
        ? [
            optionLabel(question.styleOptions, value.styleOptionId),
            ...Object.entries(value.policies).map(([resourceId, policyId]) =>
              `${question.resources.find(({ id }) => id === resourceId)?.label ?? resourceId}: ${optionLabel(question.policyOptions, policyId)}`,
            ),
          ].filter((item): item is string => Boolean(item))
        : []
    case 'tag-ratings':
      return value.kind === 'tag-ratings'
        ? Object.entries(value.ratings).map(([itemId, rating]) => {
            const item = question.items.find(({ id }) => id === itemId)?.label ?? itemId
            const choice = question.choices.find((candidate) =>
              candidate.answer.rating === rating.rating && candidate.answer.stance === rating.stance,
            )
            return `${item}: ${choice?.label ?? [rating.rating, rating.stance].filter(Boolean).join(' / ')}`
          })
        : []
    case 'tag-groups':
      return value.kind === 'tag-groups'
        ? [
            ...question.groups.flatMap((group) =>
              (value.groups[group.id] ?? []).map((item) => `${group.label}: ${item}`),
            ),
            ...(value.note ? [value.note] : []),
          ]
        : []
    case 'free-text':
      return value.kind === 'free-text' && value.text ? [value.text] : []
    case 'profile-confirmation':
      return []
    default:
      return []
  }
}
