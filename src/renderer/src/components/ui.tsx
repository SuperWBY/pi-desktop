import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const ITEM_SELECTOR = '.menu-item:not([disabled])'

/**
 * Arrow-key navigation shared by every menu-like surface. Menus are plain
 * buttons, so this only needs to move DOM focus and let the browser handle
 * Enter/Space activation.
 */
function useMenuKeys(
  open: boolean,
  close: () => void,
  ref: RefObject<HTMLDivElement | null>
): void {
  useEffect(() => {
    if (!open) return
    const node = ref.current
    if (!node) return

    node.setAttribute('role', 'menu')
    for (const item of node.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) {
      item.setAttribute('role', 'menuitem')
    }

    const items = (): HTMLElement[] => Array.from(node.querySelectorAll<HTMLElement>(ITEM_SELECTOR))
    const focusAt = (index: number): void => {
      const list = items()
      if (!list.length) return
      const next = (index + list.length) % list.length
      list[next]?.focus()
    }
    const move = (delta: number): void => {
      const list = items()
      const current = list.findIndex((item) => item === document.activeElement)
      focusAt(current === -1 ? (delta > 0 ? 0 : list.length - 1) : current + delta)
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        move(1)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        move(-1)
      } else if (event.key === 'Home') {
        event.preventDefault()
        focusAt(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        focusAt(items().length - 1)
      }
    }

    node.addEventListener('keydown', onKeyDown)
    return () => node.removeEventListener('keydown', onKeyDown)
  }, [open, close, ref])
}

export function Popover({
  trigger,
  children,
  align = 'left',
  width = 260,
  className = '',
  keyboardNav = true
}: {
  trigger: (open: boolean, toggle: () => void, expanded: Record<string, unknown>) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  width?: number
  className?: string
  keyboardNav?: boolean
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
    const below = window.innerHeight - rect.bottom - gap - 8
    const above = rect.top - gap - 8
    const openUp = below < 260 && above > below
    const maxHeight = Math.max(180, Math.min(460, openUp ? above : below))
    if (openUp) {
      setStyle({ bottom: window.innerHeight - rect.top + gap, left, width, maxHeight })
    } else {
      setStyle({ top: rect.bottom + gap, left, width, maxHeight })
    }
  }

  const close = (): void => {
    setOpen(false)
    // Return focus to whatever opened the menu so keyboard users keep context.
    rootRef.current?.querySelector<HTMLElement>('button, [tabindex]')?.focus()
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
        close()
      }
    }
    // Keep the popover anchored instead of closing it: scrolling inside the
    // menu (model list, long session menu) used to dismiss the whole popover
    // on the first wheel tick of a trackpad.
    let frame = 0
    const onScroll = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        place()
      })
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  useMenuKeys(open && keyboardNav, close, menuRef)

  // Focus the first useful control once the portal exists.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const node = menuRef.current
      if (!node) return
      const target =
        node.querySelector<HTMLElement>('.menu-search input') ??
        node.querySelector<HTMLElement>(ITEM_SELECTOR)
      target?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  return (
    <div className={`popover-root ${className}`} ref={rootRef}>
      {trigger(open, () => {
        if (!open) place()
        setOpen((value) => !value)
      }, { 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open &&
        createPortal(
          <div
            className="popover"
            style={style}
            ref={menuRef}
            onContextMenu={(event) => event.preventDefault()}
            // React portals keep bubbling through the React tree, so a wheel
            // inside the menu would otherwise reach the composer and scroll
            // the conversation behind it.
            onWheel={(event) => event.stopPropagation()}
          >
            {children(close)}
          </div>,
          document.body
        )}
    </div>
  )
}

/** Right-click menu anchored at the cursor. */
export function ContextMenu({
  position,
  onClose,
  children
}: {
  position: { x: number; y: number } | null
  onClose: () => void
  children: ReactNode
}): ReactNode {
  const menuRef = useRef<HTMLDivElement>(null)
  useMenuKeys(Boolean(position), onClose, menuRef)

  useEffect(() => {
    if (!position) return
    const onPointer = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [position, onClose])

  useEffect(() => {
    if (!position) return
    const node = menuRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    const overflowX = position.x + rect.width + 10 - window.innerWidth
    const overflowY = position.y + rect.height + 10 - window.innerHeight
    if (overflowX > 0 || overflowY > 0) {
      node.style.left = `${Math.max(8, position.x - Math.max(0, overflowX))}px`
      node.style.top = `${Math.max(8, position.y - Math.max(0, overflowY))}px`
    }
  }, [position])

  if (!position) return null

  return createPortal(
    <div
      className="menu context-menu"
      ref={menuRef}
      style={{ position: 'fixed', left: position.x, top: position.y, zIndex: 60 }}
      onContextMenu={(event) => event.preventDefault()}
      onWheel={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body
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
    <div
      className="modal-overlay"
      onMouseDown={onClose}
      onWheel={(event) => event.stopPropagation()}
    >
      <div
        className="modal"
        style={{ width }}
        onMouseDown={(event: ReactMouseEvent) => event.stopPropagation()}
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
