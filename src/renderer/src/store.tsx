import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode
} from 'react'
import type {
  AgentMessage,
  AssistantMessage,
  Bootstrap,
  CommandInfo,
  ContentBlock,
  ExtensionUiRequest,
  ModelInfo,
  PiRecord,
  PiSettings,
  PiState,
  SessionStats,
  SessionSummary,
  Settings,
  ThinkingLevel,
  ToolRun
} from '@shared/types'
import type { PiResponse } from '@shared/types'
import { contentText } from './lib/tools'

export type SendMode = 'steer' | 'followUp'
export type NoticeLevel = 'info' | 'success' | 'warning' | 'error'

export interface Notice {
  id: string
  level: NoticeLevel
  title: string
  detail?: string
  createdAt: number
  action?: { label: string; run: () => void }
}

export interface RetryState {
  attempt: number
  maxAttempts: number
  delayMs?: number
  errorMessage?: string
}

export interface AppState {
  boot: Bootstrap | null
  status: 'booting' | 'idle' | 'starting' | 'ready' | 'error' | 'exited'
  error: string | null
  sessions: SessionSummary[]
  workspace: string | null
  sessionPath: string | null
  sessionName: string | null
  piState: PiState | null
  stats: SessionStats | null
  models: ModelInfo[]
  levels: ThinkingLevel[]
  commands: CommandInfo[]
  messages: AgentMessage[]
  streaming: boolean
  streamingIndex: number
  toolRuns: Record<string, ToolRun>
  queue: { steering: string[]; followUp: string[] }
  notices: Notice[]
  uiRequests: ExtensionUiRequest[]
  compacting: boolean
  retry: RetryState | null
  settings: Settings
  piSettings: PiSettings
  settingsOpen: boolean
  sidebarOpen: boolean
  statusText: string | null
  editorText: { value: string; nonce: number } | null
  sendMode: SendMode
  stderr: string
  diagnosticsOpen: boolean
  deletedSession: { path: string; trashPath: string; name: string } | null
}

const initialSettings: Settings = { theme: 'dark', workspaces: [] }

export const initialState: AppState = {
  boot: null,
  status: 'booting',
  error: null,
  sessions: [],
  workspace: null,
  sessionPath: null,
  sessionName: null,
  piState: null,
  stats: null,
  models: [],
  levels: [],
  commands: [],
  messages: [],
  streaming: false,
  streamingIndex: -1,
  toolRuns: {},
  queue: { steering: [], followUp: [] },
  notices: [],
  uiRequests: [],
  compacting: false,
  retry: null,
  settings: initialSettings,
  piSettings: {},
  settingsOpen: false,
  sidebarOpen: localStorage.getItem('pi.sidebar') !== 'closed',
  statusText: null,
  editorText: null,
  sendMode: 'steer',
  stderr: '',
  diagnosticsOpen: false,
  deletedSession: null
}

let noticeSequence = 0

function addNotice(
  state: AppState,
  level: NoticeLevel,
  title: string,
  detail?: string,
  action?: { label: string; run: () => void }
): AppState {
  const notice: Notice = {
    id: `n${++noticeSequence}`,
    level,
    title,
    detail,
    createdAt: Date.now(),
    action
  }
  return { ...state, notices: [...state.notices, notice].slice(-4) }
}

export function normalizeQueue(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        if (typeof record.text === 'string') return record.text
        const content = contentText(record.content)
        if (content) return content
      }
      return ''
    })
    .filter(Boolean)
}

function applyAssistantEvent(
  message: AssistantMessage,
  event: Record<string, unknown>
): AssistantMessage {
  const content = [...message.content]
  const index = typeof event.contentIndex === 'number' ? event.contentIndex : content.length - 1
  const type = String(event.type ?? '')

  const set = (block: ContentBlock): void => {
    content[index] = block
  }

  switch (type) {
    case 'text_start':
      set({ type: 'text', text: '' })
      break
    case 'text_delta': {
      const current = content[index]
      const text = current?.type === 'text' ? current.text : ''
      set({ type: 'text', text: text + String(event.delta ?? '') })
      break
    }
    case 'text_end':
      set({ type: 'text', text: String(event.content ?? '') })
      break
    case 'thinking_start':
      set({ type: 'thinking', thinking: '' })
      break
    case 'thinking_delta': {
      const current = content[index]
      const thinking = current?.type === 'thinking' ? current.thinking : ''
      set({ type: 'thinking', thinking: thinking + String(event.delta ?? '') })
      break
    }
    case 'thinking_end':
      set({ type: 'thinking', thinking: String(event.content ?? '') })
      break
    case 'toolcall_start':
      set({
        type: 'toolCall',
        id: String(event.id ?? `call-${index}`),
        name: String(event.toolName ?? 'tool'),
        arguments: {}
      })
      break
    case 'toolcall_end': {
      const call = event.toolCall as
        | { id?: string; name?: string; arguments?: Record<string, unknown> }
        | undefined
      const current = content[index]
      set({
        type: 'toolCall',
        id: call?.id ?? (current?.type === 'toolCall' ? current.id : `call-${index}`),
        name: call?.name ?? (current?.type === 'toolCall' ? current.name : 'tool'),
        arguments: call?.arguments ?? {}
      })
      break
    }
    default:
      break
  }

  return { ...message, content }
}

