/** 83456 -> "1:23.456". Returns "--:--.---" for 0/invalid. */
export function formatLapTime(ms: number | null | undefined): string {
  if (!ms || ms <= 0 || !Number.isFinite(ms)) return '--:--.---'
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const millis = Math.floor(ms % 1000)
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

/** 1234 -> "+1.234", -500 -> "-0.500". */
export function formatDelta(ms: number): string {
  const sign = ms < 0 ? '-' : '+'
  return `${sign}${(Math.abs(ms) / 1000).toFixed(3)}`
}
