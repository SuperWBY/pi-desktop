import type {
  BackgroundSchedulerStatus,
  AddProjectResult,
  Bootstrap,
  BrowserBounds,
  BrowserState,
  ChromeDomain,
  ChromeImportResult,
  ChromeProfile,
  ConnectorEntry,
  CustomProviderEntry,
  DeletedSession,
  DirEntry,
  GitStatus,
  McpConnectionTest,
  McpConnector,
  McpConnectorInput,
  ModelsConfig,
  OpenSessionResult,
  PackageEntry,
  PackageProgress,
  PiModelRow,
  PiRecord,
  PiResponse,
  ScheduleCadence,
  ScheduleEvent,
  ScheduledRun,
  ScheduledTask,
  ScheduledTaskInput,
  SessionNotice,
  UsageRange,
  UsageSummary,
  SessionSummary,
  Settings,
  PiSettings,
  SkillEntry
} from './types'

import type { ConversationNetworkBlock, SessionPermissionChange, SessionSecurity } from './types'

import type { DictationApi } from './dictation'

export interface PiDesktopApi {
  dictation: DictationApi
  initialTheme?: 'dark' | 'light'
  systemTheme(): Promise<'dark' | 'light'>
  onSystemTheme(callback: (theme: 'dark' | 'light') => void): () => void
  bootstrap(): Promise<Bootstrap>
  installPi(): Promise<{ ok: boolean; piPath?: string; piVersion?: string | null; output?: string; error?: string }>
  recheckPi(): Promise<{ piPath: string; piVersion: string | null }>
  projectTrustStatus(cwd: string): Promise<import('./types').ProjectTrustStatus>
  checkUpdate(): Promise<import('./types').UpdateInfo>
  listAuthProviders(): Promise<import('./types').AuthProviderStatus[]>
  saveApiKey(provider: string, key: string): Promise<import('./types').AuthProviderStatus[]>
  validateApiKey(provider: string, key: string): Promise<{ ok: true } | { ok: false; error: string }>
  removeAuthProvider(provider: string): Promise<import('./types').AuthProviderStatus[]>
  listOAuthProviders(): Promise<{ id: string; name: string; oauth: boolean; apiKey: boolean }[]>
  startOAuth(provider: string): Promise<{ ok: boolean; error?: string }>
  respondOAuth(id: string, value: string, cancelled?: boolean): void
  cancelOAuth(): void
  onOAuthEvent(callback: (event: Record<string, unknown>) => void): () => void
  openReleasePage(url: string): Promise<void>
  downloadUpdate(): Promise<{ ok: boolean; path?: string; error?: string }>
  onUpdateProgress(callback: (progress: import('./types').UpdateProgress) => void): () => void
  onUpdateAvailable(callback: (info: import('./types').UpdateInfo) => void): () => void
  getJevStatus(): Promise<import('./types').JevStatus>
  sandboxStatus(): Promise<import('./types').SandboxStatus>
  sandboxAudit(): Promise<string[]>
  onSandboxDomainDenied(callback: (event: ConversationNetworkBlock) => void): () => void
  saveJevSettings(patch: { enabled?: boolean; provider?: 'typesafe' | 'opencode-free'; model?: string; key?: string; sharePageText?: boolean }): Promise<import('./types').JevStatus>
  projectTrustSet(cwd: string, decision: boolean | null, scope?: 'project' | 'parent'): Promise<import('./types').ProjectTrustStatus>
  onPiInstallProgress(callback: (progress: { stage: string; message: string }) => void): () => void
  acknowledgeInterruptedUi(id: string): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  updatePiSettings(patch: PiSettings): Promise<PiSettings>
  pickFolder(): Promise<string | null>
  addProject(input: { cwd: string; name: string; trust?: boolean }): Promise<AddProjectResult>
  pickFile(options?: { title?: string; defaultPath?: string }): Promise<string | null>
  getPathForFile(file: File): string
  listSessions(): Promise<SessionSummary[]>
  searchSessions(query: string): Promise<import('./types').SessionSearchMatch[]>
  listWorkspaceFiles(cwd: string, query: string): Promise<string[]>
  deleteSession(path: string): Promise<DeletedSession | null>
  restoreSession(trashPath: string, path: string): Promise<boolean>
  readModelsConfig(): Promise<ModelsConfig>
  saveProvider(id: string, entry: CustomProviderEntry): Promise<ModelsConfig>
  removeProvider(id: string): Promise<ModelsConfig>
  listPiModels(): Promise<{ models: PiModelRow[]; error?: string }>
  refreshModelCatalog(): Promise<{ ok: boolean; output: string }>
  openSession(options: { cwd: string; sessionPath?: string | null; scratch?: boolean }): Promise<OpenSessionResult>
  closeSession(): Promise<void>
  sessionSecurity(sessionPath: string | null): Promise<SessionSecurity | null>
  setSessionPermission(input: SessionPermissionChange): Promise<SessionSecurity>
  creatorAction(input: import('./creator').CreatorAction, sessionPath: string | null): Promise<import('./creator').CreatorResult & {warning?:string}>
  listCreatedPlugins(): Promise<import('./creator').CreatedPluginsResult>
  command<T = unknown>(command: Record<string, unknown>, timeoutMs?: number): Promise<PiResponse<T>>
  uiResponse(response: Record<string, unknown>): void
  openExternal(url: string): Promise<void>
  externalBrowserPreview(sessionId: string, backend: string, doc: string, url: string, generation: string): Promise<{ image: string; at: number } | null>
  browserPreview(doc: string, url: string, candidate?: string): Promise<{ width: number; height: number; image: string; point: { x: number; y: number } | null; at: number } | null>
  revealBrowserPage(doc: string, openPanel?: boolean): Promise<boolean>
  browserCurrent(): Promise<BrowserState>
  browserOpen(url: string, separate?: boolean): Promise<BrowserState>
  browserNavigate(url: string, separate?: boolean): Promise<BrowserState>
  browserBack(): Promise<void>
  browserForward(): Promise<void>
  browserReload(): Promise<void>
  browserStop(): Promise<void>
  browserClose(): Promise<void>
  browserBounds(bounds: BrowserBounds): Promise<void>
  browserVisible(visible: boolean): Promise<void>
  onBrowserState(callback: (state: BrowserState) => void): () => void
  onBrowserReveal(callback: (doc: string) => void): () => void
  chromeBridgeInfo(): Promise<string>
  chromeBridgeCopyPath(): Promise<void>
  chromeBridgeDrag(): void
  desktopPermissionDragApp(): void
  desktopPermissionGuideClose(): void
  chromeBridgeCheck(): Promise<{ connected: boolean; busy: boolean; versionStatus?: 'current' | 'outdated' | 'unknown' }>
  desktopPermissionCheck(): Promise<{ accessibility: boolean; screenRecording: boolean; provisional?: boolean }>
  desktopPermissionRequest(kind: 'accessibility' | 'screen'): Promise<{ accessibility: boolean; screenRecording: boolean; provisional?: boolean }>
  openChromeExtensions(): Promise<void>
  browserRouterStatus(): Promise<import('./types').BrowserRouterStatus>
  startCdpBrowser(): Promise<{ ok: boolean; detail: string }>
  chromeProfiles(): Promise<{ profiles: ChromeProfile[]; running: boolean; error?: string }>
  chromePreview(profileId: string): Promise<{ domains: ChromeDomain[]; running: boolean }>
  chromeImport(profileId: string, domains: string[]): Promise<ChromeImportResult>
  showItem(path: string): Promise<void>
  openPath(path: string): Promise<boolean>
  notify(payload: {
    title?: string
    body?: string
    cwd?: string | null
    sessionPath?: string | null
  }): Promise<boolean>
  onNotifyOpen(callback: (payload: { cwd?: string | null; sessionPath?: string | null }) => void): () => void
  pickSavePath(options?: {
    defaultName?: string
    filters?: { name: string; extensions: string[] }[]
  }): Promise<string | null>
  writeTextFile(path: string, content: string): Promise<boolean>
  readDir(path: string, options?: { showHidden?: boolean }): Promise<DirEntry[]>
  readText(
    path: string,
    maxBytes?: number
  ): Promise<{ ok: boolean; content?: string; truncated?: boolean; size?: number; error?: string }>
  previewMedia(context: { path: string; workspace: string; sessionPath: string | null }): Promise<{ url: string; path: string } | null>
  platform: string
  onScrollPhase(callback: (phase: 'begin' | 'end' | 'cancel') => void): () => void
  gitStatus(cwd: string): Promise<GitStatus>
  gitBranch(cwd: string): Promise<string | null>
  gitDiff(cwd: string, path: string, staged?: boolean): Promise<string>
  gitCommit(cwd: string, message: string, paths: string[]): Promise<{ ok: boolean; output: string; error?: string }>
  listSkills(cwd: string): Promise<SkillEntry[]>
  countSkills(cwd: string): Promise<number>
  listConnectors(cwd: string): Promise<ConnectorEntry[]>
  listMcpConnectors(): Promise<McpConnector[]>
  saveMcpConnector(input: McpConnectorInput): Promise<McpConnector>
  testMcpConnector(input: McpConnectorInput): Promise<McpConnectionTest>
  removeMcpConnector(id: string): Promise<void>
  readSkill(path: string): Promise<{ ok: boolean; content?: string; error?: string }>
  listPackages(cwd: string): Promise<PackageEntry[]>
  inspectPackage(source: string, cwd: string): Promise<import('./types').PackageInspection>
  searchPackageCatalog(query: string): Promise<{ entries: import('./types').PackageCatalogEntry[]; error?: string }>
  translatePackageContent(input: import('./types').PackageTranslationRequest): Promise<import('./types').PackageTranslationResult>
  onPackageTranslationProgress(callback: (progress: import('./types').PackageTranslationProgress) => void): () => void
  getPackageDetails(input: import('./types').PackageDetailsRequest): Promise<import('./types').PackageDetailsResult>
  installPackage(
    source: string,
    options: { cwd: string; local?: boolean }
  ): Promise<{ ok: boolean; code: number | null; error?: string }>
  removePackage(
    source: string,
    cwd: string
  ): Promise<{ ok: boolean; code: number | null; error?: string }>
  updatePackage(
    source: string,
    cwd: string
  ): Promise<{ ok: boolean; code: number | null; error?: string }>
  onPackageProgress(callback: (progress: PackageProgress) => void): () => void
  listSchedules(): Promise<ScheduledTask[]>
  getSchedule(id: string): Promise<{ task: ScheduledTask; runs: ScheduledRun[] } | null>
  getSessionNotices(sessionPath: string): Promise<SessionNotice[]>
  usageSummary(range: UsageRange): Promise<UsageSummary>
  interpretSchedule(id: string, input: import('./types').ScheduleInterpretationInput): Promise<import('./types').ScheduleInterpretation>
  cancelScheduleInterpretation(id: string): Promise<void>
  createSchedule(input: ScheduledTaskInput, requireFuture?: boolean): Promise<ScheduledTask>
  updateSchedule(id: string, patch: Partial<ScheduledTaskInput>, requireFuture?: boolean): Promise<ScheduledTask | null>
  deleteSchedule(id: string): Promise<boolean>
  setScheduleEnabled(id: string, enabled: boolean): Promise<ScheduledTask | null>
  runScheduleNow(id: string): Promise<ScheduledRun | null>
  previewSchedule(cadence: ScheduleCadence, count?: number, timezone?: string): Promise<number[]>
  validateCron(expression: string): Promise<string | null>
  getBackgroundScheduler(): Promise<BackgroundSchedulerStatus>
  setBackgroundScheduler(enabled: boolean): Promise<BackgroundSchedulerStatus>
  onSchedulesChanged(callback: (tasks: ScheduledTask[]) => void): () => void
  onScheduleEvent(callback: (event: ScheduleEvent) => void): () => void
  onScheduleOpen(callback: (taskId: string) => void): () => void
  onRecord(callback: (record: PiRecord) => void): () => void
  onStatus(
    callback: (status: { status: string; code?: number | null; signal?: string | null }) => void
  ): () => void
  onStderr(callback: (text: string) => void): () => void
  onAppEvent(callback: (event: { name: string; payload?: unknown }) => void): () => void
  onSettings(callback: (settings: Settings) => void): () => void
}