function reduceRecord(state: AppState, record: Record<string, unknown>): AppState {
  const type = String(record.type ?? '')

  switch (type) {
    case 'agent_start':
      return { ...state, streaming: true }

    case 'agent_settled':
      return {
        ...state,
        streaming: false,
        streamingIndex: -1,
        retry: null,
        compacting: false
      }

    case 'message_start': {
      const message = record.message as AgentMessage
      if (!message) return state
      const base =
        message.role === 'user'
          ? state.messages.filter(
              (item) => !(item as { __optimistic?: boolean }).__optimistic
            )
          : state.messages
      const messages = [...base, message]
      if (message.role === 'assistant') {
        return { ...state, messages, streamingIndex: messages.length - 1, streaming: true }
      }
      return { ...state, messages }
    }

    case 'message_update': {
      const index = state.streamingIndex
      if (index < 0 || index >= state.messages.length) return state
      const message = state.messages[index]
      if (message.role !== 'assistant') return state
      const updated = applyAssistantEvent(
        message as AssistantMessage,
        record.assistantMessageEvent as Record<string, unknown>
      )
      const messages = [...state.messages]
      messages[index] = updated
      return { ...state, messages }
    }

    case 'message_end': {
      const incoming = record.message as AgentMessage
      if (!incoming) return state
      const index = state.streamingIndex
      if (index >= 0 && index < state.messages.length && state.messages[index].role === incoming.role) {
        const messages = [...state.messages]
        messages[index] = incoming
        return { ...state, messages, streamingIndex: -1 }
      }
      const last = state.messages[state.messages.length - 1]
      if (
        last &&
        last.role === incoming.role &&
        (last as { timestamp?: number }).timestamp === (incoming as { timestamp?: number }).timestamp
      ) {
        const messages = [...state.messages]
        messages[messages.length - 1] = incoming
        return { ...state, messages }
      }
      return { ...state, messages: [...state.messages, incoming] }
    }

    case 'tool_execution_start': {
      const id = String(record.toolCallId ?? '')
      if (!id) return state
      const run: ToolRun = {
        id,
        name: String(record.toolName ?? 'tool'),
        args: (record.args as Record<string, unknown>) ?? {},
        status: 'running',
        startedAt: Date.now()
      }
      return { ...state, toolRuns: { ...state.toolRuns, [id]: run } }
    }

    case 'tool_execution_update': {
      const id = String(record.toolCallId ?? '')
      const run = state.toolRuns[id]
      if (!run) return state
      const text = contentText(record.partialResult)
      return {
        ...state,
        toolRuns: {
          ...state.toolRuns,
          [id]: { ...run, partialText: text || run.partialText }
        }
      }
    }

    case 'tool_execution_end': {
      const id = String(record.toolCallId ?? '')
      if (!id) return state
      const run: ToolRun = state.toolRuns[id] ?? {
        id,
        name: String(record.toolName ?? 'tool'),
        args: (record.args as Record<string, unknown>) ?? {},
        status: 'running',
        startedAt: Date.now()
      }
      const result = record.result as
        | { content?: ContentBlock[]; details?: unknown }
        | undefined
      return {
        ...state,
        toolRuns: {
          ...state.toolRuns,
          [id]: {
            ...run,
            status: record.isError ? 'error' : 'done',
            resultText: contentText(result),
            resultContent: result?.content,
            resultDetails: result?.details,
            durationMs: typeof record.durationMs === 'number' ? record.durationMs : run.durationMs
          }
        }
      }
    }

    case 'queue_update':
      return {
        ...state,
        queue: {
          steering: normalizeQueue(record.steering),
          followUp: normalizeQueue(record.followUp)
        }
      }

    case 'thinking_level_changed': {
      const level = record.level as ThinkingLevel
      return state.piState
        ? { ...state, piState: { ...state.piState, thinkingLevel: level } }
        : state
    }

    case 'session_info_changed': {
      const name = typeof record.name === 'string' && record.name.trim() ? record.name : null
      return { ...state, sessionName: name }
    }

    case 'compaction_start':
      return { ...state, compacting: true }

    case 'compaction_end':
      return { ...state, compacting: false }

    case 'auto_retry_start':
      return {
        ...state,
        retry: {
          attempt: Number(record.attempt ?? 1),
          maxAttempts: Number(record.maxAttempts ?? 1),
          delayMs: typeof record.delayMs === 'number' ? record.delayMs : undefined,
          errorMessage: typeof record.errorMessage === 'string' ? record.errorMessage : undefined
        }
      }

    case 'auto_retry_end': {
      if (record.success) return { ...state, retry: null }
      return addNotice(
        { ...state, retry: null },
        'error',
        'Retry failed',
        typeof record.finalError === 'string' ? record.finalError : undefined
      )
    }

    case 'extension_error':
      return addNotice(
        state,
        'error',
        'Extension error',
        `${String(record.extensionsPath ?? record.extensionPath ?? '')} ${String(record.error ?? '')}`.trim()
      )

    case 'extension_ui_request': {
      const request = record as unknown as ExtensionUiRequest
      switch (request.method) {
        case 'notify':
          return addNotice(
            state,
            (request.level as NoticeLevel) ?? 'info',
            String(request.message ?? request.title ?? 'Notification')
          )
        case 'setTitle':
          if (request.title) document.title = String(request.title)
          return state
        case 'set_editor_text':
          return {
            ...state,
            editorText: { value: String(request.text ?? ''), nonce: Date.now() }
          }
        case 'setStatus':
          return { ...state, statusText: request.status ? String(request.status) : null }
        default:
          return { ...state, uiRequests: [...state.uiRequests, request] }
      }
    }

    default:
      return state
  }
}

