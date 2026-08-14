import type {
  DecisionSummary,
  DestinationPack,
  EvidenceSummary,
  Participant,
  PlanB,
  ProductResult,
  ReopenOption,
  RerunDiff,
  RerunImpact,
  SourceView,
  TripPace,
} from './types'

/** Frontend-only demo fixtures. These are normalized view models, not server responses or live travel facts. */
export const featuredDestinations: DestinationPack[] = [
  { id:'seoul', country:'한국', name:'서울', tags:['전시','동네','미식'], image:'https://images.unsplash.com/photo-1534274988757-a28bf1a57c17?auto=format&fit=crop&w=900&q=85' },
  { id:'busan', country:'한국', name:'부산', tags:['해운대','시장','야경'], image:'https://images.unsplash.com/photo-1534274867514-d5b47ef89ed7?auto=format&fit=crop&w=900&q=85' },
  { id:'tokyo', country:'일본', name:'도쿄', tags:['트렌드','문화','동네'], image:'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=900&q=85' },
  { id:'osaka', country:'일본', name:'오사카', tags:['미식','도톤보리','온천'], image:'https://images.unsplash.com/photo-1590559899731-a382839e5549?auto=format&fit=crop&w=900&q=85' },
]

export const tripPaces: TripPace[] = [
  { coreAnchorsPerDay:1, label:'여유롭게', detail:'쉬는 시간을 넉넉하게' },
  { coreAnchorsPerDay:2, label:'균형 있게', detail:'관광과 휴식의 균형' },
  { coreAnchorsPerDay:3, label:'알차게', detail:'보고 싶은 곳을 적극적으로' },
]

export const demoParticipants: Participant[] = [
  { id:'felicia', name:'Felicia', initial:'F', isHost:true, state:'in-progress', stateLabel:'입력 중', availabilityConfirmed:false, preferencesRepresented:false },
  { id:'minji', name:'민지', initial:'민', state:'complete', stateLabel:'입력 완료', availabilityConfirmed:true, preferencesRepresented:true },
  { id:'hyunwoo', name:'현우', initial:'현', state:'in-progress', stateLabel:'입력 중', availabilityConfirmed:true, preferencesRepresented:false },
  { id:'jenny', name:'Jenny', initial:'J', state:'incomplete', stateLabel:'입력 미완료', availabilityConfirmed:false, preferencesRepresented:false },
  { id:'seoyeon', name:'서연', initial:'서', state:'complete', stateLabel:'입력 완료', availabilityConfirmed:true, preferencesRepresented:true },
]

const officialSource: SourceView = { label:'공식 페이지', sourceType:'official', checkedAt:'오늘 05:40' }
const bookingSource: SourceView = { label:'예약처 조회', sourceType:'provider', checkedAt:'8분 전' }
const mapSource: SourceView = { label:'지도 경로 정보', sourceType:'provider', checkedAt:'12분 전' }
const advisorySource: SourceView = { label:'추가 참고 정보', sourceType:'web', checkedAt:'3일 전' }

const evidence = (
  id: string,
  label: string,
  value: string,
  state: EvidenceSummary['state'],
  stateLabel: string,
  checkedLabel: string,
  source?: SourceView,
  uncertainty?: string,
): EvidenceSummary => ({ id, label, value, state, stateLabel, checkedLabel, source, uncertainty })

const flightEvidence = evidence('flight-live','항공 운임','₩328,000','live','실시간','8분 전 확인',bookingSource)
const hotelEvidence = evidence('hotel-live','객실 요금','¥15,200 / 박','live','실시간','12분 전 확인',bookingSource)
const activityHoursEvidence = evidence('activity-hours','영업시간','17:00–22:30','verified','확인됨','오늘 확인',officialSource)
const allergyUnknownEvidence = evidence('allergy-unknown','갑각류 대응','정보 없음','unknown','확인 필요','예약 전 직접 확인',officialSource,'교차 오염과 조리 도구 분리 여부를 매장에 직접 확인해야 합니다.')
const staleDiningHoursEvidence = evidence('dining-hours-stale','영업시간','11:30–22:00','stale','오래된 정보','3일 전 확인',advisorySource,'임시 휴무와 마지막 주문 시간을 다시 확인해야 합니다.')
const routeEvidence = evidence('route-estimate','이동 시간','32분','estimated','추정','12분 전 경로 기준',mapSource)
const trainEvidence = evidence('train-verified','열차 운행','JR 신쾌속','verified','확인됨','오늘 확인',officialSource)

