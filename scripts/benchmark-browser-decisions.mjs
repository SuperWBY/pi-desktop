#!/usr/bin/env node
// Synthetic offline fixtures only. Configure an explicit model endpoint to run.
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
const endpoint = process.env.PI_BENCH_ENDPOINT
const model = process.env.PI_BENCH_MODEL
if (!endpoint || !model) { console.error('Set PI_BENCH_ENDPOINT and PI_BENCH_MODEL. No benchmark was run.'); process.exit(2) }
let url
try { url = new URL(endpoint) } catch { console.error('Invalid endpoint.'); process.exit(2) }
const isLocal = url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)
const isOpenCode = url.protocol === 'https:' && url.origin === 'https://opencode.ai' && url.pathname === '/inference/systemone/v1/systemone'
const isTypeSafe = url.protocol === 'https:' && url.origin === 'https://api.typesafe.ai' && url.pathname === '/v1/systemone'
if ((!isLocal && !isOpenCode && !isTypeSafe) || url.username || url.password || url.search || url.hash) { console.error('Endpoint must be loopback or an explicitly supported official endpoint.'); process.exit(2) }
if (isOpenCode && model !== 'jev-1.13-free') { console.error('OpenCode benchmark permits only jev-1.13-free.'); process.exit(2) }
const fixtures = JSON.parse(await readFile(new URL('./fixtures/browser-decisions-zh.json', import.meta.url), 'utf8'))
const results = []
for (const fixture of fixtures) for (const reverse of [false,true]) {
  const indices = fixture.options.map((_,i)=>i)
  if (reverse) indices.reverse()
  const criteria = { none:'没有符合目标的选项' }
  indices.forEach((original,index) => { criteria[`option_${index}`] = fixture.options[original] })
  const expected = fixture.answer === null ? 'none' : `option_${indices.indexOf(fixture.answer)}`
  const payload = { model, state:{ goal:fixture.goal }, questions:{ target:{ type:'choice', instructions:'选择与目标最匹配的选项；没有合适选项时选择 none。', criteria } } }
  const start = performance.now()
  let choice = null
  try {
    const response = await fetch(url, { method:'POST', headers:{'content-type':'application/json', ...(process.env.PI_BENCH_KEY ? { authorization:`Bearer ${process.env.PI_BENCH_KEY}` } : {})}, body:JSON.stringify(payload), signal:AbortSignal.timeout(15000) })
    if (response.ok) {
      const data = await response.json()
      const answer = data.answers?.target
      if (answer?.type === 'choice' && Object.hasOwn(criteria,answer.choice)) choice = answer.choice
    }
  } catch {}
  const chosenIndex = choice === 'none' ? null : choice === null ? undefined : indices[Number(choice.slice('option_'.length))]
  results.push({ correct:choice === expected, failed:choice === null, chosenIndex, ms:Math.round(performance.now()-start) })
}
const durations = results.map(r=>r.ms).sort((a,b)=>a-b)
const percentile = p => durations[Math.ceil(durations.length*p)-1]
const consistent = fixtures.filter((_,i) => !results[2*i].failed && !results[2*i+1].failed && results[2*i].chosenIndex === results[2*i+1].chosenIndex).length
const report = { model, cases:fixtures.length, decisions:results.length, correct:results.filter(r=>r.correct).length, failed:results.filter(r=>r.failed).length, order_consistent_pairs:consistent, p50_ms:percentile(.5), p95_ms:percentile(.95), note:'Synthetic target-selection test only; not an end-to-end browser, safety or anti-bot benchmark.' }
console.log(JSON.stringify(report,null,2))
if (results.some(r=>r.failed)) process.exitCode=1
