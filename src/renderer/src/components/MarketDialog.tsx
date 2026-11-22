import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal } from './ui'

/** Retain the dialog through its exit animation, with keyboard focus kept inside it. */
export function MarketDialog({ title, onClose, children }: {
  title: string
  onClose: () => void
  children: (close: () => void, run: (action: () => void) => void) => ReactNode
}): ReactNode {
  const [closing, setClosing] = useState(false)
  const closed = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const anchor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null
    anchor.current?.querySelector<HTMLElement>('input,button')?.focus()
    const trap = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const modal = anchor.current?.closest('.modal')
      const buttons = modal?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], select:not(:disabled)')
      if (!buttons?.length) return
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => {
      clearTimeout(timer.current)
      document.removeEventListener('keydown', trap)
      if (trigger?.isConnected) trigger.focus()
      else document.querySelector<HTMLButtonElement>('.plugin-market-page [role="tab"][aria-selected="true"]')?.focus()
    }
  }, [])
  const close = (): void => {
    if (closed.current) return
    closed.current = true
    if (anchor.current) anchor.current.inert = true
    setClosing(true)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    timer.current = setTimeout(onClose, reduced ? 0 : 150)
  }
  return <Modal open title={title} onClose={close}>
    <div ref={anchor} className="market-dialog-content" data-closing={closing} inert={closing}>{children(close, (action) => { if (!closed.current) action() })}</div>
  </Modal>
}