export type Action =
  | { type: 'BOOT'; boot: Bootstrap }
  | { type: 'SET_SESSIONS'; sessions: SessionSummary[] }
  | { type: 'SET_SETTINGS'; settings: Settings }
  | { type: 'SET_PI_SETTINGS'; piSettings: PiSettings }
  | { type: 'PATCH_PI_STATE'; patch: Partial<PiState> }
  | { type: 'SESSION_START'; workspace: string; sessionPath: string | null; keepMessages?: boolean }
  | {
      type: 'SESSION_READY'
      piState: PiState | null
      stats: SessionStats | null
      models: ModelInfo[]
      levels: ThinkingLevel[]
      commands: CommandInfo[]
      messages: AgentMessage[]
      sessionPath: string | null
      workspace?: string
    }
  | { type: 'SESSION_ERROR'; error: string }
  | { type: 'STATS'; stats: SessionStats | null; piState: PiState | null; sessionPath?: string | null }
  | { type: 'RECORD'; record: PiRecord }
  | { type: 'RECORDS'; records: PiRecord[] }
  | { type: 'SEND_OPTIMISTIC'; text: string; images: { data: string; mimeType: string }[] }
  | { type: 'REMOVE_OPTIMISTIC' }
  | { type: 'SET_MESSAGES'; messages: AgentMessage[] }
  | { type: 'STATUS'; status: { status: string; code?: number | null; signal?: string | null } }
  | { type: 'STDERR'; text: string }
  | { type: 'NOTICE'; level: NoticeLevel; title: string; detail?: string; action?: { label: string; run: () => void } }
  | { type: 'DISMISS_NOTICE'; id: string }
  | { type: 'UI_DONE' }
  | { type: 'SET_NAME'; name: string | null }
  | { type: 'SET_MODEL'; model: ModelInfo }
  | { type: 'SET_THINKING'; level: ThinkingLevel }
  | { type: 'SET_SEND_MODE'; mode: SendMode }
  | { type: 'SET_STREAMING'; streaming: boolean }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SETTINGS_OPEN'; open: boolean }
  | { type: 'SET_DIAGNOSTICS_OPEN'; open: boolean }
  | { type: 'SET_DELETED_SESSION'; deleted: { path: string; trashPath: string; name: string } | null }
  | { type: 'SET_THEME'; theme: 'dark' | 'light' }
  | { type: 'FILL_COMPOSER'; value: string }

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'BOOT':
      return {
        ...state,
        boot: action.boot,
        settings: action.boot.settings,
        piSettings: action.boot.piSettings ?? {},
        status: 'booting'
      }

    case 'SET_PI_SETTINGS':
      return { ...state, piSettings: action.piSettings }

    case 'PATCH_PI_STATE':
      return state.piState ? { ...state, piState: { ...state.piState, ...action.patch } } : state

    case 'SET_SESSIONS':
      return { ...state, sessions: action.sessions }

    case 'SET_SETTINGS':
      return { ...state, settings: action.settings }

    case 'SET_THEME':
      return {
        ...state,
        settings: { ...state.settings, theme: action.theme }
      }

    case 'SESSION_START':
      return {
        ...state,
        workspace: action.workspace,
        sessionPath: action.sessionPath,
        sessionName: action.keepMessages ? state.sessionName : null,
        status: 'starting',
        error: null,
        piState: action.keepMessages ? state.piState : null,
        stats: action.keepMessages ? state.stats : null,
        messages: action.keepMessages ? state.messages : [],
        toolRuns: action.keepMessages ? state.toolRuns : {},
        queue: { steering: [], followUp: [] },
        streaming: false,
        streamingIndex: -1,
        compacting: false,
        retry: null,
        statusText: null
      }

    case 'SESSION_READY':
      return {
        ...state,
        status: 'ready',
        error: null,
        piState: action.piState,
        stats: action.stats,
        models: action.models,
        levels: action.levels.length ? action.levels : ['off'],
        commands: action.commands,
        messages: action.messages,
        workspace: action.workspace ?? state.workspace,
        sessionPath: action.sessionPath ?? action.piState?.sessionFile ?? null,
        sessionName: action.piState?.sessionName ?? null,
        streaming: false,
        streamingIndex: -1,
        toolRuns: {}
      }

    case 'SESSION_ERROR':
      return { ...state, status: 'error', error: action.error }

    case 'STATS':
      return {
        ...state,
        stats: action.stats,
        piState: action.piState ?? state.piState,
        sessionPath:
          action.sessionPath ?? action.piState?.sessionFile ?? state.sessionPath
      }

    case 'RECORD':
      return reduceRecord(state, action.record)

    case 'RECORDS':
      return action.records.reduce((next, record) => reduceRecord(next, record), state)

    case 'SEND_OPTIMISTIC': {
      const content: ContentBlock[] = []
      if (action.text) content.push({ type: 'text', text: action.text })
      for (const image of action.images) {
        content.push({ type: 'image', data: image.data, mimeType: image.mimeType })
      }
      const message = {
        role: 'user',
        content,
        timestamp: Date.now(),
        __optimistic: true
      } as unknown as AgentMessage
      return { ...state, messages: [...state.messages, message] }
    }

    case 'SET_MESSAGES':
      return { ...state, messages: action.messages, streaming: false, streamingIndex: -1 }

    case 'REMOVE_OPTIMISTIC':
      return {
        ...state,
        messages: state.messages.filter((message) => !(message as { __optimistic?: boolean }).__optimistic)
      }

    case 'STATUS': {
      if (action.status.status === 'idle') return { ...state, status: 'idle' }
      if (action.status.status !== 'exited') return state
      if (state.status === 'starting') return state
      return {
        ...state,
        status: 'exited',
        streaming: false,
        error: `pi exited${action.status.code != null ? ` (code ${action.status.code})` : ''}`
      }
    }

    case 'STDERR':
      return { ...state, stderr: (state.stderr + action.text).slice(-4000) }

    case 'NOTICE':
      return addNotice(state, action.level, action.title, action.detail, action.action)

    case 'SET_DIAGNOSTICS_OPEN':
      return { ...state, diagnosticsOpen: action.open }

    case 'SET_DELETED_SESSION':
      return { ...state, deletedSession: action.deleted }

    case 'DISMISS_NOTICE':
      return { ...state, notices: state.notices.filter((notice) => notice.id !== action.id) }

    case 'UI_DONE':
      return { ...state, uiRequests: state.uiRequests.slice(1) }

    case 'SET_NAME':
      return { ...state, sessionName: action.name }

    case 'SET_MODEL':
      return state.piState
        ? { ...state, piState: { ...state.piState, model: action.model } }
        : state

    case 'SET_THINKING':
      return state.piState
        ? { ...state, piState: { ...state.piState, thinkingLevel: action.level } }
        : state

    case 'SET_SEND_MODE':
      return { ...state, sendMode: action.mode }

    case 'SET_STREAMING':
      return { ...state, streaming: action.streaming }

    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarOpen: !state.sidebarOpen }

    case 'SET_SETTINGS_OPEN':
      return { ...state, settingsOpen: action.open }

    case 'FILL_COMPOSER':
      return { ...state, editorText: { value: action.value, nonce: Date.now() } }

    default:
      return state
  }
}

