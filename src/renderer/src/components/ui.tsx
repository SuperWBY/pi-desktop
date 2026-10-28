import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export function Popover({
  trigger,
  children,
  align = 'left',
  width = 260,
  className = ''
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  width?: number
  className?: string
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<CSSProperties>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const place = (): void => {
    const node = rootRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    const gap = 6
    const left = Math.min(
      Math.max(8, align === 'right' ? rect.right - width : rect.left),
      Math.max(8, window.innerWidth - width - 8)
    )
    if (rect.bottom > window.innerHeight * 0.66) {
      setStyle({ bottom: window.innerHeight - rect.top + gap, left, width })
    } else {
      setStyle({ top: rect.bottom + gap, left, width })
    }
  }

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent): void => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    const onScroll = (): void => setOpen(false)
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  return (
    <div className={`popover-root ${className}`} ref={rootRef}>
      {trigger(open, () => {
        if (!open) place()
        setOpen((value) => !value)
      })}
      {open &&
        createPortal(
          <div className="popover" style={style} ref={menuRef}>
            {children(() => setOpen(false))}
          </div>,
          document.body
        )}
    </div>
  )
}

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 520
}: {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}): ReactNode {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        style={{ width }}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Spinner({ size = 14 }: { size?: number }): ReactNode {
  return (
    <span className="spinner" style={{ minWidth: size }} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  )
}
