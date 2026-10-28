import type {
  Bootstrap,
  CustomProviderEntry,
  DeletedSession,
  ModelsConfig,
  OpenSessionResult,
  PiModelRow,
  PiRecord,
  PiResponse,
  SessionSummary,
  Settings,
  PiSettings
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
  openSession(options: { cwd: string; sessionPath?: string | null }): Promise<OpenSessionResult>
  closeSession(): Promise<void>
  command<T = unknown>(command: Record<string, unknown>, timeoutMs?: number): Promise<PiResponse<T>>
  uiResponse(response: Record<string, unknown>): void
  openExternal(url: string): Promise<void>
  showItem(path: string): Promise<void>
  openPath(path: string): Promise<boolean>
  notify(payload: { title?: string; body?: string }): Promise<boolean>
  pickSavePath(options?: {
    defaultName?: string
    filters?: { name: string; extensions: string[] }[]
  }): Promise<string | null>
  writeTextFile(path: string, content: string): Promise<boolean>
  onRecord(callback: (record: PiRecord) => void): () => void
  onStatus(
    callback: (status: { status: string; code?: number | null; signal?: string | null }) => void
  ): () => void
  onStderr(callback: (text: string) => void): () => void
  onAppEvent(callback: (event: { name: string; payload?: unknown }) => void): () => void
  onSettings(callback: (settings: Settings) => void): () => void
}
