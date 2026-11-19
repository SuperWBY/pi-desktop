import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..'),home=mkdtempSync(join(tmpdir(),'pi-outer-home-'))
try{
 const dir=join(home,'.pi','computer-use');mkdirSync(dir,{recursive:true})
 const bridge=join(dir,'browser-bridge.json'),sentinel='outer-instance-must-remain'
 writeFileSync(bridge,sentinel)
 const run=spawnSync(process.execPath,['scripts/e2e.mjs'],{cwd:root,env:{...process.env,HOME:home,E2E_ONLY:'computer-use-permissions'},encoding:'utf8',timeout:60000})
 assert.equal(run.status,0,`isolated Electron regression must pass: ${run.stderr}`)
 assert.ok(existsSync(bridge),'test app must not delete another instance bridge')
 assert.equal(readFileSync(bridge,'utf8'),sentinel,'test app must not overwrite another instance bridge')
 console.log('PASS e2e test uses an isolated HOME and leaves outer bridge untouched')
}finally{rmSync(home,{recursive:true,force:true})}
