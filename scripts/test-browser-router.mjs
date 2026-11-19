import assert from 'node:assert/strict'
import { BrowserRouter } from '../extensions/computer-use/src/browser-router.ts'

const calls = []
const adapters = Object.fromEntries(['inapp', 'cdp', 'extension'].map((backend) => [backend, {
  async observe() { calls.push(`${backend}:observe`); return { candidates: [{ id: 'one', role: 'button', name: 'Go' }], url: 'https://example.test/' } },
  async act(action) { calls.push(`${backend}:${action.type}`); return { ok: true } },
  async close() { calls.push(`${backend}:close`) }
}]))
let allow = true
let approvals = 0
let release
const router = new BrowserRouter(adapters, { approve: async () => { approvals++; return allow } })
assert.throws(() => router.current(), /session/i)
const session = await router.open('cdp')
assert.equal(session.backend, 'cdp')
await assert.rejects(() => router.open('inapp'), /close/i)
await assert.rejects(() => router.act({ candidateId: 'one', type: 'click' }), /observe/i)
await router.observe()
await assert.rejects(() => router.act({candidateId:'one',type:'type',text:'x'.repeat(20001)}), /20,?000|20000/i, 'oversized input must be rejected before approval and dispatch')
assert.ok(!calls.includes('cdp:type'))
assert.equal(approvals,0,'oversized input must not request approval')
await assert.rejects(() => router.act({candidateId:'one',type:'press',key:'k'.repeat(201)}), /200/i)
assert.equal(approvals,0,'oversized key must not request approval')
allow=false
assert.equal((await router.act({candidateId:'one',type:'type',text:'x'.repeat(20000)})).cancelled,true,'limit-sized input is available for approval')
assert.equal(approvals,1)
allow=true

await assert.rejects(() => router.act({ candidateId: 'other', type: 'click' }), /candidate/i)
allow = false
assert.equal((await router.act({ candidateId: 'one', type: 'click' })).cancelled, true)
assert.ok(!calls.includes('cdp:click'))
allow = true
await router.act({ candidateId: 'one', type: 'click' })
assert.equal(calls.filter((c) => c === 'cdp:click').length, 1)
await assert.rejects(() => router.act({ candidateId: 'one', type: 'click' }), /observe/i)
await router.observe()
adapters.cdp.act = async () => { await new Promise((resolve) => { release = resolve }); return { ok: true } }
const pending = router.act({ candidateId: 'one', type: 'click' })
await new Promise((resolve) => setImmediate(resolve))
await assert.rejects(() => router.act({ candidateId: 'one', type: 'click' }), /busy/i)
await assert.rejects(() => router.close(), /busy/i)
release(); await pending
await router.observe()
adapters.cdp.act = async () => { throw new Error('transport failed') }
await assert.rejects(router.act({ candidateId: 'one', type: 'click' }), /result is unknown/i)
await assert.rejects(router.act({ candidateId: 'one', type: 'click' }), /result is unknown/i)
router.pauseForUser()
router.resumeAfterUser()
adapters.cdp.observe = async () => ({ candidates: [{ id: 'secret', role: 'input', secure: true }] })
await router.observe()
await assert.rejects(router.act({ candidateId: 'secret', type: 'type', text: 'secret' }), /secure/i)
await router.close()
assert.equal(calls.at(-1), 'cdp:close')
assert.throws(() => router.current(), /session/i)
console.log('PASS browser router: session lock, approval, stale observation, concurrency and close')
