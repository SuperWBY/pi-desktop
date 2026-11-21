import type { AgentMessage, AssistantMessage, ToolCallBlock } from '@shared/types'

export type ProcessStep =
  | { kind: 'message'; item: AgentMessage; index: number }
  | { kind: 'calls'; calls: ToolCallBlock[] }

const workspaceTools = new Set(['read', 'bash', 'grep', 'find', 'ls'])

export function toolGroupKey(name: string): string | null {
  if (name === 'edit' || name === 'write') return null
  return workspaceTools.has(name) ? 'workspace-tools' : name
}

/** Tool-call-only assistant message → the calls it carries, otherwise null. */
function pureCallsOf(item: AgentMessage): ToolCallBlock[] | null {
  if (item.role !== 'assistant') return null
  const assistant = item as AssistantMessage
  if (assistant.errorMessage) return null
  const blocks = assistant.content
  if (!Array.isArray(blocks) || blocks.length === 0) return null
  if (!blocks.every((block) => block?.type === 'toolCall')) return null
  return blocks as ToolCallBlock[]
}

/**
 * Group adjacent workspace actions across messages. Prose, thinking and
 * individual edits stay in their original places.
 */
export function buildProcessSteps(
  items: AgentMessage[],
  rendered: Set<string>
): ProcessStep[] {
  const steps: ProcessStep[] = []
  let run: { key: string; calls: ToolCallBlock[] } | null = null

  const flush = (): void => {
    if (!run) return
    steps.push({ kind: 'calls', calls: run.calls })
    run = null
  }

  items.forEach((item, index) => {
    if (item.role === 'toolResult') {
      const id = (item as { toolCallId?: string }).toolCallId
      // Results whose call is already rendered inside a step need no row.
      if (id && rendered.has(id)) return
      flush()
      steps.push({ kind: 'message', item, index })
      return
    }

    const calls = pureCallsOf(item)
    const key = calls && toolGroupKey(calls[0].name)
    if (calls && key && calls.every((call) => toolGroupKey(call.name) === key)) {
      if (run?.key === key) {
        run.calls.push(...calls)
      } else {
        flush()
        run = { key, calls: [...calls] }
      }
      return
    }

    flush()
    steps.push({ kind: 'message', item, index })
  })

  flush()
  return steps
}
