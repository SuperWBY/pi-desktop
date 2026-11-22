import { CREATOR_COMMAND } from '@shared/creator'
import { CreatorModeBar } from './CreatorPanel'
import { useTranslation } from '../i18n'
import {
  useCallback,
  useEffect,
  useId,
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
  Cable,
  Hand,
  FileText,
  FolderOpen,
  Check,
  ChevronDown,
  Layers3,
  GripVertical,
  GitFork,
  Image as ImageIcon,
  Paperclip,
  Plus,
  CircleDashed,
  ShieldCheck,
  Sparkles,
  Square,
  TriangleAlert,
  X
} from 'lucide-react'
import clsx from 'clsx'
import type {
  ScheduleCadence,
  SessionPermission
} from '@shared/types'
import { userFacingError } from '@shared/errors'
import { useApp, type Attachment } from '../store'
import { ContextUsage, measureContextUsage } from './ContextUsage'
import { thinkingLabel } from '../lib/thinking'
import { ModelMenu, MODEL_PROVIDERS_WIDTH } from './ModelMenu'
import { Modal, Popover, Spinner } from './ui'
import { requestSkillsTab } from './SkillsPage'
import { ProjectPicker } from './ProjectPicker'
import { SlashMenu, slashItems, slashQueryOf, type SlashItem } from './SlashMenu'
import { readDraft, saveDraft } from '../lib/composer-drafts'
import { ConversationPrompt } from './ConversationPrompt'
import { DictationBar, DictationButton, DictationStatus, useDictation } from './Dictation'

const PASTE_AS_FILE_CHARS = 2000

const PERMISSION_OPTIONS = [
  { id: 'ask', label: '手动确认', detail: '每次执行工具前先问你。', icon: Hand },
  { id: 'review', label: '自动模式', detail: '常规操作直接做，检测到危险命令时先问你。', icon: ShieldCheck },
  { id: 'full', label: '完全访问', detail: '本次对话可访问电脑文件和网络。', icon: TriangleAlert }
] as const


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

