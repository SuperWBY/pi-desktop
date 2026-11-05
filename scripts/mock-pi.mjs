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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const scenario = process.env.MOCK_SCENARIO ?? 'default'
const args = process.argv.slice(2)
const sessionFlag = args.indexOf('--session')
let sessionFile = sessionFlag !== -1 ? args[sessionFlag + 1] : null
const cwd = process.cwd()

if (process.env.MOCK_RPC_ARGS_FILE && args.includes('--mode')) {
  writeFileSync(process.env.MOCK_RPC_ARGS_FILE, JSON.stringify(args))
}

// Headless mode used by scheduled tasks: `pi -p ... "prompt"`.
if (args.includes('-p') || args.includes('--print')) {
  const dirFlag = args.indexOf('--session-dir')
  const idFlag = args.indexOf('--session-id')
  const sessionDir = dirFlag !== -1 ? args[dirFlag + 1] : cwd
  const sessionId = idFlag !== -1 ? args[idFlag + 1] : `mock-${Date.now()}`
  const prompt = args[args.length - 1] ?? ''
  if (process.env.MOCK_ARGS_FILE) {
    writeFileSync(process.env.MOCK_ARGS_FILE, JSON.stringify(args))
  }
  if (process.env.MOCK_SCHEDULE_DELAY) {
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.MOCK_SCHEDULE_DELAY)))
  }
  if (process.env.MOCK_SCHEDULE_FAIL === '1') {
    console.error('mock scheduled task failed')
    process.exit(1)
  }
  const priorFlag = args.indexOf('--session')
  const priorPath = priorFlag !== -1 ? args[priorFlag + 1] : null
  if (priorPath && existsSync(priorPath)) {
    const timestamp = new Date().toISOString()
    const lines = [
      {
        type: 'message',
        timestamp,
        message: { role: 'user', content: [{ type: 'text', text: prompt }] }
      },
      {
        type: 'message',
        timestamp,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'mock scheduled answer (continued)' }],
          usage: { input: 1, output: 2, totalTokens: 3, cost: { total: 0 } }
        }
      }
    ]
    writeFileSync(priorPath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n', { flag: 'a' })
    console.log(`mock scheduled answer continued ${priorPath}`)
    process.exit(0)
  }
  mkdirSync(sessionDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(sessionDir, `${stamp}_${sessionId}.jsonl`)
  const timestamp = new Date().toISOString()
  const lines = [
    { type: 'session', id: sessionId, cwd, timestamp },
    { type: 'session_info', name: `Scheduled ${sessionId}` },
    {
      type: 'message',
      timestamp,
      message: { role: 'user', content: [{ type: 'text', text: prompt }] }
    },
    {
      type: 'message',
      timestamp,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'mock scheduled answer' }],
        usage: { input: 1, output: 2, totalTokens: 3, cost: { total: 0 } }
      }
    }
  ]
  writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  console.log(`mock scheduled answer for ${sessionId}`)
  process.exit(0)
}

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
const transcriptSize = Number(process.env.MOCK_TRANSCRIPT ?? 0)
const toolBurst = Number(process.env.MOCK_TOOLS ?? 0)
const now = Date.now()

const sessionRoot = process.env.PI_CODING_AGENT_SESSION_DIR?.trim()

/** Real pi creates the transcript lazily; the desktop app relies on the file existing. */
function createSessionFile() {
  const dir = sessionRoot ? join(sessionRoot, '--mock-project--') : '/tmp'
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `mock-${Date.now()}.jsonl`)
  writeFileSync(
    file,
    `${JSON.stringify({ type: 'session', id: `mock-${Date.now()}`, cwd, timestamp: new Date().toISOString() })}\n`
  )
  return file
}

function loadSessionMessages(file) {
  const out = []
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      const entry = JSON.parse(line)
      if (entry.type === 'message' && entry.message) out.push(entry.message)
    }
  } catch {
    // missing or malformed file: behave like an empty session
  }
  return out
}

const editDemo = process.env.MOCK_EDIT === '1'
/** Real pi sends one assistant message per tool call; mirror that on demand. */
const splitTools = process.env.MOCK_SPLIT_TOOLS === '1'

