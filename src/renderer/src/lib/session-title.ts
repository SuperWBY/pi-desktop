import { contentText } from './tools'
import { truncate } from './format'

const UNTITLED = new Set(['未命名会话', 'Untitled chat', 'Untitled'])

/** Same title the top bar shows: renamed name, else shortened first user message. */
export function sessionDisplayTitle(input: {
  sessionName?: string | null
  messages?: Array<{ role?: string; content?: unknown }>
  emptyLabel?: string
  maxLength?: number
}): string {
  const named = input.sessionName?.trim()
  if (named && !UNTITLED.has(named)) return named
  const firstUser = input.messages?.find((message) => message.role === 'user')
  if (firstUser) {
    const text = contentText((firstUser as { content?: unknown }).content).replace(/\s+/g, ' ').trim()
    if (text) return truncate(text, input.maxLength ?? 56)
  }
  return input.emptyLabel ?? 'Pi'
}
