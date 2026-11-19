export type ThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export interface ModelCost {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  total?: number
}

export interface ModelInfo {
  id: string
  name: string
  provider: string
  api?: string
  baseUrl?: string
  reasoning?: boolean
  input?: string[]
  contextWindow?: number
  maxTokens?: number
  cost?: ModelCost
}

export interface PiState {
  model?: ModelInfo | null
  thinkingLevel: ThinkingLevel
  isStreaming: boolean
  isCompacting: boolean
  steeringMode: 'all' | 'one-at-a-time'
  followUpMode: 'all' | 'one-at-a-time'
  sessionFile?: string | null
  sessionId?: string
  sessionName?: string
  autoCompactionEnabled?: boolean
  messageCount?: number
  pendingMessageCount?: number
}

export type ToolApprovalMode = 'dangerous' | 'all' | 'never'
export type SessionPermission = 'ask' | 'review' | 'full'

export interface SessionSecurity {
  permission: SessionPermission
  mode: ToolApprovalMode
  sandboxed: boolean
  files?: 'workspace-write' | 'read-only'
  network?: 'model' | 'off'
}

export interface TokenCounts {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export interface SessionStats {
  sessionFile?: string | null
  sessionId?: string
  userMessages?: number
  assistantMessages?: number
  toolCalls?: number
  toolResults?: number
  totalMessages?: number
  tokens?: TokenCounts
  cost?: number
  contextUsage?: {
    tokens: number | null
    contextWindow: number | null
    percent: number | null
  } | null
}

export interface Usage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  totalTokens?: number
  cost?: ModelCost
  reasoning?: number
}

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ImageBlock {
  type: 'image'
  data: string
  mimeType: string
}

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
  redacted?: boolean
}

