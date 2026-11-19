import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

if (!process.env.PI_TEST_PI) throw new Error('Set PI_TEST_PI to the real Pi executable.')
const dir = await mkdtemp(join(tmpdir(), 'pi-guard-rpc-'))
const guardPath = process.env.PI_TEST_GUARD || resolve('extensions/computer-use/src/desktop-access-extension.ts')
const agent = join(dir, 'agent'), settings = join(dir, 'desktop-settings.json'), marker = join(dir, 'calls.txt')
let advertisedPermission = false
await mkdir(agent, {recursive:true})
const server = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const data = JSON.parse(body)
  const messages = data.messages || []
  const last = messages.at(-1)
  const user = [...messages].reverse().find(message => message.role === 'user')
  const userText = JSON.stringify(user?.content || '')
  const browser = userText.includes('browser')
  const permissionCheck = userText.includes('permissions')
  if (permissionCheck) advertisedPermission = (data.tools || []).some(tool => tool.function?.name === 'computer_use_permissions')
  const delta = last?.role === 'tool'
    ? { content:'done' }
    : { role:'assistant', tool_calls:[{ index:0, id:`call_${Date.now()}`, type:'function', function:{name:permissionCheck ? 'computer_use_permissions' : browser ? 'computer_use_session_observe' : 'computer_use_observe', arguments:'{}'} }] }
  const finish = last?.role === 'tool' ? 'stop' : 'tool_calls'
  res.writeHead(200, {'content-type':'text/event-stream','cache-control':'no-cache'})
  for (const chunk of [{id:'test',object:'chat.completion.chunk',created:1,model:'test',choices:[{index:0,delta,finish_reason:null}]},{id:'test',object:'chat.completion.chunk',created:1,model:'test',choices:[{index:0,delta:{},finish_reason:finish}]}]) res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  res.end('data: [DONE]\n\n')
})
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
await writeFile(join(agent,'models.json'),JSON.stringify({providers:{local:{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,api:'openai-completions',apiKey:'test',models:[{id:'test'}]}}}))
await writeFile(settings, JSON.stringify({computerUseEnabled:false}))
const probe = join(dir,'probe.mjs')
await writeFile(probe, `import { appendFileSync } from 'node:fs'; import { Type } from 'typebox'; export default pi => { const register=()=>{ for (const name of ['computer_use_observe','computer_use_session_observe']) pi.registerTool({name,label:name,description:name,parameters:Type.Object({}),execute:async()=>{appendFileSync(process.env.PI_GUARD_TEST_MARKER,name+'\\n');return {content:[{type:'text',text:'ok'}]}}}); }; if(process.env.PI_TEST_DYNAMIC_EXISTING) pi.on('session_start',register); else register(); };`)
const child = spawn(process.env.PI_TEST_PI,['--mode','rpc','--no-session','--no-extensions','--no-skills','--no-mcp','--provider','local','--model','test','--extension',guardPath,'--extension',probe],{cwd:dir,env:{...process.env,HOME:dir,PI_CODING_AGENT_DIR:agent,PI_DESKTOP_SETTINGS_FILE:settings,PI_GUARD_TEST_MARKER:marker,PI_OFFLINE:'1'},stdio:['pipe','pipe','pipe']})
let buffer='', stderr='', pending=[]
child.stderr.on('data', chunk=>{stderr+=chunk})
child.stdout.on('data', chunk=>{buffer+=chunk; for (;;) {const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try {const event=JSON.parse(line);for(const wait of [...pending])if(wait.predicate(event)){pending=pending.filter(w=>w!==wait);clearTimeout(wait.timer);wait.resolve(event)}} catch {}}})
const waitFor = (predicate) => new Promise((resolvePromise,reject)=>{const item={predicate,resolve:resolvePromise,timer:setTimeout(()=>{pending=pending.filter(w=>w!==item);reject(new Error(`Pi RPC timeout: ${stderr}`))},15000)};pending.push(item)})
async function prompt(message) { const done=waitFor(event=>event.type==='agent_end');child.stdin.write(`${JSON.stringify({type:'prompt',message})}\n`);await done }
const calls = async () => { try { return (await readFile(marker,'utf8')).trim().split('\n').filter(Boolean) } catch { return [] } }
try {
  await prompt('desktop')
  assert.deepEqual(await calls(), [], 'disabled desktop tool must not execute')
  await prompt('browser')
  assert.deepEqual(await calls(), ['computer_use_session_observe'], 'browser tool remains available')
  await writeFile(settings,JSON.stringify({computerUseEnabled:true}))
  await prompt('desktop')
  assert.deepEqual(await calls(), ['computer_use_session_observe','computer_use_observe'], 'enabling takes effect without restarting Pi')
  await writeFile(settings,JSON.stringify({computerUseEnabled:false}))
  await prompt('desktop')
  assert.deepEqual(await calls(), ['computer_use_session_observe','computer_use_observe'], 'disabling takes effect without restarting Pi')
  const fallback = spawn(process.env.PI_TEST_PI,['--mode','rpc','--no-session','--no-extensions','--no-skills','--no-mcp','--provider','local','--model','test','--extension',guardPath],{cwd:dir,env:{...process.env,HOME:dir,PI_CODING_AGENT_DIR:agent,PI_DESKTOP_SETTINGS_FILE:settings,PI_OFFLINE:'1'},stdio:['pipe','pipe','pipe']})
  try {
    let text='', sawTool=false, failed=false
    const done = new Promise((resolveDone,reject)=>{
      const timer=setTimeout(()=>reject(new Error('fallback tool timed out')),15000)
      fallback.stdout.on('data',chunk=>{text+=chunk;for(;;){const i=text.indexOf('\n');if(i<0)break;const line=text.slice(0,i);text=text.slice(i+1);try{const event=JSON.parse(line);if(event.type==='tool_execution_end' && event.toolName==='computer_use_permissions'){sawTool=true;failed=event.isError===true}if(event.type==='agent_end'){clearTimeout(timer);resolveDone()}}catch{}}})
    })
    fallback.stdin.write(`${JSON.stringify({type:'prompt',message:'permissions'})}\n`)
    await done
    assert.ok(sawTool && !failed, 'late-registered bundled tool executes in a real Pi agent turn')
    assert.equal(advertisedPermission, true, 'late-registered bundled tool is actually advertised to the model')
  } finally { fallback.kill() }
  await writeFile(settings,JSON.stringify({computerUseEnabled:true}))
  const dynamic = spawn(process.env.PI_TEST_PI,['--mode','rpc','--no-session','--no-extensions','--no-skills','--no-mcp','--provider','local','--model','test','--extension',guardPath,'--extension',probe],{cwd:dir,env:{...process.env,HOME:dir,PI_CODING_AGENT_DIR:agent,PI_DESKTOP_SETTINGS_FILE:settings,PI_GUARD_TEST_MARKER:marker,PI_TEST_DYNAMIC_EXISTING:'1',PI_OFFLINE:'1'},stdio:['pipe','pipe','pipe']})
  try {
    let text=''
    const done=new Promise((resolveDone,reject)=>{const timer=setTimeout(()=>reject(new Error('dynamic extension timed out')),15000);dynamic.stdout.on('data',chunk=>{text+=chunk;for(;;){const i=text.indexOf('\n');if(i<0)break;const line=text.slice(0,i);text=text.slice(i+1);try{const event=JSON.parse(line);if(event.type==='extension_ui_request')dynamic.stdin.write(`${JSON.stringify({type:'extension_ui_response',id:event.id,cancelled:true})}\n`);if(event.type==='agent_end'){clearTimeout(timer);resolveDone()}}catch{}}})})
    dynamic.stdin.write(`${JSON.stringify({type:'prompt',message:'desktop'})}\n`)
    await done
    assert.deepEqual(await calls(), ['computer_use_session_observe','computer_use_observe','computer_use_observe'], 'extension registered during session_start retains precedence')
  } finally { dynamic.kill() }
  console.log('PASS real Pi RPC: desktop off/on/off and independent browser tool')
} finally { child.kill(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); await rm(dir,{recursive:true,force:true}) }