export const demoDecisions: DecisionSummary[] = [
  {
    id:'transport-inbound', category:'transport', categoryLabel:'오는 길·가는 길', title:'대한항공 KE721', location:'인천 → 간사이', detail:'출발 시간이 모두의 가능 범위에 들어오는 직항', summaryReason:'새벽 출발을 피하면서 체류 시간을 가장 길게 확보했습니다.', reasons:['5명 모두 가능한 출발 시간','새벽 출발 불가 조건 충족','환승 없이 이동','후보 B보다 체류 시간 3시간 20분 증가'], status:'verified', evidence:[flightEvidence], rejectedCandidates:[{id:'flight-b',title:'저가항공 새벽편',reason:'2명의 새벽 출발 불가 조건과 충돌',hardConstraintConflict:true}],
    travelData:{kind:'transport',mode:'flight',modeLabel:'항공',operator:'대한항공',serviceNumber:'KE721',departureLocation:'인천',arrivalLocation:'간사이',departureTime:'09:10',arrivalTime:'11:00',durationMinutes:110,transferCount:0,baggage:'위탁 수하물 포함',inventory:{state:'available',label:'좌석 확인됨',detail:'5명 좌석 조회',evidence:flightEvidence},baseFare:{type:'live',amount:309000,currency:'KRW',unit:'person',checkedLabel:'8분 전 확인'},additionalTransportCost:{type:'estimated',amount:19000,currency:'KRW',unit:'person'},effectiveTotalPrice:{type:'live',amount:328000,currency:'KRW',unit:'person',checkedLabel:'8분 전 확인'},bookingUrl:'https://www.koreanair.com',evidence:flightEvidence},
  },
  {
    id:'stay-namba', category:'stay', categoryLabel:'체류 거점·숙소', title:'Hotel Resol Trinity Osaka', location:'난바 · 역 도보 4분', detail:'5명이 함께 이동하기 편한 중심 지역 숙소', summaryReason:'음식과 교통 접근성이 다른 후보보다 좋았습니다.', reasons:['5명 모두 절대 예산 범위 충족','도보 제한 조건 충족','음식 접근성이 가장 좋음','후보 B보다 이동시간 42분 감소'], status:'verified', evidence:[hotelEvidence,evidence('hotel-location','주소·위치','난바역 도보 4분','verified','확인됨','오늘 확인',mapSource)], rejectedCandidates:[{id:'hotel-b',title:'Hotel B',reason:'1명의 절대 예산 상한 초과',hardConstraintConflict:true},{id:'hotel-c',title:'Hotel C',reason:'그룹 객실 재고 확인 불가'}],
    travelData:{kind:'accommodation',name:'Hotel Resol Trinity Osaka',location:{name:'Hotel Resol Trinity Osaka',area:'난바',address:'2-6-6 Koraibashi, Chuo Ward, Osaka',coordinates:{latitude:34.6895,longitude:135.501},mapUrl:'https://maps.google.com/?q=Hotel+Resol+Trinity+Osaka'},image:'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80',nightlyPrice:{type:'live',amount:15200,currency:'JPY',convertedKRW:142000,unit:'night',exchangeRate:9.34,checkedAt:'오늘 05:40',checkedLabel:'12분 전 확인'},totalStayPrice:{type:'live',amount:45600,currency:'JPY',convertedKRW:426000,unit:'stay',checkedLabel:'12분 전 확인'},roomCombination:'트윈룸 2실 + 싱글룸 1실',groupCapacity:5,roomAvailability:{state:'limited',label:'객실 3실 조합 확인됨',detail:'현재 조회 기준 잔여 수량 제한',evidence:hotelEvidence},amenities:['무료 Wi-Fi','대욕장','짐 보관'],accessibility:['역 도보 4분','엘리베이터'],checkIn:'15:00',checkOut:'11:00',cancellationInfo:'무료 취소 기한과 객실별 조건은 예약 직전에 다시 확인해 주세요.',bookingUrl:'https://www.google.com/travel/hotels',evidence:hotelEvidence},
  },
  {
    id:'activity-core', category:'activity', categoryLabel:'갈 곳·할 일', title:'우메다 스카이 빌딩', location:'우메다', detail:'도시 전망과 야경을 저녁 핵심 경험으로 배치', summaryReason:'야경 선호를 반영하면서 낮 일정을 무리하게 늘리지 않았습니다.', reasons:['야경 선호 4명 반영','숙소에서 대중교통 접근 가능','예상 체류 90분으로 페이스 유지'], status:'verified', evidence:[activityHoursEvidence,evidence('activity-ticket','입장권','¥1,500','live','실시간','오늘 확인',bookingSource)], rejectedCandidates:[{id:'activity-b',title:'테마파크 종일권',reason:'높은 우선순위 응답이 1명뿐이고 예산 여유 감소'}],
    travelData:{kind:'activity',name:'우메다 스카이 빌딩',category:'전망대',location:{name:'우메다 스카이 빌딩',area:'우메다',address:'1-1-88 Oyodonaka, Kita Ward, Osaka',coordinates:{latitude:34.7053,longitude:135.49},mapUrl:'https://maps.google.com/?q=Umeda+Sky+Building'},openingHours:'17:00–22:30',closedDays:'공식 운영 공지 확인',ticketPrice:{type:'live',amount:1500,currency:'JPY',convertedKRW:14000,unit:'ticket',exchangeRate:9.34,checkedAt:'오늘 05:40',checkedLabel:'오늘 확인'},reservation:{state:'reservation-required',label:'예약 권장',detail:'일몰 시간대 사전 확인',evidence:activityHoursEvidence},expectedDurationMinutes:90,weatherSensitivity:{title:'우천 영향 있음',detail:'비가 오면 야외 전망과 시야가 제한될 수 있어요.',severity:'caution'},bookingUrl:'https://www.skybldg.co.jp/en/observatory/',evidence:activityHoursEvidence},
  },
  {
    id:'dining-safe', category:'dining', categoryLabel:'식사', title:'난바 오코노미야키 식당 후보', location:'난바', detail:'알레르기 대응을 직접 확인한 뒤 예약할 후보', summaryReason:'알레르기는 취향 점수보다 우선해 보호하고, 확인 전에는 안전하다고 표시하지 않습니다.', reasons:['갑각류 알레르기 조건 보호','교차 오염 확인 전 예약 금지','로컬 음식 선호 유지'], status:'needs-check', evidence:[allergyUnknownEvidence,staleDiningHoursEvidence], rejectedCandidates:[{id:'dining-b',title:'해산물 이자카야 B',reason:'교차 오염 대응 확인 불가',hardConstraintConflict:true}],
    travelData:{kind:'dining',name:'난바 오코노미야키 식당 후보',cuisine:'오코노미야키',location:{name:'식당 후보',area:'난바',address:'난바역 인근',coordinates:{latitude:34.6687,longitude:135.5013}},openingHours:'11:30–22:00',price:{type:'estimated',amount:4100,currency:'JPY',convertedKRW:38000,unit:'person',exchangeRate:9.34,checkedAt:'오늘 05:40',checkedLabel:'메뉴 기준 추정'},reservation:{state:'unknown',label:'예약 가능 여부 확인 필요',detail:'그룹 5명 좌석 직접 문의'},waitingInfo:'저녁 시간 대기 정보 없음',allergySupport:[{label:'갑각류 대응',status:'unknown',detail:'알레르기 대응 정보 없음 · 직접 확인 필요',evidence:allergyUnknownEvidence}],dietarySupport:[{label:'채식 메뉴',status:'inferred',detail:'채소 메뉴가 있어 대응 가능성이 있으나 조리 방식은 미확인',evidence:evidence('vegetarian-inferred','식이 대응','가능성 있음','estimated','추정 정보','메뉴 설명 기준',advisorySource)}],evidence:staleDiningHoursEvidence},
  },
  {
    id:'schedule-route', category:'schedule', categoryLabel:'날짜별 일정·현지 이동', title:'난바 → 오사카성', location:'오사카 시내', detail:'관광과 휴식의 균형을 유지하는 현지 이동', summaryReason:'연속 도보를 줄이면서 하루 핵심 일정 두 개를 유지했습니다.', reasons:['하루 핵심 일정 2개 유지','매일 자유시간 90분 이상','연속 도보 35분 이하'], status:'verified', evidence:[routeEvidence], rejectedCandidates:[{id:'schedule-b',title:'하루 4곳 압축 일정',reason:'걷기 제한과 목표 페이스를 모두 초과'}],
    travelData:{kind:'route',route:{id:'route-namba-castle',origin:'난바',destination:'오사카성',mode:'subway',modeLabel:'지하철',durationMinutes:32,distanceKm:7.4,transferCount:1,walkingMinutes:8,departureTime:'12:40',arrivalTime:'13:12',fare:{type:'live',amount:240,currency:'JPY',convertedKRW:2100,unit:'route',exchangeRate:9.34,checkedAt:'오늘 05:40',checkedLabel:'12분 전 확인'},steps:[{id:'step-1',mode:'walk',instruction:'난바역까지 이동',durationMinutes:4},{id:'step-2',mode:'subway',station:'혼마치역',instruction:'미도스지선 → 주오선 환승',durationMinutes:20},{id:'step-3',mode:'walk',instruction:'오사카성 입구까지 이동',durationMinutes:4}],cutoffWarning:'막차 시간은 방문 당일 다시 확인해 주세요.',map:{label:'난바 → 오사카성',path:[{latitude:34.6687,longitude:135.5013},{latitude:34.6759,longitude:135.501},{latitude:34.6811,longitude:135.4997},{latitude:34.6842,longitude:135.5115},{latitude:34.6873,longitude:135.5262}]},mapUrl:'https://maps.google.com/?saddr=Namba,+Osaka&daddr=Osaka+Castle',evidence:routeEvidence}},
  },
  {
    id:'transport-intercity', category:'transport', categoryLabel:'오는 길·가는 길', title:'JR 신쾌속 오사카 → 교토', location:'오사카역 → 교토역', detail:'도시 간 이동을 위한 예약 불필요 열차', summaryReason:'버스보다 이동시간이 짧고 일정 변경이 쉽습니다.', reasons:['약 29분 이동','예약 없이 탑승 가능','오전 일정과 연결 쉬움'], status:'verified', featured:false, evidence:[trainEvidence], rejectedCandidates:[{id:'bus-kyoto',title:'교토행 고속버스',reason:'도로 혼잡 시 도착시간 변동이 큼'}],
    travelData:{kind:'transport',mode:'train',modeLabel:'도시간 철도',operator:'JR',serviceNumber:'신쾌속',departureLocation:'오사카역',arrivalLocation:'교토역',departureTime:'08:42',arrivalTime:'09:11',durationMinutes:29,transferCount:0,reservationRequired:false,inventory:{state:'available',label:'예약 불필요',detail:'일반 좌석 이용',evidence:trainEvidence},effectiveTotalPrice:{type:'live',amount:580,currency:'JPY',convertedKRW:5400,unit:'person',exchangeRate:9.34,checkedAt:'오늘 05:40',checkedLabel:'오늘 확인'},evidence:trainEvidence},
  },
]

