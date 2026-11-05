import { useEffect, useState } from 'react'

/**
 * Live duration for a running tool. Returns the elapsed milliseconds while
 * `running`, and undefined once it stops so the caller can show the frozen
 * duration reported by pi instead.
 */
export function useElapsed(startedAt: number | undefined, running: boolean): number | undefined {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running || !startedAt) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [running, startedAt])

  if (!startedAt) return undefined
  return running ? Math.max(0, now - startedAt) : undefined
}
