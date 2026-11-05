import type { AgentMessage, AssistantMessage, ToolCallBlock } from '@shared/types'

/**
 * A turn's process rendered as a flat list of steps. pi emits one assistant
 * message per tool call, so six `bash` calls in a row arrive as six separate
 * messages with a model header each. Rendering them message-by-message paints
 * a very long execution chain; collapsing same-name neighbours into one step
 * keeps the density Codex / Claude Code have.
 */
export type ProcessStep =
  | { kind: 'message'; item: AgentMessage; index: number }
  | { kind: 'calls'; name: string; calls: ToolCallBlock[] }

/** Diffs stay one-per-card: merging them would hide what actually changed. */
const KEEP_SINGLE = new Set(['edit', 'write'])

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
 * Collapse a turn into steps. Runs of same-name tool calls merge across
 * messages (and across the tool results between them); anything that carries
 * text, thinking or a diff flushes the run.
 */
export function buildProcessSteps(
  items: AgentMessage[],
  rendered: Set<string>
): ProcessStep[] {
  const steps: ProcessStep[] = []
  let run: { name: string; calls: ToolCallBlock[] } | null = null

  const flush = (): void => {
    if (!run) return
    steps.push({ kind: 'calls', name: run.name, calls: run.calls })
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
    const name = calls?.[0]?.name
    if (calls && name && !KEEP_SINGLE.has(name) && calls.every((call) => call.name === name)) {
      if (run && run.name === name) {
        run.calls.push(...calls)
      } else {
        flush()
        run = { name, calls: [...calls] }
      }
      return
    }

    flush()
    steps.push({ kind: 'message', item, index })
  })

  flush()
  return steps
}
