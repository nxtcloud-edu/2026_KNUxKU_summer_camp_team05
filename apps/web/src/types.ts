export type Stage =
  | 'landing'
  | 'destinations'
  | 'invite'
  | 'lobby'
  | 'survey'
  | 'date-resolution'
  | 'planning'
  | 'result'
  | 'decision'
  | 'reopen'
  | 'rerun-processing'
  | 'updated-result'
  | 'replay'

export const resultModes=[
  {id:'overview',label:'개요'},
  {id:'schedule',label:'일정'},
  {id:'booking',label:'예약'},
  {id:'decisions',label:'결정'},
] as const

export type ResultMode=(typeof resultModes)[number]['id']
export type LandingModal='intro'|'how'|'login'|null

export const demoStages:Stage[]=['landing','destinations','invite','lobby','survey','date-resolution','planning','result','decision','reopen','rerun-processing','updated-result','replay']

export const stageNav:Record<Stage,string>={
  landing:'소개',destinations:'여행지',invite:'친구 초대',lobby:'여행 방',survey:'내 여행 만들기','date-resolution':'날짜 정하기',planning:'계획 중',result:'우리 여행',decision:'결정 이유',reopen:'다시 논의','rerun-processing':'다시 논의 중','updated-result':'업데이트 결과',replay:'결정 과정',
}