export interface Attachment {
  id: string
  dataUrl: string
  mimeType: string
  name: string
}

interface AppActions {
  refreshSessions: () => Promise<void>
  openSession: (cwd: string, sessionPath?: string | null) => Promise<boolean>
  newSession: () => Promise<boolean>
  pickFolder: () => Promise<void>
  sendMessage: (
    text: string,
    images: { type: 'image'; data: string; mimeType: string }[]
  ) => Promise<boolean>
  stop: () => Promise<{ steering: string[]; followUp: string[] } | null>
  renameSession: (name: string) => Promise<void>
  deleteSession: (path: string) => Promise<void>
  setModel: (model: ModelInfo) => Promise<void>
  setThinking: (level: ThinkingLevel) => Promise<void>
  setSendMode: (mode: SendMode) => void
  toggleSidebar: () => void
  openSettings: (open: boolean) => void
  openDiagnostics: (open: boolean) => void
  undoDelete: () => Promise<void>
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  updatePiSettings: (patch: PiSettings) => Promise<void>
  setSteeringMode: (mode: 'all' | 'one-at-a-time') => Promise<void>
  setFollowUpMode: (mode: 'all' | 'one-at-a-time') => Promise<void>
  setAutoCompaction: (enabled: boolean) => Promise<void>
  setAutoRetry: (enabled: boolean) => Promise<void>
  setTheme: (theme: 'dark' | 'light') => Promise<void>
  notify: (
    level: NoticeLevel,
    title: string,
    detail?: string,
    action?: { label: string; run: () => void }
  ) => void
  dismissNotice: (id: string) => void
  respondUi: (response: Record<string, unknown>) => void
  refreshMeta: () => Promise<void>
  restartSession: () => Promise<void>
  compact: () => Promise<void>
  fillComposer: (text: string) => void
  openExternal: (url: string) => void
  revealSession: (path: string) => void
}

