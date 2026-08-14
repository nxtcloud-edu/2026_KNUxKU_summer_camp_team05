import { useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, Info, SpinnerGap, WarningCircle } from '@phosphor-icons/react'
import { demoRerunFlow, demoRerunImpact, reopenOptions } from '../../product/mockData'
import type { DecisionSummary, ReopenReason, RerunDiff } from '../../product/types'
import { Page } from '../../components/ui'

const debugVisible = () => import.meta.env.DEV
  && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('debug') === '1'

function FlowHeader({ label, title, children }: { label: string; title: string; children?: ReactNode }) {
  return <header className="moa-rediscussion-head"><span>{label}</span><h1>{title}</h1>{children}</header>
}

function ReDiscussionActions({ secondary, secondaryAction, primary, primaryAction, disabled = false, sticky = false }: { secondary?: string; secondaryAction?: () => void; primary: string; primaryAction: () => void; disabled?: boolean; sticky?: boolean }) {
  return <div className={`moa-rediscussion-actions${sticky ? ' sticky' : ''}`}>
    {secondary && secondaryAction && <button type="button" className="secondary" onClick={secondaryAction}>{secondary}</button>}
    <button type="button" className="primary" disabled={disabled} onClick={primaryAction}>{primary}<ArrowRight /></button>
  </div>
}

