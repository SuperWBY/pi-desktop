import { randomUUID } from 'node:crypto'

export type BrowserBackend = 'inapp' | 'cdp' | 'extension'
export type BrowserViewport = { width: number; height: number }
export type BrowserAction = { candidateId: string; type: 'click' | 'type' | 'press'; text?: string; key?: string }
export type BrowserCandidate = { id: string; role?: string; name?: string; secure?: boolean; [key: string]: unknown }
export type BrowserObservation = { candidates: BrowserCandidate[]; url?: string; title?: string; [key: string]: unknown }
export type BrowserAdapter = { observe(url?: string, page?: string, viewport?: BrowserViewport): Promise<BrowserObservation>; readText?(observation: BrowserObservation): Promise<{ text: string; truncated: boolean; requiresHuman?: boolean }>; checkFile?(observation: BrowserObservation, candidate: BrowserCandidate): Promise<void>; hashFile?(observation: BrowserObservation, candidate: BrowserCandidate): Promise<{ sha256: string; size: number }>; act(action: BrowserAction, observation: BrowserObservation): Promise<unknown>; close(): Promise<void> }
type FileSelection = { file: { name: string; size: number; type: string }; url?: string; contentVerified?: boolean }
type Session = { id: string; backend: BrowserBackend; observation: BrowserObservation | null; readObservation: BrowserObservation | null; paused: boolean; fileSelectionPending: boolean; fileSelectionPreview?: { value: FileSelection; observation: BrowserObservation; candidate: BrowserCandidate }; fileSelectionTarget?: { name: string; url?: string; hadFile: boolean; recordId?: string; tabId?: number; documentId?: string } }
type Approval = (session: Readonly<Session>, action: BrowserAction, candidate: BrowserCandidate) => Promise<boolean>
type ActionJournal = {
  pending(backend: BrowserBackend): { id: string } | null
  claim(backend: BrowserBackend): { id: string }
  acknowledge(backend: BrowserBackend, id: string): void
  resolve(backend: BrowserBackend, id: string, confirmed: boolean): void
}

