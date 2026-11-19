import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const root = resolve(import.meta.dirname, '..')
await mkdir(join(root, 'output'), { recursive: true })
const testDir = await mkdtemp(join(root, 'output', 'session-permissions-'))
const workspace = join(testDir, 'project')
const userData = join(testDir, 'data')
const agent = join(testDir, 'agent')
const sessions = join(testDir, 'sessions')
const outside = join(testDir, 'outside.txt')
const quote = (value) => "'" + value.replaceAll("'", "'\"'\"'") + "'"

const model = createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += chunk
  const { messages } = JSON.parse(body)
  const last = messages.at(-1)
  const prompt = JSON.stringify(last.content)
  const bash = last.role === 'user' && (prompt.includes('检查终端') || prompt.includes('检查风险'))
  const command = prompt.includes('检查风险') ? "printf '%s' sudo" : 'pwd'
  const delta = bash
    ? { role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-command', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command }) } }] }
    : { content: last.role === 'tool' ? '终端检查完成' : '会话保留检查完成' }
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const choice of [{ index: 0, delta, finish_reason: null }, { index: 0, delta: {}, finish_reason: bash ? 'tool_calls' : 'stop' }]) {
    response.write(`data: ${JSON.stringify({ id: 'permissions-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [choice] })}\n\n`)
  }
  response.end('data: [DONE]\n\n')
})
await new Promise((done) => model.listen(0, '127.0.0.1', done))

