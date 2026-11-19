import assert from 'node:assert/strict'
import { grantProjectTrustOnce } from '../src/main/project-trust-once.ts'
let owner={}, current=owner, streaming=false, pending=false, accepted=false, restarts=0, cwd='/tmp/fixture', path='/tmp/session'
const deps={current:()=>current,pending:()=>pending,inspect:async()=>({cwd,sessionFile:path,isStreaming:streaming}),confirm:async()=>accepted,restart:async()=>{restarts++;return {ok:true}}}
let result=await grantProjectTrustOnce(deps)
assert.equal(result.cancelled,true,'cancel must not restart')
assert.equal(restarts,0)
accepted=true;streaming=true
result=await grantProjectTrustOnce(deps);assert.equal(result.ok,false);assert.equal(restarts,0)
streaming=false;pending=true
result=await grantProjectTrustOnce(deps);assert.equal(result.ok,false);assert.equal(restarts,0)
pending=false
result=await grantProjectTrustOnce({...deps,confirm:async()=>{current={};return true}})
assert.equal(result.ok,false);assert.equal(restarts,0,'switching sessions during consent must not authorize another project')
current=owner
result=await grantProjectTrustOnce({...deps,confirm:async()=>{path='/tmp/other';return true}})
assert.equal(result.ok,false);assert.equal(restarts,0,'changed session must not be restarted')
path='/tmp/session'
result=await grantProjectTrustOnce(deps);assert.equal(result.ok,true);assert.equal(restarts,1)
console.log('PASS one-session trust consent: cancellation, busy, pending, switch, changed session, explicit consent')
