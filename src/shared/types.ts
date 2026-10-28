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

export interface Settings {
  piPath?: string
  theme: 'dark' | 'light'
  workspaces: string[]
  lastWorkspace?: string
  toolCardsExpanded?: boolean
  followStream?: boolean
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

export interface Bootstrap {
  platform: string
  appVersion: string
  electronVersion: string
  piPath: string
  piVersion: string | null
  home: string
  sessionsRoot: string
  settings: Settings
  piSettings: PiSettings
  piSettingsFile: string
  agentDir: string
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
}

export interface SessionListItem {
  path: string
  cwd: string
  name: string
  exists: boolean
}