export interface ToolCallBlock {
  type: 'toolCall'
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type ContentBlock = TextBlock | ImageBlock | ThinkingBlock | ToolCallBlock

export interface UserMessage {
  role: 'user'
  content: string | ContentBlock[]
  timestamp?: number
  [key: string]: unknown
}

export interface AssistantMessage {
  role: 'assistant'
  content: ContentBlock[]
  provider?: string
  model?: string
  responseModel?: string
  thinkingLevel?: ThinkingLevel
  usage?: Usage
  stopReason?: string
  errorMessage?: string
  timestamp?: number
  /** Wall time pi spent producing this step (thinking + text). */
  durationMs?: number
  [key: string]: unknown
}

export interface ToolResultMessage {
  role: 'toolResult'
  toolCallId: string
  toolName: string
  content: ContentBlock[]
  details?: unknown
  isError?: boolean
  timestamp?: number
  [key: string]: unknown
}

export interface SystemMessage {
  role: 'system'
  content: string | ContentBlock[]
  sections?: Record<string, string | null>
  timestamp?: number
  [key: string]: unknown
}

export interface CustomMessage {
  role: 'custom'
  customType?: string
  content: string | ContentBlock[]
  display?: boolean
  timestamp?: number
  [key: string]: unknown
}

export type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | SystemMessage
  | CustomMessage

export interface ToolRun {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  partialText?: string
  resultText?: string
  resultContent?: ContentBlock[]
  resultDetails?: unknown
  startedAt: number
  durationMs?: number
}

export interface CommandInfo {
  name: string
  description?: string
  source?: 'extension' | 'prompt' | 'skill'
}

export interface SessionSummary {
  path: string
  id: string
  cwd: string
  name: string
  preview: string
  updatedAt: number
  createdAt: number
  messageCount: number
  size: number
}

export interface BackgroundSchedulerStatus {
  supported: boolean
  installed: boolean
  path?: string
  detail?: string
}

export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserDownload {
  id: string
  filename: string
  state: 'completed' | 'cancelled' | 'interrupted'
}

export interface BrowserState {
  open: boolean
  url: string
  title: string
  favicon: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
  download?: BrowserDownload
}

export interface ChromeProfile {
  id: string
  name: string
  account?: string
}

export interface ChromeDomain {
  domain: string
  count: number
}

export interface ChromeImportResult {
  ok: boolean
  imported: number
  skipped: number
  failed: number
  errors: { domain: string; reason: string }[]
  error?: string
}

export interface Settings {
  computerUseEnabled?: boolean
  piPath?: string
  language?: 'zh-CN' | 'en'
  theme: 'dark' | 'light'
  workspaces: string[]
  workspaceNames?: Record<string, string>
  lastWorkspace?: string
  lastSessionPath?: string
  /** Fold the process away once the final answer of a turn lands. */
  turnAutoFold?: boolean
  /** How many recent turns stay in the main view before older ones aggregate. */
  turnAggregate?: number
  /** off | summary | full */
  thinkingDisplay?: 'off' | 'summary' | 'full'
  /** Desktop notification when a long run finishes in the background. */
  notifyOnFinish?: boolean
  workPanelOpen?: boolean
  workPanelWidth?: number
  workPanelTab?: 'home' | 'changes' | 'files' | 'terminal' | 'artifacts' | 'browser'
  workPanelTabs?: ('home' | 'changes' | 'files' | 'terminal' | 'artifacts' | 'browser')[]
  /** Where links in chat open: the in-app browser panel or the OS browser. */
  linkOpenMode?: 'browser' | 'external'
  /** Check GitHub Releases once after launch; never downloads without confirmation. */
  autoCheckUpdates?: boolean
  toolCardsExpanded?: boolean
  /** dangerous = confirm only high-risk bash; all = confirm every tool; never = no desktop approval. */
  toolApprovalMode?: ToolApprovalMode
  allowFullAccess?: boolean
  /** OS-level sandbox for the pi process tree (macOS/Linux). */
  sandboxEnabled?: boolean
  /** workspace-write = edit project; read-only = project read, session/tmp writes only. */
  sandboxMode?: 'workspace-write' | 'read-only'
  /** model = model hosts + custom domains; off = no network at all. */
  sandboxNetwork?: 'model' | 'off'
  sandboxAllowedDomains?: string[]
  /** Optional HTTP proxy for the pi child when the sandbox is off. */
  networkProxy?: string
  networkNoProxy?: string
  followStream?: boolean
  launchAtLogin?: boolean
  backgroundScheduler?: boolean
  windowBounds?: { x?: number; y?: number; width: number; height: number }
}

/** One provider entry in pi's models.json. */
export interface CustomModelEntry {
  id: string
  name?: string
  reasoning?: boolean
  input?: string[]
  contextWindow?: number
  maxTokens?: number
}

export interface CustomProviderEntry {
  name?: string
  baseUrl?: string
  api?: string
  apiKey?: string
  models?: CustomModelEntry[]
}

export interface ModelsConfig {
  file: string
  exists: boolean
  providers: Record<string, CustomProviderEntry>
  error?: string
}

/** A model pi resolves today, from `pi --list-models`. */
export interface PiModelRow {
  provider: string
  id: string
  context: string
  maxOut: string
  thinking: boolean
  images: boolean
}

/** Subset of pi's own settings.json that the desktop app reads and writes. */
export interface PiSettings {
  defaultProvider?: string
  defaultModel?: string
  defaultThinkingLevel?: ThinkingLevel
  steeringMode?: 'all' | 'one-at-a-time'
  followUpMode?: 'all' | 'one-at-a-time'
  defaultTools?: string[]
  compaction?: {
    enabled?: boolean
    reserveTokens?: number
    keepRecentTokens?: number
  }
  retry?: {
    enabled?: boolean
    maxRetries?: number
  }
  images?: {
    autoResize?: boolean
    blockImages?: boolean
  }
  sessionDir?: string
  [key: string]: unknown
}

export interface AuthProviderStatus {
  provider: string
  type: 'api_key' | 'oauth' | 'unknown'
}

export interface UpdateAsset {
  name: string
  url: string
  size: number
  digest?: string
}

export interface UpdateInfo {
  current: string
  latest: string | null
  hasUpdate: boolean
  url: string | null
  notes: string | null
  publishedAt: string | null
  asset?: UpdateAsset | null
  error?: string
}

export interface UpdateProgress {
  phase: 'downloading' | 'verifying' | 'ready' | 'error'
  received?: number
  total?: number
  message: string
  path?: string
}

export interface ProjectTrustStatus {
  required: boolean
  decision: boolean | null
  inheritedFrom?: string
  resources?: string[]
}

export type AddProjectResult =
  | { status: 'needs-trust'; cwd: string; trust: ProjectTrustStatus }
  | { status: 'added'; cwd: string }

export interface Bootstrap {
  platform: string
  appVersion: string
  electronVersion: string
  piPath: string
  piVersion: string | null
  /** True when this executable came from the offline seed bundled with the app. */
  piBundled?: boolean
  /** False when the app was launched for an automated test or a managed build. */
  autoInstallPi?: boolean
  home: string
  sessionsRoot: string
  /** Dedicated cwd for conversations without a project. */
  scratchPath: string
  settings: Settings
  piSettings: PiSettings
  piSettingsFile: string
  agentDir: string
  interruptedUi?: { id: string; cwd: string; sessionPath: string | null; at: number }[] | null
}

export interface PiResponse<T = unknown> {
  id?: string
  type: 'response'
  command: string
  success: boolean
  data?: T
  error?: string
}

export interface ExtensionUiRequest {
  type: 'extension_ui_request'
  id: string
  method:
    | 'select'
    | 'confirm'
    | 'input'
    | 'editor'
    | 'notify'
    | 'setStatus'
    | 'setTitle'
    | 'setWidget'
    | 'set_editor_text'
    | string
  title?: string
  message?: string
  text?: string
  options?: string[]
  placeholder?: string
  prefill?: string
  timeout?: number
  level?: 'info' | 'warning' | 'error' | string
  [key: string]: unknown
}

export interface PiRecord {
  type: string
  [key: string]: unknown
}

export interface OpenSessionResult {
  ok: boolean
  error?: string
  sessionPath?: string | null
  cwd?: string
  scratch?: boolean
}

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
  size: number
}

