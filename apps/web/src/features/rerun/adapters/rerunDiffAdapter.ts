import type { ProductResult, RerunDiff } from '../../../product/types'

/**
 * Two backend results -> the before/after the user sees.
 *
 * The backend has no diff endpoint, so the comparison is computed from the two
 * plans we actually loaded. "Unchanged" is a real answer here: a rerun that
 * re-examined the decision and kept it must say so rather than inventing a
 * change.
 */
const krw = (value: number) => `₩${value.toLocaleString('ko-KR')}`

export function buildRerunDiff(
  before: ProductResult,
  after: ProductResult,
  decisionId: string,
): RerunDiff {
  const beforeDecision = before.decisions.find((item) => item.id === decisionId)
  const afterDecision = after.decisions.find((item) => item.id === decisionId)
    ?? after.decisions.find((item) => item.category === beforeDecision?.category)

  const beforeTitle = beforeDecision?.title ?? '이전 선택 기록 없음'
  const afterTitle = afterDecision?.title ?? '변경된 선택 기록 없음'
  const changed = beforeTitle !== afterTitle

  const metrics = [
    before.budgetPerPerson === after.budgetPerPerson
      ? null
      : { label: '1인 예상', before: krw(before.budgetPerPerson), after: krw(after.budgetPerPerson) },
    before.dateRange === after.dateRange
      ? null
      : { label: '여행 날짜', before: before.dateRange, after: after.dateRange },
    before.checksRequired === after.checksRequired
      ? null
      : { label: '확인 필요', before: `${before.checksRequired}건`, after: `${after.checksRequired}건` },
  ].filter((metric): metric is { label: string; before: string; after: string } => metric !== null)

  const newlyUnverified = after.unverifiedItems.filter((item) => !before.unverifiedItems.includes(item))

  return {
    changed,
    summaryTitle: changed ? '선택이 변경됐어요' : '선택은 그대로 유지됐어요',
    beforeTitle,
    afterTitle,
    metrics,
    reason: changed
      ? '다시 확인한 결과 다른 후보가 조건을 더 잘 만족했어요.'
      : '다시 검토했지만 현재 선택이 여전히 조건을 가장 잘 만족했어요.',
    evidenceChanges: newlyUnverified.length > 0
      ? newlyUnverified
      : after.unverifiedItems.length === 0
        ? ['확인되지 않은 항목이 남지 않았어요']
        : after.unverifiedItems,
    ...(after.status === 'VERIFIED'
      ? {}
      : { bookingReadinessChange: '아직 확인되지 않은 항목이 있어 예약 전 직접 확인이 필요해요.' }),
  }
}
