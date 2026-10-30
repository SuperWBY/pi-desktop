import { diffLines } from 'diff'
import type { AssistantMessage, ToolCallBlock, ToolResultMessage, ToolRun } from '@shared/types'
import { editPairs } from './tools'
import type { Turn } from './turns'

export interface FileChange {
  path: string
  relative: string
  additions: number
  deletions: number
  unmeasuredWrite: boolean
  turnKeys: string[]
  calls: {
    id: string
    name: string
    oldText: string
    newText: string
  }[]
}

function countLines(text: string): number {
  return text ? text.replace(/\n$/, '').split('\n').length : 0
}

export function collectSessionChanges(turns: Turn[], runs: Record<string, ToolRun>, workspace: string): FileChange[] {
  const files = new Map<string, FileChange>()
  for (const turn of turns) {
    const results = new Map(turn.items.filter((item): item is ToolResultMessage => item.role === 'toolResult').map((item) => [item.toolCallId, item]))
    for (const item of turn.items) {
      if (item.role !== 'assistant') continue
      for (const block of (item as AssistantMessage).content ?? []) {
        if (block.type !== 'toolCall') continue
        const call = block as ToolCallBlock
        if (call.name !== 'edit' && call.name !== 'write') continue
        const result = results.get(call.id)
        const run = runs[call.id]
        // A request is not evidence of a change: only show completed writes.
        if (result?.isError || run?.status === 'error' || (!result && run?.status !== 'done')) continue
        const requestedPath = String((call.arguments as { path?: unknown })?.path ?? '')
        if (!requestedPath) continue
        const path = requestedPath.startsWith('/') ? requestedPath : `${workspace.replace(/\/$/, '')}/${requestedPath}`
        const relative = path.startsWith(`${workspace}/`) ? path.slice(workspace.length + 1) : requestedPath
        const entry =
          files.get(path) ??
          ({
            path,
            relative,
            additions: 0,
            deletions: 0,
            unmeasuredWrite: false,
            turnKeys: [],
            calls: []
          } satisfies FileChange)
        if (!entry.turnKeys.includes(turn.key)) entry.turnKeys.push(turn.key)
        if (call.name === 'edit') {
          for (const pair of editPairs(call.arguments)) {
            for (const part of diffLines(pair.oldText, pair.newText)) {
              if (part.added) entry.additions += countLines(part.value)
              if (part.removed) entry.deletions += countLines(part.value)
            }
            entry.calls.push({ id: call.id, name: 'edit', oldText: pair.oldText, newText: pair.newText })
          }
        } else {
          const content = String((call.arguments as { content?: unknown })?.content ?? '')
          entry.unmeasuredWrite = true
          entry.calls.push({ id: call.id, name: 'write', oldText: '', newText: content })
        }
        files.set(path, entry)
      }
    }
  }
  return [...files.values()].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
}
