import { useEffect, useState, type ReactNode } from 'react'
import { Minus, Plus, X } from 'lucide-react'

let openListener: ((src: string | null) => void) | null = null

/** Any <img> inside the transcript can be opened full size. */
export function openImage(src: string): void {
  openListener?.(src)
}

export function ImageLightbox(): ReactNode {
  const [src, setSrc] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    openListener = (next) => {
      setSrc(next)
      setZoom(1)
    }
    return () => {
      openListener = null
    }
  }, [])

  useEffect(() => {
    if (!src) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setSrc(null)
      } else if (event.key === '+' || event.key === '=') {
        setZoom((value) => Math.min(4, value + 0.25))
      } else if (event.key === '-') {
        setZoom((value) => Math.max(0.5, value - 0.25))
      } else if (event.key === '0') {
        setZoom(1)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [src])

  if (!src) return null

  return (
    <div className="lightbox" onMouseDown={() => setSrc(null)} onWheel={(e) => e.stopPropagation()}>
      <img
        src={src}
        alt=""
        style={{ transform: `scale(${zoom})` }}
        onMouseDown={(event) => event.stopPropagation()}
        onWheel={(event) => {
          event.preventDefault()
          setZoom((value) =>
            Math.min(4, Math.max(0.5, value + (event.deltaY < 0 ? 0.15 : -0.15)))
          )
        }}
      />
      <div className="lightbox-bar" onMouseDown={(event) => event.stopPropagation()}>
        <button onClick={() => setZoom((value) => Math.min(4, value + 0.25))} aria-label="放大">
          <Plus size={14} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))} aria-label="缩小">
          <Minus size={14} />
        </button>
        <button onClick={() => setSrc(null)} aria-label="关闭">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
