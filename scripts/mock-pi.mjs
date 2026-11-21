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
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

if (process.argv.includes('--version')) {
  console.log('0.74.0')
  process.exit(0)
}

const scenario = process.env.MOCK_SCENARIO ?? 'default'
const args = process.argv.slice(2)
const sessionFlag = args.indexOf('--session')
let sessionFile = sessionFlag !== -1 ? args[sessionFlag + 1] : null
const cwd = process.cwd()

if (args.includes('rpc') && basename(cwd) === 'scratch' && process.env.MOCK_SCRATCH_START_DELAY) {
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.MOCK_SCRATCH_START_DELAY)))
}

if (args[0] === 'list' && process.env.MOCK_LIST_OUTPUT) {
  process.stdout.write(process.env.MOCK_LIST_OUTPUT)
  process.exit(0)
}
if (args[0] === 'list' && process.env.MOCK_LIST_SOURCE) {
  await new Promise(resolve => setTimeout(resolve, Number(process.env.MOCK_LIST_DELAY_MS || 0)))
  process.stdout.write(`User packages:\n  ${process.env.MOCK_LIST_SOURCE}\n    ${process.env.MOCK_LIST_SOURCE}\n`)
  process.exit(0)
}

if (process.env.MOCK_RPC_ARGS_FILE && args.includes('--mode')) {
  writeFileSync(process.env.MOCK_RPC_ARGS_FILE, JSON.stringify(args))
}
if (process.env.MOCK_RPC_ENV_FILE && args.includes('--mode')) {
  writeFileSync(process.env.MOCK_RPC_ENV_FILE, JSON.stringify({ desktopSettingsFile:process.env.PI_DESKTOP_SETTINGS_FILE, desktopBrowserBridgeFile:process.env.PI_DESKTOP_BROWSER_BRIDGE_FILE }))
}
if (process.env.PI_DESKTOP_TOOL_INFO_FILE && args.includes('--mode')) {
  const guard = args[args.indexOf('--extension') + 1]
  const helperRoot = process.env.MOCK_COMPUTER_USE_ROOT || (guard ? dirname(dirname(guard)) : null)
  writeFileSync(process.env.PI_DESKTOP_TOOL_INFO_FILE, JSON.stringify({helperRoot}))
}

// Headless mode used by scheduled tasks: `pi -p ... "prompt"`.
if (args.includes('-p') || args.includes('--print')) {
  if (process.env.MOCK_SCHEDULE_PROBE_OUTSIDE) {
    try { writeFileSync(process.env.MOCK_SCHEDULE_PROBE_OUTSIDE, 'unexpected'); console.log('outside-write-allowed') }
    catch { console.log('outside-write-denied') }
  }
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

if (scenario === 'multi-providers') {
  MODELS[1].output = ['image']
  MODELS.push({ ...MODELS[0], provider: 'volcengine-ark' })
}

/** Per-model thinking levels (order matters for the UI). */
function levelsFor(next) {
  if (next?.provider === 'volcengine-ark') return ['low', 'high', 'max']
  if (next?.id === 'mock-deep') return ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  return ['off', 'low', 'medium', 'high', 'max']
}
let model = MODELS[0]
let thinkingLevel = 'medium'
let streamingTimer = null
const transcriptSize = Number(process.env.MOCK_TRANSCRIPT ?? 0)
const toolBurst = Number(process.env.MOCK_TOOLS ?? 0)
const now = Date.now()
if (process.env.MOCK_ENV_FILE) { try { writeFileSync(process.env.MOCK_ENV_FILE, JSON.stringify({ jev: process.env.PI_JEV_ENABLED, provider: process.env.PI_JEV_PROVIDER, key: process.env.TYPESAFE_API_KEY, model: process.env.PI_JEV_MODEL, sandbox: process.env.PI_DESKTOP_SANDBOX, proxy: process.env.HTTPS_PROXY, noProxy: process.env.NO_PROXY })) } catch {} }

const sessionRoot = process.env.PI_CODING_AGENT_SESSION_DIR?.trim()

/** Real pi creates the transcript lazily; the desktop app relies on the file existing. */
function createSessionFile(lazy = false) {
  const dir = sessionRoot ? join(sessionRoot, '--mock-project--') : '/tmp'
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `mock-${Date.now()}.jsonl`)
  if (!lazy) writeSessionHeader(file)
  return file
}

