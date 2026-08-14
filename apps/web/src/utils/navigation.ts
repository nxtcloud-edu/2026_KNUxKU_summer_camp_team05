import type { ReplayRequest } from '../features/replay/types'
import { demoStages, resultModes, type ResultMode, type Stage } from '../types'
import { readStorage } from './storage'

const stageStorageKey = 'moa-stage'
const replayQueryKeys = ['tripId', 'planVersionId', 'roundId'] as const
const decisionStages: Stage[] = ['decision', 'reopen', 'rerun-processing', 'updated-result']

type MoaHistoryState = {
  stage?: Stage
  mode?: ResultMode
  decisionId?: string
  returnStage?: Stage
}

export type ReplayNavigationState = ReplayRequest & { roundId?: string }

const isStage = (value: string | null): value is Stage =>
  value !== null && demoStages.includes(value as Stage)

const isResultMode = (value: string | null): value is ResultMode =>
  value !== null && resultModes.some(({ id }) => id === value)

const queryValue = (query: URLSearchParams, key: string) => query.get(key)?.trim() || undefined
const isDecisionStage = (stage: Stage) => decisionStages.includes(stage)

export function readStageFromUrl(): Stage | null {
  const queryStage = new URLSearchParams(window.location.search).get('stage')
  return isStage(queryStage) ? queryStage : null
}

export function readResultModeFromUrl(): ResultMode | null {
  const queryMode = new URLSearchParams(window.location.search).get('mode')
  return isResultMode(queryMode) ? queryMode : null
}

export function readDecisionIdFromUrl(): string | undefined {
  return queryValue(new URLSearchParams(window.location.search), 'decisionId')
}

export function readReplayNavigationState(): ReplayNavigationState | null {
  const query = new URLSearchParams(window.location.search)
  const tripId = queryValue(query, 'tripId')
  const planVersionId = queryValue(query, 'planVersionId')
  if (!tripId || !planVersionId) return null

  return {
    tripId,
    planVersionId,
    decisionId: queryValue(query, 'decisionId'),
    roundId: queryValue(query, 'roundId'),
  }
}

export function readInitialStage(): Stage {
  const queryStage = readStageFromUrl()
  if (queryStage) return queryStage

  const savedStage = readStorage('local', stageStorageKey)
  return isStage(savedStage) ? savedStage : 'landing'
}

export function readInitialResultMode(): ResultMode {
  return readResultModeFromUrl() ?? 'overview'
}

export function canReturnToStage(stage: Stage, returnStages: Stage | Stage[]): boolean {
  const state = window.history.state as MoaHistoryState | null
  const allowedStages = Array.isArray(returnStages) ? returnStages : [returnStages]
  return state?.stage === stage && state.returnStage !== undefined && allowedStages.includes(state.returnStage)
}

export function writeNavigationState(
  stage: Stage,
  mode: ResultMode,
  action: 'push' | 'replace' = 'push',
  replay?: ReplayNavigationState,
  decisionId?: string,
): void {
  const previousStage = readStageFromUrl()
  const currentHistoryState = window.history.state as MoaHistoryState | null
  const returnStage = action === 'push' ? previousStage ?? undefined : currentHistoryState?.returnStage
  const url = new URL(window.location.href)
  url.searchParams.set('stage', stage)

  if (stage === 'result' || stage === 'replay' || isDecisionStage(stage)) url.searchParams.set('mode', mode)
  else url.searchParams.delete('mode')

  let activeDecisionId: string | undefined
  if (stage === 'replay' && replay) {
    url.searchParams.set('tripId', replay.tripId)
    url.searchParams.set('planVersionId', replay.planVersionId)
    activeDecisionId = replay.decisionId
    if (replay.roundId) url.searchParams.set('roundId', replay.roundId)
    else url.searchParams.delete('roundId')
  } else {
    replayQueryKeys.forEach((key) => url.searchParams.delete(key))
    activeDecisionId = isDecisionStage(stage) ? decisionId ?? queryValue(url.searchParams, 'decisionId') : undefined
  }

  if (activeDecisionId) url.searchParams.set('decisionId', activeDecisionId)
  else url.searchParams.delete('decisionId')

  const state: MoaHistoryState & { replay?: ReplayNavigationState } = {
    stage,
    mode,
    replay,
    decisionId: activeDecisionId,
    returnStage,
  }
  if (action === 'push') window.history.pushState(state, '', url)
  else window.history.replaceState(state, '', url)
}