const day2Weather = evidence('weather-day2','날씨','18–24°C · 오후 비 가능성 60%','verified','확인됨','오늘 05:40 확인',officialSource)

export const demoPlanB: PlanB[] = [
  { id:'rain-day', trigger:'10월 16일 오후 비가 오면', title:'실내 중심 일정', replacements:['오사카성 공원 → 오사카 역사박물관','야외 산책 → 난바 카페'], budgetDeltaLabel:'1인 +₩6,000 예상', readinessLabel:'바로 전환 가능', weatherWarning:{title:'오후 비 가능성 60%',detail:'강수 상황에 따라 야외 일정을 실내 후보로 바꿀 수 있어요.',severity:'caution'} },
]

export const demoResult: ProductResult = {
  status:'VERIFIED_DRAFT', pace:tripPaces[1], destination:'오사카', destinationImage:featuredDestinations.find((item) => item.id === 'osaka')!.image, duration:'3박 4일', dateRange:'10.15 – 10.18', participantCount:5, budgetPerPerson:742000, stayArea:'난바', checksRequired:3,
  decisions:demoDecisions,
  bookings:[
    {id:'book-flight',category:'오는 길',title:'대한항공 KE721',state:'ready',stateLabel:'예약 준비 완료',price:{type:'live',amount:328000,currency:'KRW',unit:'person',checkedLabel:'8분 전 확인'},note:'좌석과 운임을 확인했지만 결제 전 최종 조건을 확인해 주세요.',actionLabel:'예약처에서 확인',externalUrl:'https://www.koreanair.com',evidence:flightEvidence},
    {id:'book-hotel',category:'숙소',title:'Hotel Resol Trinity Osaka',state:'ready',stateLabel:'객실 확인됨',price:{type:'live',amount:15200,currency:'JPY',convertedKRW:142000,unit:'night',exchangeRate:9.34,checkedAt:'오늘 05:40',checkedLabel:'12분 전 확인'},note:'선택한 객실 조합과 취소 기한을 결제 전에 확인해 주세요.',actionLabel:'예약처에서 확인',externalUrl:'https://www.google.com/travel/hotels',evidence:hotelEvidence},
    {id:'book-hotel-estimated',category:'숙소 후보',title:'난바 비즈니스 호텔 B',state:'needs-check',stateLabel:'예약 전 확인 필요',price:{type:'estimated',currency:'KRW',rangeMin:120000,rangeMax:180000,unit:'night',checkedLabel:'범위 추정'},note:'객실 조합에 따라 금액 차이가 커 재고 조회가 필요해요.',freshness:'추정 정보'},
    {id:'book-hotel-unknown',category:'숙소 후보',title:'난바 소형 숙소 C',state:'blocked',stateLabel:'가격 확인 필요',price:{type:'unknown'},note:'그룹 수용 가능 여부와 가격 정보가 아직 없어요.'},
  ],
  itinerary:[
    {id:'day-1',dayLabel:'DAY 1',dateLabel:'10월 15일',title:'도착과 난바',weather:{condition:'맑음',temperatureMinC:17,temperatureMaxC:23,precipitationProbability:10,summary:'대체로 맑고 선선해요.'},items:[{id:'day1-arrival',time:'11:00',title:'간사이공항 도착',detail:'수하물 수령 후 난바로 이동'},{id:'day1-route',time:'12:10',title:'공항 → 난바',route:{id:'route-airport-namba',origin:'간사이공항',destination:'난바',mode:'train',modeLabel:'공항철도',durationMinutes:38,distanceKm:43,transferCount:0,walkingMinutes:6,departureTime:'12:10',arrivalTime:'12:48',fare:{type:'live',amount:1450,currency:'JPY',convertedKRW:13500,unit:'route',exchangeRate:9.34,checkedAt:'오늘 05:40',checkedLabel:'오늘 확인'},steps:[{id:'airport-step',mode:'train',station:'간사이공항역',instruction:'난카이 라피트 탑승',durationMinutes:38}],evidence:trainEvidence}},{id:'day1-evening',time:'18:30',title:'도톤보리 저녁 산책',location:{name:'도톤보리',area:'난바',address:'Dotonbori, Chuo Ward, Osaka',coordinates:{latitude:34.6687,longitude:135.5013}}}]},
    {id:'day-2',dayLabel:'DAY 2',dateLabel:'10월 16일',title:'시장과 도시 전망',weather:{condition:'오후 비',temperatureMinC:18,temperatureMaxC:24,precipitationProbability:60,summary:'오후 비 가능성이 있어요.',evidence:day2Weather},items:[{id:'day2-market',time:'09:30',title:'구로몬 시장',detail:'아침 식사와 로컬 시장 산책'},{id:'day2-route',time:'12:40',title:'난바 → 오사카성',route:(demoDecisions.find((item) => item.id === 'schedule-route')!.travelData as Extract<NonNullable<DecisionSummary['travelData']>, {kind:'route'}>).route},{id:'day2-castle',time:'14:00',title:'오사카성',weatherWarning:{title:'우천 영향 있음',detail:'비가 강하면 공원 대신 오사카 역사박물관으로 전환해요.',severity:'caution'}},{id:'day2-umeda',time:'18:30',title:'우메다 스카이 빌딩',weatherWarning:{title:'시야 확인 필요',detail:'비와 낮은 구름이 있으면 전망이 제한될 수 있어요.',severity:'info'}}]},
    {id:'day-3',dayLabel:'DAY 3',dateLabel:'10월 17일',title:'교토와 근교 이동',weather:{condition:'흐림',temperatureMinC:16,temperatureMaxC:22,precipitationProbability:30,summary:'구름이 많지만 야외 활동 가능해요.'},items:[{id:'day3-train',time:'08:42',title:'오사카 → 교토',detail:'JR 신쾌속 · 예약 불필요',route:{id:'route-osaka-kyoto',origin:'오사카역',destination:'교토역',mode:'train',modeLabel:'도시간 철도',durationMinutes:29,distanceKm:42.8,transferCount:0,walkingMinutes:5,departureTime:'08:42',arrivalTime:'09:11',fare:{type:'live',amount:580,currency:'JPY',convertedKRW:5400,unit:'route',exchangeRate:9.34,checkedAt:'오늘 05:40',checkedLabel:'오늘 확인'},evidence:trainEvidence}},{id:'day3-drive',time:'14:20',title:'교토 서부 근교 이동',detail:'그룹 렌터카 이용 구간',route:{id:'route-kyoto-drive',origin:'교토역',destination:'아라시야마·근교',mode:'car',modeLabel:'렌터카',durationMinutes:75,distanceKm:42,transferCount:0,departureTime:'14:20',arrivalTime:'15:35',fare:{type:'estimated',amount:25500,currency:'KRW',unit:'group',checkedLabel:'예상 비용'},drivingCost:{fuel:{type:'estimated',amount:12000,currency:'KRW',unit:'group'},tolls:{type:'estimated',amount:8500,currency:'KRW',unit:'group'},parking:{type:'estimated',amount:5000,currency:'KRW',unit:'group'},total:{type:'estimated',amount:25500,currency:'KRW',unit:'group'}},evidence:evidence('drive-estimate','자차 비용','약 ₩25,500','estimated','추정','경로·평균 단가 기준',mapSource)}}]},
    {id:'day-4',dayLabel:'DAY 4',dateLabel:'10월 18일',title:'카페와 출국',weather:{condition:'맑음',temperatureMinC:17,temperatureMaxC:25,precipitationProbability:10,summary:'대체로 맑아요.'},items:[{id:'day4-cafe',time:'09:30',title:'난바 카페와 자유시간'},{id:'day4-airport',time:'13:10',title:'난바 → 간사이공항',detail:'출발 3시간 전 공항 도착 목표'}]},
  ],
  coverage:{represented:['갑각류 알레르기 보호','로컬 맛집 우선','새벽 출발 제외'],compromised:['숙소 등급 한 단계 낮춤'],protectedInstead:['중심 지역 숙소 확보','음식 예산 유지'],unrepresentedParticipants:[{name:'Jenny',reasons:['입력 미완료','날짜 미확인','취향 미대표']}]},
  concessions:[{participant:'Felicia',gaveUp:'숙소 객실 등급',received:['난바 중심 위치','음식 예산 유지']}],
  planB:demoPlanB,
}

