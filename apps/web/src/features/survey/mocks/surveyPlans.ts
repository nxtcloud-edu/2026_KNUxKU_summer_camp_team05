import { SURVEY_SCHEMA_VERSION, type SurveyOption, type SurveyPlanV4 } from '../types/survey'
import { parseSurveyPlanV4 } from '../validation/surveySchema'

export type MockCityId = 'KR-SEL' | 'KR-PUS' | 'JP-TYO' | 'JP-OSA'

type CityFixture = {
  id: MockCityId
  name: string
  transition: string
  lodging: SurveyOption[]
  cityDays: SurveyOption[]
  foods: Array<{ id: string; label: string }>
  mustDoSuggestions: string[]
  avoidSuggestions: string[]
  adaptive: {
    reason: string
    first: { title: string; detail: string }
    second: { title: string; detail: string }
  }
}

const commonLodging: SurveyOption[] = [
  { id: 'central-basic', label: '위치 좋은 기본 숙소', detail: '방은 심플해도 이동이 편한 곳', visual: 'central-basic' },
  { id: 'spacious-quiet', label: '조금 멀지만 넓고 편한 숙소', detail: '조용하고 공간이 넉넉한 곳', visual: 'spacious-quiet' },
]

const cityFixtures = {
  'KR-SEL': {
    id: 'KR-SEL', name: '서울', transition: '이제 서울에서 보낼 하루를 골라볼게요.',
    lodging: [...commonLodging, { id: 'special', label: '숙박 자체가 특별한 곳', detail: '한옥, 남산뷰, 감각적인 스테이', visual: 'special' }],
    cityDays: [
      { id: 'trend', label: '성수 → 서울숲 → 한강', detail: '트렌드 · 편집숍 · 저녁 산책', visual: 'trend' },
      { id: 'culture', label: '서촌 → 경복궁 → 미술관', detail: '전통 · 골목 · 전시', visual: 'culture' },
      { id: 'local', label: '망원 골목 → 시장 → 작은 가게', detail: '천천히 깊게 탐색', visual: 'local' },
    ],
    foods: [{ id: 'kbbq', label: '한우·고기구이' }, { id: 'market', label: '시장 음식' }, { id: 'noodle', label: '평양냉면' }, { id: 'chicken', label: '치킨' }, { id: 'dessert', label: '디저트' }, { id: 'fine', label: '한식 다이닝' }],
    mustDoSuggestions: ['한강 야경', '미술관·전시', '전통시장', '성수 편집숍'],
    avoidSuggestions: ['긴 웨이팅', '붐비는 핫플', '가파른 언덕', '늦은 귀가'],
    adaptive: { reason: '숙소 후보가 비슷해서 이것 하나만 정하면 돼요.', first: { title: '도심까지 10분', detail: '심플한 기본형 숙소' }, second: { title: '도심까지 30분', detail: '한옥 분위기와 넓은 공간' } },
  },
  'KR-PUS': {
    id: 'KR-PUS', name: '부산', transition: '이제 부산에서 보내고 싶은 하루를 볼게요.',
    lodging: [...commonLodging, { id: 'special', label: '숙박 자체가 특별한 곳', detail: '오션뷰, 테라스, 해변 앞 숙소', visual: 'special' }],
    cityDays: [
      { id: 'coast', label: '해운대 → 청사포 → 광안리', detail: '바다 · 산책 · 야경', visual: 'coast' },
      { id: 'old-town', label: '남포동 → 자갈치 → 영도', detail: '시장 · 항구 · 로컬 음식', visual: 'old-town' },
      { id: 'slow', label: '전포 골목 → 카페 → 작은 가게', detail: '한 동네를 천천히', visual: 'slow' },
    ],
    foods: [{ id: 'pork-soup', label: '돼지국밥' }, { id: 'milmyeon', label: '밀면' }, { id: 'seafood', label: '해산물' }, { id: 'fishcake', label: '어묵' }, { id: 'market', label: '시장 음식' }, { id: 'sashimi', label: '회' }],
    mustDoSuggestions: ['광안리 야경', '해안 산책', '자갈치시장', '영도 카페'],
    avoidSuggestions: ['해산물 위주 식사', '긴 해안 이동', '붐비는 해변', '오르막길'],
    adaptive: { reason: '바다 접근성과 숙소 편안함 중 하나만 정하면 돼요.', first: { title: '해변까지 5분', detail: '공간은 작은 기본형 숙소' }, second: { title: '해변까지 25분', detail: '넓은 객실과 오션뷰' } },
  },
  'JP-TYO': {
    id: 'JP-TYO', name: '도쿄', transition: '이제 도쿄 얘기만 해볼게요.',
    lodging: [...commonLodging, { id: 'special', label: '숙박 자체가 특별한 곳', detail: '료칸, 대욕장, 도쿄 타워뷰', visual: 'special' }],
    cityDays: [
      { id: 'trend', label: '시부야 → 하라주쿠 → 아키하바라', detail: '트렌드 · 쇼핑 · 팝컬처', visual: 'trend' },
      { id: 'culture', label: '아사쿠사 → 우에노 → 미술관', detail: '전통 · 문화 · 전시', visual: 'culture' },
      { id: 'local', label: '한 동네 골목 → 카페 → 작은 가게', detail: '천천히 깊게 탐색', visual: 'local' },
    ],
    foods: [{ id: 'ramen', label: '라멘' }, { id: 'sushi', label: '스시' }, { id: 'yakitori', label: '야키토리' }, { id: 'soba', label: '소바' }, { id: 'tonkatsu', label: '돈카츠' }, { id: 'dessert', label: '디저트' }],
    mustDoSuggestions: ['시부야 야경', '미술관·전시', '빈티지 쇼핑', '동네 카페'],
    avoidSuggestions: ['출퇴근 혼잡', '긴 웨이팅', '과도한 환승', '새벽 일정'],
    adaptive: { reason: '숙소 후보가 비슷해서 이것 하나만 정하면 돼요.', first: { title: '중심가까지 10분', detail: '기본형 비즈니스 호텔' }, second: { title: '중심가까지 30분', detail: '대욕장 포함 넓은 숙소' } },
  },
  'JP-OSA': {
    id: 'JP-OSA', name: '오사카', transition: '이제 오사카에서 기대하는 걸 골라볼게요.',
    lodging: [...commonLodging, { id: 'special', label: '숙박 자체가 특별한 곳', detail: '료칸, 온천, 대욕장 포함 숙소', visual: 'special' }],
    cityDays: [
      { id: 'city', label: '난바 → 신사이바시 → 도톤보리', detail: '쇼핑 · 네온 · 야경', visual: 'city' },
      { id: 'culture', label: '오사카성 → 나카노시마 → 미술관', detail: '역사 · 공원 · 전시', visual: 'culture' },
      { id: 'local', label: '구로몬시장 → 골목 → 작은 식당', detail: '시장 · 로컬 음식 · 동네', visual: 'local' },
    ],
    foods: [{ id: 'ramen', label: '라멘' }, { id: 'udon', label: '우동' }, { id: 'takoyaki', label: '타코야키' }, { id: 'okonomiyaki', label: '오코노미야키' }, { id: 'yakiniku', label: '야키니쿠' }, { id: 'sushi', label: '스시' }],
    mustDoSuggestions: ['도톤보리 야경', '구로몬시장', '테마파크', '온천·대욕장'],
    avoidSuggestions: ['긴 웨이팅', '테마파크 종일', '붐비는 상점가', '이른 아침 이동'],
    adaptive: { reason: '숙소 후보가 비슷해서 이것 하나만 정하면 돼요.', first: { title: '난바까지 10분', detail: '기본형 중심가 숙소' }, second: { title: '난바까지 30분', detail: '온천·대욕장 포함' } },
  },
} satisfies Record<MockCityId, CityFixture>

