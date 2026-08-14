import { useReducer } from 'react'
import { featuredDestinations } from '../../product/mockData'
import type { DestinationPack, ReopenReason } from '../../product/types'

export type ProductFlowState = {
  destination: DestinationPack
  selectedDecisionId: string
  reopenReason: ReopenReason | null
  reopenChoice: 'station' | 'room'
  applyToFutureTrips: boolean
}

const initialDestination = featuredDestinations.find((item) => item.id === 'osaka') ?? featuredDestinations[0]

const initialState: ProductFlowState = {
  destination: initialDestination,
  selectedDecisionId: 'stay-namba',
  reopenReason: null,
  reopenChoice: 'station',
  applyToFutureTrips: false,
}

type Action =
  | { type: 'destination'; value: DestinationPack }
  | { type: 'decision'; id: string }
  | { type: 'reset-reopen' }
  | { type: 'reopen-reason'; value: ReopenReason }
  | { type: 'reopen-choice'; value: ProductFlowState['reopenChoice'] }
  | { type: 'apply-future'; value: boolean }

function reducer(state: ProductFlowState, action: Action): ProductFlowState {
  switch (action.type) {
    case 'destination': return { ...state, destination: action.value, selectedDecisionId: 'stay-namba' }
    case 'decision': return { ...state, selectedDecisionId: action.id, reopenReason: null, reopenChoice: 'station', applyToFutureTrips: false }
    case 'reset-reopen': return { ...state, reopenReason: null, reopenChoice: 'station', applyToFutureTrips: false }
    case 'reopen-reason': return { ...state, reopenReason: action.value }
    case 'reopen-choice': return { ...state, reopenChoice: action.value }
    case 'apply-future': return { ...state, applyToFutureTrips: action.value }
  }
}

export function useProductFlow(initialDecisionId?: string) {
  const [state, dispatch] = useReducer(reducer, { ...initialState, selectedDecisionId: initialDecisionId ?? initialState.selectedDecisionId })
  return { state, dispatch }
}