export function ReopenFlow({ decision, reason, choice, applyFuture, setReason, setChoice, setApplyFuture, back, start }: { decision: DecisionSummary; reason: ReopenReason | null; choice: 'station' | 'room'; applyFuture: boolean; setReason: (reason: ReopenReason) => void; setChoice: (choice: 'station' | 'room') => void; setApplyFuture: (value: boolean) => void; back: () => void; start: () => void }) {
  const [step, setStep] = useState<'reason' | 'followup' | 'confirm' | 'impact'>('reason')
  const copy = demoRerunFlow.copy
  const selectedChoice = demoRerunFlow.followUp.choices.find((item) => item.id === choice) ?? demoRerunFlow.followUp.choices[0]
  const impactItems = demoRerunImpact.affectedDecisionDetails
    ?? demoRerunImpact.affectedDecisions.map((label) => ({ label, detail: undefined }))
  const goToStep = (next: typeof step) => {
    setStep(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const previous = () => goToStep(step === 'impact' ? 'confirm' : step === 'confirm' ? 'followup' : 'reason')

  return <Page narrow>
    <div className={`moa-rediscussion-page is-${step}`}>
      <button className="moa-back moa-rediscussion-back" onClick={step === 'reason' ? back : previous}><ArrowLeft />{copy.back}</button>

      {step === 'reason' && <>
        <FlowHeader label={copy.start.label} title={copy.start.title}>
          <p><strong>{decision.title}</strong> {copy.start.decisionDescriptionSuffix}</p>
        </FlowHeader>
        <div className="moa-reopen-options moa-rediscussion-options">
          {reopenOptions.map((option) => <button type="button" key={option.id} className={reason === option.id ? 'active' : ''} aria-pressed={reason === option.id} onClick={() => setReason(option.id)}>
            <i aria-hidden="true" />
            <strong>{option.label}</strong>
          </button>)}
        </div>
        {demoRerunFlow.limitInfo && <details className="moa-rediscussion-info"><summary>{copy.start.infoSummary}<Info /><ArrowRight /></summary><p>{demoRerunFlow.limitInfo}</p></details>}
        <ReDiscussionActions primary={copy.start.nextAction} primaryAction={() => goToStep('followup')} disabled={!reason} sticky />
      </>}

      {step === 'followup' && <>
        <FlowHeader label={demoRerunFlow.followUp.label} title={demoRerunFlow.followUp.title}><p>{demoRerunFlow.followUp.description}</p></FlowHeader>
        <section className="moa-followup moa-adaptive-followup">
          {demoRerunFlow.followUp.choices.map((item) => <button type="button" key={item.id} className={choice === item.id ? 'active' : ''} aria-pressed={choice === item.id} onClick={() => setChoice(item.id)}>
            <i aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.description}</small></span>
          </button>)}
        </section>
        <ReDiscussionActions primary={copy.followUpAction} primaryAction={() => goToStep('confirm')} sticky />
      </>}

      {step === 'confirm' && <>
        <FlowHeader label={copy.confirm.label} title={copy.confirm.title}><p>{copy.confirm.description}</p></FlowHeader>
        <section className="moa-change-summary moa-preference-change-summary">
          <div className="moa-preference-changes">
            {selectedChoice.changes.map((change) => <article key={change.label}><span>{change.label}</span><p><strong>{change.before}</strong><ArrowRight /><b>{change.after}</b></p></article>)}
          </div>
          <label className="moa-check-row moa-memory-scope">
            <input type="checkbox" checked={applyFuture} onChange={(event) => setApplyFuture(event.target.checked)} />
            <span><Check /></span>
            <div><strong>{copy.confirm.rememberLabel}</strong><small>{copy.confirm.rememberDescription}</small></div>
          </label>
        </section>
        <ReDiscussionActions secondary={copy.confirm.editAction} secondaryAction={() => goToStep('followup')} primary={copy.confirm.confirmAction} primaryAction={() => goToStep('impact')} sticky />
      </>}

      {step === 'impact' && <>
        <FlowHeader label={copy.impact.label} title={copy.impact.title}><p><strong>{decision.categoryLabel}</strong> {copy.impact.descriptionSuffix}</p></FlowHeader>
        <section className="moa-impact-preview">
          <div className="moa-impact-list">{impactItems.map((item) => <article key={item.label}><Check /><div><strong>{item.label}</strong>{item.detail && <span>{item.detail}</span>}</div></article>)}</div>
          <dl className="moa-impact-meta">
            <div><dt>{copy.impact.countLabel}</dt><dd>{demoRerunImpact.decisionCount}{copy.impact.countSuffix}</dd></div>
            {demoRerunImpact.estimatedTimeLabel && <div><dt>{copy.impact.durationLabel}</dt><dd>{demoRerunImpact.estimatedTimeLabel}</dd></div>}
            {demoRerunImpact.bookingImpact && <div><dt>{copy.impact.bookingLabel}</dt><dd>{demoRerunImpact.bookingImpact}</dd></div>}
          </dl>
        </section>
        {debugVisible() && <aside className="moa-rediscussion-debug">{demoRerunFlow.debug.impactNote}</aside>}
        <ReDiscussionActions primary={copy.impact.action} primaryAction={start} sticky />
      </>}
    </div>
  </Page>
}

export function RerunProcessing({ decision, next, leave }: { decision: DecisionSummary; next: () => void; leave: () => void }) {
  const copy = demoRerunFlow.copy.processing
  return <Page narrow><section className="moa-planning-screen moa-rediscussion-processing">
    <div className="moa-status-mark loading"><SpinnerGap /></div>
    <span className="moa-kicker">{copy.label}</span>
    <h1>{decision.categoryLabel} {copy.titleSuffix}</h1>
    <p>{copy.criterionPrefix} · {demoRerunFlow.processing.criterion}</p>
    <div className="moa-planning-list">{demoRerunFlow.processing.steps.map((item, index) => <div key={item} className={index === 0 ? 'active' : ''}><span>{index === 0 ? <SpinnerGap /> : index + 1}</span><strong>{item}</strong><small>{index === 0 ? copy.activeStatus : copy.pendingStatus}</small></div>)}</div>
    {debugVisible() && <aside className="moa-rediscussion-debug">{demoRerunFlow.debug.processingNote}</aside>}
    <ReDiscussionActions secondary={copy.leaveAction} secondaryAction={leave} primary={copy.resultAction} primaryAction={next} />
  </section></Page>
}

export function RerunResult({ diff, back, evidence }: { diff: RerunDiff; back: () => void; evidence: () => void }) {
  const copy = demoRerunFlow.copy.result
  return <Page narrow><section className="moa-rerun-result moa-updated-result">
    <div className={`moa-status-mark ${diff.changed ? 'success' : 'verdict'}`}>{diff.changed ? <Check weight="bold" /> : <WarningCircle />}</div>
    <span className="moa-kicker">{copy.label}</span>
    <h1>{copy.title}</h1>
    <p className="moa-updated-result-description">{copy.description}</p>
    <section className="moa-updated-comparison">
      <h2>{diff.summaryTitle ?? (diff.changed ? copy.changedHeading : copy.unchangedHeading)}</h2>
      {diff.changed && <div className="moa-before-after"><div><span>{copy.beforeLabel}</span><strong>{diff.beforeTitle}</strong></div><ArrowRight /><div><span>{copy.afterLabel}</span><strong>{diff.afterTitle}</strong></div></div>}
    </section>
    {diff.metrics.length > 0 && <dl className="moa-updated-metrics">{diff.metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd><span>{metric.before}</span><ArrowRight /><strong>{metric.after}</strong></dd></div>)}</dl>}
    <section className="moa-updated-reason"><h2>{diff.changed ? copy.changedReasonTitle : copy.unchangedReasonTitle}</h2><p>{diff.reason}</p><ul>{diff.evidenceChanges.map((item) => <li key={item}><Check />{item}</li>)}</ul></section>
    {diff.bookingReadinessChange && <aside className="moa-updated-booking-warning"><strong>{copy.bookingWarningTitle}</strong><p>{diff.bookingReadinessChange}</p></aside>}
    <ReDiscussionActions secondary={copy.evidenceAction} secondaryAction={evidence} primary={copy.returnAction} primaryAction={back} />
  </section></Page>
}