export interface GitFileChange {
  path: string
  relative: string
  status: string
  staged: boolean
  additions: number
  deletions: number
}

export interface GitStatus {
  ok: boolean
  branch: string
  files: GitFileChange[]
}

export interface SessionTreeEntry {
  id: string
  type: string
  parentId?: string | null
  timestamp?: string
  message?: { role?: string; content?: unknown }
}

export interface SessionTreeNode {
  entry: SessionTreeEntry
  children: SessionTreeNode[]
  label?: string
}

export interface SandboxStatus {
  available: boolean
  reason?: string
  node?: string
  cli?: string
}

export interface JevStatus {
  enabled: boolean
  provider: 'typesafe' | 'opencode-free'
  model: string
  sharePageText: boolean
  keyConfigured: boolean
  keySource: 'file' | 'env' | null
}

export interface BrowserRouterStatus {
  cdpPort: number
  backends: {
    backend: 'inapp' | 'cdp' | 'extension'
    connected: boolean
    detail: string
  }[]
}

export interface SessionTreeData {
  tree: SessionTreeNode[]
  leafId: string | null
}

export interface SessionSearchMatch {
  session: SessionSummary
  matches: { role: 'user' | 'assistant'; text: string }[]
}

export interface DeletedSession {
  path: string
  trashPath: string
  name: string
}

export interface SessionListItem {
  path: string
  cwd: string
  name: string
  exists: boolean
}

/** One skill discovered on disk (with or without a pi package). */
export interface SkillEntry {
  name: string
  description: string
  displayName?: string
  summary?: string
  version?: string
  path: string
  realPath: string
  source: 'user' | 'agents' | 'project' | 'package'
  packageName?: string
  symlink: boolean
  requires: { bins: string[]; missing: string[] }
  shadowedBy?: string
}

export interface PackageResources {
  extensions: number
  skills: number
  prompts: number
  themes: number
}

export interface PackageEntry {
  source: string
  name: string
  version?: string
  description?: string
  scope: 'user' | 'project'
  path?: string
  resources: PackageResources
  enabled: boolean
}

/** An external CLI that skills invoke (lark-cli, git, gh, …). */
export interface ConnectorEntry {
  name: string
  installed: boolean
  path?: string
  usedBy: Array<{ name: string; path: string }>
}

export interface McpConnector {
  id: string
  name: string
  transport: 'http' | 'stdio'
  url?: string
  enabled: boolean
  headerNames: string[]
}

export interface McpConnectorInput {
  id?: string
  name: string
  url: string
  headers: Array<{ name: string; value: string; keep?: boolean }>
}

export type McpConnectionTest =
  | { status: 'connected'; toolCount: number }
  | { status: 'unauthorized' | 'unreachable' | 'unsupported' }

export interface PackageCatalogEntry {
  name: string
  version: string
  description: string
  publishedAt: string | null
  publisher: string | null
  keywords: string[]
  npmUrl: string | null
  repositoryUrl: string | null
  source: string
}

