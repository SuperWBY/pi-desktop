import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

if (!process.env.PI_TEST_PI) throw new Error('Set PI_TEST_PI to the real Pi executable.')
const dir = await mkdtemp(join(tmpdir(), 'pi-permission-rpc-'))
const probe = join(dir, 'probe.mjs')
const result = join(dir, 'result.json')
const flowUrl = pathToFileURL(resolve('extensions/computer-use/src/desktop-permissions.ts')).href
await writeFile(probe, `import { writeFileSync } from 'node:fs'; import { ensureDesktopPermissions } from ${JSON.stringify(flowUrl)};
export default pi => pi.registerCommand('permission-probe', { description: 'Test permission UI', handler: async (_args, ctx) => { let granted = false; await ensureDesktopPermissions(ctx, { check: async () => ({ accessibility: granted, screenRecording: true }), request: async () => {}, openSettings: async () => { granted = true } }); writeFileSync(process.env.PI_PROBE_RESULT, JSON.stringify({ hasUI: ctx.hasUI, resumed: granted })); } });`)
const child = spawn(process.env.PI_TEST_PI, ['--mode','rpc','--no-session','--no-extensions','--no-skills','--no-mcp','--extension',probe], { cwd:dir, env:{...process.env,HOME:dir,PI_CODING_AGENT_DIR:join(dir,'agent'),PI_PROBE_RESULT:result,PI_OFFLINE:'1'}, stdio:['pipe','pipe','pipe'] })
let buffer = '', stderr = '', seen = false
child.stderr.on('data', chunk => { stderr += chunk })
child.stdout.on('data', chunk => {
  buffer += chunk
  for (;;) {
    const pos = buffer.indexOf('\n')
    if (pos < 0) break
    const line = buffer.slice(0,pos); buffer = buffer.slice(pos+1)
    try {
      const message = JSON.parse(line)
      if (message.type === 'extension_ui_request' && message.method === 'select') {
        seen = true
        assert.equal(message.title, 'Computer Use: System Permissions')
        child.stdin.write(`${JSON.stringify({type:'extension_ui_response',id:message.id,value:'Open Accessibility Settings'})}\n`)
      }
    } catch (error) { if (error instanceof assert.AssertionError) throw error }
  }
})
child.stdin.write(`${JSON.stringify({type:'prompt',message:'/permission-probe'})}\n`)
try {
  const deadline = Date.now() + 15000
  let value
  while (Date.now() < deadline && !value) {
    try { value = JSON.parse(await readFile(result,'utf8')) } catch { await new Promise(resolve => setTimeout(resolve,50)) }
  }
  assert.ok(seen, `real Pi did not send the permission prompt: ${stderr}`)
  assert.deepEqual(value, { hasUI:true, resumed:true })
  console.log('PASS real Pi RPC: permission selection and task continuation')
} finally { child.kill(); await rm(dir,{recursive:true,force:true}) }
