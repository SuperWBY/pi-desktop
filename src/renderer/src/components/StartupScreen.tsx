import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from '../i18n'

// Sample the three Pi mark shapes into tiny tiles; each tile has a stable,
// independent starting position and lands where it belongs in the mark.
const PIXEL_STEP = 22
const pixels = Array.from({ length: Math.ceil(800 / PIXEL_STEP) ** 2 }, (_, index) => {
  const columns = Math.ceil(800 / PIXEL_STEP)
  const x = (index % columns) * PIXEL_STEP + PIXEL_STEP / 2
  const y = Math.floor(index / columns) * PIXEL_STEP + PIXEL_STEP / 2
  const coral = (x >= 165 && x < 517 && y >= 165 && y < 283) || (x >= 400 && x < 517 && y >= 283 && y < 400)
  const blue = (x >= 165 && x < 283 && y >= 283 && y < 635) || (x >= 283 && x < 400 && y >= 400 && y < 517)
  const gold = x >= 517 && x < 635 && y >= 400 && y < 635
  if (!coral && !blue && !gold) return null
  const random = (seed: number): number => { const value = Math.sin(index * 127.1 + seed * 311.7) * 43758.5453; return value - Math.floor(value) }
  const angle = random(1) * Math.PI * 2
  const distance = 32 + random(2) * 88
  return {
    index,
    style: {
      left: `${(x - PIXEL_STEP / 2) / 8}%`, top: `${(y - PIXEL_STEP / 2) / 8}%`,
      width: `${PIXEL_STEP / 8}%`, height: `${PIXEL_STEP / 8}%`,
      background: coral ? '#F09082' : blue ? '#4D9ABF' : '#F1BE58',
      '--pixel-x': `${(Math.cos(angle) * distance).toFixed(1)}px`,
      '--pixel-y': `${(Math.sin(angle) * distance).toFixed(1)}px`,
      '--pixel-rotation': `${Math.round((random(3) - .5) * 150)}deg`,
      '--pixel-delay': `${Math.round(random(4) * 55)}ms`
    } as CSSProperties
  }
}).filter((pixel) => pixel !== null)

/** Let the short mark animation finish without waiting for session startup. */
export function StartupScreen({ booting, failed }: { booting: boolean; failed: boolean }): ReactNode {
  const t = useTranslation()
  const [finished, setFinished] = useState(false)
  const [present, setPresent] = useState(true)
  const [slow, setSlow] = useState(false)
  const startedAt = useRef(performance.now())

  useEffect(() => {
    if (booting || finished) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const remaining = failed || reduced ? 0 : Math.max(0, 760 - (performance.now() - startedAt.current))
    if (!remaining) { setFinished(true); return }
    const timer = window.setTimeout(() => setFinished(true), remaining)
    return () => window.clearTimeout(timer)
  }, [booting, failed, finished])
  useEffect(() => {
    if (finished) return
    const timer = window.setTimeout(() => setSlow(true), 500)
    return () => window.clearTimeout(timer)
  }, [finished])
  useEffect(() => {
    if (!finished) return
    const timer = window.setTimeout(() => setPresent(false), 160)
    return () => window.clearTimeout(timer)
  }, [finished])

  if (!present) return null
  return (
    <div className="startup-screen" data-finished={finished} aria-hidden={finished} role="status" aria-label={t('正在启动…')}>
      <div className="startup-center">
        <div className="startup-mark">
          <div className="startup-glow" />
          <div className="startup-pixels" aria-hidden="true">{pixels.map(({ index, style }) => <span className="startup-pixel" key={index} style={style} />)}</div>
          <svg className="startup-logo" viewBox="0 0 800 800" aria-hidden="true">
            <path fill="#F09082" d="M165.29 165.29H517.36V400H400V282.65H165.29Z" />
            <path fill="#4D9ABF" d="M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z" />
            <path fill="#F1BE58" d="M517.36 400H634.72V634.72H517.36Z" />
          </svg>
        </div>
        <div className="startup-wordmark">Pi <span>Desktop</span></div>
        <div className="startup-status">{slow && booting && !finished ? t('正在启动…') : '\u00a0'}</div>
      </div>
    </div>
  )
}
