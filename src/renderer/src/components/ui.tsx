import { useTranslation } from '../i18n'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const ITEM_SELECTOR = '.menu-item:not([disabled]), .project-picker-item:not([disabled])'

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
      if (!item.hasAttribute('role')) item.setAttribute('role', 'menuitem')
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
  keyboardNav = true,
  animateExit = false,
  matchTriggerWidth = false,
  gap: requestedGap = 8
}: {
  trigger: (open: boolean, toggle: () => void, expanded: Record<string, unknown>) => ReactNode
  children: (close: () => void, spaceBefore: number) => ReactNode
  align?: 'left' | 'right'
  width?: number
  className?: string
  keyboardNav?: boolean
  animateExit?: boolean
  matchTriggerWidth?: boolean
  gap?: number
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [present, setPresent] = useState(false)
  useEffect(() => {
    if (open) { setPresent(true); return }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = setTimeout(() => setPresent(false), animateExit && !reduced ? 120 : 0)
    return () => clearTimeout(timer)
  }, [open, animateExit])
  const [style, setStyle] = useState<CSSProperties>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const place = (): void => {
    const node = rootRef.current
    if (!node) return
    const rect = (matchTriggerWidth ? node.querySelector('button') ?? node : node).getBoundingClientRect()
    const gap = requestedGap
    const edge = 8
    const menuWidth = matchTriggerWidth ? rect.width : width
    // Composer menus open above the entire input, including on the empty chat.
    const composer = node.closest('.composer, .composer-project-row')?.getBoundingClientRect()
    const anchorTop = composer ? composer.top : rect.top
    const anchorBottom = composer ? composer.bottom : rect.bottom
    const left = Math.min(
      Math.max(edge, align === 'right' ? rect.right - menuWidth : rect.left),
      Math.max(edge, window.innerWidth - menuWidth - edge)
    )
    const above = Math.max(0, anchorTop - gap - edge)
    const below = Math.max(0, window.innerHeight - anchorBottom - gap - edge)
    const openUp = Boolean(composer) || (below < 220 && above >= below)
    const maxHeight = Math.min(460, openUp ? above : below)
    const modalLayer = node.closest('.modal') ? { zIndex: 210 } : {}
    if (openUp) {
      setStyle({ bottom: window.innerHeight - anchorTop + gap, left, width: menuWidth, maxHeight, ...modalLayer, ...(matchTriggerWidth ? { transformOrigin: 'bottom center' } : {}) })
    } else {
      setStyle({ top: anchorBottom + gap, left, width: menuWidth, maxHeight, ...modalLayer, ...(matchTriggerWidth ? { transformOrigin: 'top center' } : {}) })
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
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        event.stopPropagation()
        close()
      }
    }
    // Keep the popover anchored instead of closing it: scrolling inside the
    // menu (model list, long session menu) used to dismiss the whole popover
    // on the first wheel tick of a trackpad.
    let frame = 0
    const schedulePlacement = (): void => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        place()
      })
    }
    const onScroll = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      schedulePlacement()
    }
    // The native resize event can arrive before the composer has moved.
    const composer = rootRef.current?.closest('.composer-wrap')
    const observer = new ResizeObserver(schedulePlacement)
    if (rootRef.current) observer.observe(rootRef.current)
    if (composer) {
      observer.observe(composer)
      const column = composer.closest('.main')
      if (column) observer.observe(column)
    }
    document.addEventListener('mousedown', onPointer)
    const captureKeys = Boolean(rootRef.current?.closest('.modal'))
    document.addEventListener('keydown', onKey, captureKeys)
    window.addEventListener('resize', schedulePlacement)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer?.disconnect()
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey, captureKeys)
      window.removeEventListener('resize', schedulePlacement)
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
        node.querySelector<HTMLElement>('.menu-search input, .project-picker-search input') ??
        node.querySelector<HTMLElement>('.menu-item[aria-checked="true"]') ??
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
      {(open || (animateExit && present)) &&
        createPortal(
          <div
            className={`popover${!open ? ' popover-closing' : ''}`}
            inert={!open}
            style={style}
            ref={menuRef}
            onContextMenu={(event) => event.preventDefault()}
            // React portals keep bubbling through the React tree, so a wheel
            // inside the menu would otherwise reach the composer and scroll
            // the conversation behind it.
            onWheel={(event) => event.stopPropagation()}
          >
            {children(close, Number(style.left) || 0)}
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
  const t = useTranslation()
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
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
        aria-labelledby={titleId}
        aria-modal="true"
      >
        <div className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t("Close")}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
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
