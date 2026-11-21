import assert from 'node:assert/strict'
import {stripTypeScriptTypes} from 'node:module'
import {createServer} from 'node:http'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {creatorTemplate} from '../extensions/creator/templates.ts'
import {runReadOnlySubagent} from '../extensions/creator/subagent.ts'
import {CreatorWorkspace} from '../extensions/creator/workspace.ts'
import {installCreatorDraft} from '../src/main/creator.ts'
let checks=0
async function test(name,run){await run();checks++;console.log('✓ '+name)}
function factory(kind){return new Function(stripTypeScriptTypes(creatorTemplate(kind,'fixture-mode')['extension.ts']).replace('export default','return'))()}
await test('Mode really switches tools, blocks writes, changes instructions and restores prior tools',async()=>{
 const events={},commands={};let active=['read','write','bash']
 const pi={on:(name,fn)=>events[name]=fn,registerCommand:(name,fn)=>commands[name]=fn,getActiveTools:()=>active,setActiveTools:tools=>{active=tools}}
 const ctx={isIdle:()=>true,ui:{notify:()=>{}}}
 factory('mode')(pi)
 await commands['fixture-mode'].handler('on',ctx)
 assert.deepEqual(active,['read','grep','find','ls'])
 assert.equal(events.tool_call({toolName:'write'}).block,true);assert.equal(events.tool_call({toolName:'read'}),undefined)
 assert.ok(events.before_agent_start({systemPrompt:'BASE'}).systemPrompt.startsWith('BASE\n'))
 await commands['fixture-mode'].handler('off',ctx);assert.deepEqual(active,['read','write','bash'])
 assert.equal(events.before_agent_start({systemPrompt:'BASE'}),undefined)
})
await test('Context extension changes request projection without deleting history, errors, images or call IDs',()=>{
 const events={};factory('context')({on:(name,fn)=>events[name]=fn,registerCommand:()=>{}})
 const original=[{role:'toolResult',toolCallId:'call-1',content:[{type:'text',text:'x'.repeat(8000)},{type:'image',data:'original'}],isError:false},{role:'toolResult',toolCallId:'call-2',content:[{type:'text',text:'error'.repeat(2000)}],isError:true},{role:'assistant',content:[{type:'toolCall',id:'call-1',name:'read'}]}]
 const before=JSON.stringify(original),result=events.context({messages:original}).messages
 assert.equal(JSON.stringify(original),before);assert.ok(result[0].content[0].text.length<8000);assert.equal(result[0].toolCallId,'call-1');assert.deepEqual(result[0].content[1],original[0].content[1]);assert.deepEqual(result.slice(1),original.slice(1))
})
const root=mkdtempSync(join(tmpdir(),'pi-creator-behavior-')),agent=join(root,'agent');mkdirSync(agent)
const saved={cli:process.env.PI_DESKTOP_CREATOR_CLI,dir:process.env.PI_CODING_AGENT_DIR}
process.env.PI_DESKTOP_CREATOR_CLI=resolve('build/pi-seed/1.5.2/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js')
process.env.PI_CODING_AGENT_DIR=agent
let responseMode='answer'
const requests=[]
const server=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk
 const request=JSON.parse(raw);requests.push(request)
 if(responseMode==='hang'){req.on('close',()=>{});return}
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'})
 for(const delta of [{role:'assistant',content:'Independent sub-agent result.'},{}])res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta,finish_reason:delta.content?null:'stop'}]})+'\n\n')
 res.end('data: [DONE]\n\n')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const port=server.address().port
