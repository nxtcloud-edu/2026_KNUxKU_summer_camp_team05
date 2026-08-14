import { ArrowRight, Check, MapPin } from '@phosphor-icons/react'
import type { DestinationPack } from '../product/types'
import { useLocalImageFallback } from '../utils/images'
import { Page, StickyAction } from './ui'

export function DestinationPicker({ destinations, selected, select, next, request }: {
  destinations: DestinationPack[]
  selected: DestinationPack
  select: (destination: DestinationPack) => void
  next: () => void
  request: () => void
}) {
  return <Page><div className="moa-page-head"><span className="moa-kicker">DESTINATION FIRST</span><h1>어디로 갈까요?</h1><p>여행지를 고르면 그곳에서 결정에 영향을 주는 질문만 준비할게요.</p></div>{(['한국','일본'] as const).map((country)=><section className="moa-destination-group" key={country}><div><h2>{country}</h2><span>{country==='한국'?'가볍게 떠나기 좋은 두 곳':'가깝지만 분위기가 다른 두 곳'}</span></div><div className="moa-destination-grid">{destinations.filter((destination)=>destination.country===country).map((destination)=><button key={destination.id} className={`moa-destination-card ${selected.id===destination.id?'selected':''}`} onClick={()=>select(destination)}><img src={destination.image} alt={destination.name} onError={useLocalImageFallback}/><span className="moa-photo-shade"/><div><strong>{destination.name}</strong><p>{destination.tags.join(' · ')}</p></div>{selected.id===destination.id&&<i><Check weight="bold"/></i>}</button>)}</div></section>)}<div className="moa-request"><div><MapPin/><p><strong>찾는 곳이 없나요?</strong><span>지원 여행지는 앞으로 바뀔 수 있어요.</span></p></div><button onClick={request}>여행지 요청하기 <ArrowRight/></button></div><StickyAction note={`${selected.name} 질문을 준비할게요`} button="여행 방 만들기" onClick={next}/></Page>
}