const priorities: SurveyOption[] = [
  { id: 'stay', label: '숙소', detail: '좋은 위치, 좋은 방', visual: 'stay' },
  { id: 'food', label: '식사', detail: '맛있는 건 포기 못함', visual: 'food' },
  { id: 'experience', label: '경험', detail: '공연, 티켓, 액티비티', visual: 'experience' },
  { id: 'transport', label: '이동', detail: '시간과 편의를 사기', visual: 'transport' },
  { id: 'personal', label: '쇼핑·카페', detail: '내가 자유롭게 쓸 돈', visual: 'personal' },
]

const groupOptions: SurveyOption[] = [
  { id: 'together', label: '웬만하면 다 같이', detail: '대부분 같은 일정', visual: 'together' },
  { id: 'core-together', label: '큰 일정은 같이', detail: '자유시간 정도는 따로 OK', visual: 'core-together' },
  { id: 'split-ok', label: '취향이 다르면 나눠도 OK', detail: '반나절 정도 따로 움직여도 괜찮음', visual: 'split-ok' },
]

const styleQuestions = [
  { id: 'pace', title: '어떤 하루가 더 내 스타일이에요?', presentation: 'timeline' as const, options: [
    { id: 'relaxed', label: '여유롭게', detail: '핵심 1곳 + 충분한 휴식', visual: 'timeline-one' },
    { id: 'balanced', label: '딱 적당히', detail: '핵심 2곳 + 식사·휴식', visual: 'timeline-two' },
    { id: 'full', label: '알차게', detail: '3곳 이상 다양하게', visual: 'timeline-three' },
  ] },
  { id: 'planning', title: '예약과 즉흥 사이, 어느 쪽이 편해요?', presentation: 'standard' as const, options: [
    { id: 'loose', label: '꼭 필요한 것만 예약', detail: '나머지는 현장에서 정해요', visual: 'notes-loose' },
    { id: 'balanced', label: '큰 일정만 정하기', detail: '핵심만 잡고 여백을 둬요', visual: 'notes-balanced' },
    { id: 'fixed', label: '대부분 미리 확정', detail: '예약과 동선을 꼼꼼하게', visual: 'notes-fixed' },
  ] },
  { id: 'togetherness', title: '일행과 어느 정도 함께하고 싶어요?', presentation: 'people' as const, options: groupOptions },
  { id: 'timing', title: '하루를 언제 시작하고 싶어요?', presentation: 'standard' as const, options: [
    { id: 'early', label: '일찍 시작하고 저녁엔 휴식', detail: '아침 시간을 길게 써요', visual: 'sunrise' },
    { id: 'day', label: '오전 9–10시 시작', detail: '무리 없는 보통 리듬', visual: 'day' },
    { id: 'night', label: '늦게 시작해 밤까지', detail: '도시의 저녁을 즐겨요', visual: 'moon' },
  ] },
  { id: 'convenience', title: '이동할 때 어느 쪽이 더 마음 편해요?', presentation: 'route' as const, options: [
    { id: 'comfort', label: '돈을 더 내고 편하게', detail: '짧고 편한 경로를 우선', visual: 'route-short' },
    { id: 'balanced', label: '균형', detail: '가격과 시간을 함께 봐요', visual: 'route-balanced' },
    { id: 'save', label: '시간이 걸려도 절약', detail: '조금 더 움직여도 괜찮아요', visual: 'route-long' },
  ] },
  { id: 'transport', title: '목적지까지 간다면?', presentation: 'ticket' as const, options: [
    { id: 'lowest', label: '최저가', detail: '이른 시간·환승·변경 제한 OK', visual: 'ticket-basic' },
    { id: 'balanced', label: '균형', detail: '무리 없는 시간·적은 환승', visual: 'ticket-balanced' },
    { id: 'comfort', label: '편안함', detail: '좋은 시간·수하물·변경 가능', visual: 'ticket-comfort' },
  ] },
]