export const reopenOptions: ReopenOption[] = [
  {id:'misunderstood',label:'취향을 잘못 이해했어요'},
  {id:'incorrect-fact',label:'사실이 틀렸어요',criticalCorrection:true},
  {id:'new-constraint',label:'새로운 조건이 생겼어요',criticalCorrection:true},
  {id:'budget-change',label:'예산을 바꾸고 싶어요'},
  {id:'other-candidate',label:'다른 후보를 보고 싶어요'},
  {id:'other',label:'기타'},
]

export const demoRerunImpact: RerunImpact = { affectedDecisions:['숙소','갈 곳·할 일','식사','날짜별 일정','예산'], decisionCount:5, estimatedTimeLabel:'약 12분', bookingImpact:'현재 예약 항목 영향 없음' }

export const changedRerunDiff: RerunDiff = { changed:true,beforeTitle:'Hotel Resol Trinity Osaka',afterTitle:'Hotel Monterey Grasmere Osaka',metrics:[{label:'1인 예상',before:'₩742,000',after:'₩728,000'},{label:'총 이동시간',before:'4시간 20분',after:'3시간 41분'}],reason:'숙소 위치의 중요도가 높아져 역 접근성이 낮은 후보가 제외되었습니다.',evidenceChanges:['역 도보 시간 다시 비교','객실 가격 범위 다시 확인'],bookingReadinessChange:'숙소는 예약 전 재고 확인이 필요해요.' }
export const unchangedRerunDiff: RerunDiff = { changed:false,beforeTitle:'Hotel Resol Trinity Osaka',afterTitle:'Hotel Resol Trinity Osaka',metrics:[],reason:'새 기준을 반영해 다시 검토했지만 현재 선택이 여전히 가장 적합했습니다.',evidenceChanges:['가격 범위 다시 확인','역 접근성 근거 다시 확인'] }

