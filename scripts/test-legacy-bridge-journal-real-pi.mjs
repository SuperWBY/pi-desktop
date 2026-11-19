import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
if(!process.env.PI_TEST_PI) throw Error('Set PI_TEST_PI to the real Pi executable')
const dir=await mkdtemp(join(tmpdir(),'pi-legacy-bridge-')), agent=join(dir,'agent'), home=join(dir,'home'), result=join(dir,'result.json')
await mkdir(agent,{recursive:true});await mkdir(home,{recursive:true})
if(process.env.TEST_BRIDGE_PRESENT==='1') await writeFile(join(dir,'missing.json'),JSON.stringify({port:1,token:'test'}))
await writeFile(join(agent,'models.json'),JSON.stringify({providers:{local:{baseUrl:'http://127.0.0.1:1/v1',api:'openai-completions',apiKey:'test',models:[{id:'test'}]}}}))
const probe=join(dir,'probe.ts')
await writeFile(probe,`import computerUse from ${JSON.stringify(resolve('extensions/computer-use/index.ts'))}; import {BrowserActionJournal} from ${JSON.stringify(resolve('extensions/computer-use/src/browser-action-journal.ts'))}; import {writeFile,mkdir} from 'node:fs/promises'; import {join} from 'node:path'; export default function(pi){const tools={};computerUse({registerTool:t=>tools[t.name]=t,on:()=>{}});pi.registerCommand('legacy-bridge-probe',{description:'local test',handler:async()=>{let error='';try{await tools[process.env.TEST_LEGACY_CDP==='1'?'computer_use_cdp_act':'computer_use_browser_act'].execute('test',{candidateId:process.env.TEST_LEGACY_CDP==='1'?'c1':'b1',type:'click'},undefined,undefined,{ui:{confirm:async()=>true}})}catch(e){error=String(e)}await mkdir(join(process.env.HOME,'.pi','computer-use'),{recursive:true});const j=new BrowserActionJournal(join(process.env.HOME,'.pi','computer-use','browser-actions.sqlite'));const pending=j.pending('extension');j.close();await writeFile(process.env.TEST_RESULT,JSON.stringify({error,pending}))}})}`)
const child=spawn(process.env.PI_TEST_PI,['--mode','rpc','--no-session','--no-extensions','--no-skills','--no-mcp','--provider','local','--model','test','--extension',probe],{cwd:dir,env:{...process.env,HOME:home,PI_CODING_AGENT_DIR:agent,PI_DESKTOP_BROWSER_BRIDGE_FILE:process.env.TEST_STANDALONE==='1'?'':join(dir,'missing.json'),PI_COMPUTER_USE_APPROVAL:'never',TEST_RESULT:result,PI_OFFLINE:'1'},stdio:['pipe','pipe','pipe']})
let diagnostic='';child.stdout.on('data',c=>diagnostic+=String(c));child.stderr.on('data',c=>diagnostic+=String(c))
try{child.stdin.write(JSON.stringify({type:'prompt',message:'/legacy-bridge-probe'})+'\n');let data;for(let i=0;i<300&&!data;i++){try{data=JSON.parse(await readFile(result,'utf8'))}catch{await new Promise(r=>setTimeout(r,50))}}assert.ok(data,diagnostic.slice(-2000));assert.match(data.error,process.env.TEST_LEGACY_CDP==='1'||process.env.TEST_BRIDGE_PRESENT==='1'||process.env.TEST_STANDALONE==='1'?/computer_use_session_open/i:/bridge.*not available/i);assert.equal(data.pending,null);console.log('PASS real Pi clears legacy action journal before unavailable or unguarded bridge action')}
finally{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r))}await rm(dir,{recursive:true,force:true})}
