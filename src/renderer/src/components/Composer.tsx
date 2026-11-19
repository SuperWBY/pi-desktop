import { useTranslation } from '../i18n'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent
} from 'react'
import {
  ArrowUp,
  Eye,
  FileText,
  Check,
  ChevronDown,
  GripVertical,
  Image as ImageIcon,
  Plus,
  Shield,
  ShieldCheck,
  Square,
  TriangleAlert,
  X
} from 'lucide-react'
import clsx from 'clsx'
import type { ModelInfo, ScheduleCadence, SessionPermission, SessionSecurity, ThinkingLevel } from '@shared/types'
import { isTemporaryWorkspace } from '@shared/paths'
import { useApp, type Attachment } from '../store'
import { formatTokens, projectName } from '../lib/format'
import { Modal, Popover, Spinner } from './ui'

type Protection = 'standard' | 'readonly' | 'full'

function protectionOf(security: SessionSecurity | null): Protection | null {
  if (!security) return null
  if (security.permission === 'full') return 'full'
  if (security.permission === 'ask' || security.files === 'read-only') return 'readonly'
  return 'standard'
}

function reasoningBars(level: string): number {
  if (level === 'medium') return 2
  if (level === 'high') return 3
  if (level === 'xhigh' || level === 'max') return 4
  return 1
}

type Draft = { text: string; attachments: Attachment[] }
const drafts = new Map<string, Draft>()
const draftStorageKey = (key: string): string => `pi.composer.draft.${key}`

function readDraft(key: string): Draft {
  const cached = drafts.get(key)
  if (cached) return cached
  try { return { text: localStorage.getItem(draftStorageKey(key)) ?? '', attachments: [] } }
  catch { return { text: '', attachments: [] } }
}

function saveDraft(key: string, draft: Draft): void {
  drafts.set(key, draft)
  try {
    if (draft.text) localStorage.setItem(draftStorageKey(key), draft.text)
    else localStorage.removeItem(draftStorageKey(key))
  } catch { /* The in-memory draft still works when storage is unavailable. */ }
}

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max'
}

function readImage(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve({
        id: crypto.randomUUID(),
        dataUrl: String(reader.result),
        mimeType: file.type || 'image/png',
        name: file.name || 'image',
        kind: 'image',
        size: file.size
      })
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'))
    reader.readAsDataURL(file)
  })
}

const TEXT_FILE = /\.(txt|md|markdown|json|jsonc|yaml|yml|toml|ini|cfg|conf|env|csv|tsv|log|xml|html|css|scss|less|js|jsx|mjs|cjs|ts|tsx|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|zsh|bash|sql|graphql|gql|vue|svelte|astro|dockerfile|makefile|gitignore|editorconfig)$/i

async function readAttachment(file: File): Promise<Attachment> {
  if (file.type.startsWith('image/')) {
    const image = await readImage(file)
    try { image.path = window.pi.getPathForFile(file) } catch { /* optional */ }
    return image
  }
  let text: string | undefined
  if (file.size <= 128 * 1024 && (file.type.startsWith('text/') || TEXT_FILE.test(file.name))) {
    try { text = await file.text() } catch { text = undefined }
  }
  let path = ''
  try { path = window.pi.getPathForFile(file) } catch { path = '' }
  return {
    id: crypto.randomUUID(),
    dataUrl: '',
    mimeType: file.type || 'application/octet-stream',
    name: file.name || 'file',
    kind: 'file',
    path,
    text,
    size: file.size
  }
}

function attachmentContext(files: Attachment[]): string {
  if (!files.length) return ''
  let budget = 64 * 1024
  const blocks = files.map((file) => {
    const location = file.path ? `路径：${file.path}` : '没有可用的绝对路径'
    let content = ''
    if (file.text !== undefined) {
      const slice = file.text.slice(0, Math.max(0, budget))
      budget -= slice.length
      content = `\n\n\`\`\`\n${slice}\n\`\`\``
      if (slice.length < file.text.length) content += file.path ? '\n附件内容未完整内嵌；请通过路径读取完整文件。' : '\n附件内容未完整内嵌，且没有可用路径；不能假设已读完整内容。'
    } else if (file.path) {
      content = '\n附件内容未内嵌；请通过路径读取文件。'
    }
    return `### ${file.name}\n${location}${content}`
  })
  return `\n\n<attachments>\n${blocks.join('\n\n')}\n</attachments>\n请先阅读这些附件，再回答。`
}