writeFileSync(join(agent,'models.json'),JSON.stringify({providers:{'creator-fixture':{baseUrl:`http://127.0.0.1:${port}/v1`,api:'openai-completions',apiKey:'fixture-key',models:[{id:'fixture-model',name:'Fixture',contextWindow:64000,maxTokens:1024}]}}}))
writeFileSync(join(agent,'settings.json'),JSON.stringify({packages:[]}))
try{
 await test('Sub-agent uses a real independent Pi executor and returns its result with read-only tools',async()=>{
  const result=await runReadOnlySubagent({task:'Summarize this delegated task.',cwd:root,provider:'creator-fixture',model:'fixture-model'})
  assert.equal(result,'Independent sub-agent result.')
  assert.deepEqual(requests.at(-1).tools.map(tool=>tool.function.name).sort(),['find','grep','ls','read'])
  assert.ok(JSON.stringify(requests.at(-1).messages).includes('Summarize this delegated task.'))
 })
 await test('Cancelling the parent operation terminates the real sub-agent request',async()=>{
  responseMode='hang';const controller=new AbortController();const prior=requests.length
  const pending=runReadOnlySubagent({task:'Wait for cancellation.',cwd:root,provider:'creator-fixture',model:'fixture-model',signal:controller.signal})
  const wait=setInterval(()=>{if(requests.length>prior){clearInterval(wait);controller.abort()}},10)
  try{await assert.rejects(pending,/Cancelled/)}finally{clearInterval(wait)}
 })
 const workspace=new CreatorWorkspace(root);workspace.create('mode','snapshot-mode');await workspace.test('snapshot-mode')
 const storage=join(root,'installed');let sources=[];let source
 const options={cwd:root,id:'snapshot-mode',storage,isConfigured:path=>sources.includes(path),install:async path=>{source=path;sources.push(path);return {ok:true}},verify:async path=>sources.includes(path)?path:null,rollback:async path=>{sources=sources.filter(item=>item!==path);return {ok:true}}}
 await test('Installation creates a stable snapshot and changing the draft cannot alter installed code',async()=>{
  const result=await installCreatorDraft(options),before=readFileSync(join(result.source,'extension.ts'),'utf8')
  writeFileSync(join(workspace.get('snapshot-mode').path,'extension.ts'),'changed draft')
  assert.equal(readFileSync(join(result.source,'extension.ts'),'utf8'),before)
 })
 await test('First installation verification failure compensates the new package declaration',async()=>{
  workspace.create('mode','rollback-mode');await workspace.test('rollback-mode')
  await assert.rejects(()=>installCreatorDraft({...options,id:'rollback-mode',verify:async()=>null}),/did not report/)
  assert.ok(!sources.includes(source));assert.equal(existsSync(source),false)
 })
 await test('Failed package compensation preserves the tested snapshot instead of a dangling source',async()=>{
  workspace.create('mode','retain-mode');await workspace.test('retain-mode')
  await assert.rejects(()=>installCreatorDraft({...options,id:'retain-mode',verify:async()=>null,rollback:async()=>({ok:false,error:'fixture failure'})}),/snapshot was retained/)
  assert.equal(existsSync(join(source,'extension.ts')),true)
 })
 await test('A good entry cannot hide a broken second extension entry',async()=>{
  const draft=workspace.create('mode','two-entries'),manifest=JSON.parse(readFileSync(join(draft.path,'package.json')))
  manifest.pi.extensions.push('./broken.ts');writeFileSync(join(draft.path,'package.json'),JSON.stringify(manifest));writeFileSync(join(draft.path,'broken.ts'),'export default function( { broken')
  await assert.rejects(()=>workspace.test(draft.id),/Failed to load extension|No plugin command|timed out|Pi exited/)
  assert.notEqual(workspace.get(draft.id).status,'tested')
 })
 await test('A failed update restores the preceding active snapshot and keeps its package declaration',async()=>{
  workspace.create('mode','update-mode');await workspace.test('update-mode')
  const first=await installCreatorDraft({...options,id:'update-mode'}),before=readFileSync(join(first.source,'extension.ts'),'utf8')
  const path=join(workspace.get('update-mode').path,'extension.ts');writeFileSync(path,readFileSync(path,'utf8')+'\n// next version\n');await workspace.test('update-mode')
  await assert.rejects(()=>installCreatorDraft({...options,id:'update-mode',install:async()=>({ok:false,error:'update failed'})}),/update failed/)
  assert.equal(readFileSync(join(first.source,'extension.ts'),'utf8'),before);assert.ok(sources.includes(first.source))
 })
 const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}}
 const waitFor=async(predicate,timeout=4000)=>{const until=Date.now()+timeout;while(!predicate()&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(predicate())}
 const workerCode=(pidPath,readyPath,hang)=>`import {spawn} from 'node:child_process';import{writeFileSync,existsSync}from'node:fs';export default async function(pi){pi.registerCommand('worker-probe',{description:'fixture',handler:async()=>{}});const helper=spawn(process.execPath,['-e',${JSON.stringify("process.on('SIGTERM',()=>{});require('node:fs').writeFileSync("+JSON.stringify(readyPath)+",'ready');setInterval(()=>{},1000)")}],{stdio:'inherit'});writeFileSync(${JSON.stringify(pidPath)},String(helper.pid));while(!existsSync(${JSON.stringify(readyPath)}))await new Promise(resolve=>setTimeout(resolve,10));${hang?'await new Promise(()=>{})':''}}`
 await test('A successful test cleans up a startup helper that ignores SIGTERM and inherits stdio',async()=>{
  const draft=workspace.create('mode','worker-success'),pidPath=join(root,'success.pid'),ready=join(root,'success.ready')
  writeFileSync(join(draft.path,'extension.ts'),workerCode(pidPath,ready,false));await workspace.test(draft.id)
  const pid=Number(readFileSync(pidPath,'utf8'));await waitFor(()=>!alive(pid))
 })
 await test('Cancelling a startup test cleans up the entire helper process group',async()=>{
  const draft=workspace.create('mode','worker-cancel'),pidPath=join(root,'cancel.pid'),ready=join(root,'cancel.ready'),controller=new AbortController()
  writeFileSync(join(draft.path,'extension.ts'),workerCode(pidPath,ready,true));const pending=workspace.test(draft.id,controller.signal)
  await waitFor(()=>existsSync(ready));const pid=Number(readFileSync(pidPath,'utf8'));controller.abort()
  await assert.rejects(pending,/Cancelled/);await waitFor(()=>!alive(pid))
 })
 console.log(`${checks} creator behavioral checks passed`)
}finally{
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true})
 for(const[name,value]of[['PI_DESKTOP_CREATOR_CLI',saved.cli],['PI_CODING_AGENT_DIR',saved.dir]])if(value===undefined)delete process.env[name];else process.env[name]=value
}
