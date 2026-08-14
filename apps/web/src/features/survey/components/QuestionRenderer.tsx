import { useMemo, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import {
  AirplaneTakeoff,
  Armchair,
  ArrowLeft,
  ArrowRight,
  Bed,
  Buildings,
  CalendarBlank,
  CalendarCheck,
  CaretDown,
  Check,
  Compass,
  Footprints,
  ForkKnife,
  HouseLine,
  ListChecks,
  MapPin,
  MapTrifold,
  Moon,
  NotePencil,
  Plus,
  Scales,
  ShieldCheck,
  ShoppingBag,
  Storefront,
  SunHorizon,
  Taxi,
  Ticket,
  Train,
  UsersThree,
  X,
} from '@phosphor-icons/react'
import { getAnswerLabels } from '../answerPresentation'
import type {
  ConstraintAnswerItem,
  ConstraintsQuestion,
  DateRangeAnswer,
  MoneyRangeAnswer,
  MoneyRangeQuestion,
  ResourcePoliciesQuestion,
  SurveyAnswerV4,
  SurveyAnswerValue,
  SurveyOption,
  SurveyPlanV4,
  SurveyQuestion,
  TagGroupsQuestion,
  TagRatingsQuestion,
} from '../types/survey'

type QuestionRendererProps = {
  question: SurveyQuestion
  answer?: SurveyAnswerValue
  plan: SurveyPlanV4
  answers: Record<string, SurveyAnswerV4>
  destinationName: string
  destinationImage: string
  headingRef: RefObject<HTMLHeadingElement | null>
  submitting: boolean
  onAnswer: (value: SurveyAnswerValue) => void
  onAutoAnswer: (value: SurveyAnswerValue, feedback: string) => void
  onBack: () => void
  onNext: () => void
  onSkip: () => void
  onExit: () => void
  onSubmit: (value: SurveyAnswerValue) => void
}

const calendarWeekdays = ['일', '월', '화', '수', '목', '금', '토']

const dateLabel = (value: string | undefined, includeYear = false) => {
  if (!value) return '선택해주세요'
  const date = new Date(`${value}T00:00:00`)
  return new Intl.DateTimeFormat('ko-KR', includeYear
    ? { year: 'numeric', month: 'long', day: 'numeric' }
    : { month: 'long', day: 'numeric' }).format(date)
}

const moneyLabel = (value: number | undefined) => value === undefined ? '' : value.toLocaleString('ko-KR')

function dateValues(minDate: string, maxDate: string) {
  const dates: string[] = []
  const cursor = new Date(`${minDate}T00:00:00`)
  const end = new Date(`${maxDate}T00:00:00`)
  while (cursor <= end) {
    const year = cursor.getFullYear()
    const month = String(cursor.getMonth() + 1).padStart(2, '0')
    const day = String(cursor.getDate()).padStart(2, '0')
    dates.push(`${year}-${month}-${day}`)
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

function BuilderHeading({ question, headingRef, children }: { question: SurveyQuestion; headingRef: RefObject<HTMLHeadingElement | null>; children?: ReactNode }) {
  return <header className="moa-builder-heading">{question.eyebrow&&<span>{question.eyebrow}</span>}<h1 ref={headingRef} tabIndex={-1}>{question.title}</h1>{question.description&&<p>{question.description}</p>}{children}</header>
}

function BuilderActions({ back, next, nextLabel = '계속하기', disabled = false, skip }: { back: () => void; next: () => void; nextLabel?: string; disabled?: boolean; skip?: () => void }) {
  return <div className="moa-builder-actions"><button type="button" className="back" onClick={back}><ArrowLeft/>이전</button><div>{skip&&<button type="button" className="skip" onClick={skip}>건너뛰기</button>}<button type="button" className="next" onClick={next} disabled={disabled}>{nextLabel}<ArrowRight/></button></div></div>
}

function OptionIcon({ option, kind }: { option: SurveyOption; kind: NonNullable<Extract<SurveyQuestion, { uiType: 'single-choice' }>['presentation']> }) {
  const key = option.visual ?? option.id
  const props = { size: 30, weight: 'duotone' as const }
  switch (key) {
    case 'timeline-one': return <Armchair {...props}/>
    case 'timeline-two': return <Compass {...props}/>
    case 'timeline-three': return <MapTrifold {...props}/>
    case 'notes-loose': return <NotePencil {...props}/>
    case 'notes-balanced': return <CalendarCheck {...props}/>
    case 'notes-fixed': return <ListChecks {...props}/>
    case 'together': return <UsersThree {...props}/>
    case 'core-together': return <CalendarCheck {...props}/>
    case 'split-ok': return <Compass {...props}/>
    case 'sunrise': return <SunHorizon {...props}/>
    case 'day': return <CalendarCheck {...props}/>
    case 'moon': return <Moon {...props}/>
    case 'route-short': return <Taxi {...props}/>
    case 'route-balanced': return <Scales {...props}/>
    case 'route-long': return <Train {...props}/>
    case 'ticket-basic': return <Ticket {...props}/>
    case 'ticket-balanced': return <AirplaneTakeoff {...props}/>
    case 'ticket-comfort': return <Armchair {...props}/>
    case 'central-basic': return <Buildings {...props}/>
    case 'spacious-quiet': return <HouseLine {...props}/>
    case 'special': return <Bed {...props}/>
    case 'destination': return <ForkKnife {...props}/>
    case 'market': return <Storefront {...props}/>
    case 'easy': return <MapPin {...props}/>
    case 'one-area': return <Footprints {...props}/>
    case 'two-areas': return <Compass {...props}/>
    case 'many-areas': return <MapTrifold {...props}/>
    case 'trend':
    case 'city': return <ShoppingBag {...props}/>
    case 'culture':
    case 'old-town': return <Buildings {...props}/>
    case 'local':
    case 'slow': return <Storefront {...props}/>
    case 'coast': return <MapPin {...props}/>
    case 'stay': return <Bed {...props}/>
    case 'food': return <ForkKnife {...props}/>
    case 'experience': return <Ticket {...props}/>
    case 'transport': return <Train {...props}/>
    case 'personal': return <ShoppingBag {...props}/>
    default:
      if (kind === 'lodging') return <Bed {...props}/>
      if (kind === 'city') return <Buildings {...props}/>
      if (kind === 'ticket') return <Ticket {...props}/>
      if (kind === 'people') return <UsersThree {...props}/>
      if (kind === 'route') return <Train {...props}/>
      return <Compass {...props}/>
  }
}

function OptionCards({ options, value, choose, kind = 'standard' }: { options: SurveyOption[]; value?: string; choose: (option: SurveyOption) => void; kind?: NonNullable<Extract<SurveyQuestion, { uiType: 'single-choice' }>['presentation']> }) {
  return <div className={`moa-builder-options ${kind}`}>{options.map((option) => <button type="button" key={option.id} className={value === option.id ? 'selected' : ''} aria-pressed={value === option.id} onClick={() => choose(option)}><i className="moa-option-icon" aria-hidden="true"><OptionIcon option={option} kind={kind}/></i><span className="moa-option-copy"><strong>{option.label}</strong>{option.detail&&<small>{option.detail}</small>}</span>{value === option.id&&<b><Check weight="bold"/></b>}</button>)}</div>
}

function DateRangeField({ question, answer, setAnswer, back, next, skip, headingRef }: { question: Extract<SurveyQuestion, { uiType: 'date-range' }>; answer?: SurveyAnswerValue; setAnswer: (value: SurveyAnswerValue) => void; back: () => void; next: () => void; skip: () => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const value: DateRangeAnswer = answer?.kind === 'date-range' ? answer : { kind: 'date-range' }
  const dates = useMemo(() => dateValues(question.minDate, question.maxDate), [question.maxDate, question.minDate])
  const chooseDate = (id: string) => {
    if (!value.startDate || value.endDate) {
      setAnswer({ ...value, startDate: id, endDate: undefined })
      return
    }
    setAnswer({ ...value, startDate: id < value.startDate ? id : value.startDate, endDate: id < value.startDate ? value.startDate : id })
  }
  const firstDate = new Date(`${question.minDate}T00:00:00`)
  const monthLabel = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long' }).format(firstDate)
  const complete = Boolean(value.startDate && value.endDate && value.nights !== undefined)
  return <><BuilderHeading question={question} headingRef={headingRef}/><section className="moa-builder-calendar" aria-labelledby="builder-calendar-month"><header><strong id="builder-calendar-month">{monthLabel}</strong><span>{!value.startDate ? '시작일 선택' : !value.endDate ? '종료일 선택' : '선택 완료'}</span></header><div className="moa-builder-date-summary" role="status" aria-live="polite"><div className={value.startDate ? 'set' : ''}><small>시작</small><strong>{dateLabel(value.startDate)}</strong></div><ArrowRight/><div className={value.endDate ? 'set' : ''}><small>종료</small><strong>{dateLabel(value.endDate)}</strong></div></div><div className="moa-builder-weekdays" aria-hidden="true">{calendarWeekdays.map((day) => <span key={day}>{day}</span>)}</div><div className="moa-builder-days" role="group" aria-label="여행 시작일과 종료일 선택">{Array.from({ length: firstDate.getDay() }, (_, index) => <i key={index}/>)}{dates.map((id) => { const inRange = Boolean(value.startDate && value.endDate && id >= value.startDate && id <= value.endDate); const start = id === value.startDate; const end = id === value.endDate; return <button type="button" key={id} className={`${inRange ? 'in-range ' : ''}${start ? 'start ' : ''}${end ? 'end' : ''}`} aria-pressed={inRange || start} onClick={() => chooseDate(id)}>{Number(id.slice(-2))}</button> })}</div></section><section className="moa-builder-block"><h2>몇 박 정도 생각하고 있어요?</h2><div className="moa-night-options">{question.nightOptions.map((option) => <button type="button" key={option.id} className={value.nights === option.value ? 'selected' : ''} aria-pressed={value.nights === option.value} onClick={() => setAnswer({ ...value, nights: option.value })}>{option.label}</button>)}</div></section>{value.startDate&&value.endDate&&value.nights!==undefined&&<div className="moa-travel-ticket"><CalendarBlank/><div><span>여행 가능 일정</span><strong>{dateLabel(value.startDate)}–{dateLabel(value.endDate)} 사이 · {value.nights === 'unknown' ? '기간 미정' : `${value.nights}박 가능`}</strong></div></div>}<BuilderActions back={back} next={next} nextLabel={question.nextLabel} disabled={!complete} skip={!question.required ? skip : undefined}/></>
}

function MoneyEditor({ label, placeholder, value, step, change, maximum = false }: { label: string; placeholder?: string; value?: number; step: number; change: (value?: number) => void; maximum?: boolean }) {
  const parse = (raw: string) => { const digits = raw.replace(/\D/g, ''); return digits ? Number(digits) : undefined }
  return <label className={`moa-money-editor${maximum ? ' maximum' : ''}`}><span>{label}</span><div><b>₩</b><input inputMode="numeric" aria-label={label} value={moneyLabel(value)} onChange={(event) => change(parse(event.target.value))} placeholder={placeholder}/></div><footer><button type="button" onClick={() => change(value === undefined || value <= step ? undefined : value - step)}>−{step / 10000}만</button><button type="button" onClick={() => change((value ?? 0) + step)}>+{step / 10000}만</button></footer></label>
}

function MoneyRangeField({ question, answer, setAnswer, back, next, headingRef }: { question: MoneyRangeQuestion; answer?: SurveyAnswerValue; setAnswer: (value: SurveyAnswerValue) => void; back: () => void; next: () => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const value: MoneyRangeAnswer = answer?.kind === 'money-range' ? answer : { kind: 'money-range', currency: question.currency }
  const update = (patch: Partial<MoneyRangeAnswer>) => setAnswer({ ...value, ...patch })
  const valid = value.targetAmount !== undefined && value.maximumAmount !== undefined && value.maximumAmount >= value.targetAmount && value.includesLongDistanceTransport !== undefined
  return <><BuilderHeading question={question} headingRef={headingRef}/><div className="moa-money-grid"><MoneyEditor label={question.targetLabel} placeholder={question.targetPlaceholder} value={value.targetAmount} step={question.step} change={(targetAmount) => update({ targetAmount })}/><MoneyEditor label={question.maximumLabel} placeholder={question.maximumPlaceholder} value={value.maximumAmount} step={question.step} maximum change={(maximumAmount) => update({ maximumAmount })}/></div>{value.targetAmount!==undefined&&value.maximumAmount!==undefined&&value.maximumAmount<value.targetAmount&&<p className="moa-builder-error" role="alert">절대 상한은 목표 예산보다 낮을 수 없어요.</p>}<section className="moa-builder-block"><h2>{question.includeTransportLabel}</h2><div className="moa-segmented">{question.includeTransportOptions.map((option) => <button type="button" key={option.id} className={value.includesLongDistanceTransport === option.value ? 'selected' : ''} aria-pressed={value.includesLongDistanceTransport === option.value} onClick={() => update({ includesLongDistanceTransport: option.value })}>{option.label}</button>)}</div></section>{question.precisionFields?.length&&<details className="moa-precision"><summary>더 정확하게 맞추기 <Plus/></summary><p>비워둔 금액은 0으로 해석하지 않아요. 모두 선택 사항이에요.</p>{question.precisionFields.map((field) => { const precision = value.precision?.[field.id]; return <div key={field.id}><label><span>{field.label}</span><div>+ ₩<input inputMode="numeric" value={precision?.kind === 'amount' ? precision.amount.toLocaleString('ko-KR') : ''} disabled={precision?.kind === 'unknown'} placeholder="금액 입력" onChange={(event) => { const raw = event.target.value.replace(/\D/g, ''); const next = { ...(value.precision ?? {}) }; if (raw) next[field.id] = { kind: 'amount', amount: Number(raw) }; else delete next[field.id]; update({ precision: Object.keys(next).length ? next : undefined }) }}/></div></label><button type="button" className={precision?.kind === 'unknown' ? 'selected' : ''} aria-pressed={precision?.kind === 'unknown'} onClick={() => { const next = { ...(value.precision ?? {}) }; if (precision?.kind === 'unknown') delete next[field.id]; else next[field.id] = { kind: 'unknown' }; update({ precision: Object.keys(next).length ? next : undefined }) }}>잘 모르겠어요</button></div> })}</details>}<BuilderActions back={back} next={next} nextLabel={question.nextLabel} disabled={!valid}/></>
}

function RankedChoiceField({ question, answer, setAnswer, back, next, skip, headingRef }: { question: Extract<SurveyQuestion, { uiType: 'ranked-choice' }>; answer?: SurveyAnswerValue; setAnswer: (value: SurveyAnswerValue) => void; back: () => void; next: () => void; skip: () => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const selected = answer?.kind === 'ranked-choice' ? answer.optionIds : []
  const toggle = (id: string) => setAnswer({ kind: 'ranked-choice', optionIds: selected.includes(id) ? selected.filter((item) => item !== id) : selected.length < question.maximumSelections ? [...selected, id] : selected })
  const minimum = question.minimumSelections ?? (question.required ? 1 : 0)
  return <><BuilderHeading question={question} headingRef={headingRef}/><div className="moa-priority-grid">{question.options.map((item) => { const rank = selected.indexOf(item.id); return <button type="button" key={item.id} className={rank >= 0 ? 'selected' : ''} aria-pressed={rank >= 0} onClick={() => toggle(item.id)}><i className="moa-priority-icon"><OptionIcon option={item} kind="standard"/></i><span>{rank >= 0 ? `${rank + 1}순위` : '선택'}</span><strong>{item.label}</strong>{item.detail&&<small>{item.detail}</small>}</button> })}</div><p className="moa-builder-hint">{selected.length === 0 ? '먼저 하나를 골라보세요.' : selected.length < question.maximumSelections ? '하나 더 골라도 좋아요.' : '우선순위를 정했어요.'}</p><BuilderActions back={back} next={next} disabled={selected.length < minimum} skip={question.allowSkip ? skip : undefined} nextLabel={question.nextLabel}/></>
}

function ConstraintsField({ question, answer, setAnswer, back, next, skip, headingRef }: { question: ConstraintsQuestion; answer?: SurveyAnswerValue; setAnswer: (value: SurveyAnswerValue) => void; back: () => void; next: () => void; skip: () => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const [open, setOpen] = useState<string | null>(null)
  const [custom, setCustom] = useState<Record<string, string>>({})
  const groups = answer?.kind === 'constraints' ? answer.groups : {}
  const setItems = (groupId: string, items: ConstraintAnswerItem[]) => setAnswer({ kind: 'constraints', groups: { ...groups, [groupId]: items } })
  const toggleSuggestion = (group: ConstraintsQuestion['groups'][number], suggestion: ConstraintsQuestion['groups'][number]['suggestions'][number]) => {
    const items = groups[group.id] ?? []
    const existing = items.find((item) => item.id === suggestion.id)
    if (existing) setItems(group.id, items.filter((item) => item.id !== suggestion.id))
    else setItems(group.id, [...items, { id: suggestion.id, label: suggestion.label, levelId: suggestion.initialLevelId ?? group.defaultLevelId, confirmationOptionId: suggestion.initialConfirmationOptionId }])
  }
  const patch = (groupId: string, id: string, itemPatch: Partial<ConstraintAnswerItem>) => setItems(groupId, (groups[groupId] ?? []).map((item) => item.id === id ? { ...item, ...itemPatch } : item))
  const addCustom = (event: FormEvent, group: ConstraintsQuestion['groups'][number]) => { event.preventDefault(); const label = custom[group.id]?.trim(); if (!label) return; const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2)}`; setItems(group.id, [...(groups[group.id] ?? []), { id, label, levelId: group.defaultLevelId }]); setCustom({ ...custom, [group.id]: '' }) }
  const requiredConfirmationLevels = new Set(question.confirmationRequiredForLevelIds ?? [])
  const pending = Object.values(groups).flat().some((item) => requiredConfirmationLevels.has(item.levelId) && !item.confirmationOptionId)
  return <><BuilderHeading question={question} headingRef={headingRef}/><div className="moa-safety-list">{question.groups.map((group) => { const items = groups[group.id] ?? []; const expanded = open === group.id; return <section key={group.id} className={group.safetyCritical ? 'critical' : ''}><header><div>{group.safetyCritical ? <ShieldCheck/> : <Check/>}<span><strong>{group.label}</strong><small>{items.length ? `${items.length}개 추가됨` : group.emptyLabel}</small></span></div><div><button type="button" onClick={() => setItems(group.id, [])} className={items.length === 0 ? 'selected' : ''}>{group.emptyLabel}</button><button type="button" className="moa-safety-add" aria-expanded={expanded} aria-label={`${group.label} 조건 추가`} onClick={() => setOpen(expanded ? null : group.id)}><Plus/></button></div></header>{expanded&&<div className="moa-safety-detail"><div className="moa-safety-suggestions">{group.suggestions.map((suggestion) => <button type="button" key={suggestion.id} className={items.some((item) => item.id === suggestion.id) ? 'selected' : ''} aria-pressed={items.some((item) => item.id === suggestion.id)} onClick={() => toggleSuggestion(group, suggestion)}>{items.some((item) => item.id === suggestion.id)&&<Check/>}{suggestion.label}</button>)}</div><form onSubmit={(event) => addCustom(event, group)}><input value={custom[group.id] ?? ''} onChange={(event) => setCustom({ ...custom, [group.id]: event.target.value })} placeholder="직접 조건 입력"/><button type="submit">추가</button></form>{items.map((item) => <article key={item.id}><div><strong>{item.label}</strong><button type="button" onClick={() => setItems(group.id, items.filter((entry) => entry.id !== item.id))} aria-label={`${item.label} 삭제`}><X/></button></div><span>이 기준을 어느 정도로 지킬까요?</span><div className="moa-rule-levels">{question.levels.map((level) => <button type="button" key={level.id} className={item.levelId === level.id ? 'selected' : ''} aria-pressed={item.levelId === level.id} onClick={() => patch(group.id, item.id, { levelId: level.id, confirmationOptionId: requiredConfirmationLevels.has(level.id) ? undefined : item.confirmationOptionId })}>{level.label}</button>)}</div>{requiredConfirmationLevels.has(item.levelId)&&!item.confirmationOptionId&&<div className="moa-safety-confirm"><strong>이 조건의 적용 범위를 확인해 주세요.</strong>{question.confirmationOptions.map((option) => <button type="button" key={option.id} onClick={() => patch(group.id, item.id, { confirmationOptionId: option.id })}>{option.label}</button>)}</div>}</article>)}</div>}</section> })}</div>{pending&&<p className="moa-builder-error" role="alert">필수 조건의 적용 범위를 확인해 주세요.</p>}<BuilderActions back={back} next={next} disabled={pending} skip={question.allowSkip ? skip : undefined} nextLabel={question.nextLabel}/></>
}

function ResourcePoliciesField({ question, answer, setAnswer, back, next, skip, headingRef }: { question: ResourcePoliciesQuestion; answer?: SurveyAnswerValue; setAnswer: (value: SurveyAnswerValue) => void; back: () => void; next: () => void; skip: () => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const value = answer?.kind === 'resource-policies' ? answer : { kind: 'resource-policies' as const, policies: {} }
  return <><BuilderHeading question={question} headingRef={headingRef}/><OptionCards options={question.styleOptions} value={value.styleOptionId} choose={(option) => setAnswer({ ...value, styleOptionId: option.id })} kind="people"/><details className="moa-split-settings"><summary>{question.settingsLabel}<CaretDown/></summary>{question.resources.map((resource) => <div key={resource.id}><strong>{resource.label}</strong><div>{question.policyOptions.map((policy) => <button type="button" key={policy.id} className={value.policies[resource.id] === policy.id ? 'selected' : ''} aria-pressed={value.policies[resource.id] === policy.id} onClick={() => setAnswer({ ...value, policies: { ...value.policies, [resource.id]: policy.id } })}>{policy.label}</button>)}</div></div>)}</details><BuilderActions back={back} next={next} skip={question.allowSkip ? skip : undefined} nextLabel={question.nextLabel}/></>
}

function SingleChoiceField({ question, answer, autoAnswer, setAnswer, back, next, skip, headingRef }: { question: Extract<SurveyQuestion, { uiType: 'single-choice' }>; answer?: SurveyAnswerValue; autoAnswer: (value: SurveyAnswerValue, feedback: string) => void; setAnswer: (value: SurveyAnswerValue) => void; back: () => void; next: () => void; skip: () => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const selected = answer?.kind === 'single-choice' ? answer.optionId : undefined
  const choose = (option: SurveyOption) => { const value: SurveyAnswerValue = { kind: 'single-choice', optionId: option.id }; if (question.autoAdvance) autoAnswer(value, `${option.label} 답변을 저장했어요.`); else setAnswer(value) }
  if (question.presentation === 'comparison') {
    const [first, second, ...rest] = question.options
    return <><BuilderHeading question={question} headingRef={headingRef}/><div className="moa-adaptive">{first&&<article><span>첫 번째</span><h2>{first.label}</h2>{first.detail&&<p>{first.detail}</p>}</article>}<b>VS</b>{second&&<article><span>두 번째</span><h2>{second.label}</h2>{second.detail&&<p>{second.detail}</p>}</article>}</div><div className="moa-adaptive-actions">{[first, second, ...rest].filter(Boolean).map((option) => <button type="button" key={option.id} className={selected === option.id ? 'selected' : ''} aria-pressed={selected === option.id} onClick={() => choose(option)}>{option.label}</button>)}</div><BuilderActions back={back} next={next} disabled={!selected} skip={question.allowSkip ? skip : undefined} nextLabel={question.nextLabel}/></>
  }
  return <><BuilderHeading question={question} headingRef={headingRef}/>{question.presentation === 'route'&&<div className="moa-map-metaphor" aria-hidden="true"><MapPin/><i/><MapPin/><i/><MapPin/></div>}<OptionCards options={question.options} value={selected} choose={choose} kind={question.presentation ?? 'standard'}/><BuilderActions back={back} next={next} disabled={!selected} skip={question.allowSkip ? skip : undefined} nextLabel={question.nextLabel}/></>
}

function TagRatingsField({ question, answer, setAnswer, back, next, skip, headingRef }: { question: TagRatingsQuestion; answer?: SurveyAnswerValue; setAnswer: (value: SurveyAnswerValue) => void; back: () => void; next: () => void; skip: () => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const [active, setActive] = useState<string | null>(null)
  const ratings = answer?.kind === 'tag-ratings' ? answer.ratings : {}
  return <><BuilderHeading question={question} headingRef={headingRef}/><div className="moa-food-grid">{question.items.map((item) => { const rating = ratings[item.id]; const selectedChoice = question.choices.find((choice) => choice.answer.rating === rating?.rating && choice.answer.stance === rating?.stance); const expanded = active === item.id; return <article key={item.id} className={selectedChoice ? `rated ${selectedChoice.id}` : ''}><button type="button" aria-expanded={expanded} onClick={() => setActive(expanded ? null : item.id)}><ForkKnife/><strong>{item.label}</strong>{selectedChoice&&<small>{selectedChoice.label}</small>}<CaretDown/></button>{expanded&&<div>{question.choices.map((choice) => <button type="button" key={choice.id} className={selectedChoice?.id === choice.id ? 'selected' : ''} aria-pressed={selectedChoice?.id === choice.id} onClick={() => { setAnswer({ kind: 'tag-ratings', ratings: { ...ratings, [item.id]: { ...choice.answer } } }); setActive(null) }}>{choice.label}</button>)}</div>}</article> })}</div><BuilderActions back={back} next={next} skip={question.allowSkip ? skip : undefined} nextLabel={question.nextLabel}/></>
}

function TagEditor({ group, items, change }: { group: TagGroupsQuestion['groups'][number]; items: string[]; change: (items: string[]) => void }) {
  const [value, setValue] = useState('')
  const add = (label: string) => { const trimmed = label.trim(); if (!trimmed || items.includes(trimmed) || items.length >= group.limit) return; change([...items, trimmed]); setValue('') }
  return <section className="moa-tag-editor"><header><h2>{group.label}</h2><span>{items.length} / {group.limit}</span></header><div className="moa-tag-values">{items.map((item) => <span key={item}>{item}<button type="button" onClick={() => change(items.filter((value) => value !== item))} aria-label={`${item} 삭제`}><X/></button></span>)}</div><div className="moa-tag-suggestions">{group.suggestions.map((item) => <button type="button" key={item} disabled={items.length >= group.limit || items.includes(item)} onClick={() => add(item)}>+ {item}</button>)}</div><form onSubmit={(event) => { event.preventDefault(); add(value) }}><input value={value} onChange={(event) => setValue(event.target.value)} placeholder={group.placeholder} disabled={items.length >= group.limit}/><button type="submit" disabled={!value.trim() || items.length >= group.limit}>추가</button></form></section>
}

function TagGroupsField({ question, answer, setAnswer, back, next, skip, headingRef }: { question: TagGroupsQuestion; answer?: SurveyAnswerValue; setAnswer: (value: SurveyAnswerValue) => void; back: () => void; next: () => void; skip: () => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const value = answer?.kind === 'tag-groups' ? answer : { kind: 'tag-groups' as const, groups: {} }
  return <><BuilderHeading question={question} headingRef={headingRef}/><div className="moa-must-avoid-grid">{question.groups.map((group) => <TagEditor key={group.id} group={group} items={value.groups[group.id] ?? []} change={(items) => setAnswer({ ...value, groups: { ...value.groups, [group.id]: items } })}/>)}</div>{question.noteLabel&&<label className="moa-builder-note"><span>{question.noteLabel}</span><textarea rows={2} value={value.note ?? ''} onChange={(event) => setAnswer({ ...value, note: event.target.value || undefined })} placeholder={question.notePlaceholder}/></label>}<BuilderActions back={back} next={next} skip={question.allowSkip ? skip : undefined} nextLabel={question.nextLabel}/></>
}

function ProfileConfirmation({ question, answer, plan, answers, setAnswer, back, submit, submitting, headingRef }: { question: Extract<SurveyQuestion, { uiType: 'profile-confirmation' }>; answer?: SurveyAnswerValue; plan: SurveyPlanV4; answers: Record<string, SurveyAnswerV4>; setAnswer: (value: SurveyAnswerValue) => void; back: () => void; submit: (value: SurveyAnswerValue) => void; submitting: boolean; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const rememberForFuture = answer?.kind === 'profile-confirmation' ? answer.rememberForFuture : null
  const rows = [...plan.sections].sort((a, b) => a.displayOrder - b.displayOrder).map((section) => ({ section, items: plan.questions.filter((candidate) => candidate.sectionId === section.id && candidate.id !== question.id).sort((a, b) => a.displayOrder - b.displayOrder).flatMap((candidate) => getAnswerLabels(candidate, answers[candidate.id]?.value)) })).filter(({ items }) => items.length)
  return <div className="moa-final-profile"><BuilderHeading question={question} headingRef={headingRef}/><section className="moa-final-card"><header><span>{plan.title.toUpperCase()}</span><h2>직접 선택한 답변 {Object.keys(answers).length}개</h2></header>{rows.map(({ section, items }) => <div key={section.id}><span>{section.label}</span><ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul><button type="button" onClick={back}>수정</button></div>)}</section><section className="moa-memory-choice"><div><strong>{question.rememberLabel}</strong>{question.rememberDescription&&<small>{question.rememberDescription}</small>}</div><div className="moa-segmented"><button type="button" className={rememberForFuture === false ? 'selected' : ''} aria-pressed={rememberForFuture === false} onClick={() => setAnswer({ kind: 'profile-confirmation', rememberForFuture: false })}>이번 여행에만 사용</button><button type="button" className={rememberForFuture === true ? 'selected' : ''} aria-pressed={rememberForFuture === true} onClick={() => setAnswer({ kind: 'profile-confirmation', rememberForFuture: true })}>다음 여행에도 기억</button></div></section><div className="moa-final-actions"><button type="button" onClick={back}>수정하기</button><button type="button" disabled={submitting || rememberForFuture === null} onClick={() => { if (rememberForFuture !== null) submit({ kind: 'profile-confirmation', rememberForFuture }) }}>{submitting ? '저장 중…' : question.submitLabel} <ArrowRight/></button></div></div>
}

export function QuestionRenderer(props: QuestionRendererProps) {
  const { question, answer, headingRef, onAnswer, onAutoAnswer, onBack, onNext, onSkip } = props
  if ((answer?.kind === 'unknown' || answer?.kind === 'skipped') && question.uiType !== 'intro' && question.uiType !== 'transition' && question.uiType !== 'profile-confirmation') {
    const nextLabel = 'nextLabel' in question ? question.nextLabel : undefined
    return <><BuilderHeading question={question} headingRef={headingRef}/><div className="moa-answer-absence"><strong>{answer.kind === 'unknown' ? '잘 모르겠어요' : '건너뛴 질문이에요'}</strong><span>이 상태를 바꾸지 않고 계속할 수 있어요.</span></div><BuilderActions back={onBack} next={onNext} nextLabel={nextLabel}/></>
  }
  switch (question.uiType) {
    case 'intro': return <section className="moa-builder-intro" style={{ backgroundImage: `linear-gradient(90deg,rgba(10,30,37,.88),rgba(10,30,37,.44)),url(${props.destinationImage})` }}><button type="button" className="moa-builder-intro-back" onClick={props.onExit}><ArrowLeft/>여행 방</button><div><span>{props.destinationName.toUpperCase()}</span><h1 ref={headingRef}>{question.title}</h1>{question.description&&<p>{question.description}</p>}<button type="button" onClick={onNext}>{question.actionLabel} <ArrowRight/></button>{question.footnote&&<small>{question.footnote}</small>}</div></section>
    case 'date-range': return <DateRangeField question={question} answer={answer} setAnswer={onAnswer} back={onBack} next={onNext} skip={onSkip} headingRef={headingRef}/>
    case 'money-range': return <MoneyRangeField question={question} answer={answer} setAnswer={onAnswer} back={onBack} next={onNext} headingRef={headingRef}/>
    case 'ranked-choice': return <RankedChoiceField question={question} answer={answer} setAnswer={onAnswer} back={onBack} next={onNext} skip={onSkip} headingRef={headingRef}/>
    case 'constraints': return <ConstraintsField question={question} answer={answer} setAnswer={onAnswer} back={onBack} next={onNext} skip={onSkip} headingRef={headingRef}/>
    case 'resource-policies': return <ResourcePoliciesField question={question} answer={answer} setAnswer={onAnswer} back={onBack} next={onNext} skip={onSkip} headingRef={headingRef}/>
    case 'single-choice': return <SingleChoiceField question={question} answer={answer} autoAnswer={onAutoAnswer} setAnswer={onAnswer} back={onBack} next={onNext} skip={onSkip} headingRef={headingRef}/>
    case 'transition': return <div className="moa-city-transition"><img src={question.imageUrl ?? props.destinationImage} alt=""/><div>{question.eyebrow&&<span>{question.eyebrow}</span>}<h1 ref={headingRef} tabIndex={-1}>{question.title}</h1>{question.description&&<p>{question.description}</p>}<div className="moa-city-transition-actions"><button type="button" onClick={onNext}>{question.actionLabel} <ArrowRight/></button><button type="button" className="back" onClick={onBack}><ArrowLeft/>이전</button></div></div></div>
    case 'tag-ratings': return <TagRatingsField question={question} answer={answer} setAnswer={onAnswer} back={onBack} next={onNext} skip={onSkip} headingRef={headingRef}/>
    case 'tag-groups': return <TagGroupsField question={question} answer={answer} setAnswer={onAnswer} back={onBack} next={onNext} skip={onSkip} headingRef={headingRef}/>
    case 'free-text': { const text = answer?.kind === 'free-text' ? answer.text : ''; return <><BuilderHeading question={question} headingRef={headingRef}/><label className="moa-builder-note"><textarea rows={question.multiline === false ? 1 : 4} maxLength={question.maximumLength} value={text} onChange={(event) => onAnswer({ kind: 'free-text', text: event.target.value })} placeholder={question.placeholder}/></label><BuilderActions back={onBack} next={onNext} disabled={question.required && !text.trim()} skip={question.allowSkip ? onSkip : undefined} nextLabel={question.nextLabel}/></> }
    case 'profile-confirmation': return <ProfileConfirmation question={question} answer={answer} plan={props.plan} answers={props.answers} setAnswer={onAnswer} back={onBack} submit={props.onSubmit} submitting={props.submitting} headingRef={headingRef}/>
  }
}
