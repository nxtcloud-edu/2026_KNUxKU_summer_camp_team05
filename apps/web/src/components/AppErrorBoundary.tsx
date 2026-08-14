import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ArrowRight, WarningCircle } from '@phosphor-icons/react'

type AppErrorBoundaryProps = {
  children: ReactNode
}

type AppErrorBoundaryState = {
  failed: boolean
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('MOA application error', error, info.componentStack)
  }

  private goHome = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('stage', 'landing')
    url.searchParams.delete('mode')
    url.searchParams.delete('presentation')
    url.searchParams.delete('embedded')
    window.location.assign(url)
  }

  render() {
    if (!this.state.failed) return this.props.children

    return <main className="moa-app-error" role="alert">
      <WarningCircle />
      <span>MOA ERROR</span>
      <h1>화면을 표시하지 못했어요</h1>
      <p>저장된 답변은 브라우저에 그대로 남아 있어요. 새로고침하거나 처음 화면으로 돌아가 다시 시작해주세요.</p>
      <div>
        <button className="moa-button big" type="button" onClick={() => window.location.reload()}>새로고침<ArrowRight /></button>
        <button className="moa-button big ghost" type="button" onClick={this.goHome}>처음 화면으로</button>
      </div>
    </main>
  }
}
