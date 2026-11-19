import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomBytes, createHmac } from 'node:crypto'
import { checkChromeBridge } from '../src/main/chrome-bridge-check.ts'
const key = randomBytes(32).toString('hex')
const sign = (...parts) => createHmac('sha256',Buffer.from(key,'hex')).update(parts.join('\n')).digest('hex')
const reserve = createServer()
await new Promise((resolve) => reserve.listen(0,'127.0.0.1',resolve))
const port = reserve.address().port
await new Promise((resolve) => reserve.close(resolve))
const endpoint = `http://127.0.0.1:${port}`
const pending = checkChromeBridge({port, timeoutMs:2000, key, expectedVersion:'0.1.13'})
const client = randomBytes(32).toString('hex')
let challenge
for (let i=0;i<30;i++) {
 try { challenge=await fetch(`${endpoint}/challenge?client=${client}`).then(r=>r.json()); break } catch { await new Promise(r=>setTimeout(r,10)) }
}
assert.equal(challenge.proof,sign('server',client,challenge.nonce))
const post = (path, body) => fetch(`${endpoint}${path}`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
const envelope = await (await post('/next',{client,nonce:challenge.nonce,proof:sign('client',client,challenge.nonce)})).json()
const ping = JSON.parse(envelope.payload)
assert.equal(ping.type,'ping')
const payload = JSON.stringify({id:ping.id,ok:true,result:{protocol:1}})
assert.equal((await post('/result',{client,nonce:challenge.nonce,payload,proof:sign('result',client,challenge.nonce,payload)})).status,200)
const legacy=await pending
assert.equal(legacy.connected,true)
assert.equal(legacy.versionStatus,'unknown','a connected legacy extension must not be reported as current')
assert.equal((await checkChromeBridge({port,timeoutMs:100,key})).connected,false)
const blocker=createServer()
await new Promise(r=>blocker.listen(port,'127.0.0.1',r))
assert.equal((await checkChromeBridge({port,timeoutMs:100,key})).busy,true)
await new Promise(r=>blocker.close(r))
console.log('PASS connection check requires authenticated matching ping and detects busy')
