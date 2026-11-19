import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
if (!process.env.PI_TEST_PI) throw Error('Set PI_TEST_PI to the real Pi executable.')
const dir=await mkdtemp(join(tmpdir(),'pi-desktop-status-')), agent=join(dir,'agent'), info=join(dir,'info.json')
const excluded=join(agent,'extensions','desktop')
await mkdir(excluded,{recursive:true})
await writeFile(join(excluded,'package.json'),JSON.stringify({name:'pi-desktop-computer-use'}))
await writeFile(join(excluded,'index.ts'),"export default pi => pi.registerTool({ name:'computer_use_observe', label:'Excluded', description:'Excluded', parameters:{type:'object',properties:{}}, execute:async()=>({content:[]}) })")
await writeFile(join(agent,'settings.json'),JSON.stringify({extensions:['-extensions/desktop/index.ts']}))
const child=spawn(process.env.PI_TEST_PI,['--mode','rpc','--no-session','--no-skills','--no-mcp','--extension',resolve('extensions/computer-use/src/desktop-access-extension.ts')],{cwd:dir,env:{...process.env,HOME:dir,PI_CODING_AGENT_DIR:agent,PI_DESKTOP_TOOL_INFO_FILE:info,PI_OFFLINE:'1'},stdio:['pipe','pipe','pipe']})
let buffer='', stderr='', userEvents=0, agentStarts=0
child.stderr.on('data',chunk=>{stderr+=chunk})
const waiting=new Map()
child.stdout.on('data',chunk=>{buffer+=chunk;for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const event=JSON.parse(line);if(event.type==='message_start' && event.message?.role==='user')userEvents++;if(event.type==='agent_start')agentStarts++;if(event.type==='response' && waiting.has(event.id)){waiting.get(event.id)(event);waiting.delete(event.id)}}catch{}}})
const send=(id,command)=>new Promise((resolvePromise,reject)=>{const timer=setTimeout(()=>reject(Error(`RPC timeout: ${stderr}`)),10000);waiting.set(id,value=>{clearTimeout(timer);resolvePromise(value)});child.stdin.write(`${JSON.stringify({id,...command})}\n`)})
try {
 await send('ready',{type:'get_state'})
 const result=await send('status',{type:'prompt',message:'/pi-desktop-access-status'})
 assert.equal(result.success,true,'internal status command succeeds without a model')
 const deadline=Date.now()+5000
 let value
 while(Date.now()<deadline && !value){try{value=JSON.parse(await readFile(info,'utf8'))}catch{await new Promise(resolve=>setTimeout(resolve,25))}}
 assert.equal(value?.helperRoot,resolve('extensions/computer-use')+'/', 'disabled auto-discovered extension must not determine helper')
 const messages=await send('messages',{type:'get_messages'})
 assert.equal(messages.data?.messages?.length,0,'status check must not add a chat message')
 assert.equal(userEvents,0,'status check must not emit a visible user message')
 assert.equal(agentStarts,0,'status check must not start a model turn')
 console.log('PASS real Pi RPC: silent proactive status honors disabled extensions')
} finally {child.kill();await rm(dir,{recursive:true,force:true})}
