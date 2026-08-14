import { ArrowRight, Check, Clock, SpinnerGap, UsersThree, WarningCircle } from '@phosphor-icons/react'
import { Page } from '../../components/ui'
import type { DateResolutionOption, DateResolutionSnapshot, PlanningSnapshot } from './api/planningRepository'

/**
 * Date resolution and the planning run.
 *
 * Both screens render what the repository reports and nothing else: no invented
 * dates, no simulated percentage, and a stalled run says why it stalled.
 */

const sourceNote = (source: 'fixture' | 'live') => source === 'fixture'
  ? '지금 보이는 값은 프론트엔드 데모 데이터예요. 실제 계산은 서버의 참여자 응답이 필요해요.'
  : '서버가 계산한 실제 결과예요.'

function ResolvedDates({ label, detail, source, next }: { label: string; detail: string; source: 'fixture' | 'live'; next: () => void }) {
  return <Page narrow><section className="moa-resolution-success">
    <div className="moa-status-mark success"><Check weight="bold" /></div>
    <span className="moa-kicker">DATE RESOLVED</span>
    <h1>여행 날짜를 정했어요.</h1>
    <strong>{label}</strong>
    <p>{detail}</p>
    <aside className="moa-demo-note">{sourceNote(source)}</aside>
    <button className="moa-button big" onClick={next}>MOA에게 계획 맡기기 <ArrowRight /></button>
  </section></Page>
}

export function DateResolutionScreen({ snapshot, loading, error, choose, next, back }: {
  snapshot: DateResolutionSnapshot | null
  loading: boolean
  error: string | null
  choose: (option: DateResolutionOption) => Promise<void>
  next: () => void
  back: () => void
}) {
  if (loading && !snapshot) {
    return <Page narrow><section className="moa-survey-status" role="status"><strong>가능한 날짜를 확인하고 있어요.</strong></section></Page>
  }

  if (error || !snapshot) {
    return <Page narrow><section className="moa-survey-status" role="alert">
      <strong>날짜 정보를 불러오지 못했어요.</strong>
      <p>{error ?? '잠시 후 다시 시도해 주세요.'}</p>
      <button type="button" onClick={back}>여행 방으로 돌아가기</button>
    </section></Page>
  }

  if (snapshot.status === 'resolved' && snapshot.resolved) {
    return <ResolvedDates label={snapshot.resolved.label} detail={snapshot.resolved.detail} source={snapshot.source} next={next} />
  }

  if (snapshot.status === 'unavailable') {
    return <Page narrow>
      <button className="moa-back" onClick={back}>여행 방으로</button>
      <div className="moa-product-head">
        <span className="moa-kicker">DATE RESOLUTION</span>
        <h1>아직 여행 날짜가 정해지지 않았어요.</h1>
        <p>{snapshot.reason ?? '참여자들의 가능한 날짜가 더 모이면 날짜를 확정할 수 있어요.'}</p>
      </div>
      <div className="moa-planning-actions">
        <button className="moa-button ghost big" onClick={back}>여행 방으로</button>
        <button className="moa-button big" onClick={next}>계획 진행 상태 보기 <ArrowRight /></button>
      </div>
    </Page>
  }

  return <Page narrow>
    <button className="moa-back" onClick={back}>여행 방으로</button>
    <div className="moa-product-head">
      <span className="moa-kicker">DATE RESOLUTION</span>
      <h1>모두가 가능한 일정이 없어요.</h1>
      <p>가능한 날짜를 비교해 가장 현실적인 선택지만 정리했어요.</p>
    </div>
    <div className="moa-date-options">
      {snapshot.options.map((option) => <button key={option.id} className={option.recommended ? 'recommended' : ''} disabled={loading} onClick={() => { void choose(option) }}>
        <b>{option.code}</b>
        <div><strong>{option.rangeLabel}</strong><span><UsersThree />{option.attendeeLabel}</span><small>{option.detail}</small></div>
        <ArrowRight />
      </button>)}
      <button onClick={back}><b>{String.fromCharCode(65 + snapshot.options.length)}</b><div><strong>가능 일정 다시 확인</strong><small>친구들에게 날짜 입력을 다시 요청해요.</small></div><ArrowRight /></button>
    </div>
    <aside className="moa-demo-note">{snapshot.reason ?? sourceNote(snapshot.source)}</aside>
  </Page>
}

