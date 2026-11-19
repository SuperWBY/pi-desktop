import assert from 'node:assert/strict'
import {startBackoffice} from './fixtures/business-backoffice/server.mjs'
import {evaluateBusinessState} from './fixtures/business-backoffice/evaluator.mjs'
import {createHash} from 'node:crypto'
const fixture=await startBackoffice()
try {
 const content='test',sha256=createHash('sha256').update(content).digest('hex'),recordId='ORD-2026-002',name='fixture.csv'
 const post=(path,data)=>fetch(fixture.url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)})
 assert.equal((await post('/api/upload',{recordId,name,content})).status,200)
 assert.equal((await post('/api/submit',{recordId,sha256})).status,200)
 assert.equal((await post('/api/submit',{recordId,sha256})).status,409)
 const state=await (await fetch(fixture.url+'/api/state')).json()
 const metrics=await (await fetch(fixture.url+'/api/metrics')).json()
 assert.equal(state.submissions.length,1,'server rejected the duplicate side effect')
 assert.deepEqual(metrics,{uploadAttempts:1,submitAttempts:2})
 const result=evaluateBusinessState(state,{recordId,name,sha256,size:Buffer.byteLength(content)},metrics)
 assert.equal(result.duplicateSideEffects,false)
 assert.equal(result.duplicateAttempts,true)
 assert.equal(result.matched,false,'rejected duplicate attempt must not count as a clean run')
 assert.equal(evaluateBusinessState(state,{recordId,name,sha256,size:Buffer.byteLength(content)}).matched,false,'missing attempt metrics must not be considered clean')
 console.log('PASS independent evaluator detects rejected duplicate submission attempts')
} finally {await fixture.close()}
