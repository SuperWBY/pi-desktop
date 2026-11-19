import assert from 'node:assert/strict'
import { evaluateBusinessState } from './fixtures/business-backoffice/evaluator.mjs'
const expected={recordId:'ORD-2026-002',name:'fixture.csv',sha256:'known-hash',size:12}
const upload={...expected}
const submission={recordId:expected.recordId,sha256:expected.sha256,status:'已提交'}
const check=state=>evaluateBusinessState(state,expected,{uploadAttempts:1,submitAttempts:1})
assert.equal(check({uploads:[upload],submissions:[submission]}).matched,true)
assert.equal(check({uploads:[],submissions:[submission]}).matched,false)
assert.equal(check({uploads:[{...upload,recordId:'ORD-2026-001'}],submissions:[submission]}).matched,false)
assert.equal(check({uploads:[{...upload,sha256:'different'}],submissions:[submission]}).matched,false)
assert.equal(check({uploads:[upload],submissions:[{...submission,status:'处理中'}]}).matched,false)
assert.equal(check({uploads:[upload,upload],submissions:[submission]}).matched,false)
assert.equal(check({uploads:[upload],submissions:[submission,submission]}).duplicateSideEffects,true)
assert.equal(evaluateBusinessState({uploads:[upload],submissions:[submission]},expected,{uploadAttempts:2,submitAttempts:1}).matched,false)
assert.equal(evaluateBusinessState({uploads:[upload],submissions:[submission]},expected,{uploadAttempts:-1,submitAttempts:1}).duplicateAttempts,null)
assert.equal(evaluateBusinessState({uploads:[upload],submissions:[submission]},expected,{}).matched,false)
console.log('PASS independent business evaluator: correct, missing, wrong record, wrong hash, pending and duplicates')