const pendingSteps: PlanningSnapshot['steps'] = [
  { id: 'transport', label: '오는 길·가는 길', state: 'pending' },
  { id: 'stay', label: '체류 거점·숙소', state: 'pending' },
  { id: 'activity', label: '갈 곳·할 일', state: 'pending' },
  { id: 'dining', label: '식사', state: 'pending' },
  { id: 'schedule', label: '날짜별 일정·현지 이동', state: 'pending' },
  { id: 'budget', label: '최종 확인', state: 'pending' },
]

const stepStatusLabels: Record<PlanningSnapshot['steps'][number]['state'], string> = {
  done: '검토 완료',
  active: '검토 중',
  pending: '대기',
  failed: '멈춤',
}

export function PlanningScreen({ snapshot, loading, error, next, leave }: {
  snapshot: PlanningSnapshot | null
  loading: boolean
  error: string | null
  next: () => void
  leave: () => void
}) {
  const steps = snapshot?.steps ?? pendingSteps
  const finished = snapshot?.finished ?? false
  const failed = snapshot?.runStatus === 'FAILED' || snapshot?.failureReason !== null && snapshot?.failureReason !== undefined
  const percent = snapshot?.percent ?? 0

  return <Page narrow><section className="moa-planning-screen">
    <div className={`moa-status-mark ${failed ? 'verdict' : finished ? 'success' : 'loading'}`}>
      {failed ? <WarningCircle /> : finished ? <Check weight="bold" /> : <SpinnerGap />}
    </div>
    <span className="moa-kicker">{snapshot?.source === 'live' ? 'PLANNING' : 'PLANNING DEMO'}</span>
    <h1>{failed ? '회의가 중간에 멈췄어요.' : finished ? '회의가 끝났어요.' : 'MOA가 대신 논의하고 있어요.'}</h1>
    <p>{loading && !snapshot ? '진행 상태를 확인하고 있어요.' : `각자의 일정, 예산, 꼭 지킬 조건과 취향을 함께 비교해요. (${percent}%)`}</p>

    <div className="moa-planning-list">{steps.map((step, index) => <div key={step.id} className={step.state === 'done' ? 'done' : step.state === 'active' ? 'active' : ''}>
      <span>{step.state === 'done' ? <Check weight="bold" /> : step.state === 'active' ? <SpinnerGap /> : step.state === 'failed' ? <WarningCircle /> : index + 1}</span>
      <strong>{step.label}</strong>
      <small>{stepStatusLabels[step.state]}</small>
    </div>)}</div>

    {snapshot?.failureReason && <aside className="moa-demo-note" role="alert">멈춘 이유: {snapshot.failureReason}</aside>}
    {snapshot !== null && snapshot.pendingApprovals > 0 && <aside className="moa-demo-note" role="status">방장 승인을 기다리는 항목이 {snapshot.pendingApprovals}건 있어 진행이 멈춰 있어요.</aside>}
    {error && <aside className="moa-demo-note" role="alert">{error}</aside>}
    {snapshot?.source !== 'live' && <aside className="moa-demo-note">{sourceNote('fixture')} 실제 예약이나 구매는 실행하지 않아요.</aside>}

    <div className="moa-planning-actions">
      <button className="moa-button ghost big" onClick={leave}>이 화면 나가기</button>
      <button className="moa-button big" onClick={next} disabled={!finished && snapshot?.source === 'live'}>
        {finished ? '우리 여행 보기' : snapshot?.source === 'live' ? '결과 준비 중' : '데모 결과 보기'} <ArrowRight />
      </button>
    </div>
    <p className="moa-leave-safe"><Clock />이 화면을 나가도 괜찮아요. 다시 들어오면 진행 상태를 이어서 볼 수 있어요.</p>
  </section></Page>
}
