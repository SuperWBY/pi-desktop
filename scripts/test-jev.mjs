import assert from 'node:assert/strict'
import { judgeWithJev } from '../extensions/computer-use/src/jev.ts'
let requests = 0
let payload
const request = async (url, options) => {
  requests++
  assert.equal(url, 'https://api.typesafe.ai/v1/systemone')
  assert.equal(options.headers.authorization, 'Bearer test-key')
  payload = JSON.parse(options.body)
  return new Response(JSON.stringify({ answers: { risk: { type: 'noul', noul: 0.83 } } }), { status: 200 })
}
assert.deepEqual(await judgeWithJev({ action: 'click', role: 'button' }, { key: '', fetch: request }), { status: 'disabled' })
assert.equal(requests, 0)
assert.deepEqual(await judgeWithJev({ action: 'click', role: 'button' }, { key: 'test-key', fetch: request }), { status: 'ok', risk: 0.83 })
assert.equal(payload.model, 'jev-latest')
assert.deepEqual(payload.state, { action: 'click', role: 'button' })
assert.equal(payload.questions.risk.type, 'noul')
await judgeWithJev({ action: 'secret-action', role: 'private-page-data' }, { key: 'test-key', fetch: request })
assert.deepEqual(payload.state, { action: 'unknown', role: 'other' })
const invalid = async () => new Response(JSON.stringify({ answers: { risk: { type: 'noul', noul: 1.5 } } }), { status: 200 })
assert.equal((await judgeWithJev({ action: 'click', role: 'button' }, { key: 'test-key', fetch: invalid })).status, 'unavailable')
const failed = async () => { throw new Error('secret should not leak') }
assert.deepEqual(await judgeWithJev({ action: 'click', role: 'button' }, { key: 'test-key', fetch: failed }), { status: 'unavailable' })
console.log('PASS Jev: opt-in, official request schema, minimal data and safe fallback')
const calls = []
const freeFetch = async (url, options) => {
  calls.push({ url, options })
  return new Response(JSON.stringify({ answers: { risk: { type: 'noul', noul: 0.2 } } }), { status: 200 })
}
assert.equal((await judgeWithJev({ action: 'click', role: 'button' }, { key: 'console-key', provider: 'opencode-free', fetch: freeFetch })).status, 'ok')
assert.equal(calls[0].url, 'https://opencode.ai/inference/systemone/v1/systemone')
assert.equal(JSON.parse(calls[0].options.body).model, 'jev-1.13-free')
assert.equal(calls[0].options.headers.authorization, 'Bearer console-key')
assert.equal((await judgeWithJev({ action: 'click', role: 'button' }, { key: 'console-key', provider: 'opencode-free', model: 'jev-1.13', fetch: freeFetch })).status, 'unavailable')
assert.equal(calls.length, 1, 'the free provider must never issue a paid model request')
console.log('PASS OpenCode free provider: correct endpoint, model and no paid fallback')