let app
try {
  await Promise.all([workspace, userData, agent, sessions].map((folder) => mkdir(folder, { recursive: true })))
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    language: 'zh-CN', lastWorkspace: workspace, workspaces: [workspace], autoCheckUpdates: false,
    toolApprovalMode: 'never', sandboxEnabled: false
  }))
  await writeFile(join(agent, 'settings.json'), JSON.stringify({ defaultProvider: 'local', defaultModel: 'fixture' }))
  await writeFile(join(agent, 'models.json'), JSON.stringify({
    providers: { local: { baseUrl: `http://127.0.0.1:${model.address().port}/v1`, api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'fixture' }] } }
  }))
  const executablePath = process.env.PI_PERMISSIONS_APP
  app = await electron.launch({
    cwd: root, executablePath,
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + userData],
    env: {
      ...process.env, HOME: testDir, PI_DESKTOP_PI_PATH: process.env.PI_TEST_PI || join(homedir(), '.pi', 'agent', 'bin', 'pi'),
      PI_CODING_AGENT_DIR: agent, PI_CODING_AGENT_SESSION_DIR: sessions, PI_OFFLINE: '1',
      NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost'
    }
  })
  const page = await app.firstWindow()
  await page.locator('.status-dot.is-ready').waitFor({ timeout: 40_000 })
  const chip = page.getByRole('button', { name: '当前会话权限', exact: true })
  const composer = page.locator('.composer-input')
  const hasMode = async (mode) => {
    try { await chip.getByText(mode, { exact: true }).waitFor({ timeout: 10_000 }) }
    catch (error) {
      const snapshot = await state()
      const notice = await page.locator('.toast').allTextContents()
      throw new Error(`Expected ${mode}. ${JSON.stringify({ mode: await chip.innerText(), sessionFile: snapshot?.sessionFile, notice })}`, { cause: error })
    }
  }
  const choose = async (mode) => {
    await chip.click()
    await page.locator('.popover').getByText(mode, { exact: true }).click()
  }
  const prompt = async (text) => {
    await composer.fill(text)
    await composer.press('Enter')
  }
  const state = async () => (await page.evaluate(() => window.pi.command({ type: 'get_state' }))).data
  const security = (path) => page.evaluate((value) => window.pi.sessionSecurity(value), path)
  const waitForIdle = () => page.waitForFunction(async () => {
    const { data } = await window.pi.command({ type: 'get_state' })
    return data && !data.isStreaming && !data.isCompacting
  })

  await hasMode('自动审核')
  const blank = await state()
  assert.equal(blank.sessionFile && existsSync(blank.sessionFile), false, 'the empty conversation reserves a path before creating its file')
  await assert.rejects(page.evaluate((input) => window.pi.setSessionPermission(input),
    { cwd: workspace, sessionPath: blank.sessionFile ?? null, permission: 'full' }), /请先在设置中/)
  await choose('询问审批')
  await hasMode('询问审批')
  await prompt('检查终端')
  await page.getByText('确认执行工具', { exact: true }).waitFor()
  const duringApproval = await state()
  await assert.rejects(page.evaluate((input) => window.pi.setSessionPermission(input),
    { cwd: workspace, sessionPath: duringApproval.sessionFile ?? null, permission: 'review' }), /结束后再切换/)
  await page.locator('.confirm-actions .ghost').click()
  await page.getByText('终端检查完成', { exact: true }).first().waitFor()
  await waitForIdle()

  await choose('自动审核')
  await hasMode('自动审核')
  await prompt('检查风险')
  await page.getByText('确认执行危险命令', { exact: true }).waitFor()
  await page.locator('.confirm-actions .ghost').click()
  await page.getByText('终端检查完成', { exact: true }).nth(1).waitFor()
  await waitForIdle()
  const sessionPath = (await state()).sessionFile
  assert.ok(sessionPath, 'the conversation is saved before its runtime is replaced')

  await composer.fill('切换权限后应保留的草稿')
  await page.evaluate(() => window.pi.updateSettings({ sandboxEnabled: true, sandboxNetwork: 'off', sandboxMode: 'workspace-write' }))
  await choose('询问审批')
  await hasMode('询问审批')
  assert.equal((await state()).sessionFile, sessionPath)
  assert.equal(await composer.inputValue(), '切换权限后应保留的草稿')
  assert.equal(await page.getByText('终端检查完成', { exact: true }).count(), 2)
  assert.deepEqual(await security(sessionPath), { permission: 'ask', mode: 'all', sandboxed: true, files: 'workspace-write', network: 'off' })

  const bash = (command) => page.evaluate((value) => window.pi.command({ type: 'bash', command: value, excludeFromContext: true }), command)
  const projectFile = join(workspace, 'inside.txt')
  await bash(`touch ${quote(projectFile)}`)
  assert.ok(existsSync(projectFile), 'sandbox allows writing to the project')
  await bash(`touch ${quote(outside)}`)
  assert.equal(existsSync(outside), false, 'sandbox blocks writing outside the project')

  await chip.click()
  await page.getByText('项目可写 · 网络已关闭', { exact: true }).waitFor()
  assert.equal(await page.locator('.popover').getByText('完全访问', { exact: true }).isVisible(), false)
  await page.getByText('在设置中启用完全访问', { exact: true }).click()
  await page.getByRole('switch', { name: '允许使用完全访问' }).click()
  await page.getByRole('button', { name: '返回对话', exact: true }).click()
  await choose('完全访问')
  await page.getByText('为当前会话启用完全访问？', { exact: true }).waitFor()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await hasMode('询问审批')
  await choose('完全访问')
  await page.getByRole('button', { name: '启用完全访问', exact: true }).click()
  await hasMode('完全访问')
  assert.deepEqual(await security(sessionPath), { permission: 'full', mode: 'never', sandboxed: false })
  await bash(`touch ${quote(outside)}`)
  assert.ok(existsSync(outside), 'full access bypasses the Pi sandbox for this conversation')

  await choose('自动审核')
  await hasMode('自动审核')
  assert.equal((await security(sessionPath)).sandboxed, true, 'leaving full access restores the configured sandbox')
  await rm(outside)
  await bash(`touch ${quote(outside)}`)
  assert.equal(existsSync(outside), false)

  await choose('完全访问')
  await page.getByRole('button', { name: '启用完全访问', exact: true }).click()
  await hasMode('完全访问')
  const next = await page.evaluate((cwd) => window.pi.openSession({ cwd, permission: 'full' }), workspace)
  assert.ok(next.ok, next.error)
  assert.deepEqual(await security(next.sessionPath), { permission: 'review', mode: 'dangerous', sandboxed: true, files: 'workspace-write', network: 'off' })
  assert.equal(await security(sessionPath), null)
  console.log('PASS session permissions: tool prompts, setting gate, same-session history and draft, sandbox enforcement, and safe new-session defaults')
} finally {
  await app?.close()
  model.closeAllConnections()
  await new Promise((done) => model.close(done))
  await rm(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
