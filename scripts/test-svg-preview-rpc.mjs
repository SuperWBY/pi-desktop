import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const executable = process.env.PI_TEST_PI
if (!executable) throw new Error('Set PI_TEST_PI to the real Pi executable.')
const dir = await mkdtemp(join(tmpdir(), 'pi-svg-rpc-'))
const agent = join(dir, 'agent')
await mkdir(agent)
await writeFile(join(dir, 'test.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="12" fill="red"/></svg>')
let advertised = false, receivedImage = false
const server = createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const data = JSON.parse(raw)
  advertised ||= (data.tools || []).some(tool => tool.function?.name === 'preview_svg')
  const afterTool = data.messages?.some(message => message.role === 'tool')
  if (afterTool) receivedImage ||= JSON.stringify(data.messages).includes('image/') || JSON.stringify(data.messages).includes('data:image')
  const delta = afterTool ? { content: 'done' } : { role: 'assistant', tool_calls: [{ index: 0, id: 'preview-test', type: 'function', function: { name: 'preview_svg', arguments: JSON.stringify({ path: 'test.svg' }) } }] }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  for (const [value, finish] of [[delta, null], [{}, afterTool ? 'stop' : 'tool_calls']]) res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`)
  res.end('data: [DONE]\n\n')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
await writeFile(join(agent, 'models.json'), JSON.stringify({ providers: { local: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: 'openai-completions', apiKey: 'test', models: [{ id: 'test', input: ['text', 'image'], contextWindow: 200000, maxTokens: 8192 }] } } }))
const piArgs = ['--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills', '--no-mcp', '--provider', 'local', '--model', 'test', '--extension', resolve('extensions/computer-use/src/artifact-preview-extension.ts')]
let command = executable, args = piArgs
if (process.env.PI_TEST_SANDBOX === '1') {
  const config = join(dir, 'sandbox.json')
  await writeFile(config, JSON.stringify({ filesystem: { denyRead: [], allowRead: ['/'], allowWrite: [tmpdir()], denyWrite: [] }, network: { allowedDomains: ['127.0.0.1'], deniedDomains: [], allowLocalBinding: true } }))
  command = process.execPath
  args = [resolve('build/srt-cli.cjs'), '--settings', config, '/usr/bin/env', executable, ...piArgs]
}
const child = spawn(command, args, { cwd: dir, env: { ...process.env, HOME: dir, PI_CODING_AGENT_DIR: agent }, stdio: ['pipe', 'pipe', 'pipe'] })
try {
  let buffer = '', stderr = '', toolSucceeded = false, events = []
  child.stderr.on('data', chunk => { stderr += chunk })
  const done = new Promise((resolveDone, reject) => {
    const timer = setTimeout(() => reject(new Error(`Pi preview test timed out: ${stderr}; events=${JSON.stringify(events.slice(-12))}; advertised=${advertised}`)), 20000)
    child.on('exit', code => { if (code) { clearTimeout(timer); reject(new Error(`Pi exited ${code}: ${stderr}`)) } })
    child.stdout.on('data', chunk => {
      buffer += chunk
      for (;;) {
        const index = buffer.indexOf('\n'); if (index < 0) break
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
        try {
          const event = JSON.parse(line)
          events.push([event.type, event.toolName, event.error, event.message?.errorMessage])
          if (event.type === 'tool_execution_end' && event.toolName === 'preview_svg') toolSucceeded = !event.isError && event.result?.content?.some(item => item.type === 'image' && item.mimeType === 'image/png')
          if (event.type === 'agent_end') { clearTimeout(timer); resolveDone() }
        } catch { /* non-JSON output */ }
      }
    })
  })
  child.stdin.write(`${JSON.stringify({ type: 'prompt', message: 'Preview test.svg' })}\n`)
  await done
  assert.ok(advertised, 'preview tool must be advertised to the model')
  assert.ok(toolSucceeded, 'preview must return PNG image content to Pi')
  assert.ok(receivedImage, 'image must reach the model request')
  console.log('PASS real Pi advertises, invokes, and sends SVG preview to the model')
} finally { child.kill(); server.closeAllConnections(); await new Promise(resolveDone => server.close(resolveDone)); await rm(dir, { recursive: true, force: true }) }