export interface PackageInspection {
  source: string
  kind: 'npm' | 'git' | 'local'
  path?: string
  name: string
  version?: string
  description?: string
  manifestFound: boolean
  scripts: { name: string; command: string }[]
  resources: PackageResources
  files?: number
  bytes?: number
  risk: 'low' | 'medium' | 'high' | 'unknown'
  warnings: string[]
}

export interface PackageProgress {
  phase: 'start' | 'log' | 'done' | 'error'
  line?: string
  code?: number | null
}

export type ScheduleCadence =
  | { type: 'once'; at: number }
  | { type: 'hourly'; minute: number }
  | { type: 'daily'; time: string }
  | { type: 'weekdays'; time: string }
  | { type: 'weekly'; weekday: number; time: string }
  | { type: 'cron'; expression: string }
  | { type: 'event'; event: 'file-change'; path: string; debounceMs: number }

export type ScheduledRunStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'interrupted'
  | 'missed'
  | 'skipped'

export interface ScheduledTask {
  id: string
  name: string
  prompt: string
  projectPath: string
  /** Conversation that created the task, for completion notices. */
  sourceSessionPath?: string
  cadence: ScheduleCadence
  timezone?: string
  runMode: 'new-session' | 'continue-session'
  model?: string
  thinking?: string
  tools?: string[]
  catchUp: boolean
  catchUpWindowMs: number
  notifications: boolean
  enabled: boolean
  createdAt: number
  updatedAt: number
  nextRunAt: number | null
  pendingCatchUpAt?: number | null
  lastRunAt: number | null
  lastStatus: ScheduledRunStatus | null
  consecutiveFailures: number
}

export interface ScheduledRun {
  id: string
  taskId: string
  trigger: 'schedule' | 'manual' | 'catch-up' | 'event'
  scheduledFor: number | null
  status: ScheduledRunStatus
  startedAt: number
  endedAt?: number
  durationMs?: number
  exitCode?: number | null
  sessionPath?: string
  logPath: string
  summary?: string
  error?: string
}

export type UsageRange = 'today' | '7d' | '30d' | 'month' | 'all'

export interface UsageTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  requests: number
  cost: number
}

export interface UsageEntry {
  at: number
  provider: string
  model: string
  usage: Record<string, unknown>
}

export interface UsageModelRow extends UsageTotals {
  provider: string
  model: string
  planId: string
  planLabel: string
}

export interface UsagePlanRow extends UsageTotals {
  id: string
  label: string
}

export interface UsageProjectRow extends UsageTotals {
  path: string
  name: string
}

export interface UsageDay extends UsageTotals {
  date: string
}

export interface UsageSkillRow {
  name: string
  calls: number
  sessions: number
  tokens: number
  cost: number
}

export interface UsageSessionRow extends UsageTotals {
  path: string
  name: string
  cwd: string
  projectPath: string
  projectName: string
  updatedAt: number
}

export interface UsageSummary {
  range: UsageRange
  from: number | null
  to: number
  totals: UsageTotals
  byDay: UsageDay[]
  byModel: UsageModelRow[]
  byPlan: UsagePlanRow[]
  byProject: UsageProjectRow[]
  bySkill: UsageSkillRow[]
  sessions: UsageSessionRow[]
  generatedAt: number
}

export interface SessionNotice {
  id: string
  sessionPath: string
  taskId: string
  taskName: string
  status: ScheduledRunStatus
  runId: string
  text: string
  createdAt: number
}

export type ScheduleEvent =
  | { type: 'created'; taskId: string; name: string; nextRunAt: number | null }
  | { type: 'started'; taskId: string; name: string; runId: string; startedAt: number }
  | {
      type: 'finished'
      taskId: string
      name: string
      runId: string
      status: ScheduledRunStatus
      durationMs?: number
      error?: string
      sessionPath?: string
      removed?: boolean
    }
  | { type: 'notice'; notice: SessionNotice }

export interface ScheduledTaskInput {
  name: string
  prompt: string
  projectPath: string
  sourceSessionPath?: string
  cadence: ScheduleCadence
  timezone?: string
  runMode?: 'new-session' | 'continue-session'
  model?: string
  thinking?: string
  tools?: string[]
  catchUp?: boolean
  notifications?: boolean
  enabled?: boolean
}
