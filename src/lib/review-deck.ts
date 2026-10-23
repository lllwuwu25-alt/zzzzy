export type DeckState = { pending: string[]; completed: string[] }
export function completeCard(state: DeckState, id: string): DeckState {
  if (!state.pending.includes(id)) return state
  return { pending: state.pending.filter((entry) => entry !== id), completed: [...state.completed, id] }
}
export function skipCard(state: DeckState): DeckState {
  return { ...state, pending: state.pending.length > 1 ? [...state.pending.slice(1), state.pending[0]] : state.pending }
}
export function restoreCard(state: DeckState, id: string): DeckState {
  return { pending: [id, ...state.pending.filter((entry) => entry !== id)], completed: state.completed.filter((entry) => entry !== id) }
}