function ModelMenu({ close }: { close: () => void }): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const current = state.piState?.model

  const grouped = useMemo(() => {
    const text = query.trim().toLowerCase()
    const filtered = state.models.filter((model) => {
      if (!text) return true
      return `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(text)
    })
    const map = new Map<string, ModelInfo[]>()
    for (const model of filtered) {
      const list = map.get(model.provider) ?? []
      list.push(model)
      map.set(model.provider, list)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [state.models, query])

  // Flat order shared by keyboard movement and rendering.
  const flat = useMemo(() => grouped.flatMap(([, models]) => models), [grouped])

  useEffect(() => {
    // Start on the model that is actually in use, so ↓/Enter is a no-op.
    const index = flat.findIndex(
      (model) => model.provider === current?.provider && model.id === current?.id
    )
    setHighlight(index >= 0 ? index : 0)
  }, [flat, current?.provider, current?.id])

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('.menu-item.highlight')
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  const pick = (model: ModelInfo): void => {
    void actions.setModel(model)
    close()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!flat.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((value) => (value + 1) % flat.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((value) => (value - 1 + flat.length) % flat.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setHighlight(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setHighlight(flat.length - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const model = flat[highlight]
      if (model) pick(model)
    }
  }

  let index = -1

  return (
    <div className="menu" onKeyDown={onKeyDown}>
      <div className="menu-search">
        <input
          autoFocus
          value={query}
          placeholder={t("搜索模型…")}
          role="combobox"
          aria-expanded="true"
          aria-controls="model-menu-list"
          aria-activedescendant={flat[highlight] ? `model-opt-${highlight}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlight(0)
          }}
        />
      </div>
      <div className="menu-list" id="model-menu-list" role="listbox" ref={listRef}>
        {grouped.length === 0 && (
          <div className="menu-empty">
            {state.models.length === 0 ? (
              <>
                <span>{t('还没有可用模型')}</span>
                <button
                  className="menu-empty-action"
                  onClick={() => {
                    close()
                    actions.openSettings(true)
                    window.dispatchEvent(new CustomEvent('pi:settings-section', { detail: 'models' }))
                  }}
                >
                  {t('配置模型')}
                </button>
              </>
            ) : t("没有匹配的模型")}
          </div>
        )}
        {grouped.map(([provider, models]) => (
          <div key={provider} className="menu-group">
            <div className="menu-group-label">{provider}</div>
            {models.map((model) => {
              index += 1
              const itemIndex = index
              const isCurrent = current?.provider === model.provider && current?.id === model.id
              return (
                <button
                  key={`${model.provider}/${model.id}`}
                  id={`model-opt-${itemIndex}`}
                  role="option"
                  aria-selected={isCurrent}
                  className={clsx(
                    'menu-item',
                    isCurrent && 'current',
                    itemIndex === highlight && 'highlight'
                  )}
                  onMouseEnter={() => setHighlight(itemIndex)}
                  onClick={() => pick(model)}
                >
                  <span className="menu-item-main">
                    <span className="menu-item-title">{model.name}</span>
                    <span className="menu-item-sub">
                      {model.contextWindow ? `${formatTokens(model.contextWindow)} ${t('上下文')}` : model.id}
                      {model.reasoning ? t(" · 推理") : ''}
                    </span>
                  </span>
                  {isCurrent && <Check size={14} />}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function ThinkingMenu({ close }: { close: () => void }): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const levels = state.levels.length ? state.levels : (['off'] as ThinkingLevel[])
  return (
    <div className="menu">
      <div className="menu-group">
        <div className="menu-group-label">{t("Reasoning effort")}</div>
        {levels.map((level) => (
          <button
            key={level}
            className={clsx('menu-item', state.piState?.thinkingLevel === level && 'active')}
            onClick={() => {
              void actions.setThinking(level)
              close()
            }}
          >
            <span className="menu-item-title">{t(THINKING_LABELS[level] ?? level)}</span>
            {state.piState?.thinkingLevel === level && <Check size={14} />}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Composer(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const key = state.sessionPath ? `session:${state.sessionPath}` : `project:${state.workspace ?? ''}`
  const [initialDraft] = useState(() => readDraft(key))
  const [text, setText] = useState(initialDraft.text)
  const [attachments, setAttachments] = useState<Attachment[]>(initialDraft.attachments)
  const draftRef = useRef({ key, workspace: state.workspace, sessionPath: state.sessionPath, draft: initialDraft })
  const skipDraftWrite = useRef(false)
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [dragQueueIndex, setDragQueueIndex] = useState<number | null>(null)
  const [dragOverQueue, setDragOverQueue] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [commandIndex, setCommandIndex] = useState(0)
  const [mention, setMention] = useState<{ query: string; start: number; end: number } | null>(null)
  const [mentionFiles, setMentionFiles] = useState<string[]>([])
  const [mentionIndex, setMentionIndex] = useState(0)
  const [sessionSecurity, setSessionSecurity] = useState<SessionSecurity | null>(null)
  const [changingPermission, setChangingPermission] = useState(false)
  const [fullAccessTarget, setFullAccessTarget] = useState<string | null>(null)
  const [atCap, setAtCap] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const focusedWhileStarting = useRef(false)

  const streaming = state.streaming
  const starting = state.status === 'starting'
  const ready = state.status === 'ready'
  const context = state.stats?.contextUsage
  const percent = typeof context?.percent === 'number' ? context.percent : 0
  const model = state.piState?.model

  useEffect(() => {
    let current = true
    setSessionSecurity(null)
    if (state.status === 'ready' && state.sessionPath) {
      void window.pi.sessionSecurity(state.sessionPath).then((security) => { if (current) setSessionSecurity(security) }).catch(() => { if (current) setSessionSecurity(null) })
    }
    return () => { current = false }
  }, [state.sessionPath, state.status])

  const openPermissionSettings = (section: 'tools' | 'network'): void => {
    actions.openSettings(true)
    window.dispatchEvent(new CustomEvent('pi:settings-section', { detail: section }))
  }

  const changePermission = async (permission: SessionPermission, files?: 'read-only'): Promise<void> => {
    const workspace = state.workspace
    if (!workspace || changingPermission || sending || streaming || state.status !== 'ready') return
    setFullAccessTarget(null)
    setChangingPermission(true)
    try {
      const security = await window.pi.setSessionPermission({ cwd: workspace, sessionPath: state.sessionPath, permission, files })
      if (draftRef.current.key === key) setSessionSecurity(security)
    } catch (error) {
      actions.notify('error', t('无法切换权限'), (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, ''))
    } finally {
      setChangingPermission(false)
    }
  }


  useLayoutEffect(() => {
    const previous = draftRef.current
    if (previous.key === key) return
    saveDraft(previous.key, previous.draft)
    // A new session obtains its path lazily after the first prompt. Preserve
    // the same draft owner when that happens without a session switch.
    const promoted = previous.sessionPath === null && state.sessionPath !== null &&
      previous.workspace === state.workspace && state.status === 'ready'
    const next = promoted ? previous.draft : readDraft(key)
    if (promoted) {
      saveDraft(previous.key, { text: '', attachments: [] })
      previous.key = key
      previous.sessionPath = state.sessionPath
      previous.draft = next
    } else {
      draftRef.current = { key, workspace: state.workspace, sessionPath: state.sessionPath, draft: next }
    }
    skipDraftWrite.current = true
    setText(next.text)
    setAttachments(next.attachments)
  }, [key, state.workspace, state.sessionPath, state.status])

  useEffect(() => {
    if (skipDraftWrite.current) { skipDraftWrite.current = false; return }
    const owner = draftRef.current
    if (owner.key !== key) return
    owner.draft = { text, attachments }
    saveDraft(key, owner.draft)
  }, [key, text, attachments])

  useEffect(() => {
    const onNewSession = (event: Event): void => {
      if (!text.trim() && attachments.length === 0) return
      event.preventDefault()
      actions.notify('warning', state.settings.language === 'en' ? 'Unsent draft' : '当前有未发送的草稿',
        state.settings.language === 'en' ? 'Send or clear this draft before starting another new session.' : '请先发送或清空草稿，再新建会话。')
    }
    window.addEventListener('pi:before-new-session', onNewSession)
    return () => window.removeEventListener('pi:before-new-session', onNewSession)
  }, [actions, attachments.length, state.settings.language, text])

  useEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = '0px'
    const next = Math.min(node.scrollHeight, 240)
    node.style.height = `${next}px`
    setAtCap(node.scrollHeight > 240)
  }, [text])

  useEffect(() => {
    if (!state.editorText) return
    const { value, append, nonce } = state.editorText
    setText((current) => append && current.trim() ? `${current}\n\n${value}` : value)
    actions.consumeEditorText(nonce)
    const node = textareaRef.current
    requestAnimationFrame(() => {
      node?.focus()
      node?.setSelectionRange(node.value.length, node.value.length)
    })
  }, [state.editorText, actions])

  useEffect(() => {
    if (state.addProjectOpen || state.settingsOpen) return
    if (starting) {
      focusedWhileStarting.current = state.sessionPath === null
      if (focusedWhileStarting.current) textareaRef.current?.focus({ preventScroll: true })
    } else if (ready) {
      if (!focusedWhileStarting.current || document.activeElement === document.body) {
        textareaRef.current?.focus({ preventScroll: true })
      }
      focusedWhileStarting.current = false
    }
  }, [starting, ready, state.sessionPath, state.workspace, state.addProjectOpen, state.settingsOpen])

  const slashQuery = text.startsWith('/') && !text.includes(' ') ? text.slice(1) : null
  const commandMatches = useMemo(() => {
    if (slashQuery === null) return []
    return state.commands
      .filter((command) => command.name.toLowerCase().includes(slashQuery.toLowerCase()))
      .slice(0, 8)
  }, [slashQuery, state.commands])

  useEffect(() => {
    setCommandIndex(0)
  }, [slashQuery])

  const updateMention = useCallback((value: string, caret: number): void => {
    const before = value.slice(0, caret)
    const match = before.match(/(^|\s)@([^\s@]*)$/)
    if (!match || !state.workspace) {
      setMention(null)
      setMentionFiles([])
      return
    }
    setMention({ query: match[2], start: caret - match[2].length - 1, end: caret })
    setMentionIndex(0)
  }, [state.workspace])

  useEffect(() => {
    if (!mention) return
    let alive = true
    const timer = window.setTimeout(() => {
      window.pi.listWorkspaceFiles(state.workspace ?? '', mention.query)
        .then((files) => { if (alive) setMentionFiles(files) })
        .catch(() => { if (alive) setMentionFiles([]) })
    }, 120)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [mention, state.workspace])

  const pickMention = useCallback((path: string): void => {
    if (!mention) return
    const next = `${text.slice(0, mention.start)}@${path} ${text.slice(mention.end)}`
    setText(next)
    setMention(null)
    setMentionFiles([])
    const caret = mention.start + path.length + 2
    window.requestAnimationFrame(() => {
      const input = textareaRef.current
      if (input) {
        input.focus()
        input.setSelectionRange(caret, caret)
      }
    })
  }, [mention, text])

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const owner = draftRef.current
      const incoming = Array.from(files)
      if (!incoming.length) return
      const available = Math.max(0, 6 - attachments.length)
      if (incoming.length > available) {
        actions.notify('warning', t('最多添加 6 个附件'), state.settings.language === 'en' ? `${incoming.length - available} files were not added.` : `本次有 ${incoming.length - available} 个文件未添加。`)
      }
      const next: Attachment[] = []
      for (const file of incoming.slice(0, available)) {
        const limit = file.type.startsWith('image/') ? 8 * 1024 * 1024 : 20 * 1024 * 1024
        if (file.size > limit) {
          actions.notify('warning', t('已跳过这个附件'), state.settings.language === 'en' ? `${file.name} exceeds ${Math.round(limit / 1024 / 1024)} MB.` : `${file.name} 超过 ${Math.round(limit / 1024 / 1024)} MB。`)
          continue
        }
        try {
          next.push(await readAttachment(file))
        } catch {
          actions.notify('error', t('无法读取附件'), file.name)
        }
      }
      if (draftRef.current.key === owner.key) {
        setAttachments((current) => [...current, ...next].slice(0, 6))
      } else {
        const saved = readDraft(owner.key)
        saveDraft(owner.key, { ...saved, attachments: [...saved.attachments, ...next].slice(0, 6) })
      }
    },
    [actions, attachments.length, state.settings.language, t]
  )

  const submit = useCallback(async () => {
    const value = text.trim()
    if ((!value && attachments.length === 0) || starting || sending || changingPermission) return
    if (value === '/schedule' || value.startsWith('/schedule ')) {
      const rest = value.slice('/schedule'.length).trim()
      if (!rest) {
        actions.notify('warning', t('定时任务'), t('在 /schedule 后面写要定时执行的内容'))
        return
      }
      const parts = rest.split(/\s+/)
      let cadence: ScheduleCadence | undefined
      let prompt = rest
      if (parts.length >= 6 && parts.slice(0, 5).every((part) => /^[A-Za-z\d*/,\-]+$/.test(part))) {
        const expression = parts.slice(0, 5).join(' ')
        const error = await window.pi.validateCron(expression)
        if (!error) {
          cadence = { type: 'cron', expression }
          prompt = parts.slice(5).join(' ')
        }
      }
      actions.openSchedules(true, { prompt, cadence, name: prompt.slice(0, 24) })
      setText('')
      return
    }
    if (state.status !== 'ready') {
      actions.notify('warning', t('Not connected'), t('Wait for the session to finish starting.'))
      return
    }

    const images = attachments
      .filter((attachment) => attachment.kind !== 'file')
      .map((attachment) => {
        const base64 = attachment.dataUrl.split(',')[1] ?? ''
        return { type: 'image' as const, data: base64, mimeType: attachment.mimeType }
      })
    const files = attachments.filter((attachment) => attachment.kind === 'file')
    if (files.some((file) => !file.path && file.text === undefined)) {
      actions.notify('warning', t('附件无法读取'), t('附件没有可用路径或文本内容，请重新选择文件。'))
      return
    }
    const message = `${value}${attachmentContext(files)}`.trim()

    const owner = draftRef.current
    setSending(true)
    const ok = await actions.sendMessage(message, images)
    setSending(false)
    if (ok && draftRef.current === owner) {
      setText((current) => (current === text ? '' : current))
      const sentIds = new Set(attachments.map((attachment) => attachment.id))
      setAttachments((current) => current.filter((attachment) => !sentIds.has(attachment.id)))
    }
  }, [actions, attachments, starting, sending, changingPermission, state.status, state.sendMode, streaming, text, t])

  const stop = useCallback(async () => {
    if (stopping) return
    setStopping(true)
    const cleared = await actions.stop()
    setStopping(false)
    const queued = cleared ? [...cleared.steering, ...cleared.followUp].join('\n\n') : ''
    if (queued) {
      setText((current) => (current ? `${queued}\n\n${current}` : queued))
      actions.notify('info', t('Stopped'), t('Queued messages were returned to the composer.'))
    }
  }, [actions, stopping, t])


  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (mention && mentionFiles.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMentionIndex((index) => (index + 1) % mentionFiles.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionIndex((index) => (index - 1 + mentionFiles.length) % mentionFiles.length)
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        const file = mentionFiles[mentionIndex]
        if (file) pickMention(file)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMention(null)
        setMentionFiles([])
        return
      }
    }

    if (commandMatches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setCommandIndex((index) => (index + 1) % commandMatches.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setCommandIndex((index) => (index - 1 + commandMatches.length) % commandMatches.length)
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        const command = commandMatches[commandIndex]
        if (command) setText(`/${command.name} `)
        return
      }
    }

    if (event.key === 'Escape') {
      if (streaming) {
        event.preventDefault()
        void stop()
      }
      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = Array.from(event.clipboardData.files)
    if (files.length) {
      event.preventDefault()
      void addFiles(files)
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragging(false)
    if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files)
  }

  // Wheel over the composer should still move the conversation — but never
  // when the pointer is over a menu, modal or drawer sitting on top of it.
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    if (target.closest('.popover, .context-menu, .modal-overlay, .drawer, .drawer-overlay')) return
    const textarea = target.closest('textarea')
    if (textarea && textarea.scrollHeight > textarea.clientHeight) return
    const scroller = document.querySelector('.chat-scroll') as HTMLElement | null
    if (!scroller) return
    const before = scroller.scrollTop
    scroller.scrollTop += event.deltaY
    if (scroller.scrollTop !== before) event.preventDefault()
  }

  const canSend = ready && (text.trim().length > 0 || attachments.length > 0) && !sending && !changingPermission

  return (
    <div
      className={clsx('composer-wrap', dragging && 'dragging')}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false)
      }}
      onDrop={onDrop}
      onWheel={onWheel}
    >
      {dragging && (
        <div className="drop-overlay">
          <ImageIcon size={18} />
          <span>{t("松手添加文件或图片")}</span>
        </div>
      )}

      {(state.queue.steering.length > 0 || state.queue.followUp.length > 0) && (
        <div className="queue-strip">
          <div className="queue-head">
            <span className="queue-label">
              {t('排队中')} · {state.queue.steering.length + state.queue.followUp.length}
            </span>
            <span className="queue-hint">{t('到当前任务结束后发送')}</span>
          </div>
          <div className="queue-list">
            {state.queue.steering.map((item) => (
              <div className="queue-item is-guiding" key={item.id}>
                <span className="queue-kind">{t('引导中')}</span>
                <p>{item.display ?? item.text}</p>
              </div>
            ))}
            {state.queue.followUp.map((item, index) => (
              <div
                className={clsx(
                  'queue-item',
                  dragQueueIndex === index && 'is-dragging',
                  dragOverQueue === index && dragQueueIndex !== index && 'is-drag-over'
                )}
                key={item.id}
                onDragOver={(event) => {
                  if (!state.streaming || dragQueueIndex === null) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDragOverQueue(index)
                }}
                onDragLeave={() => {
                  if (dragOverQueue === index) setDragOverQueue(null)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const from =
                    dragQueueIndex ?? Number(event.dataTransfer.getData('text/plain'))
                  setDragQueueIndex(null)
                  setDragOverQueue(null)
                  if (Number.isInteger(from) && from !== index) {
                    void actions.reorderQueue(from, index)
                  }
                }}
              >
                <span
                  className="queue-drag"
                  draggable={state.streaming}
                  role="button"
                  tabIndex={-1}
                  aria-label={t('拖动调整排队顺序')}
                  title={t('拖动调整排队顺序')}
                  onDragStart={(event) => {
                    setDragQueueIndex(index)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', String(index))
                  }}
                  onDragEnd={() => {
                    setDragQueueIndex(null)
                    setDragOverQueue(null)
                  }}
                >
                  <GripVertical size={12} />
                </span>
                <span className="queue-index">{index + 1}</span>
                <p>{item.display ?? item.text}</p>
                <button
                  className="queue-guide"
                  disabled={!state.streaming}
                  onClick={() => void actions.guideQueued(index)}
                  title={t('把这条消息作为引导，当前工具结束后立即发送')}
                >
                  {t('引导')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {state.messages.length === 0 && state.workspace && !state.scratchWorkspace && !isTemporaryWorkspace(state.workspace, state.boot?.scratchPath) && (
        <div className="composer-project-row">
          <span className="composer-project-name">{projectName(state.settings.workspaceNames, state.workspace)}</span>
        </div>
      )}
      <div className={clsx('composer', atCap && 'at-cap')}>
        {attachments.length > 0 && (
          <div className="attachment-row">
            {(() => { let remaining = 64 * 1024; return attachments.map((attachment) => {
              const textLength = attachment.kind === 'file' ? attachment.text?.length : undefined
              const partial = textLength !== undefined && textLength > remaining
              if (textLength !== undefined) remaining = Math.max(0, remaining - textLength)
              const status = attachment.kind !== 'file' ? '' : textLength === undefined
                ? (attachment.path ? t('通过路径读取') : t('无法读取'))
                : partial ? (attachment.path ? t('部分内容，需读取文件') : t('部分内容，无文件路径')) : t('已内嵌全文')
              return (
              <div className={clsx('attachment', attachment.kind === 'file' && 'file')} key={attachment.id} title={attachment.path || attachment.name}>
                {attachment.kind === 'file'
                  ? <span className="attachment-file-icon"><FileText size={15} /></span>
                  : <img src={attachment.dataUrl} alt={attachment.name} />}
                {attachment.kind === 'file' && <span className="attachment-file-copy"><span className="attachment-file-name">{attachment.name}</span><span className="attachment-file-status">{status}</span></span>}
                <button
                  className="attachment-remove"
                  onClick={() =>
                    setAttachments((current) =>
                      current.filter((item) => item.id !== attachment.id)
                    )
                  }
                  aria-label={`Remove ${attachment.name}`}
                >
                  <X size={11} />
                </button>
              </div>
            ) }) })()}
          </div>
        )}

        {mention && mentionFiles.length > 0 && (
          <div className="command-menu mention-menu">
            <div className="mention-label">{t('引用项目文件')}</div>
            {mentionFiles.map((file, index) => (
              <button
                key={file}
                className={clsx('command-item', index === mentionIndex && 'active')}
                onMouseEnter={() => setMentionIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pickMention(file)}
              >
                <FileText size={13} />
                <span className="mention-path">{file}</span>
              </button>
            ))}
          </div>
        )}

        {commandMatches.length > 0 && (
          <div className="command-menu">
            {commandMatches.map((command, index) => (
              <button
                key={command.name}
                className={clsx('command-item', index === commandIndex && 'active')}
                onMouseEnter={() => setCommandIndex(index)}
                onClick={() => {
                  setText(`/${command.name} `)
                  textareaRef.current?.focus()
                }}
              >
                <span className="command-name">/{command.name}</span>
                {command.description && (
                  <span className="command-desc">{command.description}</span>
                )}
              </button>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="composer-input"
          value={text}
          rows={1}
          spellCheck={false}
          aria-label={t("输入消息")}
          placeholder={t('问点什么…')}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
            setText(event.target.value)
            updateMention(event.target.value, event.target.selectionStart ?? event.target.value.length)
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />

        <div className="composer-bar">
          <div className="composer-left">
            <button
              className="icon-button add-attachment"
              title={t("添加文件或图片")}
              aria-label={t("添加文件或图片")}
              onClick={() => fileRef.current?.click()}
            >
              <Plus size={16} />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files)
                event.target.value = ''
              }}
            />
            {(() => {
              const protection = protectionOf(sessionSecurity)
              const label = protection === 'full' ? '保护：不受限' : protection === 'readonly' ? '保护：只读' : '保护：标准'
              const tone = protection === 'full' ? 'full' : protection === 'readonly' ? 'ask' : 'review'
              const Icon = changingPermission ? null : protection === 'full' ? TriangleAlert : protection === 'readonly' ? Eye : sessionSecurity?.sandboxed ? ShieldCheck : Shield
              return (
                <Popover width={220} trigger={(open, toggle, expanded) => (
                  <button className={clsx('approval-mode-chip', `permission-${tone}`, open && 'open')}
                    onClick={toggle} disabled={changingPermission || state.status !== 'ready'} aria-label={t(label)} title={t(label)} {...expanded}>
                    {changingPermission || !Icon ? <Spinner size={14} /> : <Icon size={15} />}
                  </button>
                )}>
                  {(close) => <div className="menu">
                    <div className="menu-group">
                      {([
                        ['standard', '标准', '保护：标准'],
                        ['readonly', '只读', '保护：只读'],
                        ['full', '不受限', '保护：不受限']
                      ] as const).map(([id, name, hint]) => {
                        const active = protection === id
                        return (
                          <button key={id} type="button" className={clsx('menu-item', active && 'active')} title={t(hint)}
                            aria-pressed={active} disabled={streaming || sending || active} onClick={() => {
                              close()
                              if (id === 'full') setFullAccessTarget(key)
                              else if (id === 'readonly') void changePermission('ask', 'read-only')
                              else void changePermission('review')
                            }}>
                            <span className="menu-item-title">{t(name)}</span>
                            {active && <Check size={14} />}
                          </button>
                        )
                      })}
                      <button type="button" className="menu-item" onClick={() => { close(); openPermissionSettings('tools') }}>
                        <span className="menu-item-title">{t('默认设置')} ›</span>
                      </button>
                    </div>
                  </div>}
                </Popover>
              )
            })()}
            {fullAccessTarget === key && (
              <Modal open title={t('这次不受限？')}
                subtitle={t('仅这次对话。')}
                onClose={() => setFullAccessTarget(null)}
                footer={<>
                  <button type="button" className="button ghost" onClick={() => setFullAccessTarget(null)}>{t('取消')}</button>
                  <button type="button" className="button primary" onClick={() => void changePermission('full')}>{t('确认')}</button>
                </>} children={null} />
            )}
          </div>

          <div className="composer-right">
            <Popover
              width={320}
              keyboardNav={false}
              trigger={(open, toggle, expanded) => (
                <button
                  className={clsx('chip', open && 'open')}
                  onClick={toggle}
                  disabled={streaming || !ready}
                  title={
                    streaming
                      ? t("本轮结束后可切换模型")
                      : model
                        ? `${model.provider}/${model.id}`
                        : t("选择模型")
                  }
                  aria-label={t("选择模型")}
                  {...expanded}
                >
                  <span className="chip-dot" />
                  <span className="chip-label">{model ? model.name : 'Model'}</span>
                  <ChevronDown size={12} />
                </button>
              )}
            >
              {(close) => <ModelMenu close={close} />}
            </Popover>

            <Popover
              width={220}
              trigger={(open, toggle, expanded) => {
                const level = state.piState?.thinkingLevel ?? 'off'
                const bars = reasoningBars(level)
                return (
                  <button
                    className={clsx('reasoning-button', open && 'open')}
                    onClick={toggle}
                    disabled={streaming || !ready}
                    title={`${t('推理强度')} · ${t(THINKING_LABELS[level] ?? 'Off')}`}
                    aria-label={t('推理强度')}
                    {...expanded}
                  >
                    <span className="reasoning-bars" aria-hidden="true">
                      {[1, 2, 3, 4].map((bar) => <i key={bar} className={bar <= bars ? 'on' : undefined} style={{ height: 4 + bar * 2 }} />)}
                    </span>
                  </button>
                )
              }}
            >
              {(close) => <ThinkingMenu close={close} />}
            </Popover>
            {percent > 50 ? (
              <div className="context-ring" title={`${t('上下文')} ${Math.round(percent)}%`}>
                <svg viewBox="0 0 20 20" width="16" height="16">
                  <circle cx="10" cy="10" r="7.5" className="ring-bg" />
                  <circle
                    cx="10"
                    cy="10"
                    r="7.5"
                    className={clsx('ring-fg', percent > 80 && 'warning')}
                    strokeDasharray={`${Math.min(percent, 100) * 0.471} 47.1`}
                    transform="rotate(-90 10 10)"
                  />
                </svg>
              </div>
            ) : null}

            <button
              className={clsx('send-button', streaming && 'stop')}
              onClick={() => void (streaming ? stop() : submit())}
              disabled={streaming ? stopping : !canSend}
              title={streaming ? t('停止') : t('Send (Enter)')}
              aria-label={streaming ? t('停止') : t('Send (Enter)')}
            >
              {sending || stopping ? <Spinner size={14} /> : streaming ? <Square size={11} fill="currentColor" /> : <ArrowUp size={16} />}
            </button>
          </div>
        </div>
      </div>

      {starting ? <div className="composer-hint is-starting" role="status">{t('正在准备会话…')}</div> : null}
    </div>
  )
}
