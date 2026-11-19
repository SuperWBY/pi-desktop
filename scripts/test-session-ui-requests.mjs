import assert from 'node:assert/strict'
import { SessionUiRequests } from '../src/main/session-ui-requests.ts'

const events = [], replies = [], changes = []
const broker = new SessionUiRequests((record) => events.push(record), (owner, response) => replies.push({ owner, response }), () => changes.push(broker.pendingOwners()))
const a = {}, b = {}
broker.activate(a)
broker.receive(a, { type: 'extension_ui_request', id: 'same', method: 'confirm', title: 'A' })
const aToken = events.at(-1).id
broker.activate(b)
broker.receive(a, { type: 'extension_ui_request', id: 'next', method: 'confirm', title: 'A2' })
broker.receive(b, { type: 'extension_ui_request', id: 'same', method: 'confirm', title: 'B' })
const bToken = events.at(-1).id
assert.deepEqual(broker.pendingOwners(), [a, b])
assert.notEqual(aToken, bToken)
assert.equal(broker.respond({ type: 'extension_ui_response', id: aToken, confirmed: true }), false)
assert.equal(replies.length, 0)
assert.equal(broker.respond({ type: 'extension_ui_response', id: bToken, confirmed: false }), true)
assert.deepEqual(broker.pendingOwners(), [a])
assert.deepEqual(replies.at(-1), { owner: b, response: { type: 'extension_ui_response', id: 'same', confirmed: false } })
broker.activate(a)
assert.deepEqual(events.slice(-2).map((item) => item.title), ['A', 'A2'])
assert.equal(broker.respond({ type: 'extension_ui_response', id: aToken, confirmed: true }), true)
assert.equal(replies.at(-1).owner, a)
broker.drop(a)
assert.deepEqual(broker.pendingOwners(), [])
assert.equal(broker.respond({ type: 'extension_ui_response', id: aToken, confirmed: true }), false)
broker.activate(b)
broker.receive(b, { type: 'extension_ui_request', id: 'timeout', method: 'confirm', timeout: 20 })
const timedToken = events.at(-1).id
await new Promise((resolve) => setTimeout(resolve, 40))
assert.equal(broker.respond({ type: 'extension_ui_response', id: timedToken, confirmed: true }), false)
assert.equal(events.at(-1).type, 'desktop_ui_requests_reset')
assert.deepEqual(changes.at(-1), [])
assert.equal(broker.receive(b, { type: 'extension_ui_request', id: 'notice', method: 'notify' }), false)
broker.dispose()
const denied=[]
const failing=new SessionUiRequests(()=>{},(owner,response)=>denied.push({owner,response}),()=>{}, { begin:()=>{throw Error('disk unavailable')},finish:()=>{},interrupt:()=>{},error:()=>{} })
failing.activate(a)
assert.equal(failing.receive(a,{type:'extension_ui_request',id:'unsafe',method:'confirm'}),true)
assert.equal(denied[0].response.cancelled,true)
assert.deepEqual(failing.pendingOwners(),[])
failing.dispose()
const fallback=[], sent=[]
const cleanupFailure=new SessionUiRequests(record=>sent.push(record),(owner,response)=>fallback.push(response),()=>{}, {begin:()=>{},finish:()=>{throw Error('disk unavailable')},interrupt:()=>{},error:()=>{}})
cleanupFailure.activate(a)
cleanupFailure.receive(a,{type:'extension_ui_request',id:'finish-fail',method:'confirm'})
cleanupFailure.respond({type:'extension_ui_response',id:sent.at(-1).id,confirmed:true})
assert.equal(fallback[0].cancelled,true,'approval must fail closed when its durable record cannot be updated')
cleanupFailure.dispose()
console.log('PASS session UI requests: background replay, ownership, duplicate IDs, timeout, stale responses and cleanup')
