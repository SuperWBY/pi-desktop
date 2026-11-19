import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
const received=[]
const server=createServer(async (req,res)=>{
 let raw=''; for await(const chunk of req) raw+=chunk
 const body=JSON.parse(raw);received.push(body)
 res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({answers:{target:{type:'choice',choice:'none',confidence:1}}}))
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
try {
 const child=spawn(process.execPath,['scripts/benchmark-browser-decisions.mjs'],{cwd:process.cwd(),env:{...process.env,PI_BENCH_ENDPOINT:`http://127.0.0.1:${server.address().port}/v1/systemone`,PI_BENCH_MODEL:'fixture'}})
 let output='';child.stdout.on('data',chunk=>output+=chunk)
 const code=await new Promise(resolve=>child.on('close',resolve))
 assert.equal(code,0)
 const result=JSON.parse(output)
 assert.equal(result.cases,12);assert.equal(result.decisions,24);assert.equal(result.correct,2);assert.equal(result.failed,0);assert.equal(result.order_consistent_pairs,12)
 assert.equal(received.length,24)
 assert.notDeepEqual(received[0].questions.target.criteria,received[1].questions.target.criteria,'every task tests reversed option order')
 console.log('PASS Chinese benchmark harness: paired fixtures, scoring and latency reporting')
} finally { await new Promise(resolve=>server.close(resolve)) }
