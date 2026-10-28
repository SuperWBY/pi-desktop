import {
  useCallback,
  useEffect,
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
  Brain,
  Check,
  ChevronDown,
  Image as ImageIcon,
  Paperclip,
  Square,
  X
} from 'lucide-react'
import clsx from 'clsx'
import type { ModelInfo, ThinkingLevel } from '@shared/types'
import { useApp, type Attachment } from '../store'
import { formatCost, formatTokens, truncate } from '../lib/format'
import { Popover, Spinner } from './ui'

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
        name: file.name || 'image'
      })
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'))
    reader.readAsDataURL(file)
  })
}

function ModelMenu({ close }: { close: () => void }): ReactNode {
  const { state, actions } = useApp()
  const [query, setQuery] = useState('')
  const current = state.piState?.model

  const grouped = useMemo(() => {
    const filtered = state.models.filter((model) => {
      if (!query.trim()) return true
      const haystack = `${model.name} ${model.id} ${model.provider}`.toLowerCase()
      return haystack.includes(query.toLowerCase())
    })
    const map = new Map<string, ModelInfo[]>()
    for (const model of filtered) {
      const list = map.get(model.provider) ?? []
      list.push(model)
      map.set(model.provider, list)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [state.models, query])

  return (
    <div className="menu">
      <div className="menu-search">
        <input
          autoFocus
          value={query}
          placeholder="搜索模型…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="menu-list">
        {grouped.length === 0 && <div className="menu-empty">No models found</div>}
        {grouped.map(([provider, models]) => (
          <div key={provider} className="menu-group">
            <div className="menu-group-label">{provider}</div>
            {models.map((model) => {
              const active = current?.provider === model.provider && current?.id === model.id
              return (
                <button
                  key={`${model.provider}/${model.id}`}
                  className={clsx('menu-item', active && 'active')}
                  onClick={() => {
                    void actions.setModel(model)
                    close()
                  }}
                >
                  <span className="menu-item-main">
                    <span className="menu-item-title">{model.name}</span>
                    <span className="menu-item-sub">
                      {model.contextWindow ? `${formatTokens(model.contextWindow)} 上下文` : model.id}
                      {model.reasoning ? ' · 推理' : ''}
                    </span>
                  </span>
                  {active && <Check size={14} />}
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
  const { state, actions } = useApp()
  const levels = state.levels.length ? state.levels : (['off'] as ThinkingLevel[])
  return (
    <div className="menu">
      <div className="menu-group">
        <div className="menu-group-label">Reasoning effort</div>
        {levels.map((level) => (
          <button
            key={level}
            className={clsx('menu-item', state.piState?.thinkingLevel === level && 'active')}
            onClick={() => {
              void actions.setThinking(level)
              close()
            }}
          >
            <span className="menu-item-title">{THINKING_LABELS[level] ?? level}</span>
            {state.piState?.thinkingLevel === level && <Check size={14} />}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Composer(): ReactNode {
  const { state, actions } = useApp()
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [commandIndex, setCommandIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const streaming = state.streaming
  const context = state.stats?.contextUsage
  const percent = typeof context?.percent === 'number' ? context.percent : 0
  const model = state.piState?.model

  useEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = '0px'
    node.style.height = `${Math.min(node.scrollHeight, 240)}px`
  }, [text])

  useEffect(() => {
    if (!state.editorText) return
    setText(state.editorText.value)
    const node = textareaRef.current
    requestAnimationFrame(() => {
      node?.focus()
      node?.setSelectionRange(node.value.length, node.value.length)
    })
  }, [state.editorText])

  useEffect(() => {
    if (state.status === 'ready') textareaRef.current?.focus()
  }, [state.status, state.sessionPath])

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

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const images = Array.from(files).filter((file) => file.type.startsWith('image/'))
      if (!images.length) return
      const next: Attachment[] = []
      for (const file of images.slice(0, 6)) {
        if (file.size > 8 * 1024 * 1024) {
          actions.notify('warning', 'Image skipped', `${file.name} is larger than 8 MB.`)
          continue
        }
        try {
          next.push(await readImage(file))
        } catch {
          actions.notify('error', 'Could not read image', file.name)
        }
      }
      setAttachments((current) => [...current, ...next].slice(0, 6))
    },
    [actions]
  )

  const submit = useCallback(async () => {
    const value = text.trim()
    if ((!value && attachments.length === 0) || sending) return
    if (state.status !== 'ready') {
      actions.notify('warning', 'Not connected', 'Wait for the session to finish starting.')
      return
    }

    const images = attachments.map((attachment) => {
      const base64 = attachment.dataUrl.split(',')[1] ?? ''
      return { type: 'image' as const, data: base64, mimeType: attachment.mimeType }
    })

    setSending(true)
    const ok = await actions.sendMessage(value, images)
    setSending(false)
    if (ok) {
      setText('')
      setAttachments([])
    }
  }, [actions, attachments, sending, state.status, text])

  const stop = useCallback(async () => {
    if (stopping) return
    setStopping(true)
    const cleared = await actions.stop()
    setStopping(false)
    const queued = cleared ? [...cleared.steering, ...cleared.followUp].join('\n\n') : ''
    if (queued) {
      setText((current) => (current ? `${queued}\n\n${current}` : queued))
      actions.notify('info', 'Stopped', 'Queued messages were returned to the composer.')
    }
  }, [actions, stopping])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
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
    if (files.some((file) => file.type.startsWith('image/'))) {
      event.preventDefault()
      void addFiles(files)
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragging(false)
    if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files)
  }

  // Wheel over the composer should still move the conversation.
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    const textarea = target.closest('textarea')
    if (textarea && textarea.scrollHeight > textarea.clientHeight) return
    const scroller = document.querySelector('.chat-scroll') as HTMLElement | null
    if (!scroller) return
    const before = scroller.scrollTop
    scroller.scrollTop += event.deltaY
    if (scroller.scrollTop !== before) event.preventDefault()
  }

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !sending

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
          <span>松手添加图片</span>
        </div>
      )}

      {(state.queue.steering.length > 0 || state.queue.followUp.length > 0) && (
        <div className="queue-strip">
          <span className="queue-label">Queued</span>
          {[...state.queue.steering, ...state.queue.followUp].map((item, index) => (
            <span className="queue-item" key={index}>
              {truncate(item, 80)}
            </span>
          ))}
        </div>
      )}

      <div className="composer">
        {attachments.length > 0 && (
          <div className="attachment-row">
            {attachments.map((attachment) => (
              <div className="attachment" key={attachment.id}>
                <img src={attachment.dataUrl} alt={attachment.name} />
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
          placeholder={
            streaming ? '插话（steer）或排队一条后续消息…' : '让 pi 帮你写代码、查问题、解释代码…'
          }
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />

        <div className="composer-bar">
          <div className="composer-left">
            <button
              className="icon-button"
              title="添加图片"
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip size={15} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files)
                event.target.value = ''
              }}
            />

            <Popover
              width={320}
              trigger={(open, toggle, expanded) => (
                <button
                  className={clsx('chip', open && 'open')}
                  onClick={toggle}
                  title={model ? `${model.provider}/${model.id}` : '选择模型'}
                  aria-label="选择模型"
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
              trigger={(open, toggle, expanded) => (
                <button
                  className={clsx('chip', open && 'open')}
                  onClick={toggle}
                  title="推理强度"
                  aria-label="推理强度"
                  {...expanded}
                >
                  <Brain size={13} />
                  <span className="chip-label">
                    {THINKING_LABELS[state.piState?.thinkingLevel ?? 'off'] ?? 'Off'}
                  </span>
                  <ChevronDown size={12} />
                </button>
              )}
            >
              {(close) => <ThinkingMenu close={close} />}
            </Popover>

            {streaming && (
              <div className="mode-toggle" role="group" aria-label="发送方式">
                <button
                  className={clsx(state.sendMode === 'steer' && 'active')}
                  onClick={() => actions.setSendMode('steer')}
                  title="Deliver after the current tool calls"
                >
                  Steer
                </button>
                <button
                  className={clsx(state.sendMode === 'followUp' && 'active')}
                  onClick={() => actions.setSendMode('followUp')}
                  title="Deliver after pi finishes"
                >
                  Follow-up
                </button>
              </div>
            )}
          </div>

          <div className="composer-right">
            {context?.tokens ? (
              <div
                className="context-ring"
                title={`${formatTokens(context.tokens)} / ${formatTokens(context.contextWindow)} tokens · ${formatCost(state.stats?.cost)}`}
              >
                <svg viewBox="0 0 20 20" width="20" height="20">
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
                <span>{Math.round(percent)}%</span>
              </div>
            ) : null}

            {streaming ? (
              <button
                className="send-button stop"
                onClick={() => void stop()}
                disabled={stopping}
                title="Stop (Esc)"
              >
                {stopping ? <Spinner size={14} /> : <Square size={12} fill="currentColor" />}
              </button>
            ) : (
              <button
                className="send-button"
                onClick={() => void submit()}
                disabled={!canSend}
                title="Send (Enter)"
              >
                {sending ? <Spinner size={14} /> : <ArrowUp size={16} />}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="composer-hint">
        {streaming
          ? 'Enter to queue · Esc to stop'
          : 'Enter 发送 · Shift+Enter 换行'}
      </div>
    </div>
  )
}