export function Composer(): ReactNode {
  const t = useTranslation()
  const { state, actions } = useApp()
  const requestKey = state.composerDraftKey
  const key = state.sessionPath ? `session:${state.sessionPath}` : requestKey ?? `project:${state.workspace ?? ''}`
  const workspace = state.workspace ?? ''
  const scratch = state.scratchWorkspace
  const draftOnly = !state.sessionPath || (!state.sessions.some((session) => session.path === state.sessionPath) &&
    !state.messages.some((message) => message.role === 'user' || message.role === 'assistant'))
  const [initialDraft] = useState(() => readDraft(key))
  const [text, setText] = useState(initialDraft.text)
  const selectedCommand = useMemo(() => {
    const match = /^\/([^\s/]+)[ \t]+/u.exec(text)
    if (!match) return null
    const command = state.commands.find((item) => item.name === match[1] && item.name !== CREATOR_COMMAND && ['skill', 'extension', 'prompt'].includes(item.source ?? ''))
    if (!command) return null
    return { prefix: match[0], name: command.name, label: command.name.replace(/^skill:/, ''), source: command.source }
  }, [text, state.commands])
  const lastSelectedCommand = useRef(selectedCommand)
  if (selectedCommand) lastSelectedCommand.current = selectedCommand
  const [commandDisplayName, setCommandDisplayName] = useState(initialDraft.commandDisplay?.label ?? '')
  const commandNameRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    if (!selectedCommand) return
    const stored = readDraft(key).commandDisplay
    const label = stored?.name === selectedCommand.name ? stored.label : selectedCommand.label
    setCommandDisplayName(label)
    if (commandNameRef.current) commandNameRef.current.textContent = label
  }, [selectedCommand?.name, key])
  const [attachments, setAttachments] = useState<Attachment[]>(initialDraft.attachments)
  const draftRef = useRef({ key, requestKey, workspace, scratch, draftOnly, sessionPath: state.sessionPath, draft: initialDraft })
  const skipDraftWrite = useRef(false)
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [dragQueueIndex, setDragQueueIndex] = useState<number | null>(null)
  const [dragOverQueue, setDragOverQueue] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [commandIndex, setCommandIndex] = useState(0)
  const [slashPage, setSlashPage] = useState<'commands' | 'connectors'>('commands')
  const [dismissedSlash, setDismissedSlash] = useState<string | null>(initialDraft.text || null)
  const slashId = useId()
  const [mention, setMention] = useState<{ query: string; start: number; end: number } | null>(null)
  const [mentionFiles, setMentionFiles] = useState<string[]>([])
  const [mentionIndex, setMentionIndex] = useState(0)
  const [changingPermission, setChangingPermission] = useState(false)
  const [fullAccessTarget, setFullAccessTarget] = useState<string | null>(null)
  const [atCap, setAtCap] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dictation = useDictation(
    key,
    state.settingsOpen || state.addProjectOpen || state.skillsOpen || state.schedulesOpen || Boolean(state.uiRequests.length || state.networkBlock),
    state.settings.language === 'en' ? 'en-US' : 'zh-CN',
    textareaRef,
    (value) => {
      setText(`${selectedCommand?.prefix ?? ''}${value}`)
      setMention(null)
      setMentionFiles([])
      setDismissedSlash(value)
    }
  )
  const fileRef = useRef<HTMLInputElement>(null)
  const slashMenuRef = useRef<HTMLDivElement>(null)
  const composerShellRef = useRef<HTMLDivElement>(null)
  const composerBoxRef = useRef<HTMLDivElement>(null)
  const modelChipRef = useRef<HTMLButtonElement>(null)
  const dragDepth = useRef(0)
  const focusedWhileStarting = useRef(false)

  const streaming = state.streaming
  const starting = state.status === 'starting'
  const ready = state.status === 'ready'
  const model = state.piState?.model

  const sessionSecurity = state.sessionSecurity
  const selectedPermission = PERMISSION_OPTIONS.find((item) => item.id === sessionSecurity?.permission)
  const permissionBusy = state.creatorBusy || Boolean(state.creator?.busy) || streaming || sending || state.compacting || Boolean(state.retry) || state.uiRequests.length > 0

  const changePermission = async (permission: SessionPermission): Promise<void> => {
    if (!state.workspace || changingPermission || permissionBusy || !ready) return
    setFullAccessTarget(null)
    setChangingPermission(true)
    try {
      await actions.changeSessionPermission({ permission })
    } catch (error) {
      actions.notify('error', t('无法切换权限'), userFacingError(error))
    } finally {
      setChangingPermission(false)
    }
  }

  useLayoutEffect(() => {
    const previous = draftRef.current
    if (previous.key === key) {
      previous.requestKey = requestKey
      previous.workspace = workspace
      previous.scratch = scratch
      previous.draftOnly = draftOnly
      previous.sessionPath = state.sessionPath
      return
    }
    saveDraft(previous.key, previous.draft, previous)
    // A new session obtains its path lazily after the first prompt. Preserve
    // the same draft owner when that happens without a session switch.
    const promoted = previous.sessionPath === null && state.sessionPath !== null &&
      previous.requestKey === requestKey && state.status === 'ready'
    const next = promoted ? previous.draft : readDraft(key)
    if (promoted) {
      saveDraft(key, next, { workspace, scratch, draftOnly })
      saveDraft(previous.key, { text: '', attachments: [] })
      previous.key = key
      previous.workspace = workspace
      previous.scratch = scratch
      previous.draftOnly = draftOnly
      previous.sessionPath = state.sessionPath
      previous.draft = next
    } else {
      draftRef.current = { key, requestKey, workspace, scratch, draftOnly, sessionPath: state.sessionPath, draft: next }
    }
    skipDraftWrite.current = true
    setText(next.text)
    setAttachments(next.attachments)
    setDismissedSlash(next.text)
    setCommandIndex(0)
    setSlashPage('commands')
    setMention(null)
    setMentionFiles([])
  }, [key, requestKey, workspace, scratch, draftOnly, state.sessionPath, state.status])

  useEffect(() => {
    if (skipDraftWrite.current) { skipDraftWrite.current = false; return }
    const owner = draftRef.current
    if (owner.key !== key) return
    const previousDisplay = owner.draft.commandDisplay
    const commandDisplay = selectedCommand
      ? { name: selectedCommand.name, label: commandNameRef.current?.textContent ?? commandDisplayName }
      : previousDisplay && text.startsWith(`/${previousDisplay.name} `) ? previousDisplay : undefined
    owner.draft = { text, attachments, commandDisplay }
    saveDraft(key, owner.draft, owner)
  }, [key, text, attachments, workspace, scratch, draftOnly, selectedCommand?.name, commandDisplayName])

  useLayoutEffect(() => {
    const node = textareaRef.current
    if (!node) return
    const previousHeight = node.getBoundingClientRect().height
    node.style.transition = 'none'
    node.style.height = '0px'
    const contentHeight = node.scrollHeight
    node.style.height = `${previousHeight}px`
    void node.offsetHeight
    node.style.transition = ''
    node.style.height = `${Math.min(contentHeight, 240)}px`
    setAtCap(contentHeight > 240)
  }, [text])

  const previousSuggestion = useRef<{ key: string; value: string } | null>(null)
  useEffect(() => {
    if (!state.editorText) return
    const { value, append, nonce, suggestion, prepend } = state.editorText
    const old = previousSuggestion.current?.key === key ? previousSuggestion.current.value : null
    setText((current) => {
      if (prepend) {
        const match = /^\/([^\s/]+)[ \t]+/u.exec(current)
        const existing = match && state.commands.some((item) => item.name === match[1] && ['skill', 'extension', 'prompt'].includes(item.source ?? ''))
        return `${value}${existing && match ? current.slice(match[0].length) : current}`
      }
      const index = suggestion && old ? current.lastIndexOf(old) : -1
      return index >= 0 && old
        ? `${current.slice(0, index)}${value}${current.slice(index + old.length)}`
        : append && current.trim() ? `${current}\n\n${value}` : value
    })
    previousSuggestion.current = suggestion ? { key, value } : null
    actions.consumeEditorText(nonce)
    const node = textareaRef.current
    requestAnimationFrame(() => {
      node?.focus()
      node?.setSelectionRange(node.value.length, node.value.length)
    })
  }, [state.editorText, actions, key, state.commands])

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

  const openSkillPage = useCallback((tab: 'skills' | 'connectors'): void => {
    requestSkillsTab(tab)
    actions.openSkills(true)
    window.dispatchEvent(new CustomEvent('pi:skills-tab', { detail: tab }))
  }, [actions])

  const { percent: contextPercent, used: contextTokens } = measureContextUsage(
    ready ? state.stats?.contextUsage : undefined, model?.contextWindow
  )
  const compactUnavailable = !ready || permissionBusy || contextTokens === null || contextTokens <= 0
  const canFork = ready && !permissionBusy && state.sessions.some((session) => session.path === state.sessionPath)
  const creatorAvailable = state.commands.some(command => command.name === CREATOR_COMMAND)
  const desktopCommands = useMemo<SlashItem[]>(() => [
    ...(creatorAvailable ? [{ name:'create', aliases:['creative','creator','创意','创建插件'], group:'actions' as const, icon:Sparkles, label:t('创意模式'),
      description:streaming?t('当前任务结束后可切换模式'):t('把想法变成插件，为 Pi 创造更多功能'), disabled:streaming||state.creatorBusy,
      run:()=>{void actions.beginCreator()} }] : []),
    {
      name: 'connectors', aliases: ['mcp'], group: 'actions', icon: Cable, label: t('连接器'),
      description: t('查看可用的连接器'), run: () => { setText('/'); setDismissedSlash(null); setSlashPage('connectors') }
    },
    {
      name: 'compact', group: 'actions', icon: CircleDashed, label: t('压缩上下文'),
      description: streaming ? t('本轮结束后可压缩上下文') : state.compacting ? t('正在压缩上下文…')
        : contextTokens === null ? t('等待用量更新') : contextTokens === 0 ? t('当前没有可压缩的历史')
        : contextPercent !== null
          ? t('整理聊天历史，已使用 {percent}%').replace('{percent}', String(Math.round(contextPercent)))
          : t('将较早的聊天历史整理为摘要'),
      disabled: compactUnavailable, run: () => void actions.compact()
    },
    ...(canFork ? [{
      name: 'fork', group: 'actions' as const, icon: GitFork, label: t('创建对话分支'),
      description: t('从当前对话的历史消息创建分支'),
      run: () => window.dispatchEvent(new Event('pi:fork-current-session'))
    }] : []),
  ], [actions, creatorAvailable, state.creatorBusy, canFork, compactUnavailable, contextPercent, contextTokens, state.compacting, streaming, t])

  const slashQuery = slashQueryOf(text)
  const slashOpen = slashQuery !== null && dismissedSlash !== text
  const flatSlash = useMemo(
    () => slashQuery === null ? [] : slashItems(desktopCommands, ready ? state.commands : [], slashQuery, t),
    [desktopCommands, ready, slashQuery, state.commands, t]
  )
  const activeSlashIndex = commandIndex < flatSlash.length ? commandIndex : 0

  const dismissSlash = useCallback(() => { setDismissedSlash(text); setSlashPage('commands') }, [text])

  useEffect(() => {
    if (!slashOpen) return
    const onPointer = (event: MouseEvent): void => {
      const target = event.target as Node
      if (slashMenuRef.current?.contains(target) || textareaRef.current?.contains(target)) return
      dismissSlash()
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [dismissSlash, slashOpen])

  const pickSlashCommand = useCallback((command: SlashItem): void => {
    if (command.disabled) return
    if (command.run) {
      if (command.name !== 'connectors') setText('')
      command.run()
      return
    }
    setText(`/${command.name} `)
    window.requestAnimationFrame(() => {
      const input = textareaRef.current
      if (!input) return
      input.focus()
      const caret = input.value.length
      input.setSelectionRange(caret, caret)
    })
  }, [])

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
    const caret = mention.start + path.length + 2 - (selectedCommand?.prefix.length ?? 0)
    window.requestAnimationFrame(() => {
      const input = textareaRef.current
      if (input) {
        input.focus()
        input.setSelectionRange(caret, caret)
      }
    })
  }, [mention, text, selectedCommand])

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
        saveDraft(owner.key, { ...saved, attachments: [...saved.attachments, ...next].slice(0, 6) }, owner)
      }
    },
    [actions, attachments.length, state.settings.language, t]
  )

  const submit = useCallback(async () => {
    const value = text.trim()
    if ((!value && attachments.length === 0) || starting || sending || changingPermission || dictation.active.current) return
    const localName = slashQueryOf(value)?.toLowerCase()
    const localCommand = desktopCommands.find((item) => localName === item.name || (localName && item.aliases?.includes(localName)))
    if (localCommand) {
      if (localCommand.disabled) actions.notify('warning', localCommand.label, localCommand.description)
      else pickSlashCommand(localCommand)
      return
    }
    if (value.startsWith('/schedule ')) {
      const rest = value.slice('/schedule'.length).trim()
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
    // "/create <idea>" typed in one line: enter Creator mode first, then send the idea,
    // so the model gets the creator tools instead of improvising a global extension.
    const creatorIdea = /^\/(?:create|creative|creator|创意|创建插件)\s+([\s\S]+)$/iu.exec(value)
    const creatorCommand = creatorIdea ? desktopCommands.find((item) => item.name === 'create') : undefined
    if (creatorIdea && !creatorCommand) {
      actions.notify('warning', t('创意模式'), t('暂时无法进入创意模式，请稍后再试。'))
      return
    }
    if (creatorIdea && creatorCommand?.disabled) {
      actions.notify('warning', creatorCommand.label, creatorCommand.description)
      return
    }
    const message = `${creatorCommand && creatorIdea ? creatorIdea[1].trim() : value}${attachmentContext(files)}`.trim()

    const owner = draftRef.current
    setSending(true)
    if (creatorCommand && !await actions.beginCreator()) {
      setSending(false)
      actions.notify('warning', creatorCommand.label, t('暂时无法进入创意模式，请稍后再试。'))
      return
    }
    const ok = await actions.sendMessage(message, images)
    setSending(false)
    if (ok && draftRef.current === owner) {
      setText((current) => (current === text ? '' : current))
      const sentIds = new Set(attachments.map((attachment) => attachment.id))
      setAttachments((current) => current.filter((attachment) => !sentIds.has(attachment.id)))
    }
  }, [actions, attachments, starting, sending, changingPermission, dictation.active, desktopCommands, pickSlashCommand, state.status, text, t])

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
    if (selectedCommand && event.key === 'Backspace' && event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0) {
      event.preventDefault()
      setText((current) => current.slice(selectedCommand.prefix.length))
      return
    }
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

    if (slashOpen && slashPage === 'connectors') {
      if (event.key === 'Escape') { event.preventDefault(); setSlashPage('commands'); setText('/'); return }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); return }
      return
    }
    if (slashOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (flatSlash.length) setCommandIndex((activeSlashIndex + 1) % flatSlash.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (flatSlash.length) setCommandIndex((activeSlashIndex - 1 + flatSlash.length) % flatSlash.length)
        return
      }
      if ((event.key === 'Tab' || event.key === 'Enter') && !event.shiftKey && flatSlash.length) {
        event.preventDefault()
        const command = flatSlash[activeSlashIndex]
        if (command) pickSlashCommand(command)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        dismissSlash()
        return
      }
    }
    if (!slashOpen && slashQuery !== null && event.key === 'ArrowDown') {
      event.preventDefault()
      setDismissedSlash(null)
      setCommandIndex(0)
      return
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
      return
    }
    const pasted = event.clipboardData.getData('text/plain')
    if (pasted && pasted.length > PASTE_AS_FILE_CHARS) {
      event.preventDefault()
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const file = new File([pasted], `paste-${stamp}.txt`, { type: 'text/plain' })
      void addFiles([file])
    }
  }

  const clearDragging = useCallback((): void => {
    dragDepth.current = 0
    setDragging(false)
  }, [])

  const setDraggingFromBoundary = (event: DragEvent<HTMLDivElement>, entering: boolean): void => {
    const related = event.relatedTarget as Node | null
    if (related && event.currentTarget.contains(related)) return
    if (entering) {
      dragDepth.current = 1
      setDragging(true)
      return
    }
    clearDragging()
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    clearDragging()
    if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files)
  }

  useEffect(() => {
    const end = (): void => clearDragging()
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => {
      window.removeEventListener('dragend', end)
      window.removeEventListener('drop', end)
    }
  }, [clearDragging])

  // Wheel over the composer should still move the conversation — but never
  // when the pointer is over a menu, modal or drawer sitting on top of it.
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    if (target.closest('.popover, .context-menu, .modal-overlay, .drawer, .drawer-overlay, .slash-menu, .command-menu, .conversation-prompt')) return
    const textarea = target.closest('textarea')
    if (textarea && textarea.scrollHeight > textarea.clientHeight) return
    const scroller = document.querySelector('.chat-scroll') as HTMLElement | null
    if (!scroller) return
    const before = scroller.scrollTop
    scroller.scrollTop += event.deltaY
    if (scroller.scrollTop !== before) event.preventDefault()
  }

  const canSend = ready && (text.trim().length > 0 || attachments.length > 0) && !sending && !changingPermission && !dictation.busy

  return (
    <div
      ref={composerShellRef}
      className={clsx('composer-wrap', dragging && 'dragging')}
      onKeyDownCapture={(event) => {
        if (event.key !== 'Escape' || !dictation.active.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
        event.preventDefault()
        event.stopPropagation()
        dictation.cancel()
      }}
      onDragEnter={(event) => {
        event.preventDefault()
        setDraggingFromBoundary(event, true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        if (!dragging) setDragging(true)
      }}
      onDragLeave={(event) => {
        setDraggingFromBoundary(event, false)
      }}
      onDrop={onDrop}
      onWheel={onWheel}
    >
      <CreatorModeBar />
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
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

      <ConversationPrompt />
      <div className="composer-project-slot" data-covered={Boolean(state.uiRequests.length || state.networkBlock)}
        inert={Boolean(state.uiRequests.length || state.networkBlock)}>
        <div><ProjectPicker disabled={starting || sending} covered={Boolean(state.uiRequests.length || state.networkBlock)} /></div>
      </div>
      <div ref={composerBoxRef} className={clsx('composer', atCap && 'at-cap')}>
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

        <SlashMenu id={slashId} open={slashOpen} query={slashQuery ?? ''} items={flatSlash}
          activeIndex={activeSlashIndex} menuRef={slashMenuRef} anchorRef={composerShellRef}
          boxRef={composerBoxRef} onActive={setCommandIndex} onPick={pickSlashCommand}
          page={slashPage} workspace={workspace} onBack={() => { setSlashPage('commands'); setText('/'); textareaRef.current?.focus() }} />

        <div className="composer-editor-slot" inert={dictation.busy && !text}>
          <div className="composer-editor-line">
            {lastSelectedCommand.current && <span className="composer-skill-chip" hidden={!selectedCommand} inert={!selectedCommand}>
                {lastSelectedCommand.current.source === 'skill' ? <Sparkles size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
                <span className="composer-command-name" title={`${t('实际调用')} /${lastSelectedCommand.current.label}`}>
                  <span aria-hidden="true">/</span>
                  <span ref={commandNameRef} contentEditable suppressContentEditableWarning role="textbox" aria-label={`${t('编辑命令显示名称')} (${t('实际调用')} /${lastSelectedCommand.current.label})`}
                    spellCheck={false} onInput={(event) => setCommandDisplayName(event.currentTarget.textContent ?? '')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); textareaRef.current?.focus() }
                    }}
                    onPaste={(event) => {
                      event.preventDefault()
                      const value = event.clipboardData.getData('text/plain').replace(/[\r\n]+/g, ' ')
                      document.execCommand('insertText', false, value)
                    }} />
                </span>
                {selectedCommand && commandDisplayName !== selectedCommand.label && <span className="composer-command-original" title={`${t('实际调用')} /${selectedCommand.label}`}>{t('实际调用')} /{selectedCommand.label}</span>}
                <button type="button" aria-label={t('移除已选命令')} title={t('移除已选命令')} onClick={() => {
                  if (selectedCommand) setText((current) => current.slice(selectedCommand.prefix.length))
                  requestAnimationFrame(() => textareaRef.current?.focus())
                }}><X size={13} /></button>
              </span>}
            <textarea
              ref={textareaRef}
              className="composer-input"
              value={selectedCommand ? text.slice(selectedCommand.prefix.length) : text}
              rows={1}
              spellCheck={false}
              aria-label={t("输入消息")}
              aria-autocomplete="list"
              aria-controls={slashOpen ? slashId : undefined}
              aria-activedescendant={slashOpen && slashPage === 'commands' && flatSlash.length > 0 ? `${slashId}-${activeSlashIndex}` : undefined}
              placeholder={t('问点什么…')}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                const value = `${selectedCommand?.prefix ?? ''}${event.target.value}`
                setText(value)
                if (slashQueryOf(value) === null) setSlashPage('commands')
                setDismissedSlash(null)
                setCommandIndex(0)
                updateMention(value, (event.target.selectionStart ?? event.target.value.length) + (selectedCommand?.prefix.length ?? 0))
              }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onBlur={() => { if (slashOpen) dismissSlash() }}
            />
          </div>
        </div>

        {dictation.available && <DictationStatus controls={dictation} />}
        <div className="composer-toolbar-stack">
          <div className="composer-bar" hidden={dictation.busy} inert={dictation.busy}>
            <div className="composer-left">
              <Popover
                width={220}
                align="left"
                trigger={(open, toggle, expanded) => (
                  <button
                    className={clsx('icon-button add-attachment', open && 'open')}
                    title={t('添加')}
                    aria-label={t('添加')}
                    onClick={toggle}
                    {...expanded}
                  >
                    <Plus size={16} />
                  </button>
                )}
              >
                {(close) => (
                  <div className="menu composer-add-menu">
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        close()
                        fileRef.current?.click()
                      }}
                    >
                      <Paperclip size={14} />
                      <span className="menu-item-title">{t('添加文件或图片')}</span>
                    </button>
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        close()
                        actions.openAddProject(true)
                      }}
                    >
                      <FolderOpen size={14} />
                      <span className="menu-item-title">{t('选择文件夹')}</span>
                    </button>
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        close()
                        openSkillPage('skills')
                      }}
                    >
                      <Sparkles size={14} />
                      <span className="menu-item-title">{t('技能')}</span>
                    </button>
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => {
                        close()
                        openSkillPage('connectors')
                      }}
                    >
                      <Cable size={14} />
                      <span className="menu-item-title">{t('连接器')}</span>
                    </button>
                  </div>
                )}
              </Popover>
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
              <Popover width={310} trigger={(_open, toggle, expanded) => {
                const Icon = selectedPermission?.icon ?? ShieldCheck
                const label = t(changingPermission ? '正在切换权限…' : selectedPermission?.label ?? '对话权限')
                return (
                  <button type="button" className={clsx('approval-mode-chip', selectedPermission && `permission-${selectedPermission.id}`)}
                    onClick={toggle} disabled={changingPermission || !ready} aria-label={label} title={label} {...expanded}>
                    {changingPermission ? <Spinner size={14} /> : <Icon size={15} />}
                    <span className="approval-mode-label">{label}</span>
                    <ChevronDown size={12} />
                  </button>
                )
              }}>
                {(close) => <div className="menu">
                  <div className="menu-group">
                    <div className="menu-group-label">{t('本次对话')}</div>
                    {permissionBusy && <p className="approval-menu-note" role="status">{t('本轮结束后可切换权限。')}</p>}
                    {PERMISSION_OPTIONS.map(({ id, label, detail, icon: Icon }) => {
                      const active = sessionSecurity?.permission === id
                      return (
                        <button key={id} type="button" role="menuitemradio" aria-checked={active}
                          className={clsx('menu-item approval-menu-item', `permission-${id}`, active && 'active')}
                          disabled={permissionBusy || !sessionSecurity}
                          onClick={() => {
                            close()
                            if (active) return
                            if (id === 'full') setFullAccessTarget(key)
                            else void changePermission(id)
                          }}>
                          <Icon size={15} className="approval-option-icon" />
                          <span className="menu-item-main">
                            <span className="menu-item-title">{t(label)}</span>
                            <span className="menu-item-sub">{t(detail)}</span>
                          </span>
                          {active && <Check size={14} />}
                        </button>
                      )
                    })}
                  </div>
                  {sessionSecurity && sessionSecurity.permission !== 'full' && <p className="approval-menu-note">
                    {sessionSecurity.sandboxed ? [
                      t(sessionSecurity.files === 'read-only' ? '项目文件只读' : '可修改当前项目'),
                      t(sessionSecurity.network === 'off' ? '联网已关闭' : '仅连接已允许的服务和网站')
                    ].join(' · ') : t('当前设备无法限制文件和网络访问。')}
                  </p>}
                </div>}
              </Popover>
              {fullAccessTarget === key && (
                <Modal
                  open
                  title={t('为本次对话开启完全访问？')}
                  onClose={() => setFullAccessTarget(null)}
                  footer={<>
                    <button type="button" className="button ghost" autoFocus onClick={() => setFullAccessTarget(null)}>{t('取消')}</button>
                    <button type="button" className="button primary" disabled={permissionBusy} onClick={() => void changePermission('full')}>{t('开启完全访问')}</button>
                  </>}
                >
                  <p>{t('Pi 可以访问这台电脑上的文件并联网，执行工具无需逐次确认。仅应用于本次对话。')}</p>
                </Modal>
              )}
            </div>

            <div className="composer-right">
              <Popover
                width={346}
                align="right"
                keyboardNav={false}
                trigger={(open, toggle, expanded) => {
                  const language = state.settings.language ?? 'zh-CN'
                  const effort = model?.reasoning
                    ? thinkingLabel(state.piState?.thinkingLevel, language)
                    : null
                  const label = model
                    ? effort
                      ? `${model.name} · ${effort}`
                      : model.name
                    : 'Model'
                  return (
                    <button
                      ref={modelChipRef}
                      className={clsx('chip model-chip', open && 'open')}
                      onClick={toggle}
                      disabled={streaming || !ready}
                      title={
                        streaming
                          ? t("本轮结束后可切换模型")
                          : model
                            ? `${model.provider}/${model.id}${effort ? ` · ${effort}` : ''}`
                            : t("选择模型")
                      }
                      aria-label={model ? `${t('选择模型')}，${label}` : t("选择模型")}
                      {...expanded}
                    >
                      <Layers3 className="model-compact-icon" size={15} aria-hidden="true" />
                      <span className="chip-dot" />
                      <span className="chip-label">{label}</span>
                      <ChevronDown size={12} />
                    </button>
                  )
                }}
              >
                {(close, spaceBefore) => <ModelMenu close={close} sideMenu={spaceBefore >= MODEL_PROVIDERS_WIDTH + 16} />}
              </Popover>
              <ContextUsage key={`${state.workspace}:${state.sessionPath}`} />
              <DictationButton controls={dictation} disabled={sending} />

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
          {dictation.available && <DictationBar controls={dictation} />}
        </div>
      </div>

      {starting ? <div className="composer-hint is-starting" role="status">{t('正在准备会话…')}</div> : null}
    </div>
  )
}
