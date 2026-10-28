import { diffLines } from 'diff'
import type { ContentBlock } from '@shared/types'

export type ToolKind = 'bash' | 'read' | 'write' | 'edit' | 'tool'

export interface ToolMeta {
  kind: ToolKind
  title: string
  subtitle: string
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
  let pending: string[] = []

  const flush = (): void => {
    if (!pending.length) return
    if (pending.length > context * 2 + 1) {
      output.push({ value: pending.slice(0, context).join('') })
      output.push({ value: `… ${pending.length - context * 2} unchanged lines …\n` })
      output.push({ value: pending.slice(-context).join('') })
    } else {
      output.push({ value: pending.join('') })
    }
    pending = []
  }

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part.added || part.removed) {
      flush()
      output.push(part)
      continue
    }

    const before = parts[index - 1]
    const after = parts[index + 1]
    const nearChange = Boolean(before && (before.added || before.removed)) ||
      Boolean(after && (after.added || after.removed))

    if (nearChange) {
      flush()
      output.push(part)
    } else {
      pending.push(part.value)
    }
  }

  flush()
  return output
}

export function toolImages(content: ContentBlock[] | undefined): { data: string; mimeType: string }[] {
  if (!content) return []
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'image' }> => block.type === 'image')
    .map((block) => ({ data: block.data, mimeType: block.mimeType }))
}