function writeSessionHeader(file) {
  writeFileSync(
    file,
    `${JSON.stringify({ type: 'session', id: `mock-${Date.now()}`, cwd, timestamp: new Date().toISOString() })}\n`
  )
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
    durationMs: 4500,
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
if (process.env.MOCK_LOAD_SESSION === '1' && sessionFile) messages = loadSessionMessages(sessionFile)

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
  write({ type: 'agent_start' })
  const message = {
    role: 'assistant',
    timestamp: Date.now(),
    content: [],
    usage: { input: 100, output: 20, totalTokens: 120, cost: { total: 0.001 } }
  }
  write({ type: 'message_start', message })
  const emitUpdate = (assistantMessageEvent) => {
    write({
      type: 'message_update',
      message,
      assistantMessageEvent
    })
  }
  const streamText = () => {
    const block = { type: 'text', text: '' }
    const contentIndex = message.content.push(block) - 1
    let index = 0
    const chunk = 12
    streamingTimer = setInterval(() => {
      const next = text.slice(index, index + chunk)
      index += chunk
      if (!next) {
        clearInterval(streamingTimer)
        streamingTimer = null
        message.durationMs = Date.now() - message.timestamp
        messages.push(message)
        write({ type: 'message_end', message })
        write({ type: 'agent_settled' })
        return
      }
      block.text += next
      emitUpdate({ type: 'text_delta', delta: next, contentIndex })
    }, Number(process.env.MOCK_STREAM_INTERVAL || 25))
  }
  const thinkingMs = Number(process.env.MOCK_THINKING_MS || 0)
  if (!thinkingMs) return streamText()

  emitUpdate({ type: 'thinking_start', contentIndex: 0 })
  const thinking = 'Checking the relevant details.'
  message.content.push({ type: 'thinking', thinking })
  emitUpdate({ type: 'thinking_delta', contentIndex: 0, delta: thinking })
  streamingTimer = setTimeout(() => {
    emitUpdate({ type: 'thinking_end', contentIndex: 0, content: thinking })
    streamText()
  }, thinkingMs)
}

