import { CREATOR_COMMAND } from '@shared/creator'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Cable, ChevronRight, FileText, Sparkles, Terminal, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import type { CommandInfo, ConnectorEntry, McpConnector } from '@shared/types'
import { useTranslation } from '../i18n'

const GROUP_LABELS = { actions: '会话操作', skills: '技能', commands: '扩展命令与提示词' } as const
type Group = keyof typeof GROUP_LABELS

export interface SlashItem {
  name: string
  label: string
  description: string
  icon: LucideIcon
  group: Group
  source?: string
  aliases?: string[]
  disabled?: boolean
  run?: () => void
}

export function slashQueryOf(text: string): string | null {
  return /^\/([^/\s]*)$/u.exec(text)?.[1] ?? null
}

function commandSource(info: CommandInfo['sourceInfo'], t: (text: string) => string): string | undefined {
  if (!info) return undefined
  if (info.origin === 'package') {
    const name = info.source?.replace(/^npm:/, '').replace(/^git:/, '')
    const repository = name?.match(/(?:^|\/)github\.com[/:]([^/]+\/[^/]+)\/?$/i)?.[1]
    if (repository) return repository.replace(/\.git$/, '')
    if (name && /^@?[\w.-]+(?:\/[\w.-]+)?(?:@[\w.+-]+)?$/.test(name)) return name
  }
  if (info.scope === 'project') return t('项目')
  if (info.scope === 'user') return t('个人')
  if (info.scope === 'temporary') return t('本次对话')
  return undefined
}

export function slashItems(
  actions: SlashItem[],
  commands: CommandInfo[],
  query: string,
  t: (text: string) => string
): SlashItem[] {
  const names = new Set(actions.flatMap((action) => [action.name, ...(action.aliases ?? [])]))
  const items = [...actions]
  for (const command of commands) {
    if (command.name === CREATOR_COMMAND || names.has(command.name) || ['rename', 'schedule', 'usage', 'thinking', 'reasoning'].includes(command.name)) continue
    names.add(command.name)
    const isSkill = command.source === 'skill'
    items.push({
      name: command.name,
      label: isSkill
        ? command.name.replace(/^skill:/, '').replace(/[-_]+/g, ' ').replace(/^\p{Ll}/u, (letter) => letter.toUpperCase())
        : command.name,
      description: command.description?.trim().replace(/\s+/g, ' ') ||
        t(isSkill ? '使用此技能' : command.source === 'prompt' ? '使用提示词模板' : '运行扩展命令'),
      source: commandSource(command.sourceInfo, t),
      icon: isSkill ? Sparkles : command.source === 'prompt' ? FileText : Terminal,
      group: isSkill ? 'skills' : 'commands'
    })
  }
  const groups = new Map<Group, SlashItem[]>()
  const needle = query.toLowerCase()
  const ranked = items.map((item) => {
    const terms = [item.name, item.label, ...(item.aliases ?? [])].map((term) => term.toLowerCase())
    const score = !needle ? 0 : terms.includes(needle) ? 4
      : terms.some((term) => term.startsWith(needle)) ? 3
        : terms.some((term) => term.includes(needle)) ? 2
          : item.description.toLowerCase().includes(needle) || item.source?.toLowerCase().includes(needle) ? 1 : 0
    return { item, score }
  })
  if (needle) ranked.sort((a, b) => b.score - a.score)
  for (const { item, score } of ranked) {
    if (needle && !score) continue
    const group = groups.get(item.group) ?? []
    group.push(item)
    groups.set(item.group, group)
  }
  // A matching group moves up when it contains the best search result.
  return [...groups.values()].flat()
}

function highlight(text: string, query: string): ReactNode {
  const offset = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (offset < 0) return text
  return <>{text.slice(0, offset)}<mark className="slash-match">{text.slice(offset, offset + query.length)}</mark>{text.slice(offset + query.length)}</>
}

