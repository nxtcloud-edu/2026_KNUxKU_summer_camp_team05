import type { ReactNode } from 'react'
import { ArrowRight, CheckCircle } from '@phosphor-icons/react'

export function SurveyShell({ step, title, copy, children, next, nextLabel = '다음', disabled = false }: {
  /** Zero-based position in the five-part preference flow. */
  step: number
  time?: string
  title: string
  copy: string
  children: ReactNode
  next: () => void
  nextLabel?: string
  disabled?: boolean
}) {
  const currentStep = step + 1
  return <div className="moa-page narrow">
    <SurveyProgress step={currentStep} />
    <div className="moa-survey-title">
      <span className="moa-kicker">PART {currentStep} OF 5</span>
      <h1>{title}</h1>
      <p>{copy}</p>
    </div>
    {children}
    <div className="moa-sticky">
      <p><CheckCircle weight="fill" />{disabled ? '먼저 답을 골라주세요' : currentStep < 5 ? '답변은 자동으로 저장돼요' : '이제 내 편을 만들 차례예요'}</p>
      <button className="moa-button" onClick={next} disabled={disabled}>{nextLabel}<ArrowRight /></button>
    </div>
  </div>
}

function SurveyProgress({ step }: { step: number }) {
  return <div className="moa-survey-progress">
    <div>{[1,2,3,4,5].map((number) => <span className={number <= step ? 'active' : ''} key={number} />)}</div>
    <p><strong>{step} / 5</strong><small>취향 입력</small></p>
  </div>
}
