export type AvailabilityDraft = {
  availableDates: string[]
  unavailableDates: string[]
  preferredNights: '1' | '2' | '3' | '4+' | null
  nightFlexibility: 'fixed' | 'plus-minus-one' | null
  weekdayFlexibility: 'weekends' | 'friday-pto' | 'weekdays' | null
  flightTimeFlexibility: 'early-morning' | 'morning-onward' | 'any-time' | null
}

/**
 * 식이 제약(dietary)과 알레르기(allergies)는 반드시 분리한다.
 * 식이 제약은 취향·신념 축이라 절충이 가능하지만, 알레르기는 안전 축이라 협상 대상이 아니다.
 * 알레르기는 코드 레벨에서 후보를 실격시키고, 확인 불가한 후보는 최종안이 될 수 없다.
 * 근거: travel-mediation-plan.md 5.1 ① · 9.4 안전 규칙 · 19.6 fail-closed
 */
export type HardConstraintDraft = {
  budgetLimit: string
  includesFlight: boolean
  dietary: string[]
  allergies: string[]
  beliefs: string[]
  walkingDistanceKm: number | null
  mobilityNeeds: string[]
  noGoItems: string[]
}

/** '없음'은 다른 항목과 함께 선택할 수 없다. */
export const DIETARY_NONE = '없음'

export const dietaryOptions = [DIETARY_NONE, '비건', '베지테리언', '페스코', '할랄', '코셔'] as const

/** 자주 쓰이는 알레르겐. 목록에 없으면 자유 입력으로 추가한다. */
export const allergenOptions = [
  '갑각류',
  '갑각류 외 해산물',
  '땅콩',
  '견과류',
  '계란',
  '유제품',
  '밀 · 글루텐',
  '대두',
  '메밀',
  '복숭아',
] as const

export type SurveyDraft = {
  availability: AvailabilityDraft
  hardConstraints: HardConstraintDraft
  travelStyles: Record<string, number | null>
  activityScores: Record<string, number | null>
  purposeItems: string[]
  avoid: string
}

export const createEmptySurveyDraft = (styleIds: string[], activityIds: string[]): SurveyDraft => ({
  availability: {
    availableDates: [],
    unavailableDates: [],
    preferredNights: null,
    nightFlexibility: null,
    weekdayFlexibility: null,
    flightTimeFlexibility: null,
  },
  hardConstraints: {
    budgetLimit: '',
    includesFlight: false,
    dietary: [],
    allergies: [],
    beliefs: [],
    walkingDistanceKm: null,
    mobilityNeeds: [],
    noGoItems: [],
  },
  travelStyles: Object.fromEntries(styleIds.map((id) => [id, null])),
  activityScores: Object.fromEntries(activityIds.map((id) => [id, null])),
  purposeItems: ['', ''],
  avoid: '',
})

/**
 * v4: 여행 스타일·활동 선호를 의미가 고정된 3단계 척도로 변경하고 척도 버전을 명시.
 * 백엔드는 schemaVersion 으로 분기한다.
 */
export type SurveySubmissionPayload = SurveyDraft & {
  schemaVersion: 4
  destinationId: string
  travelStyleScaleVersion: 'THREE_LEVEL_1_4_7_V1'
  activityScoreScaleVersion: 'THREE_LEVEL_1_5_10_V1'
}

export type RoomSubmissionPayload = {
  schemaVersion: 1
  destinationId: string
}

export const createRoomSubmissionPayload = (destinationId: string): RoomSubmissionPayload => ({
  schemaVersion: 1,
  destinationId,
})

export const createSurveySubmissionPayload = (
  destinationId: string,
  draft: SurveyDraft,
): SurveySubmissionPayload => {
  const purposeItems = draft.purposeItems.map((item) => item.trim()).filter(Boolean)
  if (purposeItems.length > 2) {
    throw new Error('목적급 콘텐츠는 MVP에서 최대 2개까지 제출할 수 있습니다.')
  }
  return {
    schemaVersion: 4,
    destinationId,
    travelStyleScaleVersion: 'THREE_LEVEL_1_4_7_V1',
    activityScoreScaleVersion: 'THREE_LEVEL_1_5_10_V1',
    ...draft,
    purposeItems,
  }
}
