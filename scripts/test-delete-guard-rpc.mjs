import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const pi = process.env.PI_TEST_PI
if (!pi) throw new Error('Set PI_TEST_PI to the real Pi executable.')
const dir = await mkdtemp(join(tmpdir(), 'pi-delete-guard-'))
const agent = join(dir, 'agent')
await mkdir(agent)
await writeFile(join(dir, 'existing.txt'), 'keep')
const server = createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const request = JSON.parse(raw), after = request.messages?.some(item => item.role === 'tool')
  const delta = after ? { content: 'done' } : { role: 'assistant', tool_calls: [{ index: 0, id: 'delete', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'rm existing.txt' }) } }] }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const [part, finish] of [[delta, null], [{}, after ? 'stop' : 'tool_calls']]) res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: part, finish_reason: finish }] })}\n\n`)
  res.end('data: [DONE]\n\n')
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
await writeFile(join(agent, 'models.json'), JSON.stringify({ providers: { local: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'test', models: [{ id: 'test', contextWindow: 200000, maxTokens: 8192 }] } } }))
const child = spawn(pi, ['--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills', '--no-mcp', '--provider', 'local', '--model', 'test', '--extension', resolve('extensions/computer-use/src/desktop-access-extension.ts')], { cwd: dir, env: { ...process.env, HOME: dir, PI_CODING_AGENT_DIR: agent, PI_DESKTOP_TOOL_APPROVAL: 'dangerous' }, stdio: ['pipe', 'pipe', 'pipe'] })
try {
  let buffer = '', sawConfirmation = false, stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  const done = new Promise((resolveDone, reject) => {
    const timer = setTimeout(() => reject(new Error(`delete guard timed out: ${stderr}`)), 20000)
    child.stdout.on('data', chunk => {
      buffer += chunk
      for (;;) {
        const index = buffer.indexOf('\n'); if (index < 0) break
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
        try {
          const event = JSON.parse(line)
          if (event.type === 'extension_ui_request' && event.method === 'confirm') {
            sawConfirmation = true
            child.stdin.write(`${JSON.stringify({ type: 'extension_ui_response', id: event.id, confirmed: false })}\n`)
          }
          if (event.type === 'agent_end') { clearTimeout(timer); resolveDone() }
        } catch { /* non-JSON output */ }
      }
    })
  })
  child.stdin.write(`${JSON.stringify({ type: 'prompt', message: 'test' })}\n`)
  await done
  assert.ok(sawConfirmation, 'ordinary rm must request confirmation in automatic mode')
  assert.equal(await readFile(join(dir, 'existing.txt'), 'utf8'), 'keep', 'cancelled deletion must leave the file intact')
  console.log('PASS real Pi requests confirmation and preserves existing file on cancellation')
} finally { child.kill(); server.closeAllConnections(); await new Promise(done => server.close(done)); await rm(dir, { recursive: true, force: true }) }
