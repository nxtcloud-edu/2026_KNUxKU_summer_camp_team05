import { useEffect, useState } from 'react'
import { ArrowLeft, DeviceMobile } from '@phosphor-icons/react'
import { MoaProductFlow } from './features/flow/MoaProductFlow'

const phoneViewport = { width: 390, height: 844 }
const phoneFrame = { width: 410, height: 864 }

function phoneDemoUrls() {
  const appUrl = new URL(window.location.href)
  appUrl.searchParams.delete('presentation')
  appUrl.searchParams.set('embedded', 'phone')
  appUrl.searchParams.set('stage', 'landing')
  appUrl.searchParams.delete('mode')
  appUrl.searchParams.delete('decisionId')
  appUrl.searchParams.delete('tripId')
  appUrl.searchParams.delete('planVersionId')
  appUrl.searchParams.delete('roundId')

  const exitUrl = new URL(appUrl)
  exitUrl.searchParams.delete('embedded')
  return { appUrl: appUrl.toString(), exitUrl: exitUrl.toString() }
}

function PhoneDemoPresentation() {
  const [scale, setScale] = useState(1)
  const { appUrl, exitUrl } = phoneDemoUrls()

  useEffect(() => {
    const updateScale = () => {
      const widthScale = (window.innerWidth - 64) / phoneFrame.width
      const heightScale = (window.innerHeight - 138) / phoneFrame.height
      setScale(Math.min(1, Math.max(.58, Math.min(widthScale, heightScale))))
    }
    updateScale()
    window.addEventListener('resize', updateScale)
    return () => window.removeEventListener('resize', updateScale)
  }, [])

  return <main className="moa-phone-presentation">
    <header className="moa-phone-presentation-header">
      <div><DeviceMobile aria-hidden="true" /><span><small>MOA PRESENTATION</small><strong>폰 데모</strong></span></div>
      <a href={exitUrl}><ArrowLeft />데스크톱으로 돌아가기</a>
    </header>
    <div className="moa-phone-device-stage" style={{ width: phoneFrame.width * scale, height: phoneFrame.height * scale }}>
      <div className="moa-phone-device" style={{ transform: `scale(${scale})` }}>
        <i className="moa-phone-side-button top" aria-hidden="true" />
        <i className="moa-phone-side-button middle" aria-hidden="true" />
        <i className="moa-phone-side-button bottom" aria-hidden="true" />
        <div className="moa-phone-screen">
          <div className="moa-phone-status-bar" aria-hidden="true">
            <strong>9:41</strong>
            <span>
              <svg className="signal" viewBox="0 0 16 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="4.3" y="6" width="3" height="6" rx="1"/><rect x="8.7" y="3" width="3" height="9" rx="1"/><rect x="13" y="0" width="3" height="12" rx="1"/></svg>
              <svg className="wifi" viewBox="0 0 16 12"><path d="M1 3.7a10.5 10.5 0 0 1 14 0M3.5 6.4a6.8 6.8 0 0 1 9 0M6.2 9a2.8 2.8 0 0 1 3.6 0"/><circle cx="8" cy="11" r="1"/></svg>
              <svg className="battery" viewBox="0 0 24 12"><rect x="1" y="1" width="19" height="10" rx="2"/><rect x="3" y="3" width="15" height="6" rx="1"/><path d="M21 4h1.5c.8 0 1.5.7 1.5 1.5v1c0 .8-.7 1.5-1.5 1.5H21z"/></svg>
            </span>
          </div>
          <span className="moa-phone-island" aria-hidden="true" />
          <iframe
            src={appUrl}
            title="MOA 모바일 앱 데모"
            width={phoneViewport.width}
            height={phoneViewport.height - 47}
            allow="clipboard-write"
          />
          <span className="moa-phone-home-indicator" aria-hidden="true" />
        </div>
      </div>
    </div>
  </main>
}

export default function App() {
  const query = new URLSearchParams(window.location.search)
  const phonePresentation = query.get('presentation') === 'phone' && query.get('embedded') !== 'phone'
  return phonePresentation ? <PhoneDemoPresentation /> : <MoaProductFlow />
}
