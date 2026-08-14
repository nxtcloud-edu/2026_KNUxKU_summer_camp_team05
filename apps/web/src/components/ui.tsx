import { useState, type ReactNode } from 'react'
import { ArrowRight, Check, CheckCircle, Plus } from '@phosphor-icons/react'
import type { Coins } from '@phosphor-icons/react'

export function Logo() {
  return (
    <div className="moa-logo">
      <img src="/assets/moa-wordmark.png" alt="MOA" />
    </div>
  )
}

export function Page({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return <div className={`moa-page ${narrow ? 'narrow' : ''}`}>{children}</div>
}

export function StickyAction({
  note,
  button,
  onClick,
  disabled = false,
}: {
  note: string
  button: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <div className="moa-sticky">
      <p>
        <CheckCircle weight="fill" />
        {note}
      </p>
      <button className="moa-button" onClick={onClick} disabled={disabled}>
        {button}
        <ArrowRight />
      </button>
    </div>
  )
}

export function SurveyCard({
  icon: Icon,
  title,
  children,
  full = false,
}: {
  icon: typeof Coins
  title: string
  children: ReactNode
  full?: boolean
}) {
  return (
    <section className={`moa-survey-card ${full ? 'full' : ''}`}>
      <header>
        <span>
          <Icon weight="duotone" />
        </span>
        <h2>{title}</h2>
      </header>
      {children}
    </section>
  )
}

export function ChipGroup({
  items,
  selected,
  select,
  plus = false,
}: {
  items: string[]
  selected: string[]
  select: (x: string) => void
  plus?: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [custom, setCustom] = useState('')
  const visibleItems = [...items, ...selected.filter((item) => !items.includes(item))]

  const addCustom = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = custom.trim()
    if (!trimmed) return
    if (!selected.includes(trimmed)) select(trimmed)
    setCustom('')
    setAdding(false)
  }

  return (
    <div className="moa-chip-group">
      {visibleItems.map((x) => (
        <button
          type="button"
          aria-pressed={selected.includes(x)}
          className={selected.includes(x) ? 'active' : ''}
          onClick={() => select(x)}
          key={x}
        >
          {selected.includes(x) && <Check />}
          {x}
        </button>
      ))}
      {plus && !adding && (
        <button type="button" onClick={() => setAdding(true)}>
          <Plus />
          직접 입력
        </button>
      )}
      {plus && adding && (
        <form className="moa-chip-custom" onSubmit={addCustom}>
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="조건 입력"
            autoFocus
          />
          <button type="submit">추가</button>
        </form>
      )}
    </div>
  )
}

export function PersonaBlock({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Coins
  title: string
  children: ReactNode
}) {
  return (
    <section className="moa-persona-block">
      <header>
        <Icon weight="duotone" />
        <span>{title}</span>
      </header>
      <div>{children}</div>
    </section>
  )
}
