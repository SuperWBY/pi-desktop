import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const temp = await mkdtemp(join(tmpdir(), 'pi-desktop-mcp-test-'))
const agent = join(temp, 'agent')
const data = join(temp, 'desktop')
const sampleToken = 'Bearer fixture-token'
const toolName = 'mcp__demo_bi__lookup_sales'
const preserved = { enabled: false, url: 'https://example.com/mcp', description: 'Existing entry', headers: { 'X-Test': 'unrelated' } }
let toolCalls = 0
let toolAdvertised = false
let resultReceived = false

const server = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  if (req.url === '/mcp' && req.method === 'POST') {
    if (req.headers.authorization !== sampleToken) {
      res.writeHead(401)
      res.end()
      return
    }
    const request = JSON.parse(body)
    if (request.id === undefined) {
      res.writeHead(202)
      res.end()
      return
    }
    let result
    if (request.method === 'initialize') {
      result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'demo-bi', version: '1.0' } }
    } else if (request.method === 'tools/list') {
      result = { tools: [{ name: 'lookup_sales', description: 'Look up fixture sales.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] }
    } else if (request.method === 'tools/call') {
      assert.equal(request.params.name, 'lookup_sales')
      toolCalls += 1
      result = { content: [{ type: 'text', text: 'Sales total: 123' }] }
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }))
    return
  }
  if (req.url === '/v1/chat/completions') {
    const request = JSON.parse(body)
    toolAdvertised ||= request.tools?.some((tool) => tool.function?.name === toolName) ?? false
    const isToolResult = request.messages.at(-1)?.role === 'tool'
    const contents = JSON.stringify(request.messages)
    if (isToolResult) resultReceived = contents.includes('Sales total: 123')
    const delta = isToolResult
      ? { content: 'Demo sales returned.' }
      : { role: 'assistant', tool_calls: [{ index: 0, id: 'fixture_mcp', type: 'function', function: { name: toolName, arguments: '{}' } }] }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const choice of [{ index: 0, delta, finish_reason: null }, { index: 0, delta: {}, finish_reason: isToolResult ? 'stop' : 'tool_calls' }]) {
      res.write(`data: ${JSON.stringify({ id: 'fixture-model', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [choice] })}\n\n`)
    }
    res.end('data: [DONE]\n\n')
    return
  }
  res.writeHead(404)
  res.end()
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
let app
try {
  await mkdir(join(agent, 'skills', 'chatcut-auto-screen-recorder'), { recursive: true })
  await mkdir(data)
  await writeFile(join(agent, 'skills', 'chatcut-auto-screen-recorder', 'SKILL.md'), '---\nname: chatcut-auto-screen-recorder\ndescription: Record a demo.\nrequires:\n  bins: [git, lark-cli]\n---\n# Recording\n')
  await writeFile(join(data, 'settings.json'), JSON.stringify({ language: 'zh-CN', lastWorkspace: temp, workspaces: [temp], autoCheckUpdates: false }))
  await writeFile(join(agent, 'settings.json'), JSON.stringify({ defaultProvider: 'local', defaultModel: 'fixture' }))
  await writeFile(join(agent, 'models.json'), JSON.stringify({ providers: { local: { baseUrl: `${origin}/v1`, api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'fixture' }] } } }))
  const configFile = join(agent, 'mcp.json')
  const localServer = join(temp, 'local-mcp.cjs')
  const localStarts = join(temp, 'local-starts')
  await writeFile(localServer, `require('node:fs').appendFileSync(${JSON.stringify(localStarts)}, 'start\\n');
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  const result = msg.method === 'initialize'
    ? { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'local-fixture', version: '1' } }
    : msg.method === 'tools/list' ? { tools: [] } : {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
});`)
  const local = { command: process.execPath, args: [localServer], exposure: 'direct' }
  const broken = { command: process.execPath, args: ['-e', 'process.exit(1)'], exposure: 'direct' }
  await writeFile(configFile, JSON.stringify({ autoEnableCodemode: false, mcpServers: { other: preserved, local, broken } }))
  const executablePath = process.env.PI_CONNECTORS_APP
  app = await electron.launch({
    cwd: root, executablePath,
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + data],
    env: {
      ...process.env, HOME: temp, PI_DESKTOP_PI_PATH: process.env.PI_TEST_PI || join(homedir(), '.pi', 'agent', 'bin', 'pi'),
      PI_CODING_AGENT_DIR: agent, PI_CODING_AGENT_SESSION_DIR: join(temp, 'sessions'), PI_OFFLINE: '1',
      NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost'
    }
  })
  const page = await app.firstWindow()
  await page.locator('.status-dot.is-ready').waitFor({ timeout: 40_000 })
  await page.getByText('技能与工具', { exact: true }).click()
  await page.getByText('录制产品演示', { exact: true }).waitFor()
  await page.getByRole('button', { name: '应用连接', exact: true }).click()
  await page.getByText('飞书', { exact: true }).waitFor()
  await page.getByText('本机依赖', { exact: false }).waitFor()
  const localRow = page.locator('.connection-row').filter({ has: page.getByText('local', { exact: true }) })
  await localRow.getByText('已安装', { exact: true }).waitFor({ timeout: 30000 })
  const brokenRow = page.locator('.connection-row').filter({ has: page.getByText('broken', { exact: true }) })
  await brokenRow.getByText('已安装', { exact: true }).waitFor({ timeout: 30000 })
  await page.locator('.connection-row').filter({ has: page.getByText('other', { exact: true }) }).getByText('已停用', { exact: true }).waitFor()
  assert.equal(await localRow.getByRole('button', { name: '测试连接 local' }).count(), 0)
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await localRow.getByText('已安装', { exact: true }).waitFor({ timeout: 30000 })
  if (process.env.PI_CONNECTORS_SCREENSHOT) await page.screenshot({ path: process.env.PI_CONNECTORS_SCREENSHOT })
  if (process.env.PI_MCP_LOCAL_ONLY === '1') {
    console.log('PASS configured MCP installation and disabled states')
  } else {
  assert.equal(await page.getByRole('button', { name: /^git\b/ }).isVisible(), false)
  await page.getByRole('button', { name: '手动添加', exact: true }).click()
  await page.getByLabel('连接名称').fill('Demo BI')
  await page.getByLabel('服务器 URL').fill(`${origin}/mcp`)
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await page.getByText('服务需要授权，请检查请求头或服务方的登录说明。').waitFor()
  await page.getByRole('button', { name: '添加请求头', exact: true }).click()
  await page.getByLabel('请求头名称').fill('Authorization')
  await page.getByLabel('请求头值').fill(sampleToken)
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await page.getByText('已连接，发现 1 个工具。').waitFor()
  if (process.env.PI_CONNECTORS_SCREENSHOT) await page.screenshot({ path: process.env.PI_CONNECTORS_SCREENSHOT })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('Demo BI', { exact: true }).waitFor()
  await page.locator('.connection-row').filter({ has: page.getByText('Demo BI', { exact: true }) }).getByText('已安装', { exact: true }).waitFor({ timeout: 30000 })
  const config = JSON.parse(await readFile(configFile, 'utf8'))
  assert.equal(config.autoEnableCodemode, false)
  assert.deepEqual(config.mcpServers.other, preserved)
  assert.deepEqual(config.mcpServers.local, local)
  assert.deepEqual(config.mcpServers.broken, broken)
  assert.equal(config.mcpServers['demo-bi'].headers.Authorization, sampleToken)
  if (process.platform !== 'win32') assert.equal((await stat(configFile)).mode & 0o777, 0o600)
  const saved = await page.evaluate(() => window.pi.listMcpConnectors())
  assert.equal(JSON.stringify(saved).includes(sampleToken), false)

  await page.getByRole('button', { name: '编辑 Demo BI', exact: true }).click()
  assert.equal(await page.getByLabel('请求头值').inputValue(), '')
  await page.getByLabel('连接名称').fill('Demo BI 经营数据')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('Demo BI 经营数据', { exact: true }).waitFor()
  await page.locator('.connection-row').filter({ has: page.getByText('Demo BI 经营数据', { exact: true }) }).getByText('已安装', { exact: true }).waitFor({ timeout: 30000 })

  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.locator('.new-session').click()
  const composer = page.locator('.composer-input')
  await composer.fill('查询测试销售额')
  await composer.press('Enter')
  await page.getByText('Demo sales returned.', { exact: true }).waitFor({ timeout: 25_000 })
  assert.ok(toolAdvertised && resultReceived, 'the real Pi runtime must expose the new tool and return its result to the model')
  assert.equal(toolCalls, 1)

  await page.getByText('技能与工具', { exact: true }).click()
  await page.getByRole('button', { name: '应用连接', exact: true }).click()
  await page.getByRole('button', { name: '移除 Demo BI 经营数据', exact: true }).click()
  await page.getByRole('button', { name: '移除', exact: true }).click()
  await page.getByText('连接已移除。 新建或重启会话后生效。', { exact: true }).waitFor()
  assert.deepEqual(JSON.parse(await readFile(configFile, 'utf8')).mcpServers, { other: preserved, local, broken })
  console.log('PASS classification, authenticated connector validation, native Pi MCP tool call, credential masking, edit, and removal')
  }
} finally {
  await app?.close()
  server.closeAllConnections()
  await new Promise((done) => server.close(done))
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
