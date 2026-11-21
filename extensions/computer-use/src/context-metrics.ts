/** Content estimates only; never persist prompt text, tool arguments or file contents. */
export type ContextCategoryId = 'system' | 'rules' | 'tools' | 'mcp' | 'skills' | 'summary' | 'conversation' | 'toolResults' | 'other'
export interface ContextCategory { id: ContextCategoryId; tokens: number }
type Item = Record<string, unknown>
const object = (value: unknown): Item => value && typeof value === 'object' ? value as Item : {}
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const json = (value: unknown): string => value == null ? '' : JSON.stringify(value)
const estimate = (value: string): number => Math.ceil(value.length / 4)

function contentTokens(content: unknown): number {
  if (typeof content === 'string') return estimate(content)
  if (!Array.isArray(content)) return 0
  return content.reduce((sum, raw) => {
    const block = object(raw)
    if (block.type === 'image') return sum + 1200
    return sum + estimate(text(block.text) || text(block.thinking))
  }, 0)
}

/** Replay system patches, then count each visible contribution exactly once. */
export function estimateContextCategories(messages: unknown[]): ContextCategory[] {
  const counts: Record<ContextCategoryId, number> = { system: 0, rules: 0, tools: 0, mcp: 0, skills: 0, summary: 0, conversation: 0, toolResults: 0, other: 0 }
  const sections = new Map<string, string>()
  const tools = new Map<string, Item>()
  const reads = new Map<string, ContextCategoryId>()
  const toolKey = (tool: Item): string => `${text(tool.namespace)}:${text(tool.name)}`
  for (const raw of messages) {
    const message = object(raw)
    if (message.role === 'system') {
      counts.system += contentTokens(message.content)
      for (const [key, value] of Object.entries(object(message.sections))) {
        if (value === null) sections.delete(key)
        else if (typeof value === 'string') sections.set(key, value)
      }
      for (const raw of Array.isArray(message.toolsRemoved) ? message.toolsRemoved : []) tools.delete(toolKey(object(raw)))
      for (const raw of Array.isArray(message.toolsAdded) ? message.toolsAdded : []) {
        const tool = object(raw)
        tools.set(toolKey(tool), tool)
      }
      continue
    }
    if (message.role === 'assistant') {
      counts.conversation += contentTokens(message.content)
      for (const raw of Array.isArray(message.content) ? message.content : []) {
        const block = object(raw)
        if (block.type !== 'toolCall') continue
        counts.toolResults += estimate(text(block.name) + json(block.arguments))
        const args = object(block.arguments)
        const path = text(args.path ?? args.file_path ?? args.file).replace(/\\/g, '/')
        if (!['read', 'read_file'].includes(text(block.name))) continue
        if (/(?:^|\/)SKILL\.md$/i.test(path)) reads.set(text(block.id), 'skills')
        else if (/(?:^|\/)(?:AGENTS|AGENT)\.md$/i.test(path)) reads.set(text(block.id), 'rules')
      }
    } else if (message.role === 'toolResult') {
      counts[reads.get(text(message.toolCallId)) ?? 'toolResults'] += contentTokens(message.content)
    } else if (message.role === 'compactionSummary' || message.role === 'branchSummary') {
      counts.summary += estimate(text(message.summary))
    } else if (message.role === 'bashExecution') {
      if (!message.excludeFromContext) counts.toolResults += estimate(text(message.command) + text(message.output))
    } else {
      counts[message.role === 'user' || message.role === 'custom' ? 'conversation' : 'other'] += contentTokens(message.content)
    }
  }
  for (const [key, value] of sections) counts[key === 'project_context' ? 'rules' : key === 'skills' ? 'skills' : 'system'] += estimate(value)
  for (const tool of tools.values()) {
    const id = /^mcp(?:__|_)/i.test(text(tool.name)) || /^mcp(?:__|_)/i.test(text(tool.namespace)) ? 'mcp' : 'tools'
    counts[id] += estimate(json(tool))
  }
  return Object.entries(counts).filter(([, tokens]) => tokens > 0).map(([id, tokens]) => ({ id: id as ContextCategoryId, tokens }))
}

/** Preserve residual usage; scale estimates only when they exceed the runtime total. */
export function reconcileContextCategories(total: number, categories: ContextCategory[]): { categories: ContextCategory[]; calibrated: boolean } {
  const target = Math.max(0, Math.round(total))
  const valid = categories.filter((row) => Number.isFinite(row.tokens) && row.tokens > 0)
  const sum = valid.reduce((n, row) => n + row.tokens, 0)
  if (sum <= target) {
    const result = valid.map((row) => ({ ...row }))
    const residual = target - sum
    if (residual) {
      const other = result.find((row) => row.id === 'other')
      if (other) other.tokens += residual
      else result.push({ id: 'other', tokens: residual })
    }
    return { categories: result, calibrated: false }
  }
  const scaled = valid.map((row) => ({ ...row, exact: row.tokens / sum * target, tokens: Math.floor(row.tokens / sum * target) }))
  let remaining = target - scaled.reduce((n, row) => n + row.tokens, 0)
  for (const row of [...scaled].sort((a, b) => (b.exact - b.tokens) - (a.exact - a.tokens))) {
    if (remaining-- <= 0) break
    row.tokens++
  }
  return { categories: scaled.filter((row) => row.tokens > 0).map(({ id, tokens }) => ({ id, tokens })), calibrated: true }
}
