export type DestinationPack = {
  id: string
  country: '국내' | '일본'
  name: string
  tags: string[]
  image: string
}

export type RoomMember = {
  name: string
  initial: string
  color: string
  pale: string
  status: '초대됨' | '참여함' | '설문 시작' | '설문 완료' | '대리인 확인'
  isHost?: boolean
  score: number
}

export type OsakaPreference = {
  id: string
  name: string
  context: string
  image: string
}

export const destinationPacks: DestinationPack[] = [
  { id: 'gangneung', country: '국내', name: '강릉', tags: ['바다', '카페', '서핑'], image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=85' },
  { id: 'busan', country: '국내', name: '부산', tags: ['해운대', '미식', '야경'], image: 'https://images.unsplash.com/photo-1534274867514-d5b47ef89ed7?auto=format&fit=crop&w=900&q=85' },
  { id: 'jeju', country: '국내', name: '제주', tags: ['오름', '드라이브', '바다'], image: 'https://images.unsplash.com/photo-1535189043414-47a3c49a0bed?auto=format&fit=crop&w=900&q=85' },
  { id: 'seoul', country: '국내', name: '서울', tags: ['전시', '핫플', '미식'], image: 'https://images.unsplash.com/photo-1534274988757-a28bf1a57c17?auto=format&fit=crop&w=900&q=85' },
  { id: 'yeosu', country: '국내', name: '여수', tags: ['밤바다', '해산물', '케이블카'], image: 'https://images.unsplash.com/photo-1494783367193-149034c05e8f?auto=format&fit=crop&w=900&q=85' },
  { id: 'osaka', country: '일본', name: '오사카', tags: ['미식', '도톤보리', '유니버설'], image: 'https://images.unsplash.com/photo-1590559899731-a382839e5549?auto=format&fit=crop&w=900&q=85' },
  { id: 'tokyo', country: '일본', name: '도쿄', tags: ['트렌드', '쇼핑', '도시'], image: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=900&q=85' },
  { id: 'kyoto', country: '일본', name: '교토', tags: ['사찰', '정원', '전통'], image: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=900&q=85' },
  { id: 'fukuoka', country: '일본', name: '후쿠오카', tags: ['라멘', '근교', '온천'], image: '/assets/fukuoka.webp' },
  { id: 'sapporo', country: '일본', name: '삿포로', tags: ['설경', '맥주', '해산물'], image: 'https://images.unsplash.com/photo-1517299321609-52687d1bc55a?auto=format&fit=crop&w=900&q=85' },
  { id: 'osaka-kyoto', country: '일본', name: '오사카 + 교토', tags: ['미식', '전통', '두 도시'], image: 'https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=900&q=85' },
]

export const roomMembers: RoomMember[] = [
  { name: '민지', initial: '민', color: '#F2714B', pale: '#FCE0D5', status: '대리인 확인', isHost: true, score: 8.3 },
  { name: '지훈', initial: '지', color: '#4D8CA8', pale: '#D9EAF1', status: '대리인 확인', score: 7.8 },
  { name: '서연', initial: '서', color: '#6C9E79', pale: '#DCEBDD', status: '설문 시작', score: 7.6 },
  { name: '민재', initial: '민', color: '#8B78B8', pale: '#E8E0F2', status: '대리인 확인', score: 8.1 },
  { name: '예린', initial: '예', color: '#D99B3D', pale: '#F8E9C8', status: '대리인 확인', score: 7.4 },
  { name: '수아', initial: '수', color: '#B66F84', pale: '#F2DEE4', status: '참여함', score: 7.2 },
]

export const preferenceSliders = [
  { id: 'pace', title: '여행 페이스', left: '느긋하게', right: '빡빡하게' },
  { id: 'planning', title: '계획 스타일', left: '즉흥적으로', right: '미리 꼼꼼하게' },
  { id: 'accommodation-spend', title: '돈을 쓴다면', left: '숙소는 아끼기', right: '숙소에 투자하기' },
  { id: 'atmosphere', title: '여행 분위기', left: '자연 · 풍경', right: '도심 · 쇼핑' },
  { id: 'place-style', title: '장소 취향', left: '역사 · 박물관', right: '트렌디 · 핫플' },
  { id: 'food-style', title: '맛집 선택', left: '로컬 음식 도전', right: '검증된 맛집' },
  { id: 'togetherness', title: '함께하는 정도', left: '항상 같이', right: '자유시간 필요' },
  { id: 'daily-rhythm', title: '생활 리듬', left: '새벽형', right: '늦잠형' },
  { id: 'evening-style', title: '저녁 시간', left: '나이트라이프', right: '저녁 휴식' },
  { id: 'transport-style', title: '이동 방식', left: '택시 편하게', right: '대중교통 절약' },
  { id: 'photo-priority', title: '여행 사진', left: '인생샷 중요', right: '사진 관심 없음' },
  { id: 'activity-level', title: '활동 강도', left: '모험 · 액티비티', right: '안전 · 무난' },
] as const

const osakaImages = [
  'https://images.unsplash.com/photo-1590559899731-a382839e5549?auto=format&fit=crop&w=1200&q=85',
  'https://images.unsplash.com/photo-1589452271712-64b8a66c7b71?auto=format&fit=crop&w=1200&q=85',
  'https://images.unsplash.com/photo-1554797589-7241bb691973?auto=format&fit=crop&w=1200&q=85',
  'https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=85',
  'https://images.unsplash.com/photo-1542051841857-5f90071e7989?auto=format&fit=crop&w=1200&q=85',
]

export const osakaPreferences: OsakaPreference[] = [
  ['도톤보리 야경', '네온사인 아래에서 오사카의 밤 즐기기'],
  ['유니버설 스튜디오', '하루를 온전히 테마파크에서 보내기'],
  ['구로몬 시장', '아침부터 길거리 음식과 해산물 맛보기'],
  ['오사카성', '천수각과 공원을 천천히 둘러보기'],
  ['신세카이', '레트로 골목에서 쿠시카츠 먹기'],
  ['우메다 스카이빌딩', '해 질 무렵 오사카 전경 감상하기'],
  ['로컬 이자카야', '작은 선술집에서 현지 메뉴 도전하기'],
  ['스시 오마카세', '한 끼는 제대로 된 미식에 투자하기'],
  ['덴덴타운', '게임과 애니메이션 숍 구경하기'],
  ['신사이바시 쇼핑', '브랜드와 편집숍을 넉넉하게 둘러보기'],
  ['스파월드 온천', '여행 중 하루쯤 온천에서 느긋하게 쉬기'],
  ['교토 당일치기', '기온과 사찰을 하루 동안 둘러보기'],
  ['가이유칸 수족관', '세계적인 규모의 수족관 관람하기'],
  ['아메무라 빈티지', '개성 있는 빈티지 숍 탐색하기'],
  ['나카노시마 미술관', '비 오는 날에도 여유롭게 전시 보기'],
  ['다코야키 투어', '유명 가게 세 곳을 비교하며 맛보기'],
  ['난바 카페 탐방', '일정 사이 감각적인 카페에서 쉬기'],
  ['도톤보리 크루즈', '강 위에서 야경과 네온사인 감상하기'],
  ['한큐 백화점', '식품관과 일본 브랜드 쇼핑하기'],
  ['오사카 야구 관람', '현지 팬들과 경기 분위기 즐기기'],
].map(([name, context], index) => ({ id: `osaka-activity-${index + 1}`, name: String(name), context: String(context), image: osakaImages[index % osakaImages.length] }))

export const meetingRounds = [
  { code: 'R0', name: '여행 방향', state: '완료' },
  { code: 'R1', name: '교통', state: '완료' },
  { code: 'R2', name: '숙소', state: '논의 중' },
  { code: 'R3', name: '액티비티', state: '대기' },
  { code: 'R4', name: '식사', state: '대기' },
  { code: 'R5', name: '동선', state: '대기' },
  { code: 'R6', name: '예산', state: '대기' },
]

export const itineraryDays = [
  { day: 'DAY 1', title: '도착과 도톤보리', walk: '3.2km', travel: '78분', items: [['14:20', '간사이공항 도착', 'KE723'], ['16:00', '난바 이동', '라피트 특급 · ¥1,490'], ['17:00', '난바 호텔 체크인', 'H-03 · 3박'], ['19:00', '이자카야 B', '예약 필요 · 10/1까지'], ['21:00', '도톤보리 야경 산책', '자유롭게 1시간']] },
  { day: 'DAY 2', title: '시장과 온천의 하루', walk: '4.0km', travel: '42분', items: [['09:30', '구로몬 시장', '아침 겸 먹거리 투어'], ['12:30', '오사카성 공원', '천수각은 선택 관람'], ['15:30', '스파월드 온천', '지훈 최우선 취향 반영'], ['19:00', '신세카이 쿠시카츠', '웨이팅 약 20분']] },
  { day: 'DAY 3', title: '교토의 오래된 골목', walk: '5.1km', travel: '96분', items: [['08:30', '교토 이동', '한큐선 · ¥410'], ['10:00', '기요미즈데라', '오전 혼잡 피하기'], ['13:00', '니시키 시장', '점심 자유 선택'], ['15:30', '기온 산책', '짐은 호텔 보관'], ['19:30', '난바 복귀', '저녁 자유시간']] },
  { day: 'DAY 4', title: '카페와 아쉬운 작별', walk: '2.4km', travel: '64분', items: [['09:30', '난바 카페', '서연 선호 반영'], ['11:00', '체크아웃', '짐 보관 서비스'], ['12:00', '다코야키 투어', '후보 3곳 중 현장 선택'], ['15:00', '간사이공항 이동', '라피트 특급'], ['18:10', '서울행 출발', 'KE724']] },
]

export const replayMessages = [
  { round: 0, type: 'agent', speaker: '민지의 대리인', text: '숙소보다 음식과 경험에 예산을 조금 더 쓰고 싶어요.' },
  { round: 0, type: 'agent', speaker: '수아의 대리인', text: '일정이 너무 빡빡하거나 숙소를 옮기는 계획은 피하고 싶어요.' },
  { round: 0, type: 'conflict', speaker: '여기서 의견이 갈렸어요', text: '민지는 경험에, 서연은 숙소 위치와 품질에 돈을 더 쓰고 싶어 해요.' },
  { round: 1, type: 'fact', speaker: '교통 심판', text: '6명이 움직일 때는 라피트 패스가 택시를 나눠 타는 것보다 1인당 약 2만 원 저렴해요.' },
  { round: 1, type: 'verdict', speaker: '교통 심판의 결론', text: '공항에서는 라피트 특급, 시내에서는 대중교통을 타기로 했어요.' },
  { round: 2, type: 'agent', speaker: '민지의 대리인', text: '숙소보다 맛집에 더 쓰고 싶어요.' },
  { round: 2, type: 'agent', speaker: '서연의 대리인', text: '저는 위치가 더 중요해요.' },
  { round: 2, type: 'agent', speaker: '지훈의 대리인', text: '저도 위치는 포기하기 어려워요.' },
  { round: 2, type: 'conflict', speaker: '여기서 의견이 갈렸어요', text: '서연은 좋은 위치를, 민지는 숙소비를 아끼는 쪽을 더 중요하게 봐요.' },
  { round: 2, type: 'fact', speaker: '숙소 심판', text: 'H-03은 6명이 함께 묵을 수 있고, 난바역에서 걸어서 7분이에요. 총 숙박비는 126만 원이에요.' },
  { round: 2, type: 'agent', speaker: '민지의 대리인', text: '7분이면 괜찮네요. 대신 식사 예산은 줄이지 않았으면 좋겠어요.' },
  { round: 2, type: 'agent', speaker: '서연의 대리인', text: '그럼 H-03으로 괜찮아요.' },
  { round: 2, type: 'verdict', speaker: '숙소 심판의 결론', text: '숙소는 옮기지 않고 난바 H-03에서 3박하기로 했어요.' },
  { round: 2, type: 'chief', speaker: 'Chief가 다시 봤어요', text: '수아가 진짜 안 된다고 한 숙소 이동과 모두의 예산을 다시 확인했어요. 결론은 그대로예요.' },
  { round: 3, type: 'agent', speaker: '민재의 대리인', text: '여행 중 강한 액티비티가 하나는 꼭 필요해요. 유니버설도 고려해 주세요.' },
  { round: 3, type: 'fact', speaker: '액티비티 심판', text: '유니버설은 3명에게는 좋지만, 수아와 지훈이 원하는 느긋한 속도와는 많이 달라요.' },
  { round: 3, type: 'verdict', speaker: '액티비티 심판의 결론', text: '유니버설 대신 스파월드와 교토 당일치기를 넣기로 했어요.' },
  { round: 4, type: 'verdict', speaker: '식사 심판의 결론', text: '민지와 예린의 맛집 취향, 지훈의 이자카야 취향을 함께 챙겨 이자카야 B로 정했어요.' },
  { round: 5, type: 'chief', speaker: 'Chief가 다시 봤어요', text: '숙소는 옮기지 않고, 난바에서 오가는 동선으로 바꿨어요. 자유시간도 한 번 더 넣었어요.' },
  { round: 6, type: 'fact', speaker: '예산 심판', text: '예상 비용은 1인 78만 원이에요. 누구의 최대 예산도 넘지 않아요.' },
  { round: 6, type: 'verdict', speaker: '마지막 결론', text: '평균 7.7점, 가장 낮은 점수도 7.2점이에요. 이 계획으로 가기로 했어요.' },
]

export type ReservationItem = {
  id: string
  type: '항공' | '숙소' | '식당' | '티켓'
  name: string
  price: string
  status: '완료' | '예약 필요' | '현장 구매'
  verification: '확인 완료' | '확인 필요'
  deadline: string
  owner: string
  externalUrl: string
}

export const reservations: ReservationItem[] = [
  { id:'flight', type:'항공', name:'대한항공 KE723 / KE724', price:'₩310,000', status:'완료', verification:'확인 완료', deadline:'예약 완료', owner:'민지', externalUrl:'https://example.com/moa/flights' },
  { id:'hotel', type:'숙소', name:'난바 호텔 H-03', price:'₩210,000', status:'예약 필요', verification:'확인 완료', deadline:'10월 1일까지', owner:'서연', externalUrl:'https://example.com/moa/hotel-h03' },
  { id:'restaurant', type:'식당', name:'이자카야 B', price:'약 ₩38,000', status:'예약 필요', verification:'확인 필요', deadline:'10월 1일까지', owner:'지훈', externalUrl:'https://example.com/moa/izakaya-b' },
  { id:'ticket', type:'티켓', name:'스파월드 온천', price:'약 ₩18,000', status:'현장 구매', verification:'확인 완료', deadline:'출발 전 확인', owner:'예린', externalUrl:'https://example.com/moa/spaworld' },
]

export const bookingChecklistItems = [
  { id:'book-flight', label:'항공권 예약', reservationId:'flight', defaultDone:true },
  { id:'book-hotel', label:'난바 호텔 예약', reservationId:'hotel', defaultDone:false },
  { id:'book-restaurant', label:'이자카야 B 예약', reservationId:'restaurant', defaultDone:false },
  { id:'buy-ticket', label:'스파월드 티켓 확인', reservationId:'ticket', defaultDone:false },
  { id:'confirm-allergy', label:'갑각류 알레르기 대응 확인', reservationId:'restaurant', defaultDone:false },
] as const

export const budget = [
  ['항공', 310000], ['숙소', 210000], ['식비', 140000], ['교통', 60000], ['액티비티', 60000], ['예비비', 50000],
]

export const planReadiness = {
  state: 'VERIFIED' as const,
  label: '확인 완료',
  explanation: '핵심 조건과 일정, 주요 예약 정보를 확인했어요.',
}

export type MockTrip = {
  id: string
  destination: string
  dates: string
  memberCount: number
  readyCount: number
  status: '계획 완료' | '취향 받는 중'
  stage: 'result' | 'lobby'
  image: string
}

export const mockTrips: MockTrip[] = [
  { id:'osaka-2410', destination:'오사카', dates:'10.15 — 10.18', memberCount:6, readyCount:6, status:'계획 완료', stage:'result', image:destinationPacks.find((item) => item.id === 'osaka')!.image },
  { id:'tokyo-2501', destination:'도쿄', dates:'날짜 조율 중', memberCount:5, readyCount:3, status:'취향 받는 중', stage:'lobby', image:destinationPacks.find((item) => item.id === 'tokyo')!.image },
]

export type DateResolutionOption = {
  id: string
  label: string
  dates?: string
  attendance?: string
  unavailableMember?: string
  change: string
  recommended?: boolean
  action: 'select' | 'extend'
}

export const mockDateResolution = {
  status: 'NO_FULL_OVERLAP' as const,
  summary: '현재 답변으로는 전원이 가능한 날짜가 없어요.',
  options: [
    { id:'attendance', label:'OPTION A', dates:'10월 15일 — 18일', attendance:'5 / 6명 가능', unavailableMember:'지훈 참석 어려움', change:'가장 많은 인원이 가능한 일정', recommended:true, action:'select' as const },
    { id:'shorter', label:'OPTION B', dates:'11월 5일 — 7일', attendance:'6 / 6명 가능', change:'3박에서 2박으로 줄인 일정', action:'select' as const },
    { id:'deadline', label:'OPTION C', change:'친구들이 가능 날짜를 다시 입력할 수 있게 마감 시간을 늘려요.', action:'extend' as const },
  ],
}

export type DecisionCandidate = {
  id: string
  name: string
  price: string
  detail: string
  groupFit: number
}

export type DecisionRound = {
  id: 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6'
  name: string
  summary: string
  candidates: DecisionCandidate[]
  positions: string[]
  factCheck: string
  winnerId: string
  runnerUpId: string
  reasons: string[]
  minimumSatisfaction: number
  constraints: string[]
  uncertainty?: string
}

export const decisionRounds: DecisionRound[] = [
  { id:'R0', name:'날짜 · 여행 방향', summary:'가장 많은 인원이 함께하고 3박을 유지하는 안을 비교했어요.', candidates:[{id:'D-01',name:'10월 15일 — 18일',price:'3박 4일',detail:'6명 모두 가능',groupFit:8.4},{id:'D-02',name:'11월 5일 — 7일',price:'2박 3일',detail:'일정은 짧지만 휴가 부담이 적음',groupFit:7.6}], positions:['민지 · 예린: 3박 유지','지훈 · 수아: 휴가 최소화'], factCheck:'최종 응답 기준으로 D-01은 전원 참석과 3박 조건을 함께 충족해요.', winnerId:'D-01',runnerUpId:'D-02',reasons:['전원이 참석할 수 있어요.','선호한 3박 일정을 유지해요.','항공 가격도 예산 범위예요.'],minimumSatisfaction:7.3,constraints:['전원 참석','최소 2박'],uncertainty:'항공 가격은 예약 시 달라질 수 있어요.' },
  { id:'R1', name:'교통', summary:'공항 이동과 시내 이동을 비용·시간으로 비교했어요.', candidates:[{id:'T-01',name:'라피트 + 대중교통',price:'₩60,000 / 인',detail:'공항 38분 · 시내 이동 안정적',groupFit:8.1},{id:'T-02',name:'택시 분할 이용',price:'₩82,000 / 인',detail:'짐 이동 편함 · 교통 상황 영향',groupFit:7.4}],positions:['지훈: 비용 우선','서연 · 수아: 짐 이동 편의'],factCheck:'6명이 이동하면 라피트 조합이 1인당 약 2만 원 저렴해요.',winnerId:'T-01',runnerUpId:'T-02',reasons:['전체 교통 예산을 지켜요.','공항 이동시간 변동이 적어요.','난바 숙소와 바로 연결돼요.'],minimumSatisfaction:7.2,constraints:['총예산 상한'],uncertainty:'막차 시간은 출발 전에 다시 확인해야 해요.'},
  { id:'R2', name:'숙소', summary:'위치와 가격이 다른 난바 숙소 두 곳을 비교했어요.',candidates:[{id:'H-03',name:'난바 호텔 H-03',price:'₩210,000 / 인',detail:'난바역 7분 · 6인 가능',groupFit:8.2},{id:'H-07',name:'난바 호텔 H-07',price:'₩180,000 / 인',detail:'난바역 15분 · 6인 가능',groupFit:7.6}],positions:['민지 · 예린: 식사 예산 우선','서연 · 지훈 · 수아: 숙소 위치 우선'],factCheck:'두 곳 모두 예산 안이지만 H-03은 매일 이동시간을 총 64분 줄여요.',winnerId:'H-03',runnerUpId:'H-07',reasons:['최저 만족도가 더 높아요.','야간 일정 후 이동이 편해요.','모두의 예산 안이에요.'],minimumSatisfaction:7.4,constraints:['6인 숙박','도미토리 제외','숙소 이동 없음'],uncertainty:'무료 취소 기한은 예약 페이지에서 확인해야 해요.'},
  { id:'R3', name:'액티비티', summary:'강한 체험과 느긋한 휴식을 함께 넣을 방법을 비교했어요.',candidates:[{id:'A-02',name:'스파월드 + 교토',price:'₩52,000 / 인',detail:'휴식과 문화 일정 조합',groupFit:8.0},{id:'A-05',name:'유니버설 스튜디오',price:'₩89,000 / 인',detail:'하루 종일 테마파크',groupFit:7.1}],positions:['민재 · 예린: 유니버설','수아 · 지훈: 느긋한 일정'],factCheck:'유니버설은 두 명의 체력 선호와 예산 여유를 크게 낮춰요.',winnerId:'A-02',runnerUpId:'A-05',reasons:['활동 강도 차이를 줄여요.','예산 여유가 남아요.','문화와 휴식을 모두 반영해요.'],minimumSatisfaction:7.2,constraints:['장시간 대기 최소화'],uncertainty:'스파월드 운영시간은 방문 전 확인해야 해요.'},
  { id:'R4', name:'식사', summary:'현지 분위기와 알레르기 대응 가능성을 함께 비교했어요.',candidates:[{id:'F-02',name:'이자카야 B',price:'₩38,000 / 인',detail:'6인석 문의 가능 · 해산물 제외 메뉴',groupFit:8.3},{id:'F-06',name:'오마카세 C',price:'₩82,000 / 인',detail:'예약금 필요 · 메뉴 변경 제한',groupFit:7.0}],positions:['민지 · 예린: 로컬 음식','수아: 알레르기 대응 우선'],factCheck:'이자카야 B는 갑각류 제외 주문이 가능하지만 6인석은 아직 미확정이에요.',winnerId:'F-02',runnerUpId:'F-06',reasons:['음식 취향을 가장 넓게 반영해요.','예산을 지켜요.','알레르기 대응 문의가 가능해요.'],minimumSatisfaction:7.5,constraints:['갑각류 제외'],uncertainty:'6인 예약 가능 여부를 직접 확인해야 해요.'},
  { id:'R5', name:'동선', summary:'숙소를 옮길지 난바에서 매일 이동할지 비교했어요.',candidates:[{id:'S-01',name:'난바 중심 방사형',price:'이동 280분',detail:'한 숙소 유지 · 짐 이동 없음',groupFit:8.1},{id:'S-04',name:'오사카 + 교토 숙소 이동',price:'이동 238분',detail:'이동은 짧지만 체크인 2회',groupFit:7.2}],positions:['수아: 숙소 이동 불가','민재: 교토 체류 선호'],factCheck:'숙소를 옮기면 이동은 42분 줄지만 짐 이동과 체크인이 추가돼요.',winnerId:'S-01',runnerUpId:'S-04',reasons:['숙소 이동 불가 조건을 지켜요.','짐 보관이 쉬워요.','자유시간을 유지할 수 있어요.'],minimumSatisfaction:7.3,constraints:['숙소 이동 없음'],uncertainty:'교토 당일 교통 혼잡에 따라 복귀 시간이 달라질 수 있어요.'},
  { id:'R6', name:'예산', summary:'앞선 결정을 모두 합쳐 개인별 최대 예산과 비교했어요.',candidates:[{id:'B-01',name:'현재 계획',price:'₩830,000 / 인',detail:'식사 예산 유지 · 예비비 5만원 포함',groupFit:8.0},{id:'B-03',name:'절약 계획',price:'₩762,000 / 인',detail:'숙소·식사 등급 조정 · 예비비 포함',groupFit:7.3}],positions:['민지: 식사 예산 유지','지훈: 총액 절감'],factCheck:'예비비를 포함한 현재 계획도 전원의 예산 상한 아래이고 최저 만족도도 7점 이상이에요.',winnerId:'B-01',runnerUpId:'B-03',reasons:['모든 개인 예산을 지켜요.','핵심 식사 경험을 유지해요.','가격 변동용 예비비를 남겨요.'],minimumSatisfaction:7.2,constraints:['개인별 예산 상한'],uncertainty:'항공·숙소 가격은 실제 예약 시 바뀔 수 있어요.'},
]
