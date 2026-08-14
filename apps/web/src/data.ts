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

export const replayEpisodes = [
  { redCorner: '여유 · 휴식', blueCorner: '경험 · 방문', conversation: [{ side: 'red', speaker: '민지의 대리인', text: '일정을 너무 빡빡하게 잡고 싶지 않아요.' }, { side: 'blue', speaker: '서연의 대리인', text: '짧아도 오사카를 많이 보고 싶어요.' }, { side: 'red', speaker: '지훈의 대리인', text: '저도 하루에 여유가 있었으면 해요.' }, { side: 'blue', speaker: '예린의 대리인', text: '핵심 장소는 놓치고 싶지 않아요.' }, { side: 'red', speaker: '수아의 대리인', text: '자유시간은 꼭 남겨주세요.' }] as const, score: '3 : 2', factTitle: '하루 3곳 일정', facts: ['평균 이동 54분', '자유시간 90분', '6명 모두 가능'], compromise: ['이 정도 여유면 괜찮아요.', '좋아요. 핵심 장소는 지켜주세요.'], resultTitle: '하루 3곳 일정', resultCopy: '핵심 장소는 챙기되\n매일 자유시간을 남기기로 했어요.', concession: '지훈이 방문 수에서 한 번 양보했어요.' },
  { redCorner: '택시 · 편의', blueCorner: '패스 · 예산', conversation: [{ side: 'red', speaker: '민지의 대리인', text: '공항에서는 편하게 택시를 타고 싶어요.' }, { side: 'blue', speaker: '서연의 대리인', text: '교통비는 최대한 아끼고 싶어요.' }, { side: 'blue', speaker: '지훈의 대리인', text: '저도 예산을 아끼는 쪽이 좋아요.' }, { side: 'red', speaker: '예린의 대리인', text: '짐이 많아서 환승은 부담스러워요.' }, { side: 'blue', speaker: '수아의 대리인', text: '빠른 열차면 충분히 편할 것 같아요.' }] as const, score: '2 : 4', factTitle: '라피트 특급', facts: ['택시보다 -20,000원 / 인', '난바까지 38분', '6명 좌석 가능'], compromise: ['38분이면 충분히 편하네요.', '시내에서는 패스를 쓰면 좋아요.'], resultTitle: '라피트 + 대중교통', resultCopy: '공항에서는 라피트를 타고\n시내에서는 대중교통을 쓰기로 했어요.', concession: '민재가 이동 편의에서 한 번 양보했어요.' },
  { redCorner: '맛집 · 경험', blueCorner: '위치 · 이동', conversation: [{ side: 'red', speaker: '민지의 대리인', text: '맛집에 더 쓰고 싶어요.' }, { side: 'blue', speaker: '서연의 대리인', text: '이동시간은 줄이고 싶어요.' }, { side: 'blue', speaker: '지훈의 대리인', text: '저도 위치는 포기하기 어려워요.' }, { side: 'red', speaker: '예린의 대리인', text: '여행에서는 먹는 경험이 더 중요해요.' }, { side: 'blue', speaker: '수아의 대리인', text: '매일 멀리 이동하는 건 힘들 것 같아요.' }] as const, score: '2 : 3', factTitle: '난바역 3분 호텔', facts: ['+28,000원 / 인', '이동시간 -64분', '6인 가능'], compromise: ['7분이면 괜찮네요.\n대신 식사 예산은 유지했으면 좋겠어요.', '좋아요.'], resultTitle: '난바역 3분 호텔', resultCopy: '숙소 위치를 우선하되\n식사 예산은 유지하기로 했어요.', concession: '민지가 이번 라운드에서 한 번 양보했어요.' },
  { redCorner: '강한 경험', blueCorner: '느긋한 일정', conversation: [{ side: 'red', speaker: '민지의 대리인', text: '강한 액티비티가 하나는 꼭 필요해요.' }, { side: 'blue', speaker: '서연의 대리인', text: '하루 종일 줄 서는 건 피하고 싶어요.' }, { side: 'blue', speaker: '지훈의 대리인', text: '저도 이동이 너무 많으면 힘들어요.' }, { side: 'red', speaker: '예린의 대리인', text: '기억에 남을 경험은 하나 넣어요.' }, { side: 'blue', speaker: '수아의 대리인', text: '쉬는 시간도 충분히 필요해요.' }] as const, score: '2 : 3', factTitle: '스파월드 + 교토', facts: ['대기시간 -110분', '만족 조건 5명 충족', '예산 범위 내'], compromise: ['스파월드가 있으면 괜찮아요.', '교토 일정도 여유 있게 가요.'], resultTitle: '스파월드 + 교토', resultCopy: '강한 경험 하나를 남기고\n나머지는 느긋하게 구성했어요.', concession: '민재가 유니버설에서 한 번 양보했어요.' },
  { redCorner: '로컬 맛집', blueCorner: '검증 · 예약', conversation: [{ side: 'red', speaker: '민지의 대리인', text: '현지인 맛집을 꼭 가보고 싶어요.' }, { side: 'blue', speaker: '서연의 대리인', text: '6명이 바로 앉을 수 있어야 해요.' }, { side: 'blue', speaker: '지훈의 대리인', text: '웨이팅이 짧은 곳이면 좋겠어요.' }, { side: 'red', speaker: '예린의 대리인', text: '관광객 식당은 피하고 싶어요.' }, { side: 'blue', speaker: '수아의 대리인', text: '예약 가능한 곳이 안전해요.' }] as const, score: '3 : 2', factTitle: '이자카야 B', facts: ['6인 예약 가능', '1인 ₩32,000', '숙소 도보 8분'], compromise: ['예약할 수 있으면 좋아요.', '도보 8분도 괜찮아요.'], resultTitle: '이자카야 B', resultCopy: '로컬 분위기는 살리고\n6인 예약 가능한 곳으로 정했어요.', concession: '서연이 식당 분위기에서 한 번 양보했어요.' },
  { redCorner: '많이 보기', blueCorner: '이동 최소', conversation: [{ side: 'red', speaker: '민지의 대리인', text: '교토까지 하루에 같이 보고 싶어요.' }, { side: 'blue', speaker: '서연의 대리인', text: '숙소를 옮기는 일정은 싫어요.' }, { side: 'blue', speaker: '지훈의 대리인', text: '저도 짐을 다시 싸는 건 싫어요.' }, { side: 'red', speaker: '예린의 대리인', text: '온 김에 최대한 많이 보고 싶어요.' }, { side: 'blue', speaker: '수아의 대리인', text: '한 숙소에서 이동하는 게 편해요.' }] as const, score: '2 : 4', factTitle: '난바 고정 동선', facts: ['숙소 이동 0회', '짐 보관 가능', '총 이동 -42분'], compromise: ['숙소를 안 옮기면 괜찮아요.', '자유시간도 남겨주세요.'], resultTitle: '난바 숙소 유지', resultCopy: '난바에서 오가는 동선으로 바꾸고\n자유시간을 한 번 더 넣었어요.', concession: '예린이 방문 수에서 한 번 양보했어요.' },
  { redCorner: '경험 예산', blueCorner: '전체 절약', conversation: [{ side: 'red', speaker: '민지의 대리인', text: '먹고 즐기는 예산은 지키고 싶어요.' }, { side: 'blue', speaker: '서연의 대리인', text: '1인 80만원은 넘기기 어려워요.' }, { side: 'blue', speaker: '지훈의 대리인', text: '예비비도 조금은 남겨두고 싶어요.' }, { side: 'red', speaker: '예린의 대리인', text: '기억에 남는 경험은 포기하지 말아요.' }, { side: 'blue', speaker: '수아의 대리인', text: '공동경비까지 포함해서 계산해요.' }] as const, score: '3 : 3', factTitle: '1인 예상 ₩780,000', facts: ['전원 최대 예산 충족', '공동경비 포함', '예비비 ₩40,000'], compromise: ['식사 예산이 유지되면 좋아요.', '80만원 아래면 괜찮아요.'], resultTitle: '1인 ₩780,000', resultCopy: '모두의 최대 예산 안에서\n식사와 경험 예산을 지켰어요.', concession: '전원이 한 가지씩 조정했어요.' },
] as const

export type ReplayEpisode = typeof replayEpisodes[number]

export const replaySceneDurations = [2400, 4200, 11000, 7200, 5600, 5600, 2800]

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
