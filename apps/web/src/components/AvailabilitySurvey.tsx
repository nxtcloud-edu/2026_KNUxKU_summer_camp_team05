import { useMemo, useState } from 'react'
import { CalendarBlank, CaretLeft, CaretRight, Check, X } from '@phosphor-icons/react'
import type { AvailabilityDraft } from '../formState'
import { SurveyShell } from './SurveyShell'

type DateMode = 'available' | 'unavailable'

const weekdays = ['일', '월', '화', '수', '목', '금', '토']

const toDateId = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function calendarDays(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1)
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  return [
    ...Array.from({ length:firstDay.getDay() }, () => null),
    ...Array.from({ length:lastDay.getDate() }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1)),
  ]
}

function ChoiceGroup<T extends string>({ value, options, choose }: {
  value: T | null
  options: { value:T; label:string; detail?:string }[]
  choose: (value:T) => void
}) {
  return <div className="moa-choice-grid">{options.map((option) => <button type="button" className={value === option.value ? 'active' : ''} aria-pressed={value === option.value} onClick={() => choose(option.value)} key={option.value}><strong>{option.label}</strong>{option.detail && <span>{option.detail}</span>}</button>)}</div>
}

export function AvailabilitySurvey({ value, change, next }: {
  value: AvailabilityDraft
  change: (value: AvailabilityDraft) => void
  next: () => void
}) {
  const [mode, setMode] = useState<DateMode>('available')
  const [month, setMonth] = useState(() => new Date(2026, 9, 1))
  const days = useMemo(() => calendarDays(month), [month])
  const set = <K extends keyof AvailabilityDraft>(field:K, fieldValue:AvailabilityDraft[K]) => change({ ...value, [field]:fieldValue })
  const toggleDate = (date:Date) => {
    const id = toDateId(date)
    const target = mode === 'available' ? 'availableDates' : 'unavailableDates'
    const opposite = mode === 'available' ? 'unavailableDates' : 'availableDates'
    const nextTarget = value[target].includes(id) ? value[target].filter((item) => item !== id) : [...value[target], id]
    change({ ...value, [target]:nextTarget, [opposite]:value[opposite].filter((item) => item !== id) })
  }
  const incomplete = value.availableDates.length === 0 || !value.preferredNights || !value.nightFlexibility || !value.weekdayFlexibility || !value.flightTimeFlexibility

  return <SurveyShell step={0} title="언제 시간이 괜찮아요?" copy="가능한 날과 정말 어려운 날을 알려주세요. 날짜는 모두의 답을 모아 정해요." next={next} disabled={incomplete}>
    <section className="moa-availability-calendar">
      <header>
        <div><CalendarBlank weight="duotone" /><span><strong>가능한 날짜</strong><small>날짜를 누르면 현재 선택 모드로 표시돼요.</small></span></div>
        <div className="moa-date-mode" aria-label="날짜 선택 모드">
          <button type="button" className={mode === 'available' ? 'active available' : ''} onClick={() => setMode('available')}><Check /> 가능</button>
          <button type="button" className={mode === 'unavailable' ? 'active unavailable' : ''} onClick={() => setMode('unavailable')}><X /> 절대 불가</button>
        </div>
      </header>
      <div className="moa-calendar-head"><button type="button" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} aria-label="이전 달"><CaretLeft /></button><strong>{month.getFullYear()}년 {month.getMonth() + 1}월</strong><button type="button" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} aria-label="다음 달"><CaretRight /></button></div>
      <div className="moa-calendar-grid">{weekdays.map((weekday) => <span className="weekday" key={weekday}>{weekday}</span>)}{days.map((date, index) => date ? <button type="button" className={value.availableDates.includes(toDateId(date)) ? 'available' : value.unavailableDates.includes(toDateId(date)) ? 'unavailable' : ''} aria-label={`${toDateId(date)} ${value.availableDates.includes(toDateId(date)) ? '가능' : value.unavailableDates.includes(toDateId(date)) ? '절대 불가' : '선택 안 함'}`} onClick={() => toggleDate(date)} key={toDateId(date)}><span>{date.getDate()}</span>{value.availableDates.includes(toDateId(date)) && <Check />}{value.unavailableDates.includes(toDateId(date)) && <X />}</button> : <i key={`empty-${index}`} />)}</div>
      <footer><span><i className="available" /> 가능 {value.availableDates.length}일</span><span><i className="unavailable" /> 절대 불가 {value.unavailableDates.length}일</span></footer>
    </section>

    <div className="moa-availability-questions">
      <section><h2>몇 박이 좋아요?</h2><ChoiceGroup value={value.preferredNights} choose={(selected) => set('preferredNights', selected)} options={[{value:'1',label:'1박'},{value:'2',label:'2박'},{value:'3',label:'3박'},{value:'4+',label:'4박 이상'}]} /></section>
      <section><h2>다 같이 갈 수 있다면 하루 정도 바꿔도 괜찮아요?</h2><ChoiceGroup value={value.nightFlexibility} choose={(selected) => set('nightFlexibility', selected)} options={[{value:'fixed',label:'기간 고정'},{value:'plus-minus-one',label:'±1박 괜찮아요'}]} /></section>
      <section><h2>평일 일정은 어디까지 가능해요?</h2><ChoiceGroup value={value.weekdayFlexibility} choose={(selected) => set('weekdayFlexibility', selected)} options={[{value:'weekends',label:'주말만 가능'},{value:'friday-pto',label:'금요일 연차 가능'},{value:'weekdays',label:'평일도 가능'}]} /></section>
      <section><h2>비행 시간은요?</h2><ChoiceGroup value={value.flightTimeFlexibility} choose={(selected) => set('flightTimeFlexibility', selected)} options={[{value:'early-morning',label:'이른 아침도 가능'},{value:'morning-onward',label:'오전부터 가능'},{value:'any-time',label:'시간 상관없어요'}]} /></section>
    </div>
  </SurveyShell>
}
