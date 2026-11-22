import { useSyncExternalStore } from 'react'

export type PackageOperation = { status: 'busy' | 'done' | 'error'; kind: 'install' | 'update' | 'remove'; error?: string; source: string; cwd: string; resolveNpm?: boolean; version?: string }
let snapshot: Record<string, PackageOperation> = {}
const listeners = new Set<() => void>()
let queue: Promise<unknown> = Promise.resolve()
function publish(name: string, value: PackageOperation): void {
  snapshot = { ...snapshot, [name]: value }
  listeners.forEach((listener) => listener())
}
export function usePackageOperations(): Record<string, PackageOperation> {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => snapshot)
}
export function packageOperationSnapshot(): Record<string, PackageOperation> { return snapshot }
export function confirmPackageOperations(observed: Record<string, PackageOperation>): void {
  const names = Object.keys(observed).filter((name) => observed[name].status === 'done' && snapshot[name] === observed[name])
  if (!names.length) return
  snapshot = { ...snapshot }
  names.forEach((name) => { delete snapshot[name] })
  listeners.forEach((listener) => listener())
}
/** Lives outside the page: changing navigation cannot start a second install or lose its result.
 * Serialize package writes because npm and Pi settings share the same installation directory. */
export function operatePackage(name: string, kind: PackageOperation['kind'], source: string, cwd: string, options?: { resolveNpm?: boolean; version?: string }): void {
  if (snapshot[name]?.status === 'busy') return
  const job = { kind, source, cwd, ...options }
  publish(name, { ...job, status: 'busy' })
  queue = queue.catch(() => undefined).then(async () => {
    try {
      // Pi intentionally skips updates for pinned npm sources. Reinstall the current
      // release; Pi replaces the matching package identity in settings.
      let installSource = source
      if ((kind === 'update' || options?.resolveNpm) && source.startsWith('npm:')) {
        const details = await window.pi.getPackageDetails({ name, version: kind === 'update' ? undefined : options?.version, metadataOnly: true })
        if (!details.ok) throw new Error(details.error)
        installSource = details.details.installSource
      }
      const result = kind === 'install' || (kind === 'update' && source.startsWith('npm:')) ? await window.pi.installPackage(installSource, { cwd })
        : kind === 'remove' ? await window.pi.removePackage(source, cwd) : await window.pi.updatePackage(source, cwd)
      publish(name, result.ok ? { ...job, status: 'done' } : { ...job, status: 'error', error: result.error || '操作未完成，请重试。' })
    } catch (error) {
      publish(name, { ...job, status: 'error', error: error instanceof Error ? error.message.slice(0, 500) : '无法完成操作，请检查网络和 Pi 是否可用后重试。' })
    }
  })
}

export function retryPackage(name: string): void {
  const job = snapshot[name]
  if (job?.status === 'error') operatePackage(name, job.kind, job.source, job.cwd, { resolveNpm: job.resolveNpm, version: job.version })
}
/** Shared writer for callers that manage their own progress UI (skills page):
 * npm and Pi settings share the same installation directory, so every
 * install/update/remove — market or skills page — must wait on this queue. */
export function runPackageWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}
