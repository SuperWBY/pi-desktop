import assert from 'node:assert/strict'
import { randomBytes, createHmac } from 'node:crypto'
import { createAuthenticatedBridge } from '../extensions/computer-use/src/chrome-bridge-auth.ts'
const key = randomBytes(32).toString('hex')
const sign = (...values) => createHmac('sha256', Buffer.from(key, 'hex')).update(values.join('\n')).digest('hex')
const bridge = createAuthenticatedBridge({ key, task: { id: 'task1', type: 'observe' }, port: 0, timeoutMs: 3000 })
const address = await bridge.ready
const url = `http://127.0.0.1:${address.port}`
assert.equal((await fetch(`${url}/next`)).status, 404, 'legacy unauthenticated client receives no task')
const c = randomBytes(32).toString('hex')
const challenge = await fetch(`${url}/challenge?client=${c}`).then(r => r.json())
assert.equal(challenge.proof, sign('server', c, challenge.nonce), 'server proves possession of shared key')
const send = async (path, body) => fetch(`${url}${path}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) })
assert.equal((await send('/next', { client:c, nonce:challenge.nonce, proof:'0'.repeat(64) })).status, 403, 'forged client cannot obtain a task')
const signed = { client:c, nonce:challenge.nonce, proof:sign('client',c,challenge.nonce) }
const envelope = await (await send('/next', signed)).json()
assert.equal(envelope.proof, sign('task', c, challenge.nonce, envelope.payload), 'task is bound to authenticated exchange')
assert.equal(JSON.parse(envelope.payload).id,'task1')
assert.equal((await send('/next', signed)).status, 409, 'challenge cannot be replayed')
const payload = JSON.stringify({ id:'task1', ok:true, result:'done' })
assert.equal((await send('/result', {client:c,nonce:challenge.nonce,payload,proof:'0'.repeat(64)})).status,403,'forged result rejected')
const response = await send('/result', {client:c,nonce:challenge.nonce,payload,proof:sign('result',c,challenge.nonce,payload)})
assert.equal(response.status,200)
assert.equal(await bridge.result,'done')
console.log('PASS authenticated bridge: mutual proof, tamper resistance and replay protection')