export function SlashMenu({
  id, open, query, items, activeIndex, menuRef, boxRef, anchorRef, onActive, onPick, page, workspace, onBack
}: {
  id: string
  open: boolean
  query: string
  items: SlashItem[]
  activeIndex: number
  menuRef: RefObject<HTMLDivElement | null>
  boxRef: RefObject<HTMLDivElement | null>
  anchorRef: RefObject<HTMLDivElement | null>
  onActive: (index: number) => void
  onPick: (item: SlashItem) => void
  page: 'commands' | 'connectors'
  workspace: string
  onBack: () => void
}): ReactNode {
  const t = useTranslation()
  const [position, setPosition] = useState<CSSProperties>()
  const latest = useRef({ items, activeIndex, query })
  const [connections, setConnections] = useState<{ cli: ConnectorEntry[]; mcp: McpConnector[]; loading: boolean; error: boolean }>({ cli: [], mcp: [], loading: true, error: false })
  useEffect(() => {
    if (!open || page !== 'connectors') return
    let alive = true
    setConnections({ cli: [], mcp: [], loading: true, error: false })
    void Promise.allSettled([window.pi.listConnectors(workspace), window.pi.listMcpConnectors()]).then(([cli, mcp]) => {
      if (alive) setConnections({ cli: cli.status === 'fulfilled' ? cli.value : [], mcp: mcp.status === 'fulfilled' ? mcp.value : [], loading: false, error: cli.status === 'rejected' || mcp.status === 'rejected' })
    })
    return () => { alive = false }
  }, [open, page, workspace])

  useLayoutEffect(() => {
    if (open) latest.current = { items, activeIndex, query }
  }, [open, items, activeIndex, query])

  useLayoutEffect(() => {
    const box = boxRef.current
    const anchor = anchorRef.current
    if (!open || !box || !anchor) return
    const place = (): void => {
      const { left, width } = box.getBoundingClientRect()
      const { top } = anchor.getBoundingClientRect()
      const gap = 6
      setPosition({
        left,
        width,
        bottom: window.innerHeight - top + gap,
        maxHeight: Math.min(430, Math.max(0, top - gap - 8))
      })
    }
    const observer = new ResizeObserver(place)
    observer.observe(box)
    observer.observe(anchor)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    place()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, boxRef, anchorRef])

  useLayoutEffect(() => {
    if (!open) return
    menuRef.current?.querySelector('.command-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [open, query, activeIndex, items, menuRef])

  const view = open ? { items, activeIndex, query } : latest.current
  return createPortal(
    <div
      id={id}
      ref={menuRef}
      className="command-menu slash-menu"
      style={position}
      hidden={!open}
      inert={!open}
      role={page === 'commands' ? 'listbox' : 'region'}
      aria-label={t(page === 'commands' ? '斜杠命令' : '连接器')}
      onMouseDown={(event) => event.preventDefault()}
      onWheel={(event) => event.stopPropagation()}
    >
      {page === 'connectors' ? (
        <div className="slash-page" key="connectors">
          <button type="button" className="slash-back" onClick={onBack} aria-label={t('返回斜杠菜单')}><ArrowLeft size={15} /><span>{t('连接器')}</span></button>
          {connections.loading && <div className="slash-empty" role="status">{t('加载中…')}</div>}
          {!connections.loading && connections.error && <div className="slash-empty" role="alert">{t('部分连接器无法读取')}</div>}
          {!connections.loading && (() => {
            const needle = query.toLowerCase()
            const entries = [
              ...connections.mcp.map((item) => ({ key: `mcp:${item.id}`, name: item.name, status: t(item.enabled ? '未测试' : '已停用'), detail: t(item.transport === 'http' ? 'MCP 服务' : '本机 MCP 服务') })),
              ...connections.cli.map((item) => ({ key: `cli:${item.name}`, name: item.name === 'lark-cli' ? t('飞书') : item.name === 'gh' ? 'GitHub' : item.name, status: t(item.installed ? '已安装' : '未安装'), detail: t('本机依赖') }))
            ].filter((item) => `${item.name} ${item.detail}`.toLowerCase().includes(needle))
            return entries.length ? entries.map((item) => <div className="command-item slash-connector" key={item.key}><Cable className="command-icon" size={16} aria-hidden="true" /><span className="command-name">{item.name}</span><span className="command-desc">{item.detail}</span><span className="slash-source">{item.status}</span></div>) : !connections.error && <div className="slash-empty">{t(needle ? '没有匹配的连接' : '还没有连接器')}</div>
          })()}
        </div>
      ) : view.items.length === 0 ? (
        <div className="slash-empty" role="status">{t('没有匹配的命令')}</div>
      ) : view.items.map((item, index) => {
        const Icon = item.icon
        return (
          <div key={item.name} role="presentation">
            {(index === 0 || view.items[index - 1].group !== item.group) && (
              <div className="menu-group-label">{t(GROUP_LABELS[item.group])}</div>
            )}
            <button
              id={`${id}-${index}`}
              type="button"
              tabIndex={-1}
              role="option"
              aria-selected={index === view.activeIndex}
              aria-disabled={item.disabled || undefined}
              className={clsx('command-item', index === view.activeIndex && 'active')}
              title={`/${item.name} · ${item.description}`}
              onMouseMove={() => onActive(index)}
              onClick={() => onPick(item)}
            >
              <Icon className="command-icon" size={16} aria-hidden="true" />
              <span className="command-name">{highlight(item.label, view.query)}</span>
              <span className="command-desc">{highlight(item.description, view.query)}</span>
              {item.source && <span className="slash-source">{item.source}</span>}
              {item.name === 'connectors' && <ChevronRight size={14} aria-hidden="true" />}
            </button>
          </div>
        )
      })}
    </div>,
    document.body
  )
}
