import assert from 'node:assert/strict'
import { selectTargetWithJev } from '../extensions/computer-use/src/jev.ts'
let body
const fakeFetch = async (_url, options) => {
  body = JSON.parse(options.body)
  return new Response(JSON.stringify({ answers: { target: { type: 'choice', choice: 'option_1', confidence: 0.8 } } }), { status: 200 })
}
const candidates = [{ id: 'c1', role: 'button', name: 'Search' }, { id: 'c2', role: 'button', name: 'Next' }, { id: 'c3', name: 'Secret', secure: true }]
assert.deepEqual(await selectTargetWithJev('go next', candidates, { key: 'key', sharePageText: false, fetch: fakeFetch }), { status: 'disabled' })
assert.deepEqual(await selectTargetWithJev('go next', candidates, { key: 'key', sharePageText: true, fetch: fakeFetch }), { status: 'ok', candidateId: 'c2', confidence: 0.8 })
assert.ok(!JSON.stringify(body).includes('Secret'))
assert.equal(body.questions.target.type, 'choice')
const bad = async () => new Response(JSON.stringify({ answers: { target: { type: 'choice', choice: 'option_999', confidence: 0.99 } } }), { status: 200 })
assert.deepEqual(await selectTargetWithJev('go next', candidates, { key: 'key', sharePageText: true, fetch: bad }), { status: 'unavailable' })
console.log('PASS Jev target choice: explicit text sharing, candidate validation, secure exclusion')
let freeBody
const freeFetch = async (url, options) => {
  assert.equal(url, 'https://opencode.ai/inference/systemone/v1/systemone')
  freeBody = JSON.parse(options.body)
  return new Response(JSON.stringify({ answers: { target: { type: 'choice', choice: 'none', confidence: 0.5 } } }), { status: 200 })
}
assert.deepEqual(await selectTargetWithJev('find next', candidates, { key: 'key', provider: 'opencode-free', sharePageText: true, fetch: freeFetch }), { status: 'ok', candidateId: null, confidence: 0.5 })
assert.equal(freeBody.model, 'jev-1.13-free')
console.log('PASS OpenCode target choice uses only the free model')
