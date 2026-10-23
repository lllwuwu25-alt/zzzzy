export type MotionPreference = 'system' | 'reduced'
export function getMotionPreference(): MotionPreference {
  try { return localStorage.getItem('notebook-motion') === 'reduced' ? 'reduced' : 'system' } catch { return 'system' }
}
export function setMotionPreference(value: MotionPreference) {
  try { localStorage.setItem('notebook-motion', value) } catch { /* Session preference still applies. */ }
  document.documentElement.dataset.motion = value
}