const unavailableEvidence = (destination: string) => evidence(`unavailable-${destination}`,'여행 정보','연결 대기 중','unknown','정보 없음','데모 데이터 없음',undefined,'실제 여행 데이터가 연결되면 이 항목을 확인할 수 있어요.')

export function demoResultForDestination(destination: DestinationPack): ProductResult {
  if (destination.id === 'osaka') return demoResult

  const genericEvidence = unavailableEvidence(destination.id)
  const decisions = demoResult.decisions
    .filter((item) => item.featured !== false)
    .map((decision) => ({
      ...decision,
      title: decision.category === 'stay' ? `${destination.name} 중심 지역 숙소 후보` : decision.category === 'activity' ? `${destination.name} 갈 곳·할 일 후보` : decision.category === 'dining' ? `${destination.name} 식사 후보` : decision.category === 'schedule' ? `${destination.name} 날짜별 일정` : `${destination.name} 오는 길·가는 길 후보`,
      location: destination.name,
      priceLabel: '가격 확인 필요',
      status: 'needs-check' as const,
      evidence: [genericEvidence],
      travelData: undefined,
    }))

  return {
    ...demoResult,
    status:'NEEDS_USER_CHOICE',
    destination:destination.name,
    destinationImage:destination.image,
    stayArea:'중심 지역',
    checksRequired:decisions.length,
    decisions,
    itinerary:[],
    bookings:[{id:`${destination.id}-pending`,category:'여행 정보',title:`${destination.name} 예약 후보`,state:'needs-check',stateLabel:'정보 확인 필요',price:{type:'unknown'},note:'현재 데모에는 오사카의 상세 여행 데이터만 준비되어 있어요.'}],
    planB:[],
  }
}