function handle(command) {
  pendingId = command.id ?? null
  const command_ = command.command
  switch (command.type) {
    case 'get_fork_messages':
      return response('get_fork_messages', { messages: [{ entryId: 'entry-1', text: 'first prompt' }, { entryId: 'entry-2', text: 'second prompt' }] })
    case 'get_tree':
      return response('get_tree', {
        tree: [{
          entry: { id: 'entry-1', type: 'message', parentId: null, message: { role: 'user', content: [{ type: 'text', text: 'first prompt' }] } },
          children: [{
            entry: { id: 'entry-2', type: 'message', parentId: 'entry-1', message: { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] } },
            children: [{
              entry: { id: 'entry-3', type: 'message', parentId: 'entry-2', message: { role: 'user', content: [{ type: 'text', text: 'second prompt' }] } },
              children: [{ entry: { id: 'entry-4', type: 'message', parentId: 'entry-3', message: { role: 'assistant', content: [{ type: 'text', text: 'second answer' }] } }, children: [] }]
            }]
          }]
        }],
        leafId: 'entry-4'
      })
    case 'clone': {
      const base = sessionFile ? sessionFile.replace(/\.jsonl$/i, '') : join(cwd, `mock-${Date.now()}`)
      const next = `${base}-clone-${Date.now()}.jsonl`
      mkdirSync(dirname(next), { recursive: true })
      writeFileSync(next, JSON.stringify({ type: 'session', id: 'clone', cwd, timestamp: new Date().toISOString() }) + '\n')
      sessionFile = next
      return response('clone', { cancelled: false })
    }
    case 'fork': {
      const base = sessionFile ? sessionFile.replace(/\.jsonl$/i, '') : join(cwd, `mock-${Date.now()}`)
      const next = `${base}-fork-${Date.now()}.jsonl`
      mkdirSync(dirname(next), { recursive: true })
      writeFileSync(next, JSON.stringify({ type: 'session', id: 'fork', cwd, timestamp: new Date().toISOString() }) + '\n')
      sessionFile = next
      return response('fork', { text: 'first prompt', cancelled: false })
    }
    case 'get_state':
      return response('get_state', state())
    case 'get_messages':
      return response('get_messages', { messages })
    case 'get_session_stats':
      return response('get_session_stats', stats())
    case 'get_available_models':
      return response('get_available_models', { models: MODELS })
    case 'get_available_thinking_levels':
      return response('get_available_thinking_levels', { levels: levelsFor(model) })
    case 'get_commands':
      if (process.env.MOCK_COMMANDS_FAIL === '1') return response('get_commands', undefined, false, 'registry unavailable')
      return response('get_commands', { commands: JSON.parse(process.env.MOCK_COMMANDS_JSON || '[]') })
    case 'set_model': {
      const next = MODELS.find(
        (item) => item.provider === command.provider && item.id === command.modelId
      )
      if (!next) return response('set_model', undefined, false, 'unknown model')
      if (scenario === 'model-switch-fails') {
        return response('set_model', undefined, false, 'mock: model switch rejected')
      }
      model = next
      const levels = levelsFor(model)
      // Model default when the previous level is not supported.
      if (!levels.includes(thinkingLevel)) {
        thinkingLevel = levels.includes('medium') ? 'medium' : levels[0]
        write({ type: 'thinking_level_changed', level: thinkingLevel })
      }
      write({ type: 'model_changed', model })
      return response('set_model', undefined)
    }
    case 'set_thinking_level':
      thinkingLevel = command.level
      write({ type: 'thinking_level_changed', level: thinkingLevel })
      return response('set_thinking_level', undefined)
    case 'prompt': {
      if (args.includes('--no-session') && String(command.message ?? '').startsWith('You extract a schedule for Pi Desktop.')) {
        const input = JSON.parse(String(command.message).split('\n\n').at(-1))
        const output = input.description === '明天提醒我汇总订单' && !input.replies.length
          ? { question: '明天几点提醒你？' }
          : input.description === '明天提醒我汇总订单'
            ? { name: '汇总订单', prompt: '提醒我汇总订单', timezone: input.timezone, cadence: { type: 'after', minutes: 1440 } }
            : input.description === '昨天九点提醒我'
              ? { name: '提醒', prompt: '提醒我', timezone: input.timezone, cadence: { type: 'once', local: '2000-01-01T09:00' } }
              : input.existing
                ? { name: input.existing.name, prompt: input.existing.prompt, timezone: input.timezone, cadence: { type: 'weekly', weekday: 5, time: '18:00' } }
                : { name: 'E2E 界面任务', prompt: 'E2E 界面任务', timezone: input.timezone, cadence: { type: 'weekdays', time: '09:00' } }
        const isolated = ['--no-tools', '--no-extensions', '--no-mcp', '--no-context-files'].every((flag) => args.includes(flag))
        if (!isolated) throw new Error('Schedule interpreter must not load any tools')
        setTimeout(() => write({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: JSON.stringify(output) }] } }), 100)
        return response('prompt', { disposition: 'started' })
      }
      if (!sessionFile && scenario !== 'auth-error') {
        sessionFile = createSessionFile()
      }
      if (sessionFile && process.env.MOCK_LAZY_NEW_SESSION === '1' && !existsSync(sessionFile)) {
        writeSessionHeader(sessionFile)
      }
      if (scenario === 'auth-error') {
        return response('prompt', undefined, false, '401 Unauthorized: invalid api key')
      }
      const text = String(command.message ?? '')
      const sentAt = Date.now()
      messages.push({ role: 'user', timestamp: sentAt, content: [{ type: 'text', text }] })
      if (text === 'local approval test' && process.env.MOCK_BACKGROUND_CONFIRM === '1') {
        setTimeout(() => write({ type: 'extension_ui_request', id: 'fixture-confirm', method: 'confirm', title: `Fixture ${process.pid}`, message: 'Local test only' }), 800)
        return response('prompt', { disposition: 'started' })
      }
      const body = `mock reply ${messages.length}: ${text} ${'— streaming padding '.repeat(30)}`
      const startPrompt = () => {
        write({ type: 'message_start', message: { role: 'user', timestamp: sentAt, content: command.message } })
        write({ type: 'message_end', message: { role: 'user', timestamp: sentAt, content: command.message } })
        setTimeout(() => stream(body), Number(process.env.MOCK_FIRST_RESPONSE_DELAY || 30))
      }
      if (process.env.MOCK_PROMPT_START_DELAY) setTimeout(startPrompt, Number(process.env.MOCK_PROMPT_START_DELAY))
      else startPrompt()
      if (process.env.MOCK_PROMPT_DELAY) {
        return setTimeout(() => response('prompt', { disposition: 'started' }), Number(process.env.MOCK_PROMPT_DELAY))
      }
      return response('prompt', { disposition: 'started' })
    }
    case 'extension_ui_response':
      if (scenario === 'default' && command.id === 'fixture-confirm' && process.env.MOCK_BACKGROUND_CONFIRM === '1') {
        messages.push({ role: 'assistant', content: [{ type: 'text', text: `approval:${String(command.confirmed)}` }] })
      }
      return
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
        sessionFile = createSessionFile(process.env.MOCK_LAZY_NEW_SESSION === '1')
        // E2E transcript fixtures seed `messages`; preserve them across the
        // app's initial new_session handshake. Real pi starts empty here.
        if (transcriptSize === 0) messages = []
      }
      return response(command.type, { sessionFile })
    case 'compact':
      return response('compact', {})
    case 'bash': {
      const command = String(command_ ?? '')
      if (process.env.MOCK_SANDBOX_PROBE === '1') {
        const probe = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' })
        return response('bash', { output: `${probe.stdout ?? ''}${probe.stderr ?? ''}`, exitCode: probe.status ?? 1 })
      }
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
