import { useState } from 'react'
import { ArrowRight, Check, Clock, SpinnerGap, UsersThree } from '@phosphor-icons/react'
import { Page } from '../../components/ui'

export function DateResolutionScreen({next,back}:{next:()=>void;back:()=>void}) {
  const [selection,setSelection]=useState<'full'|'shorter'|null>(null)
  if(selection) return <Page narrow><section className="moa-resolution-success"><div className="moa-status-mark success"><Check weight="bold"/></div><span className="moa-kicker">DATE RESOLVED</span><h1>여행 날짜를 정했어요.</h1><strong>{selection==='full'?'10월 15일 – 10월 18일':'10월 15일 – 10월 17일'}</strong><p>{selection==='full'?'3박 4일 · 4명 참여 가능':'2박 3일 · 5명 모두 가능한 일정'}</p><button className="moa-button big" onClick={next}>MOA에게 계획 맡기기 <ArrowRight/></button></section></Page>
  return <Page narrow><button className="moa-back" onClick={back}>여행 방으로</button><div className="moa-product-head"><span className="moa-kicker">DATE RESOLUTION</span><h1>모두가 가능한 일정이 없어요.</h1><p>가능한 날짜를 비교해 가장 현실적인 선택지만 정리했어요.</p></div><div className="moa-date-options"><button onClick={()=>setSelection('full')}><b>A</b><div><strong>10/15–10/18</strong><span><UsersThree/>4명 참여 가능</span><small>선호한 3박 4일 유지</small></div><ArrowRight/></button><button className="recommended" onClick={()=>setSelection('shorter')}><b>B</b><div><strong>10/15–10/17</strong><span><UsersThree/>5명 모두 가능</span><small>1박 단축 · 모두 함께</small></div><ArrowRight/></button><button onClick={back}><b>C</b><div><strong>가능 일정 다시 확인</strong><small>친구들에게 날짜 입력을 다시 요청해요.</small></div><ArrowRight/></button></div><aside className="moa-demo-note">이 날짜 비교는 프론트엔드 데모 데이터입니다. 실제 중복 계산은 서버의 참여자 응답이 필요해요.</aside></Page>
}

const categories=['오는 길·가는 길','체류 거점·숙소','갈 곳·할 일','식사','날짜별 일정·현지 이동','최종 확인']
export function PlanningScreen({next,leave}:{next:()=>void;leave:()=>void}) {
  return <Page narrow><section className="moa-planning-screen"><div className="moa-status-mark loading"><SpinnerGap/></div><span className="moa-kicker">PLANNING DEMO</span><h1>MOA가 대신 논의하고 있어요.</h1><p>각자의 일정, 예산, 꼭 지킬 조건과 취향을 함께 비교해요.</p><div className="moa-planning-list">{categories.map((category,index)=><div key={category} className={index<2?'done':index===2?'active':''}><span>{index<2?<Check weight="bold"/>:index===2?<SpinnerGap/>:index+1}</span><strong>{category}</strong><small>{index<2?'검토 완료':index===2?'검토 중':'대기'}</small></div>)}</div><aside className="moa-demo-note">서버 계획 작업이 아직 연결되지 않아 진행 상태는 데모입니다. 실제 예약이나 구매는 실행하지 않아요.</aside><div className="moa-planning-actions"><button className="moa-button ghost big" onClick={leave}>이 화면 나가기</button><button className="moa-button big" onClick={next}>데모 결과 보기 <ArrowRight/></button></div><p className="moa-leave-safe"><Clock/>이 화면을 나가도 괜찮아요.</p></section></Page>
}
