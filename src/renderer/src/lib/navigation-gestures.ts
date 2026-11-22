export type NavigationDirection = 'back' | 'forward'
export const SWIPE_DISTANCE = 64
export const FALLBACK_RELEASE_DELAY = 48

/** Small, in-memory view history. It never stores or replays write operations. */
export function createViewHistory<T>(value: T, key: string) {
  const entries = [{ value, key }]
  let index = 0
  let restoring: string | null = null
  let beforeRestore = 0
  return {
    record(next: T, nextKey: string, parent = false, sameView = false) {
      if (restoring !== null) {
        if (nextKey !== restoring) return
        restoring = null
        entries[index] = { value: next, key: nextKey }
        return
      }
      if (entries[index].key === nextKey) { entries[index].value = next; return }
      if (sameView) { entries[index] = { value: next, key: nextKey }; return }
      const previous = parent ? entries.slice(0, index).findLastIndex((entry) => entry.key === nextKey) : -1
      if (previous >= 0) index = previous
      else {
        entries.splice(index + 1)
        entries.push({ value: next, key: nextKey })
        if (entries.length > 32) entries.shift()
        index = entries.length - 1
      }
      entries[index] = { value: next, key: nextKey }
    },
    currentKey() { return entries[index].key },
    peekCurrent(): T { return entries[index].value },
    peek(direction: NavigationDirection): T | undefined { return entries[index + (direction === 'back' ? -1 : 1)]?.value },
    isRestoring() { return restoring !== null },
    canGo(direction: NavigationDirection) { return restoring === null && (direction === 'back' ? index > 0 : index < entries.length - 1) },
    move(direction: NavigationDirection): T | undefined {
      if (restoring !== null) return undefined
      const next = index + (direction === 'back' ? -1 : 1)
      if (next < 0 || next >= entries.length) return undefined
      beforeRestore = index
      index = next
      restoring = entries[index].key
      return entries[index].value
    },
    cancelRestore() { if (restoring !== null) { index = beforeRestore; restoring = null } }
  }
}

export class TrackpadSwipe {
  private x = 0
  private y = 0
  private axis: 'x' | 'y' | null = null
  private blocked = false
  private finished = false
  private native = false
  private last = -Infinity

  start(native = false): void {
    this.x = this.y = 0
    this.axis = null
    this.blocked = this.finished = false
    this.native = native
    this.last = -Infinity
  }

  move(input: { x: number; y: number; time: number; blocked?: boolean; modified?: boolean; mode?: number }) {
    if (!this.native && input.time - this.last > 240) this.start()
    this.last = input.time
    if (this.finished) return null
    if (input.blocked || input.modified || (input.mode ?? 0) !== 0) this.blocked = true
    if (this.blocked) return null
    this.x += input.x
    this.y += input.y
    if (!this.axis && Math.abs(this.y) > 12 && Math.abs(this.y) > Math.abs(this.x) * 1.2) this.axis = 'y'
    if (!this.axis && Math.abs(this.x) > 8 && Math.abs(this.x) > Math.abs(this.y) * 1.5) this.axis = 'x'
    if (this.axis !== 'x') return null
    const distance = Math.abs(this.x) / SWIPE_DISTANCE
    // Ease into resistance without clamping at the activation threshold:
    // continued movement stays continuous instead of hitting a hard stop.
    return { direction: this.x < 0 ? 'back' as const : 'forward' as const,
      progress: 1 - Math.exp(-2.3 * distance), ready: distance >= 1 }
  }

  release(): NavigationDirection | null {
    if (this.finished) return null
    this.finished = true
    return !this.blocked && this.axis === 'x' && Math.abs(this.x) >= SWIPE_DISTANCE ? this.x < 0 ? 'back' : 'forward' : null
  }

  cancel(): void { this.blocked = this.finished = true }
}
