export type MockTravelProviderResponse = {
  trip: {
    id: string
    roomLabel: string
    city: string
    nights: number
    days: number
    startsOn: string
    endsOn: string
    partySize: number
    agreementStatus: string
    coverImageUrl: string
  }
  sources: Record<string, {
    provider: string
    label: string
    trust: 'estimated' | 'verified' | 'estimated' | 'ai-inferred' | 'web-reference'
    checkedAt?: string
    url?: string
  }>
  days: Array<{
    id: string
    label: string
    date: string
    dateIso: string
    title: string
    imageUrl: string
    weather: string
    travelMinutes: number
    estimatedSpendKrw: number
    events: Array<{
      time: string
      title: string
      detail?: string
      transit?: { label: string; minutes: number; fareJpy?: number }
      reason?: {
        title: string
        summary: string
        comparison: Array<[string, string]>
        replayRound: number
      }
    }>
  }>
  bookings: Array<{
    id: string
    category: 'flight' | 'hotel' | 'transit' | 'rail' | 'attraction' | 'restaurant'
    title: string
    detail?: string
    deadline: string
    status: 'booked' | 'action-required' | 'available'
    statusLabel: string
    priceKrw?: number
    availability?: { label: string; checkedAt?: string; sourceKey: string }
    place?: { id: string; name: string; kind: 'hotel' | 'restaurant' | 'attraction'; hours?: string; dietaryNote?: string; sourceKey: string }
    bookingUrl?: string
    sourceKey: string
  }>
  budget: Array<[string, number]>
  routes: Array<{
    id: string
    dayId: string
    dayLabel: string
    title: string
    durationMinutes: number
    transfers: number
    fareJpy: number
    steps: Array<{ place: string; mode?: string; minutes?: number; detail?: string }>
    alternatives: Array<{ label: string; departure: string; arrival: string; minutes: number; fareJpy: number }>
    mapUrl: string
    driving?: { minutes: number; estimatedKrw: number }
    sourceKey: string
  }>
  advisories: Array<{
    id: string
    category: 'weather' | 'dining' | 'ticket' | 'dietary' | 'fx' | 'web'
    label: string
    title: string
    detail: string
    actionLabel?: string
    details?: Array<[string, string]>
    sourceKey: string
  }>
  fairness: {
    status: string
    averageScore: number
    members: Array<[string, number, string]>
    concessions: string[]
    minorityOpinions: string[]
  }
}

