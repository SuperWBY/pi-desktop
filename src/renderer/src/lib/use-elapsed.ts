import { useEffect, useState } from 'react'

/**
 * Live duration for a running operation. Returns the elapsed milliseconds while
 * `running`, and undefined once it stops so the caller can show the frozen
 * duration reported by pi instead.
 */
export function useElapsed(startedAt: number | undefined, running: boolean, intervalMs = 500): number | undefined {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running || !startedAt) return
    let timer: number
    const tick = (): void => {
      const time = Date.now()
      setNow(time)
      timer = window.setTimeout(tick, intervalMs - (Math.max(0, time - startedAt) % intervalMs))
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [running, startedAt, intervalMs])

  if (!startedAt) return undefined
  return running ? Math.max(0, now - startedAt) : undefined
}
