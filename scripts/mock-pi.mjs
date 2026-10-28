#!/usr/bin/env node
/**
 * Stand-in for `pi --mode rpc`, used by the e2e checks.
 *
 *   PI_DESKTOP_PI_PATH=./scripts/mock-pi.mjs MOCK_SCENARIO=auth-error npm run dev
 *
 * It speaks the same JSONL protocol, so the UI can be exercised without a real
 * pi install, credentials, or token spend (and on CI).
 */
import { createInterface } from 'node:readline'

const scenario = process.env.MOCK_SCENARIO ?? 'default'
const args = process.argv.slice(2)
const sessionFlag = args.indexOf('--session')
let sessionFile = sessionFlag !== -1 ? args[sessionFlag + 1] : null
const cwd = process.cwd()

const MODELS = [
  {
    id: 'mock-fast',
    name: 'Mock Fast',
    provider: 'mock',
    api: 'openai-completions',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 200000,
    maxTokens: 32000
  },
  {
    id: 'mock-deep',
    name: 'Mock Deep',
    provider: 'mock',
    api: 'openai-completions',
    reasoning: true,
    input: ['text'],
    contextWindow: 1000000,
    maxTokens: 64000
  }
]

const LEVELS = ['off', 'low', 'medium', 'high', 'max']
let model = MODELS[0]
let thinkingLevel = 'medium'
let streamingTimer = null
let messages = []

function write(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`)
}

function response(command, data, success = true, error) {
  const out = { type: 'response', command, success }
  if (data !== undefined) out.data = data
  if (error) out.error = error
  const id = pendingId
  if (id) out.id = id
  pendingId = null
  write(out)
}

let pendingId = null

function state() {
  return {
    model,
    thinkingLevel,
    isStreaming: Boolean(streamingTimer),
    isCompacting: false,
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    sessionFile,
    sessionName: null,
    messageCount: messages.length
  }
}

function stats() {
  return {
    sessionFile,
    userMessages: messages.filter((m) => m.role === 'user').length,
    assistantMessages: messages.filter((m) => m.role === 'assistant').length,
    toolCalls: 0,
    contextUsage: { tokens: 1200, percent: 3, contextWindow: model.contextWindow }
  }
}

function stream(text) {
  const message = {
    role: 'assistant',
    content: [{ type: 'text', text: '' }],
    usage: { input: 100, output: 20, totalTokens: 120, cost: { total: 0.001 } }
  }
  write({ type: 'message_start', message: { role: 'assistant', content: [] } })
  let index = 0
  const chunk = 12
  streamingTimer = setInterval(() => {
    const next = text.slice(index, index + chunk)
    index += chunk
    if (!next) {
      clearInterval(streamingTimer)
      streamingTimer = null
      message.content[0].text = text
      messages.push(message)
      write({ type: 'message_end', message })
      write({ type: 'agent_settled' })
      return
    }
    message.content[0].text += next
    write({
      type: 'message_update',
      message,
      assistantMessageEvent: { type: 'text_delta', delta: next, contentIndex: 0 }
    })
  }, 25)
}

function handle(command) {
  pendingId = command.id ?? null
  switch (command.type) {
    case 'get_state':
      return response('get_state', state())
    case 'get_messages':
      return response('get_messages', { messages })
    case 'get_session_stats':
      return response('get_session_stats', stats())
    case 'get_available_models':
      return response('get_available_models', { models: MODELS })
    case 'get_available_thinking_levels':
      return response('get_available_thinking_levels', { levels: LEVELS })
    case 'get_commands':
      return response('get_commands', { commands: [] })
    case 'set_model': {
      const next = MODELS.find(
        (item) => item.provider === command.provider && item.id === command.modelId
      )
      if (!next) return response('set_model', undefined, false, 'unknown model')
      if (scenario === 'model-switch-fails') {
        return response('set_model', undefined, false, 'mock: model switch rejected')
      }
      model = next
      write({ type: 'model_changed', model })
      return response('set_model', undefined)
    }
    case 'set_thinking_level':
      thinkingLevel = command.level
      write({ type: 'thinking_level_changed', level: thinkingLevel })
      return response('set_thinking_level', undefined)
    case 'prompt': {
      if (!sessionFile && scenario !== 'auth-error') {
        sessionFile = `/tmp/mock-session-${Date.now()}.jsonl`
      }
      if (scenario === 'auth-error') {
        return response('prompt', undefined, false, '401 Unauthorized: invalid api key')
      }
      const text = String(command.message ?? '')
      messages.push({ role: 'user', content: [{ type: 'text', text }] })
      write({ type: 'message_start', message: { role: 'user', content: command.message } })
      write({ type: 'message_end', message: { role: 'user', content: command.message } })
      setTimeout(() => stream(`mock reply ${messages.length}: ${text}`), 30)
      return response('prompt', { disposition: 'started' })
    }
    case 'abort':
      if (streamingTimer) {
        clearInterval(streamingTimer)
        streamingTimer = null
      }
      return response('abort', { steering: [], followUp: [] })
    case 'new_session':
    case 'switch_session':
      sessionFile = `/tmp/mock-session-${Date.now()}.jsonl`
      messages = []
      return response(command.type, { sessionFile })
    case 'compact':
      return response('compact', {})
    default:
      return response(command.type, {})
  }
}

if (scenario === 'auth-error') {
  process.stderr.write('mock-pi: no credentials for provider "mock"\n')
}
if (scenario === 'catalog-huge') {
  for (let i = 0; i < 300; i++) {
    MODELS.push({
      id: `mock-bulk-${i}`,
      name: `Mock Bulk ${i}`,
      provider: 'mock',
      contextWindow: 128000,
      maxTokens: 8000
    })
  }
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line.trim()) return
  let command
  try {
    command = JSON.parse(line)
  } catch {
    return
  }
  handle(command)
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
