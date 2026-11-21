import { useLayoutEffect, useRef } from 'react'
import { createViewHistory, type NavigationDirection } from './navigation-gestures'
export type NavigationTrigger = 'gesture' | 'keyboard'

export interface NavigationTarget {
  priority: number
  key: string
  enabled: boolean
  blocked(): boolean
  canGo(direction: NavigationDirection): boolean
  go(direction: NavigationDirection, trigger?: NavigationTrigger): void
}
const targets = new Set<NavigationTarget>()
export function navigationTarget(direction: NavigationDirection): NavigationTarget | undefined {
  if ([...targets].some((target) => target.enabled && target.blocked())) return undefined
  return [...targets].filter((target) => target.enabled && target.canGo(direction)).sort((a, b) => b.priority - a.priority)[0]
}

export function useNavigationHistory<T>(options: {
  value: T
  key: string
  enabled: boolean
  restore(value: T, trigger: NavigationTrigger): void | Promise<boolean>
  priority?: number
  busy?: boolean
  animate?: string
  isParent?(key: string): boolean
  canRestore?(value: T): boolean
  sameView?(previous: T, next: T): boolean
}): void {
  const history = useRef(createViewHistory(options.value, options.key))
  const latest = useRef(options)
  const transition = useRef<{ key: string; direction: NavigationDirection; trigger: NavigationTrigger } | null>(null)
  const target = useRef<NavigationTarget>({
    priority: options.priority ?? 10, key: options.key, enabled: options.enabled,
    blocked: () => Boolean(latest.current.busy) || history.current.isRestoring(),
    canGo: (direction) => {
      const value = history.current.peek(direction)
      return !latest.current.busy && history.current.canGo(direction) && value !== undefined && latest.current.canRestore?.(value) !== false
    },
    go: (direction, trigger = 'keyboard') => {
      if (!target.current.canGo(direction)) return
      const value = history.current.move(direction)
      if (value === undefined) return
      transition.current = { key: history.current.currentKey(), direction, trigger }
      const result = latest.current.restore(value, trigger)
      if (result) void result.then((ok) => {
        if (!ok) { history.current.cancelRestore(); transition.current = null }
      }).catch(() => { history.current.cancelRestore(); transition.current = null })
    }
  })
  useLayoutEffect(() => {
    latest.current = options
    Object.assign(target.current, { enabled: options.enabled, key: options.key, priority: options.priority ?? 10 })
    if (options.enabled) history.current.record(options.value, options.key,
      Boolean(options.isParent?.(options.key) && !options.isParent?.(history.current.currentKey())),
      Boolean(options.sameView?.(history.current.peekCurrent(), options.value)))
    const pending = transition.current
    if (options.enabled && pending?.key === options.key) {
      transition.current = null
      if (options.animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const element = document.querySelector<HTMLElement>(options.animate)
        if (element?.isConnected) element.animate([
          { opacity: .7, transform: `translateX(${pending.direction === 'back' ? -4 : 4}px)` },
          { opacity: 1, transform: 'translateX(0)' }
        ], { duration: parseFloat(getComputedStyle(element).getPropertyValue(pending.trigger === 'gesture' ? '--motion-1' : '--motion-3')) || 120, easing: 'cubic-bezier(0.2,0.8,0.2,1)' })
      }
    }
  })
  useLayoutEffect(() => {
    const item = target.current
    targets.add(item)
    return () => { targets.delete(item) }
  }, [])
}
