import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BrowserActionJournal } from '../extensions/computer-use/src/browser-action-journal.ts'

if (!process.env.PI_TEST_PI) throw new Error('Set PI_TEST_PI to the real Pi executable.')
const dir=await mkdtemp(join(process.env.PI_TEST_SANDBOX === '1' ? resolve('output') : tmpdir(),'pi-journal-router-'))
const agent=join(dir,'agent'), state=join(dir,'.pi','computer-use')
await mkdir(agent,{recursive:true});await mkdir(state,{recursive:true})
const journal=new BrowserActionJournal(join(state,'browser-actions.sqlite'))
const pending=journal.claim('cdp')
const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk
  const messages=JSON.parse(body).messages || []
  const isResult=messages.at(-1)?.role==='tool'
  const delta=isResult?{content:'done'}:{role:'assistant',tool_calls:[{index:0,id:'open_test',type:'function',function:{name:'computer_use_session_open',arguments:JSON.stringify({backend:'cdp'})}}]}
  res.writeHead(200,{'content-type':'text/event-stream'})
  for(const chunk of [{id:'test',object:'chat.completion.chunk',created:1,model:'test',choices:[{index:0,delta,finish_reason:null}]},{id:'test',object:'chat.completion.chunk',created:1,model:'test',choices:[{index:0,delta:{},finish_reason:isResult?'stop':'tool_calls'}]}])res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  res.end('data: [DONE]\n\n')
})
await new Promise(resolveDone=>server.listen(0,'127.0.0.1',resolveDone))
await writeFile(join(agent,'models.json'),JSON.stringify({providers:{local:{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,api:'openai-completions',apiKey:'test',models:[{id:'test'}]}}}))
const piArgs=['--mode','rpc','--no-session','--no-extensions','--no-skills','--no-mcp','--provider','local','--model','test','--extension',resolve('extensions/computer-use/index.ts')]
let command=process.env.PI_TEST_PI,args=piArgs
if(process.env.PI_TEST_SANDBOX==='1'){
 const config=join(dir,'sandbox.json')
 const journals=['browser-actions.sqlite','desktop-actions.sqlite'].flatMap(name=>['','-wal','-shm','-journal'].map(suffix=>join(state,name+suffix)))
 await writeFile(config,JSON.stringify({filesystem:{denyRead:[],allowRead:['/'],allowWrite:[agent,tmpdir(),join(state,'audit.jsonl'),...journals],denyWrite:[]},network:{allowedDomains:['127.0.0.1'],deniedDomains:[],allowLocalBinding:true}}))
 command=process.execPath;args=[resolve('build/srt-cli.cjs'),'--settings',config,'/usr/bin/env',process.env.PI_TEST_PI,...piArgs]
}
const child=spawn(command,args,{cwd:dir,env:{...process.env,HOME:dir,PI_CODING_AGENT_DIR:agent},stdio:['pipe','pipe','pipe']})
let buffer='',stderr='',toolResult
child.stderr.on('data',chunk=>{stderr+=chunk})
try {
  await new Promise((resolveDone,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`Pi test timed out: ${stderr}`)),15000)
    child.stdout.on('data',chunk=>{buffer+=chunk;for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let event;try{event=JSON.parse(line)}catch{continue}if(event.type==='tool_execution_end'&&event.toolName==='computer_use_session_open')toolResult=event;if(event.type==='agent_end'){clearTimeout(timer);resolveDone()}}})
    child.once('exit',()=>{clearTimeout(timer);reject(new Error(`Pi exited early: ${stderr}`))})
    child.stdin.write('{"type":"prompt","message":"open browser"}\n')
  })
  assert.ok(toolResult && !toolResult.isError, 'actual Pi must execute browser session open')
  assert.deepEqual(toolResult.result.details.pendingBackends,['cdp'])
  assert.equal(journal.pending('cdp').id,pending.id,'reading the pending action must not clear it')
  console.log('PASS real Pi router: pending journal is surfaced after opening the browser session')
} finally {
  if(child.exitCode===null && child.signalCode===null){child.kill();await new Promise(resolveDone=>child.once('exit',resolveDone))}
  server.closeAllConnections();await new Promise(resolveDone=>server.close(resolveDone));journal.close();await rm(dir,{recursive:true,force:true})
}
