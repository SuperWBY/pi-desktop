import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (!process.env.PI_TEST_PI) throw Error('Set PI_TEST_PI to the real Pi executable.')
const dir=await mkdtemp(join(tmpdir(),'pi-confirm-rpc-'))
const probe=join(dir,'probe.mjs'), result=join(dir,'result.json')
await writeFile(probe, `import {writeFileSync} from 'node:fs'; export default pi=>pi.registerCommand('confirm-probe',{description:'Test confirmation',handler:async(_args,ctx)=>{const yes=await ctx.ui.confirm('one','test');const no=await ctx.ui.confirm('two','test');writeFileSync(process.env.PI_PROBE_RESULT,JSON.stringify({yes,no}));}});`)
const child=spawn(process.env.PI_TEST_PI,['--mode','rpc','--no-session','--no-extensions','--no-skills','--no-mcp','--extension',probe],{cwd:dir,env:{...process.env,HOME:dir,PI_CODING_AGENT_DIR:join(dir,'agent'),PI_PROBE_RESULT:result,PI_OFFLINE:'1'},stdio:['pipe','pipe','pipe']})
let buffer='', seen=0, stderr=''
child.stderr.on('data',chunk=>{stderr+=chunk})
child.stdout.on('data',chunk=>{buffer+=chunk;for(;;){const i=buffer.indexOf('\n');if(i<0)break;const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const m=JSON.parse(line);if(m.type==='extension_ui_request'&&m.method==='confirm'){seen++;child.stdin.write(JSON.stringify({type:'extension_ui_response',id:m.id,confirmed:seen===1})+'\n')}}catch{}}})
child.stdin.write(JSON.stringify({type:'prompt',message:'/confirm-probe'})+'\n')
try {
 let value; const deadline=Date.now()+15000
 while(Date.now()<deadline&&!value){try{value=JSON.parse(await readFile(result,'utf8'))}catch{await new Promise(resolve=>setTimeout(resolve,50))}}
 assert.equal(seen,2,stderr); assert.deepEqual(value,{yes:true,no:false})
 console.log('PASS real Pi RPC: confirmation yes/no is preserved')
} finally {child.kill();await rm(dir,{recursive:true,force:true})}
