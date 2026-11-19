// Isolated Electron main-process test: no live Pi session or user data.
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const temp = mkdtempSync(join(tmpdir(), 'pi-background-test-'))
const userData = join(temp, 'userData'), agent = join(temp, 'agent'), sessions = join(temp, 'sessions')
for (const dir of [userData, agent, sessions]) mkdirSync(dir, { recursive: true })
const project = join(sessions, '--mock-project--')
mkdirSync(project)
const seed = (id) => {
  const path = join(project, `2026-01-01T00-00-00-000Z_${id}.jsonl`)
  writeFileSync(path, `${JSON.stringify({ type: 'session', id, cwd: root, timestamp: new Date().toISOString() })}\n`)
  return path
}
const a = seed('background-a'), b = seed('background-b')
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ workspaces: [root], lastWorkspace: root }))
let app
try {
  app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: root, env: { ...process.env,
    HOME: temp,
    PI_DESKTOP_PI_PATH: join(root, 'scripts/mock-pi.mjs'), PI_CODING_AGENT_DIR: agent,
    PI_CODING_AGENT_SESSION_DIR: sessions, MOCK_STREAM_INTERVAL: '150' } })
  const page = await app.firstWindow()
  await page.waitForFunction(() => Boolean(window.pi))
  await page.waitForSelector('.composer-input, .welcome', { timeout: 45000 })
  await page.waitForTimeout(1200)
  const call = (method, ...args) => page.evaluate(({ method, args }) => window.pi[method](...args), { method, args })
  assert.equal((await call('openSession', { cwd: root, sessionPath: a })).ok, true)
  assert.equal((await call('command', { type: 'prompt', message: 'local background test' })).success, true)
  await page.waitForTimeout(350)
  assert.equal((await call('command', { type: 'get_state' })).data.isStreaming, true)
  assert.equal((await call('openSession', { cwd: root, sessionPath: b })).ok, true)
  assert.equal((await call('openSession', { cwd: root, sessionPath: a })).ok, true)
  assert.equal((await call('command', { type: 'get_state' })).data.isStreaming, true, 'original process should remain running')
  await page.waitForTimeout(9000)
  const state = (await call('command', { type: 'get_state' })).data
  const messages = (await call('command', { type: 'get_messages' })).data.messages
  assert.equal(state.isStreaming, false)
  assert.ok(messages.some((message) => message.role === 'assistant' && JSON.stringify(message.content).includes('local background test')))
  console.log('PASS isolated Electron: original mock Pi process continues after switching sessions and returns its completed message')
} finally {
  await app?.close()
  rmSync(temp, { recursive: true, force: true })
}
