import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

if (!process.env.PI_TEST_PI) throw new Error('Set PI_TEST_PI to the real Pi executable.')
const dir=await mkdtemp(join(tmpdir(),'pi-desktop-bootstrap-'))
const agent=join(dir,'agent'), probe=join(dir,'probe.mjs'), result=join(dir,'result.json'), info=join(dir,'tool-info.json')
await mkdir(agent,{recursive:true})
const server=createServer(async(req,res)=>{for await(const _chunk of req) { /* consume */ } res.writeHead(200,{'content-type':'text/event-stream'});res.write(`data: ${JSON.stringify({id:'t',object:'chat.completion.chunk',created:1,model:'test',choices:[{index:0,delta:{role:'assistant',content:'ok'},finish_reason:null}]})}\n\n`);res.write(`data: ${JSON.stringify({id:'t',object:'chat.completion.chunk',created:1,model:'test',choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\n`);res.end('data: [DONE]\n\n')})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
await writeFile(join(agent,'models.json'),JSON.stringify({providers:{local:{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,api:'openai-completions',apiKey:'test',models:[{id:'test'}]}}}))
await writeFile(probe, `import { writeFileSync } from 'node:fs'; import { Type } from 'typebox'; export default pi => { const names={browser:'computer_use_session_open',desktop:'computer_use_observe',dynamic:'computer_use_observe',before:'computer_use_observe',permissions:'computer_use_permissions',judge:'computer_use_session_judge'}; const register=()=>{const name=names[process.env.PI_TEST_EXISTING];if(name)pi.registerTool({name,label:'Existing',description:'Existing',parameters:Type.Object({}),execute:async()=>({content:[]})})}; if(process.env.PI_TEST_EXISTING==='dynamic')pi.on('session_start',register);else if(process.env.PI_TEST_EXISTING==='before')pi.on('before_agent_start',register);else register(); pi.on('agent_start',()=>{const tools=pi.getAllTools();const target=tools.find(x=>x.name==='computer_use_observe');const browser=tools.find(x=>x.name==='computer_use_session_open');const custom=tools.find(x=>x.name===names[process.env.PI_TEST_EXISTING]);writeFileSync(process.env.PI_TEST_BOOTSTRAP_RESULT,JSON.stringify({source:target?.sourceInfo?.path || '',active:pi.getActiveTools().includes('computer_use_observe'),browser:!!browser,browserSource:browser?.sourceInfo?.path || '',customSource:custom?.sourceInfo?.path || '',hasDesktopReconcile:tools.some(x=>x.name==='computer_use_desktop_reconcile'),hasPermissions:tools.some(x=>x.name==='computer_use_permissions'),hasJudge:tools.some(x=>x.name==='computer_use_session_judge'),hasWait:tools.some(x=>x.name==='computer_use_session_wait'),hasDownloads:tools.some(x=>x.name==='computer_use_session_downloads'),hasRead:tools.some(x=>x.name==='computer_use_session_read'),hasVerifyFile:tools.some(x=>x.name==='computer_use_session_verify_file'),hasCancelFile:tools.some(x=>x.name==='computer_use_session_cancel_file')}));}); };`)
async function run(existing) {
 const child=spawn(process.env.PI_TEST_PI,['--mode','rpc','--no-session','--no-extensions','--no-skills','--no-mcp','--provider','local','--model','test','--extension',resolve('extensions/computer-use/src/desktop-access-extension.ts'),'--extension',probe],{cwd:dir,env:{...process.env,HOME:dir,PI_CODING_AGENT_DIR:agent,PI_TEST_BOOTSTRAP_RESULT:result,PI_DESKTOP_TOOL_INFO_FILE:info,...(existing?{PI_TEST_EXISTING:existing}:{})},stdio:['pipe','pipe','pipe']})
 let buffer='', stderr=''
 child.stderr.on('data',chunk=>{stderr+=chunk})
 try {
  await new Promise((resolveDone,reject)=>{let turns=0;const timer=setTimeout(()=>reject(new Error(`Pi RPC timeout: ${stderr}`)),15000);child.stdout.on('data',chunk=>{buffer+=chunk;for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{if(JSON.parse(line).type==='agent_end'){if(++turns===1)child.stdin.write('{"type":"prompt","message":"test again"}\n');else{clearTimeout(timer);resolveDone()}}}catch{}}});child.stdin.write('{"type":"prompt","message":"test"}\n')})
 } finally { child.kill() }
}
try {
 for (const existing of ['', 'desktop', 'dynamic', 'before', 'browser', 'permissions', 'judge']) {
  await run(existing)
  const value=JSON.parse(await readFile(result,'utf8')), actual=JSON.parse(await readFile(info,'utf8'))
  assert.equal(value.active,true,'desktop tool is available')
  assert.equal(value.hasDesktopReconcile, !['desktop','dynamic','before'].includes(existing), 'reconciliation belongs only to the bundled desktop tools')
  assert.equal(value.hasWait, existing !== 'browser', 'wait belongs only to its own browser session router')
  assert.equal(value.hasDownloads, existing !== 'browser', 'download status belongs only to its own browser session router')
  assert.equal(value.hasRead, existing !== 'browser', 'page text reading belongs only to its own browser session router')
  assert.equal(value.hasVerifyFile, existing !== 'browser', 'file verification belongs only to its own browser session router')
  assert.equal(value.hasCancelFile, existing !== 'browser', 'file cancellation belongs only to its own browser session router')
  if (existing === 'desktop' || existing === 'dynamic' || existing === 'before') { assert.equal(value.source,probe,'existing extension retains its own tool'); assert.equal(value.browser,true,'a desktop-only extension does not disable bundled browser tools'); assert.equal(value.hasPermissions,false,'do not report permissions for the wrong helper'); assert.equal(actual.helperRoot,null,'unknown custom helper is never guessed') }
  else { assert.equal(value.browser,true,'browser tool is available'); assert.equal(actual.helperRoot,resolve('extensions/computer-use') + '/', 'bundled helper root identifies the running implementation'); if(existing === 'browser') { assert.equal(value.browserSource,probe,'existing browser tool is preserved'); assert.equal(value.hasJudge,false,'do not attach bundled judge to an external router') } if(existing === 'permissions' || existing === 'judge') assert.equal(value.customSource,probe,'existing independent tool is preserved') }
 }
 console.log('PASS real Pi bootstrap: fallback tools and existing extension precedence')
} finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); await rm(dir,{recursive:true,force:true}) }
