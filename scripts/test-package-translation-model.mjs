import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const dir = await mkdtemp(join(tmpdir(), 'pi-translation-model-'))
const require = createRequire(import.meta.url)
const fixture = `import { EventEmitter } from 'node:events'
export class PiProcess extends EventEmitter {
 async start(options) { this.options=options; globalThis.translationFixture.starts.push(options) }
 stop() { globalThis.translationFixture.stops++ }
 async send(command) {
  const f=globalThis.translationFixture
  if(command.type==='get_state') return {data:{thinkingLevel:'low',model:{provider:'connected',id:'reasoning'}}}
  if(command.type==='get_available_models') return {data:{models:[{provider:'other',id:'haiku',reasoning:false},{provider:'connected',id:'haiku',reasoning:true}]}}
  if(command.type!=='prompt') throw Error('Unexpected command')
  const texts=JSON.parse(command.message).texts;f.prompts.push(texts)
  if(f.fail==='provider') throw Error('provider unavailable')
  const bad=f.fail==='always' || (f.fail==='large'&&texts.length>2)
  queueMicrotask(()=>this.emit('record',{type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:bad?'[invalid':JSON.stringify(texts.map(x=>'译 '+x))}]}}))
  return {success:true}
 }
}`
try {
 const outfile = join(dir, 'model.cjs')
 await build({ entryPoints:['src/main/package-translation-model.ts'],bundle:true,platform:'node',format:'cjs',outfile,plugins:[{name:'readonly-model-fixtures',setup(b){
  b.onResolve({filter:/^\.\/(pi|pi-runtime|settings|network-env)$/},a=>({path:a.path,namespace:'fixture'}))
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='./pi'?fixture:a.path==='./settings'?`export const loadSettings=()=>({});`:a.path==='./pi-runtime'?`export const resolvePiPath=()=>'/mock/pi';`:`export const proxyEnv=()=>({});`}))
 }}]})
 const worker = require(outfile)
 const reset = fail => globalThis.translationFixture={fail,starts:[],prompts:[],stops:0}
 let f=reset('large')
 assert.deepEqual(await worker.translatePackageTexts(['one','two','three','four'],'zh-CN','/tmp'),['译 one','译 two','译 three','译 four'])
 assert.deepEqual(f.prompts.map(x=>x.length),[4,2,2])
 assert.ok(f.starts.every(x=>x.additionalArgs.includes('--no-session')&&x.additionalArgs.includes('--no-tools')&&x.additionalArgs.includes('--no-context-files')))
 assert.ok(f.starts.filter(x=>x.additionalArgs.includes('--model')).every(x=>x.additionalArgs.includes('connected')&&x.additionalArgs.includes('haiku')&&!x.additionalArgs.includes('other')))
 assert.equal(f.stops,f.starts.length)
 f=reset('always')
 await assert.rejects(worker.translatePackageTexts(Array.from({length:48},(_,i)=>String(i)),'en','/tmp'))
 assert.deepEqual(f.prompts.map(x=>x.length),[48,24,12,6,3,2,1])
 assert.equal(f.stops,f.starts.length)
 f=reset('provider')
 await assert.rejects(worker.translatePackageTexts(['a','b'],'en','/tmp'))
 assert.equal(f.prompts.length,1)
 worker.stopPackageTranslations()
 await assert.rejects(worker.translatePackageTexts(['a'],'en','/tmp'),/closing/)
 console.log('✓ Same-provider CLI overrides, process cleanup, ordered formatting recovery, bounded retries and provider failure behavior')
} finally { delete globalThis.translationFixture;await rm(dir,{recursive:true,force:true}) }
