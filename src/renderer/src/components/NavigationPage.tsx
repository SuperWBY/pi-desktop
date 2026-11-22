import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import './navigation-page.css'

/** Keep an outgoing page mounted for its close transition; the sidebar stays interactive. */
export function NavigationPage({ open, returnFocus, children }: {
  open: boolean
  returnFocus: string
  children: ReactNode
}): ReactNode {
  const [present, setPresent] = useState(open)
  const [visible, setVisible] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (open) setPresent(true)
    else {
      setVisible(false)
      if (root.current?.contains(document.activeElement)) {
        document.querySelector<HTMLElement>(returnFocus)?.focus()
      }
    }
  }, [open, returnFocus])

  useEffect(() => {
    if (!present) return
    if (open) {
      const frame = requestAnimationFrame(() => {
        if (root.current) void root.current.offsetWidth
        setVisible(true)
      })
      return () => cancelAnimationFrame(frame)
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = parseFloat(getComputedStyle(root.current!).getPropertyValue('--panel-close-dur')) || 160
    const timer = window.setTimeout(() => setPresent(false), reduced ? 0 : duration)
    return () => clearTimeout(timer)
  }, [open, present])

  if (!present) return null
  return <div ref={root} className="navigation-page t-panel-slide" data-open={open && visible}
    inert={!open} aria-hidden={!open}>{children}</div>
}
