import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {spawn} from 'node:child_process'
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
if(!process.env.PI_TEST_PI) throw Error('Set PI_TEST_PI to the real Pi executable')
const dir=await mkdtemp(join(tmpdir(),'pi-real-bridge-path-')), home=join(dir,'home'),agent=join(dir,'agent')
await mkdir(home,{recursive:true});await mkdir(agent,{recursive:true})
await writeFile(join(agent,'models.json'),JSON.stringify({providers:{local:{baseUrl:'http://127.0.0.1:1/v1',api:'openai-completions',apiKey:'test',models:[{id:'test'}]}}}))
const servers=[],children=[]
try{
 const probe=join(dir,'probe.ts'),module=resolve('extensions/computer-use/index.ts')
 await writeFile(probe,`import computerUse from ${JSON.stringify(module)}; import {writeFile} from 'node:fs/promises'; export default function(pi) { const tools={};computerUse({registerTool:t=>tools[t.name]=t,on:()=>{}});pi.registerCommand('bridge-path-probe',{description:'local test',handler:async()=>{try{await tools.computer_use_session_open.execute('o',{backend:'inapp'});const r=await tools.computer_use_session_downloads.execute('d',{});await writeFile(process.env.PI_BRIDGE_PROBE_RESULT,JSON.stringify({ok:true,content:r.content}));}catch(e){await writeFile(process.env.PI_BRIDGE_PROBE_RESULT,JSON.stringify({ok:false,error:String(e)}))}}})}`)
 for(const label of ['a','b']){
  const server=createServer((req,res)=>{if(req.headers.authorization!==`Bearer token-${label}`){res.writeHead(401);return res.end('{}')}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,epoch:label,cursor:1,truncated:false,downloads:[{sequence:1,filename:`${label}.csv`,state:'completed'}]}))})
  await new Promise(r=>server.listen(0,'127.0.0.1',r));servers.push(server)
  const file=join(dir,label+'.json'),result=join(dir,label+'-result.json');await writeFile(file,JSON.stringify({port:server.address().port,token:`token-${label}`}))
  const child=spawn(process.env.PI_TEST_PI,['--mode','rpc','--no-session','--no-extensions','--no-skills','--no-mcp','--provider','local','--model','test','--extension',probe],{cwd:dir,env:{...process.env,HOME:home,PI_CODING_AGENT_DIR:agent,PI_DESKTOP_BROWSER_BRIDGE_FILE:file,PI_BRIDGE_PROBE_RESULT:result,PI_OFFLINE:'1'},stdio:['pipe','pipe','pipe']})
  let diagnostic='';children.push(child);child.stdout.on('data',chunk=>{diagnostic+=String(chunk)});child.stderr.on('data',chunk=>{diagnostic+=String(chunk)});child.stdin.write(JSON.stringify({type:'prompt',message:'/bridge-path-probe'})+'\n')
  let data;for(let i=0;i<300&&!data;i++){try{data=JSON.parse(await readFile(result,'utf8'))}catch{await new Promise(r=>setTimeout(r,50))}}
  assert.equal(data?.ok,true,JSON.stringify(data) ?? diagnostic.slice(-2000));assert.match(JSON.stringify(data.content),new RegExp(`${label}\\.csv`),'Pi must read the bridge named in its own environment')
 }
 console.log('PASS real Pi RPC routes each process to its scoped browser bridge')
}finally{for(const child of children)child.kill();for(const server of servers)await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true})}
