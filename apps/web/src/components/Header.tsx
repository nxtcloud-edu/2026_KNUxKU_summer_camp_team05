import { CaretRight, UsersThree } from '@phosphor-icons/react'
import { Logo } from './ui'
import type { Stage } from '../types'
import { stageNav } from '../types'

export function Header({ stage, destinationLabel, home, room, profile, userInitial }: {
  stage: Stage
  destinationLabel: string
  home: () => void
  room: () => void
  profile: () => void
  userInitial: string
}) {
  return <header className="moa-header"><button onClick={home} aria-label="MOA 처음 화면"><Logo/></button><div className="moa-breadcrumb"><span>{destinationLabel}</span><CaretRight/><strong>{stageNav[stage]}</strong></div><div className="moa-header-actions"><button onClick={room}><UsersThree/>여행 방</button><button className="moa-avatar" onClick={profile} aria-label="프로필 또는 로그인 열기">{userInitial}</button></div></header>
}