function needsHuman(observation: BrowserObservation): boolean {
  if (observation.requiresHuman === true) return true
  const text = [observation.title ?? '', ...observation.candidates.map((candidate) => candidate.name ?? '')].join(' ').slice(0, 16000)
  return /verify (?:you are|you're) human|verify you are not a (?:bot|robot)|captcha|security check|just a moment\.{0,3}|人机验证|安全验证|完成验证|滑块验证|验证码/i.test(text)
}
function fingerprint(observation: BrowserObservation): string {
  return JSON.stringify({ url: observation.url ?? '', title: observation.title ?? '', candidates: observation.candidates.map((c) => ({ id: c.id, name: c.name, role: c.role, value: c.secure ? undefined : c.value })) })
}

export class BrowserRouter {
  private session: Session | null = null
  private busy = false
  private uncertainAction = false
  private adapters: Record<BrowserBackend, BrowserAdapter>
  private options: { approve?: Approval; journal?: ActionJournal }
  constructor(adapters: Record<BrowserBackend, BrowserAdapter>, options: { approve?: Approval; journal?: ActionJournal } = {}) { this.adapters = adapters; this.options = options }
  hasSession(): boolean { return this.session !== null }
  pendingAction(): { id: string } | null { return this.session ? this.options.journal?.pending(this.session.backend) ?? null : null }
  pendingBackends(): BrowserBackend[] { return (['inapp', 'cdp', 'extension'] as const).filter(backend => !!this.options.journal?.pending(backend)) }
  hasUncertainAction(): boolean { return this.hasAnyPendingAction() }
  hasAnyPendingAction(): boolean { return this.uncertainAction || this.pendingBackends().length > 0 }
  private requireSession(): Session {
    if (!this.session) throw new Error('No browser session. Open a session first.')
    return this.session
  }
  current(): Readonly<Session> { return this.requireSession() }
  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('Browser session is busy.')
    this.busy = true
    try { return await operation() } finally { this.busy = false }
  }
  async open(backend: BrowserBackend): Promise<{ id: string; backend: BrowserBackend }> {
    return this.locked(async () => {
      if (this.session) throw new Error('Close the current browser session before opening another.')
      if (!Object.hasOwn(this.adapters, backend)) throw new Error('Unknown browser backend.')
      this.session = { id: randomUUID(), backend, observation: null, readObservation: null, paused: false, fileSelectionPending: false }
      return { id: this.session.id, backend }
    })
  }
  async observe(url?: string, page?: string, viewport?: BrowserViewport): Promise<BrowserObservation> {
    return this.locked(async () => {
      const session = this.requireSession()
      if (session.paused) throw new Error('Human action is required. Resume after the user completes it.')
      if (page !== undefined && (session.backend !== 'inapp' || !/^[a-zA-Z0-9_-]{1,48}$/.test(page))) throw new Error('Use a short in-app page name.')
      if (viewport && (session.backend !== 'inapp' || ![viewport.width, viewport.height].every(n => Number.isInteger(n) && n >= 240 && n <= 2560))) throw new Error('Use an in-app viewport from 240 to 2560 CSS pixels per side.')
      if ((url || page || viewport) && this.hasUncertainAction()) throw new Error('The previous action result is unknown. Inspect the current page and ask the user to verify the result before navigating.')
      let navigation: { id: string } | undefined
      if (url) {
        try { navigation = this.options.journal?.claim(session.backend) }
        catch (error) {
          if (this.hasAnyPendingAction()) throw new Error('The previous action result is unknown or still in progress. Inspect it and ask the user to confirm before navigating.', { cause: error })
          throw error
        }
      }
      session.observation = null
      session.readObservation = null
      let result: BrowserObservation
      try { result = await this.adapters[session.backend].observe(url, page, viewport) }
      catch (error) {
        if (navigation) {
          this.uncertainAction = true
          throw new Error('The action result is unknown because navigation failed. Inspect the current page and ask the user to verify the result.', { cause: error })
        }
        const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code
        if (url || viewport || !['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'].includes(code ?? '')) throw error
        result = await this.adapters[session.backend].observe()
      }
      if (navigation) {
        try { this.options.journal!.acknowledge(session.backend, navigation.id) }
        catch (error) { this.uncertainAction = true; throw new Error('The action result is unknown because its navigation record could not be cleared. Inspect the current page and ask the user to verify the result.', { cause: error }) }
      }
      if (!result || !Array.isArray(result.candidates)) throw new Error('Invalid browser observation.')
      if (needsHuman(result)) { session.paused = true; return { ...result, requiresHuman: true } }
      session.observation = result
      return result
    })
  }
  async waitFor(options: { name: string; role?: string; timeoutMs?: number; intervalMs?: number; signal?: AbortSignal }): Promise<{ matched: boolean; candidate?: BrowserCandidate; url?: string; reason?: string; elapsedMs: number; observations: number }> {
    return this.locked(async () => {
      const session = this.requireSession()
      if (session.paused) throw new Error('Human action is required. Resume after the user completes it.')
      const name = options.name?.trim()
      if (!name || name.length > 200) throw new Error('A candidate name of at most 200 characters is required.')
      const timeoutMs = Math.max(100, Math.min(10_000, Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 5000))
      const intervalMs = Math.max(50, Math.min(1000, Number.isFinite(options.intervalMs) ? Number(options.intervalMs) : 250))
      const started = Date.now()
      const deadline = started + timeoutMs
      let observations = 0
      session.observation = null
      session.readObservation = null
      do {
        if (options.signal?.aborted) throw new Error('Browser wait cancelled.')
        const observed = await this.adapters[session.backend].observe()
        observations++
        if (options.signal?.aborted) throw new Error('Browser wait cancelled.')
        if (!observed || !Array.isArray(observed.candidates)) throw new Error('Invalid browser observation.')
        if (needsHuman(observed)) { session.paused = true; throw new Error('Human verification required. Complete it before continuing.') }
        const matches = observed.candidates.filter((candidate) => candidate.name === name && (!options.role || candidate.role === options.role))
        if (matches.length > 1) throw new Error('More than one matching candidate. Refine the target and observe again.')
        if (matches.length === 1 && Date.now() <= deadline) { session.observation = observed; return { matched: true, candidate: matches[0], url: observed.url, elapsedMs: Date.now() - started, observations } }
        const remaining = deadline - Date.now()
        if (remaining <= 0) break
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)))
      } while (Date.now() <= deadline)
      if (options.signal?.aborted) throw new Error('Browser wait cancelled.')
      return { matched: false, reason: 'Timed out without a matching candidate.', elapsedMs: Date.now() - started, observations }
    })
  }
  async readText(): Promise<{ text: string; truncated: boolean; url?: string }> {
    return this.locked(async () => {
      const session = this.requireSession()
      if (session.paused) throw new Error('Human action is required. Resume after the user completes it.')
      const observation = session.observation ?? session.readObservation
      if (!observation) throw new Error('Observe the browser before reading page text.')
      const read = this.adapters[session.backend].readText
      if (!read) throw new Error('Page text reading is not supported by this browser backend.')
      let result: Awaited<ReturnType<NonNullable<BrowserAdapter['readText']>>>
      try { result = await read(observation) }
      catch (error) { session.readObservation = null; throw error }
      if (result.requiresHuman) { session.paused = true; session.observation = null; session.readObservation = null; throw new Error('Human verification required. Complete it before continuing.') }
      if (typeof result.text !== 'string' || typeof result.truncated !== 'boolean') throw new Error('Invalid page text response.')
      return { text: result.text, truncated: result.truncated, url: observation.url }
    })
  }
  async act(action: BrowserAction, approve?: Approval): Promise<{ cancelled?: boolean; result?: unknown; verification?: { status: 'changed' | 'no_change' | 'unavailable'; requiresHuman?: boolean; reason?: 'file_selection' } }> {
    return this.locked(async () => {
      const session = this.requireSession()
      if (session.paused) throw new Error('Human action is required; resume after the user completes it.')
      if (this.hasUncertainAction()) throw new Error('The previous action result is unknown. Inspect the result and ask the user to confirm before further actions.')
      const observation = session.observation
      if (!observation) throw new Error('Observe the browser before acting.')
      const candidate = observation.candidates.find((item) => item.id === action.candidateId)
      if (!candidate) throw new Error('Candidate is not in the latest observation.')
      if (action.type === 'type' && candidate.secure) throw new Error('Cannot type into a secure field.')
      if (action.type === 'click' && candidate.type === 'file' && (typeof observation.documentId !== 'string' || !observation.documentId || (session.backend === 'extension' && !Number.isInteger(observation.tabId)))) throw new Error('Cannot identify the browser document or Chrome tab; observe again.')
      if (action.type === 'type' && String(action.text ?? '').length > 20_000) throw new Error('Input exceeds 20,000 UTF-16 units and cannot be fully reviewed. Use a file or revise the task.')
      if (action.type === 'press' && String(action.key ?? 'Enter').length > 200) throw new Error('Key value exceeds 200 UTF-16 units and cannot be fully reviewed.')
      const approval = approve ?? this.options.approve
      if (approval && !(await approval(session, action, candidate))) return { cancelled: true }
      let record: { id: string } | undefined
      try { record = this.options.journal?.claim(session.backend) }
      catch (error) {
        if (this.hasAnyPendingAction()) throw new Error('The previous action result is unknown or still in progress. Inspect it and ask the user to confirm before further actions.', { cause: error })
        throw error
      }
      session.observation = null
      session.readObservation = null
      let result: unknown
      try { result = await this.adapters[session.backend].act(action, observation) }
      catch (error) {
        if (/Human verification required/i.test(String(error))) session.paused = true
        const problem = error as { name?: string; code?: string; cause?: { code?: string } }
        if (record || /timed out|timeout|fetch failed|network|socket|connection|transport failed|browser closed|may have run/i.test(String(error)) || ['AbortError', 'TimeoutError'].includes(problem?.name ?? '') || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'].includes(problem?.code ?? problem?.cause?.code ?? '')) {
          this.uncertainAction = true
          throw new Error('The action result is unknown because the browser action failed. Do not repeat it; inspect the current page and ask the user to verify the result.', { cause: error })
        }
        throw error
      }
      const rejected = result && typeof result === 'object' ? (result as { __piGuardRejected?: unknown }).__piGuardRejected : undefined
      const guarded = rejected === 'human' || rejected === 'page_changed' || rejected === 'target_changed' || (rejected === 'view_hidden' && session.backend === 'inapp')
      if (record && (guarded || action.type !== 'click' || candidate.type !== 'file')) {
        try { this.options.journal!.acknowledge(session.backend, record.id) }
        catch (error) { this.uncertainAction = true; throw new Error('The action result is unknown because its record could not be cleared. Do not repeat it; inspect the current page and ask the user to verify the result.', { cause: error }) }
      }
      if (guarded) {
        if (rejected === 'human') { session.paused = true; throw new Error('Human verification required. Complete it before continuing.') }
        if (rejected === 'page_changed') throw new Error('Browser page changed; observe again.')
        if (rejected === 'target_changed') throw new Error('Target changed; observe again.')
        if (rejected === 'view_hidden') throw new Error('Open the in-app browser panel and observe again before choosing a file.')
      }
      if (action.type === 'click' && candidate.type === 'file') {
        session.paused = true
        session.fileSelectionPending = true
        session.fileSelectionTarget = { name: String(candidate.name ?? ''), url: observation.url, hadFile: candidate.fileCount !== 0, recordId: record?.id, documentId: observation.documentId as string, ...(session.backend === 'extension' ? { tabId: observation.tabId as number } : {}) }
        return { result, verification: { status: 'unavailable', requiresHuman: true, reason: 'file_selection' } }
      }
      try {
        const after = await this.adapters[session.backend].observe()
        if (!after || !Array.isArray(after.candidates)) throw new Error('Invalid browser observation.')
        const requiresHuman = needsHuman(after)
        if (requiresHuman) session.paused = true
        const samePage = Boolean(observation.url && after.url === observation.url)
        const sameDocument = typeof observation.documentId === 'string' && observation.documentId.length > 0 && observation.documentId === after.documentId
        const sameTab = session.backend !== 'extension' || (Number.isInteger(observation.tabId) && observation.tabId === after.tabId)
        if (!requiresHuman && samePage && sameDocument && sameTab) session.readObservation = after
        return { result, verification: { status: fingerprint(observation) === fingerprint(after) ? 'no_change' : 'changed', ...(requiresHuman ? { requiresHuman: true } : {}) } }
      } catch { return { result, verification: { status: 'unavailable' } } }

    })
  }

  async verifyFileSelection(expectedName: string, expectedSha256?: string): Promise<{ file: { name: string; size: number; type: string }; url?: string; contentVerified?: boolean }> {
    if (!expectedName || expectedName.length > 256 || /[\/\\\u0000-\u001f\u007f]/.test(expectedName)) throw new Error('Expected file name must be a plain file name.')
    if (expectedSha256 !== undefined && !/^[0-9a-f]{64}$/i.test(expectedSha256)) throw new Error('Expected SHA-256 must contain 64 hexadecimal characters.')
    return this.checkFileSelection(expectedName, false, expectedSha256?.toLowerCase())
  }

  async previewFileSelection(): Promise<FileSelection> {
    return this.checkFileSelection(undefined, true, undefined, true)
  }

  async confirmFileSelection(preview: FileSelection): Promise<FileSelection> {
    if (!preview?.file || !preview.url) throw new Error('Inspect the selected file before user confirmation.')
    return this.checkFileSelection(undefined, true, undefined, false, preview)
  }

  private async checkFileSelection(expectedName: string | undefined, userConfirmed: boolean, expectedSha256?: string, previewOnly = false, preview?: FileSelection): Promise<FileSelection> {
    return this.locked(async () => {
      const session = this.requireSession()
      const target = session.fileSelectionTarget
      if (!session.fileSelectionPending || !target) throw new Error('No browser file selection is pending.')
      const pending = this.options.journal?.pending(session.backend)
      if (this.uncertainAction || this.pendingBackends().some(backend => backend !== session.backend) || (target.recordId ? pending?.id !== target.recordId : this.hasAnyPendingAction())) throw new Error('A browser action result is unknown; resolve it before continuing.')
      if (target.hadFile && !userConfirmed) throw new Error('A file was already selected before the chooser opened; ask the user to confirm and observe again.')
      if (preview) {
        const saved = session.fileSelectionPreview
        if (!saved || saved.value !== preview) throw new Error('File review expired; inspect and confirm again.')
        const check = this.adapters[session.backend].checkFile
        if (!check) throw new Error('File identity check is unavailable. Update the browser connection and try again.')
        await check(saved.observation, saved.candidate)
        if (target.recordId) this.options.journal!.acknowledge(session.backend, target.recordId)
        session.observation = saved.observation
        session.paused = false
        session.fileSelectionPending = false
        session.fileSelectionTarget = undefined
        session.fileSelectionPreview = undefined
        return saved.value
      }
      const observed = await this.adapters[session.backend].observe()
      if (!observed || !Array.isArray(observed.candidates)) throw new Error('Invalid browser observation.')
      if (needsHuman(observed)) throw new Error('Human verification required. Complete it before continuing.')
      if (observed.url !== target.url) throw new Error('Browser page changed during file selection; ask the user to check it.')
      if (observed.documentId !== target.documentId || (session.backend === 'extension' && observed.tabId !== target.tabId)) throw new Error('Browser tab or document changed during file selection; return to the original page and check it.')
      const candidates = observed.candidates.filter(item => item.type === 'file' && String(item.name ?? '') === target.name)
      if (candidates.length !== 1) throw new Error('File input is missing or ambiguous; ask the user to check it.')
      const candidate = candidates[0]
      if (candidate.fileCount !== 1 || candidate.filesTruncated !== false || !Array.isArray(candidate.files) || candidate.files.length !== 1) throw new Error('Exactly one file must be selected before continuing.')
      const file = candidate.files[0] as { name?: unknown; size?: unknown; type?: unknown }
      if (expectedName !== undefined && file.name !== expectedName) throw new Error('The selected file does not match the expected file name.')
      if (typeof file.name !== 'string' || !file.name || typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.type !== 'string') throw new Error('Invalid selected file metadata.')
      if (previewOnly) {
        const value = { file: { name: file.name, size: file.size, type: file.type }, url: observed.url }
        session.fileSelectionPreview = { value, observation: observed, candidate }
        return value
      }
      if (!expectedSha256 && !userConfirmed) throw Object.assign(new Error('File content is not verified. Ask the user to inspect and confirm the selected file before continuing.'), { code: 'PI_FILE_CONFIRMATION_REQUIRED' })
      if (expectedSha256) {
        const hashFile = this.adapters[session.backend].hashFile
        if (!hashFile) throw new Error('File content hash verification is unsupported by this browser.')
        const digest = await hashFile(observed, candidate)
        if (digest.size !== file.size || digest.sha256 !== expectedSha256) throw new Error('Selected file content does not match the expected SHA-256 hash.')
      }
      if (target.recordId) this.options.journal!.acknowledge(session.backend, target.recordId)
      session.observation = observed
      session.paused = false
      session.fileSelectionPending = false
      session.fileSelectionTarget = undefined
      session.fileSelectionPreview = undefined
      return { file: { name: file.name, size: file.size, type: file.type }, url: observed.url, ...(expectedSha256 ? { contentVerified: true } : {}) }
    })
  }

  async cancelFileSelection(): Promise<void> {
    return this.locked(async () => {
      const session = this.requireSession()
      const target = session.fileSelectionTarget
      if (!session.fileSelectionPending || !target) throw new Error('No browser file selection is pending.')
      if (target.recordId) this.options.journal!.acknowledge(session.backend, target.recordId)
      session.observation = null
      session.paused = false
      session.fileSelectionPending = false
      session.fileSelectionTarget = undefined
      session.fileSelectionPreview = undefined
    })
  }

  pauseForUser(): void {
    if (this.busy) throw new Error('Browser session is busy.')
    const session = this.requireSession()
    session.observation = null
    session.paused = true
  }
  resumeAfterUser(expectedActionId?: string): void {
    if (this.busy) throw new Error('Browser session is busy.')
    const session = this.requireSession()
    if (session.fileSelectionPending) throw new Error('Complete or cancel the pending file selection first.')
    const pending = this.pendingAction()
    if (pending || expectedActionId) {
      if (!expectedActionId || !pending || pending.id !== expectedActionId) throw new Error('The pending action changed or was not found; inspect again.')
      this.options.journal!.resolve(session.backend, expectedActionId, true)
    } else if (this.pendingBackends().length) {
      throw new Error('A pending action belongs to another browser backend. Switch to that backend and inspect it before confirming.')
    }
    session.observation = null
    session.readObservation = null
    session.paused = false
    session.fileSelectionPending = false
    session.fileSelectionTarget = undefined
    this.uncertainAction = false
  }
  async close(): Promise<void> {
    return this.locked(async () => {
      const session = this.requireSession()
      this.session = null
      // Keep the browser available for inspection when an action may have run.
      if (!this.options.journal?.pending(session.backend)) await this.adapters[session.backend].close()
    })
  }
}
