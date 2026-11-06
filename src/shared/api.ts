import type {
  BackgroundSchedulerStatus,
  Bootstrap,
  BrowserBounds,
  BrowserState,
  ConnectorEntry,
  CustomProviderEntry,
  DeletedSession,
  DirEntry,
  GitStatus,
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

export interface PiDesktopApi {
  bootstrap(): Promise<Bootstrap>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  updatePiSettings(patch: PiSettings): Promise<PiSettings>
  pickFolder(): Promise<string | null>
  pickFile(options?: { title?: string; defaultPath?: string }): Promise<string | null>
  listSessions(): Promise<SessionSummary[]>
  deleteSession(path: string): Promise<DeletedSession | null>
  restoreSession(trashPath: string, path: string): Promise<boolean>
  readModelsConfig(): Promise<ModelsConfig>
  saveProvider(id: string, entry: CustomProviderEntry): Promise<ModelsConfig>
  removeProvider(id: string): Promise<ModelsConfig>
  listPiModels(): Promise<{ models: PiModelRow[]; error?: string }>
  refreshModelCatalog(): Promise<{ ok: boolean; output: string }>
  openSession(options: { cwd: string; sessionPath?: string | null; scratch?: boolean }): Promise<OpenSessionResult>
  closeSession(): Promise<void>
  command<T = unknown>(command: Record<string, unknown>, timeoutMs?: number): Promise<PiResponse<T>>
  uiResponse(response: Record<string, unknown>): void
  openExternal(url: string): Promise<void>
  browserOpen(url: string): Promise<BrowserState>
  browserNavigate(url: string): Promise<BrowserState>
  browserBack(): Promise<void>
  browserForward(): Promise<void>
  browserReload(): Promise<void>
  browserStop(): Promise<void>
  browserClose(): Promise<void>
  browserBounds(bounds: BrowserBounds): Promise<void>
  browserVisible(visible: boolean): Promise<void>
  onBrowserState(callback: (state: BrowserState) => void): () => void
  showItem(path: string): Promise<void>
  openPath(path: string): Promise<boolean>
  notify(payload: { title?: string; body?: string }): Promise<boolean>
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
  platform: string
  gitStatus(cwd: string): Promise<GitStatus>
  gitDiff(cwd: string, path: string, staged?: boolean): Promise<string>
  listSkills(cwd: string): Promise<SkillEntry[]>
  countSkills(cwd: string): Promise<number>
  listConnectors(cwd: string): Promise<ConnectorEntry[]>
  readSkill(path: string): Promise<{ ok: boolean; content?: string; error?: string }>
  listPackages(cwd: string): Promise<PackageEntry[]>
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
  createSchedule(input: ScheduledTaskInput): Promise<ScheduledTask>
  updateSchedule(id: string, patch: Partial<ScheduledTaskInput>): Promise<ScheduledTask | null>
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
