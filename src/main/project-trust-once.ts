export interface ProjectTrustOnceDeps<T> {
  current(): T
  pending(): boolean
  inspect(): Promise<{ cwd: string; sessionFile: string; isStreaming: boolean }>
  confirm(): Promise<boolean>
  restart(): Promise<{ ok: boolean }>
}

/**
 * Native project-trust consent must be tied to the exact session the user was
 * looking at. A click that races a session switch or a running turn must not
 * restart another project or repeat work.
 */
export async function grantProjectTrustOnce<T>(deps: ProjectTrustOnceDeps<T>): Promise<{ ok: boolean; cancelled?: boolean }> {
  const owner = deps.current()
  const before = await deps.inspect()
  if (!before?.cwd || before.isStreaming || deps.pending()) return { ok: false }
  if (!(await deps.confirm())) return { ok: false, cancelled: true }
  if (deps.current() !== owner) return { ok: false }
  const after = await deps.inspect()
  if (
    !after?.cwd ||
    after.cwd !== before.cwd ||
    after.sessionFile !== before.sessionFile ||
    after.isStreaming ||
    deps.pending()
  ) return { ok: false }
  const result = await deps.restart()
  return { ok: result.ok }
}