const response: MockTravelProviderResponse = {
  trip: {
    id: 'osaka-2410', roomLabel: 'OSAKA · TRIP ROOM', city: '오사카', nights: 3, days: 4,
    startsOn: '10.15', endsOn: '10.18', partySize: 6, agreementStatus: '합의 완료',
    coverImageUrl: 'https://images.unsplash.com/photo-1590559899731-a382839e5549?auto=format&fit=crop&w=1600&q=88',
  },
  sources: {
    flight: { provider: 'mock-flight', label: '항공 운임', trust: 'estimated', checkedAt: '데모 기준' },
    hotel: { provider: 'mock-hotel', label: '숙소 재고', trust: 'estimated', checkedAt: '데모 기준' },
    transit: { provider: 'mock-transit', label: '대중교통', trust: 'verified' },
    maps: { provider: 'mock-maps', label: '지도 경로', trust: 'estimated' },
    attraction: { provider: 'mock-attraction', label: '공식 티켓', trust: 'estimated', checkedAt: '데모 기준' },
    restaurant: { provider: 'mock-restaurant', label: '영업 정보', trust: 'web-reference', url: 'https://example.com/moa/izakaya-b' },
    weather: { provider: 'mock-weather', label: '기상 예보', trust: 'estimated', checkedAt: '데모 기준' },
    dietary: { provider: 'mock-dietary', label: '메뉴 정보 추정', trust: 'ai-inferred' },
    fx: { provider: 'mock-fx', label: '환율', trust: 'estimated', checkedAt: '데모 기준' },
    web: { provider: 'mock-web', label: '웹 참고 정보', trust: 'web-reference', url: 'https://example.com/moa/advisory' },
  },
  days: [
    {
      id: 'day-1', label: 'DAY 1', date: '10.15', dateIso: '2026-10-15', title: '도착과 도톤보리',
      imageUrl: 'https://images.unsplash.com/photo-1590559899731-a382839e5549?auto=format&fit=crop&w=1000&q=85',
      weather: '22°C · 비 30%', travelMinutes: 78, estimatedSpendKrw: 84000,
      events: [
        { time: '14:20', title: '간사이공항 도착', detail: 'KE723', transit: { label: '리무진 버스', minutes: 50, fareJpy: 1800 }, reason: { title: '왜 이 경로예요?', summary: '짐이 있는 6명이 환승 없이 난바까지 이동하는 안을 골랐어요.', comparison: [['환승', '0회'], ['소요 시간', '50분'], ['택시 대비', '-₩16,000 / 인']], replayRound: 1 } },
        { time: '16:00', title: '난바', transit: { label: '도보', minutes: 7 } },
        { time: '17:00', title: '난바 호텔', detail: '체크인 · 예약 필요', reason: { title: '왜 이 숙소예요?', summary: '조금 더 지불하고 여행 내내 이동 시간을 줄이는 쪽으로 합의했어요.', comparison: [['다른 후보보다', '+₩28,000 / 인'], ['대신', '매일 이동시간 -64분'], ['객실', '6명 숙박 가능'], ['예산', '식사 예산 유지 가능']], replayRound: 2 } },
        { time: '19:00', title: '이자카야 B', detail: '조건부 · 갑각류 대응 확인 전 예약 금지', reason: { title: '왜 이 식당이에요?', summary: '로컬 분위기와 단체 예약 가능성을 함께 본 선택이에요.', comparison: [['도보', '숙소에서 8분'], ['단체석', '6인 문의 가능'], ['식이 정보', '매장 확인 필요']], replayRound: 4 } },
        { time: '21:00', title: '도톤보리', detail: '야경 산책' },
      ],
    },
    {
      id: 'day-2', label: 'DAY 2', date: '10.16', dateIso: '2026-10-16', title: '교토의 하루',
      imageUrl: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1000&q=85',
      weather: '19°C · 비 70%', travelMinutes: 116, estimatedSpendKrw: 96000,
      events: [
        { time: '08:40', title: '난바 출발', detail: '지하철 · JR · 버스' },
        { time: '10:10', title: '기요미즈데라', detail: '오전 관람 · 18:00까지' },
        { time: '13:00', title: '니시키 시장', detail: '점심 자유 선택' },
        { time: '15:30', title: '기온', detail: '오래된 골목 산책' },
        { time: '19:30', title: '난바 복귀', detail: '저녁 자유시간' },
      ],
    },
    {
      id: 'day-3', label: 'DAY 3', date: '10.17', dateIso: '2026-10-17', title: 'USJ',
      imageUrl: 'https://images.unsplash.com/photo-1591261730799-ee4e6c2d16d7?auto=format&fit=crop&w=1000&q=85',
      weather: '23°C · 맑음', travelMinutes: 54, estimatedSpendKrw: 154000,
      events: [
        { time: '07:30', title: '난바 출발', detail: 'JR 유메사키선 환승' },
        { time: '08:30', title: '유니버설 스튜디오 재팬', detail: '1일 스튜디오 패스' },
        { time: '19:00', title: '시티워크', detail: '저녁 식사' },
        { time: '21:00', title: '호텔 복귀', detail: '난바 자유시간' },
      ],
    },
    {
      id: 'day-4', label: 'DAY 4', date: '10.18', dateIso: '2026-10-18', title: '카페와 작별',
      imageUrl: 'https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1000&q=85',
      weather: '21°C · 흐림', travelMinutes: 64, estimatedSpendKrw: 52000,
      events: [
        { time: '09:30', title: '난바 카페', detail: '서연 선호 반영' },
        { time: '11:00', title: '호텔 체크아웃', detail: '짐 보관 서비스' },
        { time: '12:00', title: '다코야키 투어', detail: '후보 3곳 중 현장 선택' },
        { time: '15:00', title: '간사이공항 이동', detail: '공항 리무진' },
        { time: '18:10', title: '서울행 출발', detail: 'KE724' },
      ],
    },
  ],
  bookings: [
    { id: 'flight', category: 'flight', title: '대한항공 KE723 / KE724', deadline: '완료', status: 'booked', statusLabel: '예약 완료', priceKrw: 310000, bookingUrl: 'https://example.com/moa/flights', sourceKey: 'flight' },
    { id: 'airport-bus', category: 'transit', title: '공항 리무진', deadline: '완료', status: 'booked', statusLabel: '예약 완료', priceKrw: 34000, bookingUrl: 'https://example.com/moa/bus', sourceKey: 'transit' },
    { id: 'hotel', category: 'hotel', title: '난바 호텔', detail: '객실 있음 · 데모 기준', deadline: '10.01', status: 'action-required', statusLabel: '예약 필요', priceKrw: 210000, availability: { label: '객실 있음', checkedAt: '데모 기준', sourceKey: 'hotel' }, place: { id: 'namba-hotel', name: '난바 호텔', kind: 'hotel', sourceKey: 'hotel' }, bookingUrl: 'https://example.com/moa/hotel', sourceKey: 'hotel' },
    { id: 'restaurant', category: 'restaurant', title: '이자카야 B', detail: '17:00–23:30', deadline: '10.01', status: 'action-required', statusLabel: '안전 확인 필요', place: { id: 'izakaya-b', name: '이자카야 B', kind: 'restaurant', hours: '17:00–23:30', dietaryNote: '갑각류 제외 가능 여부 문의 필요', sourceKey: 'restaurant' }, bookingUrl: 'https://example.com/moa/izakaya-b', sourceKey: 'restaurant' },
    { id: 'usj', category: 'attraction', title: 'USJ', detail: '스튜디오 패스 1일권', deadline: '10.05', status: 'available', statusLabel: '티켓 있음', priceKrw: 84000, availability: { label: '재고 있음', checkedAt: '데모 기준', sourceKey: 'attraction' }, place: { id: 'usj', name: 'USJ', kind: 'attraction', hours: '08:30–21:30', sourceKey: 'attraction' }, bookingUrl: 'https://example.com/moa/usj', sourceKey: 'attraction' },
  ],
  budget: [['항공', 310000], ['숙소', 210000], ['식사', 140000], ['교통', 90000], ['티켓', 80000]],
  routes: [
    { id: 'route-day-1', dayId: 'day-1', dayLabel: 'DAY 1 · 도착', title: '간사이공항에서 난바', durationMinutes: 50, transfers: 0, fareJpy: 1800, steps: [{ place: '간사이공항' }, { place: '공항 리무진', mode: '버스', minutes: 50 }, { place: '난바' }, { place: '난바 호텔', mode: '도보', minutes: 7 }], alternatives: [{ label: '추천', departure: '15:05', arrival: '15:55', minutes: 50, fareJpy: 1800 }, { label: '더 빠르게', departure: '15:14', arrival: '15:52', minutes: 38, fareJpy: 1490 }], mapUrl: 'https://maps.google.com/?q=Namba,Osaka', sourceKey: 'maps' },
    { id: 'route-day-2', dayId: 'day-2', dayLabel: 'DAY 2 · 교토', title: '난바에서 기요미즈데라', durationMinutes: 58, transfers: 2, fareJpy: 1120, steps: [{ place: '난바' }, { place: '오사카역', mode: '지하철', minutes: 8 }, { place: '교토역', mode: 'JR', minutes: 29 }, { place: '기요미즈데라', mode: '버스', minutes: 12 }], alternatives: [{ label: '추천', departure: '09:12', arrival: '10:01', minutes: 49, fareJpy: 820 }, { label: '더 빠르게', departure: '09:20', arrival: '09:58', minutes: 38, fareJpy: 1420 }], mapUrl: 'https://maps.google.com/?q=Kiyomizudera,Kyoto', driving: { minutes: 42, estimatedKrw: 18000 }, sourceKey: 'maps' },
    { id: 'route-day-3', dayId: 'day-3', dayLabel: 'DAY 3 · USJ', title: '난바에서 USJ', durationMinutes: 27, transfers: 1, fareJpy: 390, steps: [{ place: '난바' }, { place: '니시쿠조', mode: 'JR', minutes: 14 }, { place: '유니버설시티', mode: 'JR 유메사키선', minutes: 6 }, { place: 'USJ', mode: '도보', minutes: 5 }], alternatives: [{ label: '추천', departure: '07:42', arrival: '08:09', minutes: 27, fareJpy: 390 }, { label: '덜 걷기', departure: '07:48', arrival: '08:19', minutes: 31, fareJpy: 430 }], mapUrl: 'https://maps.google.com/?q=Universal+Studios+Japan', sourceKey: 'transit' },
    { id: 'route-day-4', dayId: 'day-4', dayLabel: 'DAY 4 · 출국', title: '난바에서 간사이공항', durationMinutes: 50, transfers: 0, fareJpy: 1800, steps: [{ place: '난바' }, { place: '공항 리무진', mode: '버스', minutes: 50 }, { place: '간사이공항 제1터미널' }], alternatives: [{ label: '추천', departure: '15:00', arrival: '15:50', minutes: 50, fareJpy: 1800 }, { label: '더 빠르게', departure: '15:05', arrival: '15:43', minutes: 38, fareJpy: 1490 }], mapUrl: 'https://maps.google.com/?q=Kansai+International+Airport', sourceKey: 'transit' },
  ],
  advisories: [
    { id: 'weather', category: 'weather', label: 'WEATHER', title: 'DAY 2 · 비 가능성 높음', detail: '대체 일정 준비됨', actionLabel: '대체 일정 보기', details: [['대체 일정', '나카노시마 미술관 · 난바 카페'], ['전환 기준', '강수확률 60% 이상']], sourceKey: 'weather' },
    { id: 'dining', category: 'dining', label: 'DINING', title: '이자카야 B · 조건부', detail: '갑각류 대응 확인 전 예약 금지', sourceKey: 'restaurant' },
    { id: 'ticket', category: 'ticket', label: 'TICKET', title: 'USJ', detail: '재고 있음 · 현재 ₩84,000', sourceKey: 'attraction' },
    { id: 'dietary', category: 'dietary', label: 'DIETARY', title: '민지 · 갑각류', detail: 'AI 추정 · 안전 확인 전 예약 불가', actionLabel: '확인 항목 보기', details: [['예약 상태', '안전 확인 전 예약 금지'], ['매장 확인', '교차 오염·조리도구 분리'], ['정보 신뢰', 'AI 추정 · 미확인']], sourceKey: 'dietary' },
    { id: 'fx', category: 'fx', label: 'FX', title: '¥100 ≈ ₩920', detail: '오늘 기준', sourceKey: 'fx' },
    { id: 'web', category: 'web', label: 'WEB ADVISORY', title: '교토 버스 혼잡 안내', detail: '웹 참고 정보', actionLabel: '공식 페이지 확인', sourceKey: 'web' },
  ],
  fairness: {
    status: '모두 합의 완료', averageScore: 7.7,
    members: [['민지', 8.3, '식사 예산 유지'], ['지훈', 7.8, '교통비 절감 반영'], ['서연', 7.6, '자유시간 확보'], ['민재', 8.1, 'USJ 일정 반영'], ['예린', 7.4, '교토 일정 반영'], ['수아', 7.2, '이동 부담 최소화']],
    concessions: ['민지는 숙소 위치를 위해 가격에서 양보했어요.', '민재는 일정 강도를 낮추는 데 동의했어요.'],
    minorityOpinions: ['USJ 대신 여유로운 온천 일정을 선호한 의견이 남아 있어요.'],
  },
}

export const mockTravelProvider = {
  getTripPack: (tripId: string) => response.trip.id === tripId ? response : null,
}
