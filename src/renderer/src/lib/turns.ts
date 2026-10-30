import type {
  AgentMessage,
  AssistantMessage,
  ToolCallBlock,
  ToolResultMessage,
  ToolRun,
  UserMessage
} from '@shared/types'

export interface TurnStats {
  steps: number
  tools: Record<string, number>
  files: string[]
  errors: number
  tokens: number
  cost: number
  thinkingLines: number
  startedAt?: number
  endedAt?: number
}

export interface Turn {
  key: string
  index: number
  user: UserMessage | null
  userText: string
  items: AgentMessage[]
  stats: TurnStats
  streaming: boolean
  finalText: string
  finalMessage?: AssistantMessage
  failed: boolean
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        Boolean(block) && typeof block === 'object' && (block as { type?: string }).type === 'text'
    )
    .map((block) => block.text)
    .join('\n\n')
}

function assistantText(message: AssistantMessage): string {
  return textOf(message.content).trim()
}

function toolCallsOf(message: AssistantMessage): ToolCallBlock[] {
  return (message.content ?? []).filter(
    (block): block is ToolCallBlock => block.type === 'toolCall'
  )
}

function thinkingLinesOf(message: AssistantMessage): number {
  return (message.content ?? []).reduce((total, block) => {
    if (block.type !== 'thinking') return total
    const text = (block as { thinking?: string }).thinking ?? ''
    return total + text.split('\n').filter((line) => line.trim()).length
  }, 0)
}

export function turnKey(user: UserMessage | null, index: number): string {
  const text = user ? textOf(user.content) : ''
  let hash = 0
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0
  return `t${index}-${(hash >>> 0).toString(36)}`
}

/**
 * Groups the flat message stream into turns: one user message plus everything
 * that follows it until the next user message. Tool results and custom entries
 * belong to the turn that produced them.
 */
export function buildTurns(
  messages: AgentMessage[],
  toolRuns: Record<string, ToolRun>,
  results: Record<string, ToolResultMessage>,
  streamingIndex: number
): Turn[] {
  const turns: Turn[] = []
  let current: Turn | null = null

  const start = (user: UserMessage | null, index: number): Turn => {
    const turn: Turn = {
      key: turnKey(user, index),
      index,
      user,
      userText: user ? textOf(user.content) : '',
      items: [],
      stats: {
        steps: 0,
        tools: {},
        files: [],
        errors: 0,
        tokens: 0,
        cost: 0,
        thinkingLines: 0
      },
      streaming: false,
      finalText: '',
      failed: false
    }
    turns.push(turn)
    return turn
  }

  messages.forEach((message) => {
    if (message.role === 'user') {
      current = start(message as UserMessage, turns.length)
      return
    }
    if (!current) current = start(null, turns.length)
    current.items.push(message)
  })

  for (const turn of turns) {
    const files = new Set<string>()
    const tools: Record<string, number> = {}
    const seenCalls = new Set<string>()
    const failedCalls = new Set<string>()
    let started: number | undefined
    let ended: number | undefined

    for (const item of turn.items) {
      if (typeof item.timestamp === 'number') {
        if (started === undefined) started = item.timestamp
        ended = item.timestamp
      }
      if (item.role === 'assistant') {
        const assistant = item as AssistantMessage
        const calls = toolCallsOf(assistant)
        turn.stats.steps += 1 + calls.length
        turn.stats.thinkingLines += thinkingLinesOf(assistant)
        turn.stats.tokens +=
          assistant.usage?.totalTokens ?? (assistant.usage?.input ?? 0) + (assistant.usage?.output ?? 0)
        turn.stats.cost += assistant.usage?.cost?.total ?? 0
        if (assistant.errorMessage) {
          turn.stats.errors += 1
          turn.failed = true
        }
        for (const call of calls) {
          seenCalls.add(call.id)
          tools[call.name] = (tools[call.name] ?? 0) + 1
          const path = (call.arguments as { path?: unknown } | undefined)?.path
          if (typeof path === 'string' && path) files.add(path)
          const run = toolRuns[call.id]
          if (run?.status === 'error') {
            failedCalls.add(call.id)
            turn.failed = true
          }
        }
        // Only the last assistant message can be the final answer. Text that
        // accompanies tool calls is progress, not a completed response.
        turn.finalMessage = assistant
        turn.finalText = calls.length ? '' : assistantText(assistant)
      } else if (item.role === 'toolResult') {
        const result = item as ToolResultMessage
        // A toolResult that already has its call in this turn must not be
        // counted twice (the summary would read `read×10` for five reads).
        if (!seenCalls.has(result.toolCallId)) {
          tools[result.toolName] = (tools[result.toolName] ?? 0) + 1
        }
        if (result.isError) {
          failedCalls.add(result.toolCallId)
          turn.failed = true
        }
        const run = toolRuns[result.toolCallId]
        if (run?.status === 'error') turn.failed = true
      }
    }

    for (const run of Object.values(toolRuns)) {
      const name = run.name
      if (run.status === 'error' && !turn.stats.tools[name]) {
        // A run without a matching message still belongs to the streaming turn.
        if (turn === turns[turns.length - 1]) turn.failed = true
      }
    }

    turn.stats.tools = tools
    turn.stats.errors += failedCalls.size
    turn.stats.files = [...files]
    turn.stats.startedAt = started
    turn.stats.endedAt = ended
    turn.streaming =
      streamingIndex >= 0 &&
      turn === turns[turns.length - 1] &&
      turn.items.some((item, position) => {
        const absolute = messages.indexOf(item)
        return absolute === streamingIndex && position >= 0
      })

    if (turn.streaming) {
      // Live turn: close over runs still in flight so the summary ticks.
      turn.stats.endedAt = Date.now()
      if (Object.values(toolRuns).some((run) => run.status === 'running')) turn.failed = false
    }
  }

  // `results` is only needed for error detection; keep the signature stable.
  void results

  return turns
}

export function summariseTools(tools: Record<string, number>): string {
  return Object.entries(tools)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => (count > 1 ? `${name}×${count}` : name))
    .join(' ')
}

function turnToMarkdown(turn: Turn): string {
  const lines: string[] = []
  if (turn.userText) lines.push(`### 你\n\n${turn.userText}`)
  const tools = summariseTools(turn.stats.tools)
  const meta = [
    turn.stats.steps ? `${turn.stats.steps} 步` : '',
    tools,
    turn.stats.files.length ? `${turn.stats.files.length} 个文件` : '',
    turn.stats.startedAt && turn.stats.endedAt
      ? `${Math.round((turn.stats.endedAt - turn.stats.startedAt) / 1000)}s`
      : ''
  ].filter(Boolean)
  if (meta.length) lines.push(`> 过程：${meta.join(' · ')}`)
  if (turn.finalText) lines.push(`### pi\n\n${turn.finalText}`)
  return lines.join('\n\n')
}

export function turnsToMarkdown(turns: Turn[], title?: string): string {
  const header = title ? `# ${title}\n\n` : ''
  return `${header}${turns.map(turnToMarkdown).filter(Boolean).join('\n\n---\n\n')}\n`
}
