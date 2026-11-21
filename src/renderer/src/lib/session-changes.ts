import type { AssistantMessage, ToolCallBlock, ToolResultMessage, ToolRun } from '@shared/types'
import { editChange, type EditPatch } from './edit-change'
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
    patch?: EditPatch
  }[]
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
        const path = requestedPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(requestedPath) ? requestedPath : `${workspace.replace(/\/$/, '')}/${requestedPath}`
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
          const edit = editChange(call.arguments, run?.resultDetails ?? result?.details)
          entry.additions += edit.additions
          entry.deletions += edit.deletions
          if (edit.patch) entry.calls.push({ id: call.id, name: 'edit', oldText: '', newText: '', patch: edit.patch })
          for (const pair of edit.pairs) {
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
