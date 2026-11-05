import { diffLines } from 'diff'
import type { ContentBlock } from '@shared/types'

export type ToolKind = 'bash' | 'read' | 'write' | 'edit' | 'tool'

export interface ToolMeta {
  kind: ToolKind
  title: string
  subtitle: string
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

export function toolPhrases(name: string): ToolPhrases {
  switch (name) {
    case 'bash':
      return { running: '正在运行', done: '已运行', failed: '运行失败', group: '运行了 {count} 条命令' }
    case 'read':
      return { running: '正在读取', done: '已读取', failed: '读取失败', group: '读取了 {count} 个文件' }
    case 'write':
      return { running: '正在写入', done: '已写入', failed: '写入失败', group: '写入了 {count} 个文件' }
    case 'edit':
      return { running: '正在编辑', done: '已编辑', failed: '编辑失败', group: '编辑了 {count} 个文件' }
    default:
      return { running: '正在调用', done: '已调用', failed: '调用失败', group: '调用了 {count} 次 {name}' }
  }
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

export function toolMeta(name: string, args: Record<string, unknown>): ToolMeta {
  const path = typeof args.path === 'string' ? args.path : ''
  const fileName = path.split('/').filter(Boolean).pop() ?? path

  switch (name) {
    case 'bash': {
      const command = typeof args.command === 'string' ? args.command : ''
      return { kind: 'bash', title: 'Bash', subtitle: command.replace(/\s+/g, ' ').trim() }
    }
    case 'read': {
      const range: string[] = []
      if (typeof args.offset === 'number') range.push(`from ${args.offset}`)
      if (typeof args.limit === 'number') range.push(`${args.limit} lines`)
      return {
        kind: 'read',
        title: 'Read',
        subtitle: fileName + (range.length ? ` · ${range.join(', ')}` : '')
      }
    }
    case 'write':
      return { kind: 'write', title: 'Write', subtitle: fileName }
    case 'edit': {
      const count = editPairs(args).length
      return {
        kind: 'edit',
        title: 'Edit',
        subtitle: fileName + (count > 1 ? ` · ${count} changes` : '')
      }
    }
    default:
      return { kind: 'tool', title: name, subtitle: '' }
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