function seededTurn(i) {
  const burst = toolBurst
    ? Array.from({ length: i === transcriptSize - 1 ? Math.max(toolBurst, 5) : toolBurst }, (_, k) => ({
        type: 'toolCall',
        id: `call-${i}-${k}`,
        name: 'read',
        arguments: { path: `src/module-${i}-${k}.ts` }
      }))
    : []
  const calls = splitTools
    ? burst.map((call, k) => ({
        ...call,
        name: 'bash',
        arguments: { command: `git log --oneline -${k + 1} && ls src` }
      }))
    : burst

  if (editDemo) {
    const oldLines = Array.from({ length: 40 }, (_, n) => `line ${n + 1}`)
    const newLines = [...oldLines]
    newLines[2] = 'line 3 (changed)'
    newLines[30] = 'line 31 (changed)'
    calls.push({
      type: 'toolCall',
      id: `call-edit-${i}`,
      name: 'edit',
      arguments: {
        path: `src/edited-${i}.ts`,
        edits: [{ oldText: oldLines.join('\n'), newText: newLines.join('\n') }]
      }
    })
  }

  const base = now - (transcriptSize - i) * 60_000
  const user = {
    role: 'user',
    timestamp: base,
    content: [{ type: 'text', text: `seeded question ${i}` }]
  }
  const results = calls.map((call) => ({
    role: 'toolResult',
    toolCallId: call.id,
    toolName: call.name,
    timestamp: base + 1200,
    content: [
      {
        type: 'text',
        text: Array.from(
          { length: 60 },
          (_, n) => `line ${n + 1} of ${call.arguments.path ?? call.arguments.command}`
        ).join('\n')
      }
    ]
  }))
  const usage = { input: 80, output: 40, totalTokens: 120, cost: { total: 0.0001 } }
  const answer = {
    role: 'assistant',
    timestamp: base + 2000,
    content: [{ type: 'text', text: `seeded answer ${i}: ${'lorem ipsum dolor sit amet '.repeat(14)}` }],
    usage: { input: 100, output: 200, totalTokens: 300, cost: { total: 0.0002 } }
  }

  if (splitTools) {
    return [
      user,
      ...calls.flatMap((call, k) => [
        { role: 'assistant', timestamp: base + 1000 + k * 10, content: [call], usage },
        results[k]
      ]),
      answer
    ]
  }

  const parts = [
    user,
    {
      role: 'assistant',
      timestamp: base + 1000,
      content: [{ type: 'text', text: `looking at module ${i}` }, ...calls],
      usage
    },
    ...results,
    answer
  ]
  return parts
}

let messages = Array.from({ length: transcriptSize }, (_, i) => seededTurn(i)).flat()

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
  const command_ = command.command
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
        sessionFile = createSessionFile()
      }
      if (scenario === 'auth-error') {
        return response('prompt', undefined, false, '401 Unauthorized: invalid api key')
      }
      const text = String(command.message ?? '')
      messages.push({ role: 'user', content: [{ type: 'text', text }] })
      write({ type: 'message_start', message: { role: 'user', content: command.message } })
      write({ type: 'message_end', message: { role: 'user', content: command.message } })
      const body = `mock reply ${messages.length}: ${text} ${'— streaming padding '.repeat(30)}`
      setTimeout(() => stream(body), 30)
      if (process.env.MOCK_PROMPT_DELAY) {
        return setTimeout(() => response('prompt', { disposition: 'started' }), Number(process.env.MOCK_PROMPT_DELAY))
      }
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
      if (command.type === 'switch_session' && typeof command.sessionPath === 'string') {
        sessionFile = command.sessionPath
        messages = loadSessionMessages(sessionFile)
      } else {
        sessionFile = createSessionFile()
        messages = []
      }
      return response(command.type, { sessionFile })
    case 'compact':
      return response('compact', {})
    case 'bash': {
      const command = String(command_ ?? '')
      const lines = [
        `$ ${command}`,
        'mock-pi: simulated output',
        'line 3',
        'line 4',
        'done'
      ]
      for (const line of lines) {
        write({ type: 'bash_execution_update', id: pendingId, delta: `${line}\n` })
      }
      return response('bash', { output: `${lines.join('\n')}\n`, exitCode: 0, cancelled: false, truncated: false })
    }
    default:
      return response(command.type, {})
  }
}

if (scenario === 'auth-error') {
  process.stderr.write('mock-pi: no credentials for provider "mock"\n')
}
const bulk = Number(process.env.MOCK_BULK ?? (scenario === 'catalog-huge' ? 300 : 0))
if (bulk > 0) {
  for (let i = 0; i < bulk; i++) {
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
