import { diffLines } from 'diff'
import type { ContentBlock } from '@shared/types'

export type ToolKind = 'bash' | 'read' | 'write' | 'edit' | 'tool'

export interface ToolMeta {
  kind: ToolKind
  title: string
  /** Filename, hostname, or a Chinese phrase. Phrases are translated; names are not. */
  subtitle: string
  translateSubtitle?: boolean
}

function hostOf(value: string): string {
  const match = value.match(/https?:\/\/[^\s'")]+/)
  if (!match) return ''
  try {
    return new URL(match[0]).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function fileNameOf(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? ''
}

function textField(source: unknown, keys: string[]): string {
  if (!source || typeof source !== 'object') return ''
  const record = source as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function clipObject(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= 40) return trimmed
  return `${trimmed.slice(0, 39)}…`
}

function shortPath(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean)
  return clipObject(parts.slice(-2).join('/'))
}

/** The row keeps the thing that actually ran. The full text stays in the expanded body. */
function describeCommand(command: string): Pick<ToolMeta, 'subtitle' | 'translateSubtitle'> {
  return { subtitle: clipObject(command), translateSubtitle: false }
}

export function readRangeLabel(args: Record<string, unknown>): { start: number; end: number | null } | null {
  const offset = typeof args.offset === 'number' ? args.offset : null
  const limit = typeof args.limit === 'number' ? args.limit : null
  if (offset == null && limit == null) return null
  const start = offset ?? 1
  return { start, end: limit != null ? start + Math.max(limit, 1) - 1 : null }
}

/**
 * Rows read as actions, not as protocol events: the verb carries the state
 * (running / done / failed) and the group phrase carries the batch size.
 * Strings are Chinese keys; `t()` maps them for the English UI.
 */
export interface ToolPhrases {
  running: string
  done: string
  failed: string
  group: string
}

/** Only label explicit unknown-result errors as uncertain. */
export function browserActionResultUnknown(name: string, isError: boolean, text: string): boolean {
  if (['computer_use_act', 'computer_use_batch'].includes(name)) return isError && /\bdesktop (?:action|batch) result is unknown\b/i.test(text)
  return ['computer_use_session_act', 'computer_use_session_observe', 'computer_use_browser_act', 'computer_use_cdp_act', 'computer_use_cdp_observe', 'computer_use_chrome_act'].includes(name) && isError && /\b(?:the action result|the previous action result) is unknown\b/i.test(text)
}

export function toolPhrases(name: string): ToolPhrases {
  switch (name) {
    case 'bash':
      return { running: '运行', done: '运行', failed: '运行失败', group: '运行了 {count} 条命令' }
    case 'read':
      return { running: '读取', done: '读取', failed: '读取失败', group: '读取了 {count} 个文件' }
    case 'write':
      return { running: '写入', done: '写入', failed: '写入失败', group: '写入了 {count} 个文件' }
    case 'edit':
      return { running: '编辑', done: '编辑', failed: '编辑失败', group: '编辑了 {count} 个文件' }
    case 'computer_use_observe':
      return { running: '正在查看桌面', done: '已查看桌面', failed: '查看桌面失败', group: '查看桌面 {count} 次' }
    case 'computer_use_act':
    case 'computer_use_batch':
      return { running: '正在操作桌面', done: '已执行桌面操作', failed: '桌面操作失败', group: '桌面操作 {count} 次' }
    case 'computer_use_desktop_reconcile':
      return { running: '等待核对桌面操作', done: '桌面操作核对已处理', failed: '桌面操作核对未完成', group: '核对桌面操作 {count} 次' }
    case 'computer_use_session_open':
      return { running: '正在连接浏览器', done: '浏览器已就绪', failed: '连接浏览器失败', group: '连接浏览器 {count} 次' }
    case 'computer_use_session_close':
      return { running: '正在结束网页操作', done: '网页操作已结束', failed: '结束网页操作失败', group: '结束网页操作 {count} 次' }
    case 'computer_use_session_observe':
      return { running: '正在查看网页', done: '已查看网页', failed: '查看网页失败', group: '查看网页 {count} 次' }
    case 'computer_use_session_act':
      return { running: '正在操作网页', done: '已执行网页操作', failed: '网页操作失败', group: '网页操作 {count} 次' }
    case 'computer_use_session_wait':
      return { running: '正在等待网页元素', done: '网页等待结束', failed: '网页等待失败', group: '等待网页元素 {count} 次' }
    case 'computer_use_session_read':
      return { running: '正在读取网页内容', done: '已读取网页内容', failed: '读取网页内容失败', group: '读取网页内容 {count} 次' }
    case 'computer_use_session_verify_file':
      return { running: '正在核对所选文件', done: '已读取文件信息', failed: '文件核对未完成', group: '核对所选文件 {count} 次' }
    case 'computer_use_session_cancel_file':
      return { running: '等待取消文件选择', done: '文件选择已取消', failed: '取消文件选择未完成', group: '取消文件选择 {count} 次' }
    case 'computer_use_session_downloads':
      return { running: '正在检查下载记录', done: '已检查下载记录', failed: '检查下载记录失败', group: '检查下载记录 {count} 次' }
    case 'computer_use_session_takeover':
      return { running: '等待人工接管', done: '人工接管已处理', failed: '人工接管中断', group: '人工接管 {count} 次' }
    default:
      return { running: '正在处理', done: '已完成一步', failed: '这一步失败', group: '完成了 {count} 步' }
  }
}

/** A page change is evidence, not proof that the business task succeeded. */
export function computerUseOutcome(name: string, details: unknown): string | null {
  if (!name.startsWith('computer_use_') || !details || typeof details !== 'object') return null
  const value = details as { cancelled?: unknown; rejected?: unknown; reason?: unknown; paused?: unknown; pending?: unknown; matched?: unknown; file?: unknown; contentVerified?: unknown; verification?: { status?: unknown; requiresHuman?: unknown; reason?: unknown } | null }
  if (value.cancelled === true) return '已取消'
  if (value.rejected === true && value.reason === 'window_changed') return '目标已变化，请重新观察'
  if (value.rejected === true && value.reason === 'target_obscured') return '目标被遮挡，请重新观察'
  if (name === 'computer_use_desktop_reconcile' && value.pending === true) return '等待人工处理'
  if (value.verification?.reason === 'file_selection') return '等待选择文件'
  if (value.paused === true || value.verification?.requiresHuman === true) return '等待人工处理'
  if (name === 'computer_use_session_wait') return value.matched === true ? '目标已出现' : value.matched === false ? '未等到目标' : null
  if (name === 'computer_use_session_verify_file' && value.file && typeof value.file === 'object') return value.contentVerified === true ? '文件内容摘要已匹配' : '仅核对文件信息'
  if (!['computer_use_act', 'computer_use_batch', 'computer_use_session_act'].includes(name)) return null
  const status = value.verification?.status
  if (status === 'changed' || status === 'confirmed') return '界面有变化，结果待核对'
  if (status === 'no_change' || status === 'unverified') return '未发现变化，结果待核对'
  return '结果待核对'
}

/**
 * pi repeats durationMs on the toolResult message, which is the only timing
 * that survives a session reload (history has no tool_execution events).
 */
export function durationOf(
  run: { durationMs?: number } | undefined,
  result: unknown
): number | undefined {
  if (typeof run?.durationMs === 'number') return run.durationMs
  const fromResult = (result as { durationMs?: unknown } | undefined)?.durationMs
  return typeof fromResult === 'number' ? fromResult : undefined
}

export function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((block) => {
        if (!block || typeof block !== 'object') return ''
        const typed = block as { type?: string; text?: string }
        return typed.type === 'text' ? (typed.text ?? '') : ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (value && typeof value === 'object') {
    const typed = value as { content?: unknown; text?: unknown }
    if (Array.isArray(typed.content)) return contentText(typed.content)
    if (typeof typed.text === 'string') return typed.text
  }
  return ''
}

export function toolMeta(name: string, args: Record<string, unknown>, details?: unknown): ToolMeta {
  const path = typeof args.path === 'string' ? args.path : ''
  const fileName = fileNameOf(path)
  const page = hostOf(textField(args, ['url', 'href', 'page'])) || hostOf(textField(details, ['url', 'href', 'page']))
  const named = textField(args, ['title', 'name', 'app', 'query']) || textField(details, ['title', 'windowTitle', 'app'])

  switch (name) {
    case 'bash': {
      const command = typeof args.command === 'string' ? args.command : ''
      return { kind: 'bash', title: 'Bash', ...describeCommand(command) }
    }
    case 'read':
      return { kind: 'read', title: 'Read', subtitle: path ? shortPath(path) : '文件', translateSubtitle: !path }
    case 'write':
      return { kind: 'write', title: 'Write', subtitle: path ? shortPath(path) : '文件', translateSubtitle: !path }
    case 'edit':
      return { kind: 'edit', title: 'Edit', subtitle: path ? shortPath(path) : '文件', translateSubtitle: !path }
    case 'computer_use_observe':
      return { kind: 'tool', title: name, subtitle: named || page, translateSubtitle: false }
    case 'computer_use_session_wait':
      return { kind: 'tool', title: name, subtitle: typeof args.name === 'string' ? args.name : page, translateSubtitle: false }
    case 'computer_use_session_verify_file':
      return { kind: 'tool', title: name, subtitle: typeof args.expectedName === 'string' ? args.expectedName : fileName, translateSubtitle: false }
    default:
      return { kind: 'tool', title: name, subtitle: page || named || fileName, translateSubtitle: false }
  }
}

export interface EditPair {
  oldText: string
  newText: string
}

export function editPairs(args: Record<string, unknown>): EditPair[] {
  const raw = args.edits
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const entry = item as Record<string, unknown>
        const oldText = entry.oldText ?? entry.old_string ?? entry.oldString
        const newText = entry.newText ?? entry.new_string ?? entry.newString
        if (typeof oldText !== 'string' || typeof newText !== 'string') return null
        return { oldText, newText }
      })
      .filter((item): item is EditPair => Boolean(item))
  }
  const oldText = args.oldText ?? args.old_string
  const newText = args.newText ?? args.new_string
  if (typeof oldText === 'string' && typeof newText === 'string') {
    return [{ oldText, newText }]
  }
  return []
}

export interface DiffPart {
  value: string
  added?: boolean
  removed?: boolean
}

/** Keep a few lines of context around actual changes. */
export function diffParts(oldText: string, newText: string, context = 3): DiffPart[] {
  const parts = diffLines(oldText, newText) as DiffPart[]
  const output: DiffPart[] = []
  const limit = context === Number.MAX_SAFE_INTEGER ? Number.POSITIVE_INFINITY : context

  const splitLines = (value: string): string[] => value.replace(/\n$/, '').split('\n')
  const joinLines = (lines: string[]): string => `${lines.join('\n')}\n`

  const emitContext = (value: string, head: number, tail: number): void => {
    const lines = splitLines(value)
    const before = Number.isFinite(head) ? Math.max(0, head) : lines.length
    const after = Number.isFinite(tail) ? Math.max(0, tail) : lines.length
    if (lines.length <= before + after + 1) {
      output.push({ value })
      return
    }
    if (before > 0) output.push({ value: joinLines(lines.slice(0, before)) })
    const hidden = lines.length - before - after
    output.push({ value: `… ${hidden} unchanged lines …\n` })
    if (after > 0) output.push({ value: joinLines(lines.slice(lines.length - after)) })
  }

  parts.forEach((part, index) => {
    if (part.added || part.removed) {
      output.push(part)
      return
    }
    const before = parts[index - 1]
    const after = parts[index + 1]
    const changeBefore = Boolean(before && (before.added || before.removed))
    const changeAfter = Boolean(after && (after.added || after.removed))
    const head = changeBefore ? limit : 0
    const tail = changeAfter ? limit : 0
    if (!changeBefore && !changeAfter) {
      emitContext(part.value, 0, 0)
      return
    }
    emitContext(part.value, head, tail)
  })

  return output
}

export function toolImages(content: ContentBlock[] | undefined): { data: string; mimeType: string }[] {
  if (!content) return []
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'image' }> => block.type === 'image')
    .map((block) => ({ data: block.data, mimeType: block.mimeType }))
}
