import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useApp } from '../store'
import { FALLBACK_RELEASE_DELAY, TrackpadSwipe } from '../lib/navigation-gestures'
import { navigationTarget, useNavigationHistory, type NavigationTarget } from '../lib/use-navigation-history'
import './navigation-gestures.css'

function blockedTarget(target: EventTarget | null, ownsGesture = false): boolean {
  if (!(target instanceof Element)) return true
  if (document.querySelector('.modal-overlay,.popover,[role="dialog"][aria-modal="true"],.lightbox')) return true
  if (target.closest('input,textarea,select,[contenteditable="true"],[role="slider"],[inert]')) return true
  // Scroll ownership is decided at the start and retained for this gesture.
  if (ownsGesture) return false
  for (let element: Element | null = target; element; element = element.parentElement) {
    const style = getComputedStyle(element)
    if (/auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 2) return true
  }
  return false
}

export function NavigationGestures(): ReactNode {
  const { state, actions } = useApp()
  const route = state.settingsOpen ? 'settings' : state.skillsOpen ? state.skillsSection : state.schedulesOpen ? 'schedules' : 'chat'
  const [visible, setVisible] = useState(false)
  const sessionHistoryReady = useRef(false)
  if (state.status === 'ready' && state.workspace) sessionHistoryReady.current = true
  const visibleIntent = useRef(false)
  const panel = useRef<HTMLDivElement>(null)
  const paintOnMount = useRef<() => void>(() => {})
  const attachPanel = useCallback((element: HTMLDivElement | null) => {
    panel.current = element
    if (element) paintOnMount.current()
  }, [])
  useNavigationHistory({ value: route, key: route, enabled: true, priority: 0, isParent: (key) => key === 'chat',
    restore: (view) => {
      if (view === 'settings') actions.openSettings(true)
      else if (view === 'skills' || view === 'plugins') actions.openSkills(true, view)
      else if (view === 'schedules') actions.openSchedules(true)
      else { actions.openSettings(false); actions.openSkills(false); actions.openSchedules(false) }
    } })

  useEffect(() => {
    if (window.pi.platform !== 'darwin') return
    const swipe = new TrackpadSwipe()
    let target: NavigationTarget | undefined
    let targetKey = ''
    let targetDirection: 'back' | 'forward' | undefined
    let nativeTracking = false
    let idle: ReturnType<typeof setTimeout> | undefined
    let dismiss: ReturnType<typeof setTimeout> | undefined
    let frameRequest = 0
    let pending: NonNullable<ReturnType<TrackpadSwipe['move']>> | null = null
    const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const paint = (): void => {
      frameRequest = 0
      if (!pending || !visibleIntent.current) return
      const element = panel.current
      if (!element) return
      element.style.setProperty('--gesture-progress', String(pending.progress))
      element.dataset.direction = pending.direction
      element.dataset.ready = String(pending.ready)
      element.dataset.releasing = 'false'
      pending = null
    }
    paintOnMount.current = () => {
      if (pending && !frameRequest) frameRequest = requestAnimationFrame(paint)
    }
    const finish = (cancel = false): void => {
      clearTimeout(idle)
      cancelAnimationFrame(frameRequest)
      frameRequest = 0
      pending = null
      const direction = cancel ? (swipe.cancel(), null) : swipe.release()
      if (panel.current) panel.current.dataset.releasing = 'true'
      clearTimeout(dismiss)
      dismiss = setTimeout(() => { visibleIntent.current = false; setVisible(false) }, reduced() ? 0 : 120)
      if (direction && target?.enabled && target.key === targetKey && navigationTarget(direction) === target && target.canGo(direction) && !document.querySelector('.modal-overlay,.popover,[role="dialog"][aria-modal="true"]')) target.go(direction, 'gesture')
      target = undefined
      targetDirection = undefined
    }
    const unsubscribe = window.pi.onScrollPhase?.((phase) => {
      nativeTracking = phase === 'begin'
      if (nativeTracking) { finish(true); swipe.start(true) }
      else finish(phase === 'cancel')
    })
    const wheel = (event: WheelEvent): void => {
      const frame = swipe.move({ x: event.deltaX, y: event.deltaY, mode: event.deltaMode, time: performance.now(),
        blocked: event.defaultPrevented || blockedTarget(event.target, Boolean(target)), modified: event.ctrlKey || event.metaKey || event.altKey || event.shiftKey })
      clearTimeout(idle)
      if (!nativeTracking) idle = setTimeout(() => finish(), FALLBACK_RELEASE_DELAY)
      if (!frame) { if (target) finish(true); return }
      const next = target && targetDirection === frame.direction && target.key === targetKey && target.enabled && !target.blocked() && target.canGo(frame.direction)
        ? target : navigationTarget(frame.direction)
      if (!next || (target && (target !== next || target.key !== targetKey))) { finish(true); return }
      target = next; targetKey = next.key; targetDirection = frame.direction
      event.preventDefault()
      clearTimeout(dismiss)
      pending = frame
      if (!visibleIntent.current) { visibleIntent.current = true; setVisible(true) }
      if (panel.current && !frameRequest) frameRequest = requestAnimationFrame(paint)
    }
    const key = (event: KeyboardEvent): void => {
      if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || blockedTarget(event.target)) return
      const direction = event.key === '[' ? 'back' : event.key === ']' ? 'forward' : null
      const next = direction && navigationTarget(direction)
      if (direction && next) { event.preventDefault(); finish(true); next.go(direction, 'keyboard') }
    }
    const cancel = (): void => { nativeTracking = false; finish(true) }
    window.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('keydown', key)
    window.addEventListener('blur', cancel)
    window.addEventListener('pointerdown', cancel)
    return () => {
      unsubscribe?.()
      window.removeEventListener('wheel', wheel)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('pointerdown', cancel)
      clearTimeout(idle); clearTimeout(dismiss)
      cancelAnimationFrame(frameRequest)
      paintOnMount.current = () => {}
      visibleIntent.current = false
    }
  }, [])

  return <>
    {sessionHistoryReady.current && <SessionNavigationHistory />}
    {visible && <div className="navigation-gesture-layer" aria-hidden="true">
      <div className="navigation-gesture" ref={attachPanel}>
        <ArrowLeft className="navigation-gesture-back" size={21} />
        <ArrowRight className="navigation-gesture-forward" size={21} />
      </div>
    </div>}
  </>
}

function SessionNavigationHistory(): null {
  const { state, actions } = useApp()
  const workspace = state.workspace ?? ''
  const value = { workspace, sessionPath: state.sessionPath, scratch: state.scratchWorkspace, draftKey: state.composerDraftKey }
  const key = state.sessionPath ? `session:${state.sessionPath}` : state.composerDraftKey ?? `workspace:${workspace}`
  const chatVisible = !state.settingsOpen && !state.skillsOpen && !state.schedulesOpen && !state.addProjectOpen
  useNavigationHistory({
    value, key, priority: 5, enabled: chatVisible && Boolean(workspace), busy: state.status !== 'ready',
    sameView: (previous, next) => !previous.sessionPath && Boolean(next.sessionPath) && Boolean(previous.draftKey) && previous.draftKey === next.draftKey && previous.workspace === next.workspace,
    canRestore: (next) => !next.sessionPath || state.deletedSession?.path !== next.sessionPath,
    restore: (next) => actions.openSession(next.workspace, next.sessionPath, { scratch: next.scratch, ...(next.draftKey ? { draftKey: next.draftKey } : {}) }),
    animate: '.conversation-region'
  })
  return null
}
