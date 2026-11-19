#!/usr/bin/env node
// Isolated Pi RPC trust probe. It never changes the user's trust store.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const root = await mkdtemp(join(tmpdir(), 'pi-rpc-project-trust-'))
const project = join(root, 'project'), agent = join(root, 'agent')
await mkdir(join(project, '.pi', 'extensions'), { recursive: true })
await mkdir(agent)
await writeFile(join(project, '.pi', 'extensions', 'fixture.ts'), `export default pi => pi.registerCommand('isolated-trust-fixture', { description:'test only', handler:async()=>{} })\n`)
const marker = join(root, 'event.json')
const bootstrap = join(root, 'bootstrap.ts')
await writeFile(bootstrap, `import {writeFileSync} from 'node:fs'; export default pi=>pi.on('project_trust',async(e,ctx)=>{writeFileSync(${JSON.stringify(marker)},JSON.stringify({hasUI:ctx.hasUI,mode:ctx.mode}));return {trusted:'undecided'}})\n`)

async function run(args) {
  const child = spawn(process.env.PI_TEST_PI || 'pi', ['--mode','rpc','--no-session','--offline','-e',bootstrap,...args], {
    cwd: project, env: { ...process.env, PI_CODING_AGENT_DIR: agent }, stdio:['pipe','pipe','pipe']
  })
  let stderr = '', timedOut = false
  child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 4096) })
  const lines = createInterface({input:child.stdout})
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 15000)
  try {
    const result = await new Promise((resolve,reject) => {
      child.on('error',reject)
      child.on('exit',(code,signal) => reject(new Error(`Pi exited before response: ${code ?? signal}; ${stderr}`)))
      lines.on('line',line => {
        let record
        try { record=JSON.parse(line) } catch { return }
        if (record.id === 'commands' && record.type === 'response') {
          if (!record.success || !Array.isArray(record.data?.commands)) return reject(new Error('Invalid command response'))
          resolve(record.data.commands.some(command => command.name === 'isolated-trust-fixture'))
        }
      })
      child.stdin.write(JSON.stringify({id:'commands',type:'get_commands'})+'\n')
    })
    child.stdin.end()
    await new Promise(resolve=>child.once('exit',resolve))
    return result
  } finally { clearTimeout(timer); lines.close(); if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL'); if(timedOut)console.error('Pi trust probe timed out') }
}
try {
  assert.equal(await run([]),false,'untrusted project extensions must not load in RPC default ask mode')
  const trustEvent = JSON.parse(await readFile(marker,'utf8'))
  assert.deepEqual(trustEvent,{hasUI:false,mode:'rpc'},'RPC startup does not expose a trust prompt')
  assert.equal(await run(['--approve']),true,'explicit process-local approval must load the fixture extension')
  assert.equal(await run(['--no-approve']),false,'explicit refusal must not load the fixture extension')
  let store = null
  try { store=JSON.parse(await readFile(join(agent,'trust.json'),'utf8')) } catch (error) { if(error.code!=='ENOENT')throw error }
  assert.ok(!store || Object.keys(store).length===0,'one-process flags must not persist a trust decision')
  const canonical = await realpath(project)
  const trustPath = join(agent,'trust.json')
  await writeFile(trustPath,JSON.stringify({[canonical]:false}))
  assert.equal(await run([]),false,'saved refusal must be respected')
  assert.equal(await run(['--approve']),true,'explicit one-process approval overrides a saved refusal')
  assert.deepEqual(JSON.parse(await readFile(trustPath,'utf8')),{[canonical]:false},'one-process approval must not alter saved refusal')
  await writeFile(trustPath,JSON.stringify({[canonical]:true}))
  assert.equal(await run([]),true,'saved approval must be respected')
  assert.equal(await run(['--no-approve']),false,'one-process refusal overrides saved approval')
  assert.deepEqual(JSON.parse(await readFile(trustPath,'utf8')),{[canonical]:true},'one-process refusal must not alter saved approval')
  console.log('PASS real Pi RPC: default skips untrusted extension, no startup UI, per-process approve and refusal remain nonpersistent')
} finally { await rm(root,{recursive:true,force:true}) }