const AppContext = createContext<{ state: AppState; actions: AppActions } | null>(null)

async function safeCommand<T = unknown>(
  command: Record<string, unknown>,
  timeout?: number
): Promise<PiResponse<T> | null> {
  try {
    return await window.pi.command<T>(command, timeout)
  } catch {
    return null
  }
}

export function AppProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, dispatch] = useReducer(reducer, initialState)
  const stateRef = useRef(state)
  stateRef.current = state
  const messageCache = useRef(new Map<string, AgentMessage[]>())

  const notify = useCallback(
    (level: NoticeLevel, title: string, detail?: string, action?: { label: string; run: () => void }) => {
      dispatch({ type: 'NOTICE', level, title, detail, action })
    },
    []
  )

  const refreshSessions = useCallback(async () => {
    try {
      const sessions = await window.pi.listSessions()
      dispatch({ type: 'SET_SESSIONS', sessions })
    } catch {
      // ignore listing failures
    }
  }, [])

  const refreshMeta = useCallback(async () => {
    const [stateResponse, statsResponse] = await Promise.all([
      safeCommand<PiState>({ type: 'get_state' }, 20_000),
      safeCommand<SessionStats>({ type: 'get_session_stats' }, 20_000)
    ])
    dispatch({
      type: 'STATS',
      stats: statsResponse?.data ?? null,
      piState: stateResponse?.data ?? null,
      sessionPath: stateResponse?.data?.sessionFile ?? undefined
    })
  }, [])

  const openSession = useCallback(
    async (cwd: string, sessionPath?: string | null): Promise<boolean> => {
      dispatch({
        type: 'SESSION_START',
        workspace: cwd,
        sessionPath: sessionPath ?? null,
        keepMessages: Boolean(sessionPath)
      })
      const cached = sessionPath ? messageCache.current.get(sessionPath) : undefined
      if (cached) dispatch({ type: 'SET_MESSAGES', messages: cached })
      const result = await window.pi.openSession({ cwd, sessionPath: sessionPath ?? null })
      if (!result.ok) {
        const message = result.error ?? 'Could not open the session.'
        dispatch({ type: 'SESSION_ERROR', error: message })
        notify('error', '无法打开会话', message)
        return false
      }

      const [stateResponse, messagesResponse, statsResponse, modelsResponse, levelsResponse, commandsResponse] =
        await Promise.all([
          safeCommand<PiState>({ type: 'get_state' }, 20_000),
          safeCommand<{ messages: AgentMessage[] }>({ type: 'get_messages' }, 30_000),
          safeCommand<SessionStats>({ type: 'get_session_stats' }, 20_000),
          safeCommand<{ models: ModelInfo[] }>({ type: 'get_available_models' }, 20_000),
          safeCommand<{ levels: ThinkingLevel[] }>({ type: 'get_available_thinking_levels' }, 20_000),
          safeCommand<{ commands: CommandInfo[] }>({ type: 'get_commands' }, 20_000)
        ])

      const piState = stateResponse?.data ?? null
      const readyPath = result.sessionPath ?? piState?.sessionFile ?? sessionPath ?? null
      const messages = messagesResponse?.data?.messages ?? []
      if (readyPath) messageCache.current.set(readyPath, messages)
      dispatch({
        type: 'SESSION_READY',
        piState,
        stats: statsResponse?.data ?? null,
        models: modelsResponse?.data?.models ?? [],
        levels: levelsResponse?.data?.levels ?? [],
        commands: commandsResponse?.data?.commands ?? [],
        messages,
        sessionPath: readyPath,
        workspace: result.cwd ?? cwd
      })

      void refreshSessions()
      return true
    },
    [notify, refreshSessions]
  )

  /** Respawning pi is what makes it re-read models.json / auth.json. */
  const restartSession = useCallback(async () => {
    const current = stateRef.current
    if (!current.workspace) return
    await window.pi.closeSession()
    await openSession(current.workspace, current.sessionPath)
  }, [openSession])

  const newSession = useCallback(async (): Promise<boolean> => {
    const workspace = stateRef.current.workspace ?? stateRef.current.settings.lastWorkspace
    if (!workspace) {
      const folder = await window.pi.pickFolder()
      if (!folder) return false
      return openSession(folder, null)
    }
    return openSession(workspace, null)
  }, [openSession])

  const pickFolder = useCallback(async () => {
    const folder = await window.pi.pickFolder()
    if (folder) await openSession(folder, null)
  }, [openSession])

  const sendMessage = useCallback(
    async (
      text: string,
      images: { type: 'image'; data: string; mimeType: string }[]
    ): Promise<boolean> => {
      const current = stateRef.current
      if (!current.workspace) {
        notify('warning', '没有打开项目', '先选择一个文件夹再发送。')
        return false
      }
      if (current.status === 'starting') {
        notify('info', '会话正在启动', '稍等一下再发送。')
        return false
      }

      const optimistic = !current.streaming
      if (optimistic) {
        dispatch({
          type: 'SEND_OPTIMISTIC',
          text,
          images: images.map((image) => ({ data: image.data, mimeType: image.mimeType }))
        })
      }

      const command: Record<string, unknown> = current.streaming
        ? {
            type: current.sendMode === 'steer' ? 'steer' : 'follow_up',
            message: text
          }
        : { type: 'prompt', message: text }
      if (images.length) command.images = images

      const response = await safeCommand<{ disposition?: string }>(command, 120_000)
      if (!response) {
        if (optimistic) dispatch({ type: 'REMOVE_OPTIMISTIC' })
        notify('error', '消息未发送', 'pi 没有响应。')
        return false
      }
      if (!response.success) {
        if (optimistic) dispatch({ type: 'REMOVE_OPTIMISTIC' })
        notify('error', '消息未发送', response.error)
        return false
      }
      if (optimistic && response.data?.disposition === 'handled') {
        dispatch({ type: 'REMOVE_OPTIMISTIC' })
      }
      if (!current.streaming && response.data?.disposition === 'started') {
        dispatch({ type: 'SET_STREAMING', streaming: true })
      }
      return true
    },
    [notify]
  )

  const stop = useCallback(async (): Promise<{ steering: string[]; followUp: string[] } | null> => {
    const cleared = await safeCommand<{ steering?: string[]; followUp?: string[] }>(
      { type: 'clear_queue' },
      15_000
    )
    await safeCommand({ type: 'abort' }, 600_000)
    const steering = normalizeQueue(cleared?.data?.steering)
    const followUp = normalizeQueue(cleared?.data?.followUp)
    return { steering, followUp }
  }, [])

  const renameSession = useCallback(
    async (name: string) => {
      const trimmed = name.trim()
      const response = await safeCommand({ type: 'set_session_name', name: trimmed })
      if (response?.success) {
        dispatch({ type: 'SET_NAME', name: trimmed || null })
        void refreshSessions()
      } else {
        notify('error', '无法重命名会话', response?.error)
      }
    },
    [notify, refreshSessions]
  )

  const undoDelete = useCallback(async () => {
    const deleted = stateRef.current.deletedSession
    if (!deleted) return
    try {
      await window.pi.restoreSession(deleted.trashPath, deleted.path)
      dispatch({ type: 'SET_DELETED_SESSION', deleted: null })
      await refreshSessions()
      notify('success', '已恢复会话', deleted.name)
    } catch (error) {
      notify('error', '恢复失败', error instanceof Error ? error.message : String(error))
    }
  }, [notify, refreshSessions])

  const deleteSession = useCallback(
    async (path: string) => {
      try {
        const deleted = await window.pi.deleteSession(path)
        dispatch({ type: 'SET_DELETED_SESSION', deleted })
        await refreshSessions()
        if (stateRef.current.sessionPath === path) {
          await newSession()
        }
        if (deleted) {
          notify('info', '已删除会话', deleted.name, {
            label: '撤销',
            run: () => void undoDelete()
          })
        }
      } catch (error) {
        notify('error', '无法删除会话', error instanceof Error ? error.message : String(error))
      }
    },
    [newSession, notify, refreshSessions, undoDelete]
  )

  const setModel = useCallback(
    async (model: ModelInfo) => {
      const response = await safeCommand({ type: 'set_model', provider: model.provider, modelId: model.id })
      if (response?.success) {
        dispatch({ type: 'SET_MODEL', model })
        void refreshMeta()
      } else {
        notify('error', '无法切换模型', response?.error)
      }
    },
    [notify, refreshMeta]
  )

  const setThinking = useCallback(
    async (level: ThinkingLevel) => {
      const response = await safeCommand({ type: 'set_thinking_level', level })
      if (response?.success) {
        dispatch({ type: 'SET_THINKING', level })
      } else {
        notify('error', '无法修改推理强度', response?.error)
      }
    },
    [notify]
  )

  const setSendMode = useCallback((mode: SendMode) => {
    dispatch({ type: 'SET_SEND_MODE', mode })
  }, [])

  const toggleSidebar = useCallback(() => {
    dispatch({ type: 'TOGGLE_SIDEBAR' })
  }, [])

  const openSettings = useCallback((open: boolean) => {
    dispatch({ type: 'SET_SETTINGS_OPEN', open })
  }, [])

  const openDiagnostics = useCallback((open: boolean) => {
    dispatch({ type: 'SET_DIAGNOSTICS_OPEN', open })
  }, [])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const settings = await window.pi.updateSettings(patch)
    dispatch({ type: 'SET_SETTINGS', settings })
  }, [])

  const updatePiSettings = useCallback(async (patch: PiSettings) => {
    const piSettings = await window.pi.updatePiSettings(patch)
    dispatch({ type: 'SET_PI_SETTINGS', piSettings })
  }, [])

  const setSteeringMode = useCallback(
    async (mode: 'all' | 'one-at-a-time') => {
      const response = await safeCommand({ type: 'set_steering_mode', mode })
      if (!response?.success) {
        notify('error', '无法修改 steering 模式', response?.error)
        return
      }
      dispatch({ type: 'PATCH_PI_STATE', patch: { steeringMode: mode } })
      await updatePiSettings({ steeringMode: mode })
    },
    [notify, updatePiSettings]
  )

  const setFollowUpMode = useCallback(
    async (mode: 'all' | 'one-at-a-time') => {
      const response = await safeCommand({ type: 'set_follow_up_mode', mode })
      if (!response?.success) {
        notify('error', '无法修改 follow-up 模式', response?.error)
        return
      }
      dispatch({ type: 'PATCH_PI_STATE', patch: { followUpMode: mode } })
      await updatePiSettings({ followUpMode: mode })
    },
    [notify, updatePiSettings]
  )

  const setAutoCompaction = useCallback(
    async (enabled: boolean) => {
      const response = await safeCommand({ type: 'set_auto_compaction', enabled })
      if (!response?.success) {
        notify('error', '无法修改自动压缩', response?.error)
        return
      }
      dispatch({ type: 'PATCH_PI_STATE', patch: { autoCompactionEnabled: enabled } })
      await updatePiSettings({ compaction: { enabled } })
    },
    [notify, updatePiSettings]
  )

  const setAutoRetry = useCallback(
    async (enabled: boolean) => {
      const response = await safeCommand({ type: 'set_auto_retry', enabled })
      if (!response?.success) {
        notify('error', '无法修改自动重试', response?.error)
        return
      }
      await updatePiSettings({ retry: { enabled } })
    },
    [notify, updatePiSettings]
  )

  const setTheme = useCallback(
    async (theme: 'dark' | 'light') => {
      dispatch({ type: 'SET_THEME', theme })
      await updateSettings({ theme })
    },
    [updateSettings]
  )

  const dismissNotice = useCallback((id: string) => {
    dispatch({ type: 'DISMISS_NOTICE', id })
  }, [])

  const respondUi = useCallback((response: Record<string, unknown>) => {
    window.pi.uiResponse(response)
    dispatch({ type: 'UI_DONE' })
  }, [])

  const compact = useCallback(async () => {
    notify('info', '正在压缩上下文…')
    const response = await safeCommand({ type: 'compact' }, 600_000)
    if (!response?.success) {
      notify('error', '压缩失败', response?.error)
    } else {
      notify('success', '上下文已压缩')
      void refreshMeta()
    }
  }, [notify, refreshMeta])

  const fillComposer = useCallback((text: string) => {
    dispatch({ type: 'FILL_COMPOSER', value: text })
  }, [])

  const openExternal = useCallback((url: string) => {
    void window.pi.openExternal(url)
  }, [])

  const revealSession = useCallback((path: string) => {
    void window.pi.showItem(path)
  }, [])

  // Bootstrap once
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const boot = await window.pi.bootstrap()
        if (cancelled) return
        dispatch({ type: 'BOOT', boot })
        await refreshSessions()
        const workspace = boot.settings.lastWorkspace
        if (workspace) {
          const last = boot.settings.lastSessionPath
          let restored = false
          if (last) {
            const sessions = await window.pi.listSessions().catch(() => [])
            if (sessions.some((session) => session.path === last)) {
              restored = await openSession(workspace, last)
            }
          }
          if (!restored) await openSession(workspace, null)
        } else {
          dispatch({ type: 'STATUS', status: { status: 'idle' } })
        }
      } catch (error) {
        if (!cancelled) {
          dispatch({
            type: 'SESSION_ERROR',
            error: error instanceof Error ? error.message : '无法启动 Pi Desktop。'
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [openSession, refreshSessions])

  // pi creates the transcript lazily (first prompt), so the session path can
  // appear after the process is already running. Persist it whenever it lands;
  // that is what makes "reopen the app where I left off" work.
  const currentSessionPath = state.sessionPath
  useEffect(() => {
    if (!currentSessionPath) return
    if (stateRef.current.settings.lastSessionPath === currentSessionPath) return
    void window.pi
      .updateSettings({ lastSessionPath: currentSessionPath })
      .then((settings) => dispatch({ type: 'SET_SETTINGS', settings }))
      .catch(() => undefined)
  }, [currentSessionPath])

  // Batch high-frequency streaming records to one render per frame.
  useEffect(() => {
    let pending: PiRecord[] = []
    let frame = 0
    const flush = (): void => {
      frame = 0
      if (!pending.length) return
      const records = pending
      pending = []
      dispatch({ type: 'RECORDS', records })
    }
    const offRecord = window.pi.onRecord((record) => {
      pending.push(record)
      if (!frame) frame = requestAnimationFrame(flush)
    })
    return () => {
      offRecord()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  // Process and UI subscriptions
  useEffect(() => {
    const offStatus = window.pi.onStatus((status) => dispatch({ type: 'STATUS', status }))
    const offStderr = window.pi.onStderr((text) => dispatch({ type: 'STDERR', text }))
    const offSettings = window.pi.onSettings((settings) => dispatch({ type: 'SET_SETTINGS', settings }))
    const offApp = window.pi.onAppEvent((event) => {
      switch (event.name) {
        case 'new-session':
          void newSession()
          break
        case 'open-folder':
          void pickFolder()
          break
        case 'toggle-sidebar':
          dispatch({ type: 'TOGGLE_SIDEBAR' })
          break
        case 'toggle-theme':
          void setTheme(stateRef.current.settings.theme === 'dark' ? 'light' : 'dark')
          break
        case 'settings':
          dispatch({ type: 'SET_SETTINGS_OPEN', open: true })
          break
        default:
          break
      }
    })

    return () => {
      offStatus()
      offStderr()
      offSettings()
      offApp()
    }
  }, [newSession, pickFolder, setTheme])

  useEffect(() => {
    const theme = state.settings.theme
    document.documentElement.dataset.theme = theme
  }, [state.settings.theme])

  useEffect(() => {
    localStorage.setItem('pi.sidebar', state.sidebarOpen ? 'open' : 'closed')
  }, [state.sidebarOpen])

  useEffect(() => {
    document.title = state.sessionName ? `${state.sessionName} · Pi` : 'Pi'
  }, [state.sessionName])

  useEffect(() => {
    const path = state.sessionPath
    if (path && state.messages.length > 0) messageCache.current.set(path, state.messages)
  }, [state.messages, state.sessionPath])

  const wasStreaming = useRef(false)
  useEffect(() => {
    if (wasStreaming.current && !state.streaming && state.status === 'ready') {
      void refreshMeta()
      void refreshSessions()
    }
    wasStreaming.current = state.streaming
  }, [state.streaming, state.status, refreshMeta, refreshSessions])

  const actions = useMemo(
    () => ({
      refreshSessions,
      openSession,
      newSession,
      pickFolder,
      sendMessage,
      stop,
      renameSession,
      deleteSession,
      setModel,
      setThinking,
      setSendMode,
      toggleSidebar,
      openSettings,
      openDiagnostics,
      undoDelete,
      updateSettings,
      updatePiSettings,
      setSteeringMode,
      setFollowUpMode,
      setAutoCompaction,
      setAutoRetry,
      setTheme,
      notify,
      dismissNotice,
      respondUi,
      refreshMeta,
      restartSession,
      compact,
      fillComposer,
      openExternal,
      revealSession
    }),
    [
      refreshSessions,
      openSession,
      newSession,
      pickFolder,
      sendMessage,
      stop,
      renameSession,
      deleteSession,
      setModel,
      setThinking,
      setSendMode,
      toggleSidebar,
      openSettings,
      openDiagnostics,
      undoDelete,
      updateSettings,
      updatePiSettings,
      setSteeringMode,
      setFollowUpMode,
      setAutoCompaction,
      setAutoRetry,
      setTheme,
      notify,
      dismissNotice,
      respondUi,
      refreshMeta,
      restartSession,
      compact,
      fillComposer,
      openExternal,
      revealSession
    ]
  )

  const value = useMemo(() => ({ state, actions }), [state, actions])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): { state: AppState; actions: AppActions } {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