const foodStyleOptions: SurveyOption[] = [
  { id: 'destination', label: '유명 맛집을 제대로', detail: '예약하거나 기다려도 대표 한 끼', visual: 'destination' },
  { id: 'market', label: '여러 개 조금씩', detail: '시장·상점가에서 다양하게', visual: 'market' },
  { id: 'easy', label: '편하고 실패 없는 곳', detail: '일정 근처에서 부담 없이', visual: 'easy' },
]

const movementOptions: SurveyOption[] = [
  { id: 'one-area', label: '한 지역 깊게', detail: '걷고 주변을 천천히', visual: 'one-area' },
  { id: 'two-areas', label: '가까운 두 지역', detail: '균형 있게 이동', visual: 'two-areas' },
  { id: 'many-areas', label: '여러 대표 지역', detail: '이동이 늘어도 다양하게', visual: 'many-areas' },
]

function buildPlan(city: CityFixture): SurveyPlanV4 {
  const questions: SurveyPlanV4['questions'] = [
    { id: 'intro', sectionId: 'basics', displayOrder: 0, uiType: 'intro', title: '이번 여행, 어떤 모습이면 좋을까요?', description: '몇 가지만 고르면 일행과 맞춰볼 수 있도록 내 여행 기준을 만들어드릴게요.', required: false, actionLabel: '내 여행 기준 만들기', footnote: '모르는 건 건너뛰어도 괜찮아요' },
    { id: 'dates', sectionId: 'basics', displayOrder: 10, uiType: 'date-range', eyebrow: '01 여행 기본 설정', title: '언제 갈 수 있어요?', description: '시작일을 고른 다음 종료일을 선택해 주세요.', required: true, minDate: '2026-10-01', maxDate: '2026-10-31', nightOptions: [{ id: '2', label: '2박', value: 2 }, { id: '3', label: '3박', value: 3 }, { id: '4', label: '4박', value: 4 }, { id: 'unknown', label: '아직 모르겠어요', value: 'unknown' }], nextLabel: '예산 정하기' },
    { id: 'budget', sectionId: 'basics', displayOrder: 20, uiType: 'money-range', eyebrow: '01 여행 기본 설정', title: '이번 여행에서 편하게 쓸 수 있는 금액은?', description: '정답이 아니라 계획이 지켜야 할 범위를 알려주세요.', required: true, currency: 'KRW', step: 50000, targetLabel: '목표 예산', targetPlaceholder: '700,000', maximumLabel: '절대 상한', maximumPlaceholder: '900,000', includeTransportLabel: '항공 / 장거리 교통비', includeTransportOptions: [{ id: 'included', label: '예산에 포함', value: true }, { id: 'separate', label: '별도', value: false }], precisionFields: [{ id: 'central-stay', label: '중심가 숙소라면 1박에' }, { id: 'shorter-travel', label: '이동시간을 30분 줄이면' }, { id: 'private-room', label: '독실 / 전용 욕실이라면' }, { id: 'must-do-activity', label: '꼭 하고 싶은 활동이라면' }], nextLabel: '쓸 곳 고르기' },
    { id: 'budget-priorities', sectionId: 'basics', displayOrder: 30, uiType: 'ranked-choice', eyebrow: '01 여행 기본 설정', title: '돈을 쓴다면 어디가 제일 아깝지 않았으면 해요?', description: '가장 중요한 순서대로 최대 두 개만 골라주세요.', required: false, options: priorities, maximumSelections: 2, allowSkip: true, nextLabel: '꼭 지킬 것 확인' },
    { id: 'constraints', sectionId: 'constraints', displayOrder: 40, uiType: 'constraints', eyebrow: '02 이것만은 꼭', title: '여행에서 꼭 지켜야 하는 게 있나요?', description: '해당하지 않으면 ‘없어요’를 누르고 빠르게 넘어가도 괜찮아요.', required: false, groups: [
      { id: 'food', label: '음식 · 알레르기', emptyLabel: '없어요', defaultLevelId: 'preferred', safetyCritical: true, suggestions: [{ id: 'shellfish-allergy', label: '갑각류 알레르기', initialLevelId: 'required' }, { id: 'nut-allergy', label: '견과류 알레르기', initialLevelId: 'required' }, { id: 'vegetarian', label: '채식' }, { id: 'halal', label: '할랄' }] },
      { id: 'mobility', label: '이동 · 접근성', emptyLabel: '특별한 조건 없어요', defaultLevelId: 'preferred', suggestions: ['장시간 걷기 어려움', '계단 이용 어려움', '휠체어 접근 필요', '새벽 출발 불가'].map((label, index) => ({ id: `mobility-${index + 1}`, label })) },
      { id: 'principles', label: '종교 · 생활 원칙', emptyLabel: '없어요', defaultLevelId: 'preferred', suggestions: ['예배 시간 필요', '금주', '흡연실 불가', '혼숙 불가'].map((label, index) => ({ id: `principle-${index + 1}`, label })) },
      { id: 'other', label: '그 외 절대 피하고 싶은 것', emptyLabel: '없어요', defaultLevelId: 'preferred', suggestions: ['도미토리 불가', '고소공포 활동 제외', '붐비는 장소 최소화'].map((label, index) => ({ id: `other-${index + 1}`, label })) },
    ], levels: [{ id: 'required', label: '반드시 지켜야 해요' }, { id: 'preferred', label: '가능하면 지켜 주세요' }, { id: 'reference', label: '선택할 때 참고만 해 주세요' }, { id: 'approval', label: '마지막에는 제가 선택할게요' }], confirmationOptions: [{ id: 'exclude-cross-contact', label: '네, 반드시 제외' }, { id: 'preference-only', label: '아니요, 선호 정도예요' }], confirmationRequiredForLevelIds: ['required'], allowSkip: true, nextLabel: '함께 움직이는 방식' },
    { id: 'group', sectionId: 'constraints', displayOrder: 50, uiType: 'resource-policies', eyebrow: '02 이것만은 꼭', title: '여행 중 잠깐 따로 움직여도 괜찮아요?', description: '일행과 꼭 함께해야 하는 범위를 알려주세요.', required: false, styleOptions: groupOptions, resources: [{ id: 'stay', label: '숙소' }, { id: 'food', label: '식사' }, { id: 'activity', label: '활동 / 티켓' }, { id: 'long-distance', label: '장거리 이동' }, { id: 'local-car', label: '현지 차량' }], policyOptions: [{ id: 'together', label: '같이' }, { id: 'same-place', label: '같은 장소면 분리 OK' }, { id: 'separate', label: '분리 가능' }], settingsLabel: '숙소·식사·예약이 나뉘는 경우 설정', allowSkip: true, nextLabel: '내 여행 스타일 찾기' },
    ...styleQuestions.map((question, index) => ({ ...question, sectionId: 'style', displayOrder: 60 + index * 10, uiType: 'single-choice' as const, eyebrow: '03 나한테 맞는 여행', required: false, autoAdvance: true, allowSkip: true })),
    { id: 'city-intro', sectionId: 'style', displayOrder: 120, uiType: 'transition', eyebrow: 'DESTINATION EDIT', title: city.transition, description: '이제부터는 실제 여행 장면을 고르듯 가볍게 답해 주세요.', required: false, actionLabel: '도시 스타일 둘러보기' },
    { id: 'lodging', sectionId: 'style', displayOrder: 130, uiType: 'single-choice', eyebrow: `03 ${city.name} 스타일`, title: '같은 예산이라면 어디가 더 끌려요?', description: '숙소를 고르는 기준에 가장 가까운 장면을 선택해 주세요.', required: false, options: city.lodging, presentation: 'lodging', autoAdvance: true, allowSkip: true },
    { id: 'city-day', sectionId: 'style', displayOrder: 140, uiType: 'single-choice', eyebrow: `03 ${city.name} 스타일`, title: '내일 하루가 통째로 비었다면?', description: '관광지 이름보다 끌리는 하루의 흐름을 골라보세요.', required: false, options: city.cityDays, presentation: 'city', autoAdvance: true, allowSkip: true },
    { id: 'food-style', sectionId: 'style', displayOrder: 150, uiType: 'single-choice', eyebrow: `03 ${city.name} 스타일`, title: '오늘 저녁 한 끼를 고른다면?', required: false, options: foodStyleOptions, autoAdvance: true, allowSkip: true },
    { id: 'foods', sectionId: 'style', displayOrder: 160, uiType: 'tag-ratings', eyebrow: '03 나한테 맞는 여행', title: '그리고 이런 건 어때요?', description: `${city.name}에서 마음이 가는 음식만 눌러보세요. 건드리지 않은 음식은 답하지 않은 상태로 남아요.`, required: false, items: city.foods, choices: [{ id: 'must', label: '꼭 먹고 싶어요', answer: { rating: 'must', stance: 'positive' } }, { id: 'like', label: '좋아요', answer: { rating: 'like', stance: 'positive' } }, { id: 'okay', label: '괜찮아요', answer: { rating: 'okay', stance: 'neutral' } }, { id: 'avoid', label: '피하고 싶어요', answer: { rating: 'avoid', stance: 'negative' } }, { id: 'unknown', label: '잘 모르겠어요', answer: { stance: 'unknown' } }], allowSkip: true, nextLabel: '동선 고르기' },
    { id: 'movement', sectionId: 'style', displayOrder: 170, uiType: 'single-choice', eyebrow: `03 ${city.name} 스타일`, title: '하루 동선은 어떻게 쓰고 싶어요?', description: '숫자보다 실제 움직임에 가까운 방식을 골라주세요.', required: false, options: movementOptions, presentation: 'route', autoAdvance: true, allowSkip: true },
    { id: 'must-avoid', sectionId: 'finish', displayOrder: 180, uiType: 'tag-groups', eyebrow: '04 마지막 터치', title: `마지막으로, ${city.name}에서 이것만은?`, description: '비워두어도 괜찮고, 각각 최대 두 개만 남길 수 있어요.', required: false, groups: [{ id: 'must-do', label: '꼭 하고 싶어요', limit: 2, suggestions: city.mustDoSuggestions, placeholder: '직접 추가' }, { id: 'avoid', label: '이건 별로예요', limit: 2, suggestions: city.avoidSuggestions, placeholder: '직접 추가' }], noteLabel: '직접 말해주고 싶은 게 있다면', notePlaceholder: '예: 숙소가 조금 멀어도 온천이 있으면 좋아요', allowSkip: true, nextLabel: '내 여행 기준 보기' },
    { id: 'adaptive-lodging', sectionId: 'finish', displayOrder: 190, uiType: 'single-choice', eyebrow: '거의 다 됐어요', title: city.adaptive.reason, description: '비슷한 두 후보를 구분하기 위한 마지막 비교예요.', required: false, presentation: 'comparison', options: [{ id: 'first', label: city.adaptive.first.title, detail: city.adaptive.first.detail }, { id: 'second', label: city.adaptive.second.title, detail: city.adaptive.second.detail }, { id: 'similar', label: '둘 다 비슷해요' }, { id: 'neither', label: '둘 다 별로예요' }], autoAdvance: true, allowSkip: true },
    { id: 'profile-confirmation', sectionId: 'finish', displayOrder: 200, uiType: 'profile-confirmation', eyebrow: '04 마지막 터치', title: '선택한 여행 기준을 확인해 주세요.', description: '답변의 의미를 해석하지 않고 직접 고른 내용만 보여드려요.', required: true, rememberLabel: '다음 여행에도 기억', rememberDescription: '확인한 답변만 다음 여행의 시작점으로 사용해요.', submitLabel: '이 기준으로 여행 맞춰보기' },
  ]

  return {
    schemaVersion: SURVEY_SCHEMA_VERSION,
    planId: `demo-survey-${city.id.toLowerCase()}`,
    revision: 'demo-2026-08-13',
    destinationId: city.id,
    locale: 'ko-KR',
    title: `${city.name} 여행 설문`,
    sections: [
      { id: 'basics', label: '01 여행 기본 설정', shortLabel: '기본 설정', displayOrder: 10 },
      { id: 'constraints', label: '02 이것만은 꼭', shortLabel: '취향 찾기', displayOrder: 20 },
      { id: 'style', label: '03 나한테 맞는 여행', shortLabel: '도시 스타일', displayOrder: 30 },
      { id: 'finish', label: '04 마지막 터치', shortLabel: '완료', displayOrder: 40 },
    ],
    questions,
  }
}

export const mockSurveyPlans: Record<MockCityId, SurveyPlanV4> = {
  'KR-SEL': parseSurveyPlanV4(buildPlan(cityFixtures['KR-SEL'])),
  'KR-PUS': parseSurveyPlanV4(buildPlan(cityFixtures['KR-PUS'])),
  'JP-TYO': parseSurveyPlanV4(buildPlan(cityFixtures['JP-TYO'])),
  'JP-OSA': parseSurveyPlanV4(buildPlan(cityFixtures['JP-OSA'])),
}
