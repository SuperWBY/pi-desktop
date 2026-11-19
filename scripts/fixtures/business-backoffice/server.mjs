import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

// Local test fixture only. The evaluator reads this state independently of the page.
export async function startBackoffice() {
  const html = await readFile(new URL('./index.html', import.meta.url))
  const records = [
    { id: 'ORD-2026-001', name: '青木测试商品', status: '待处理' },
    { id: 'ORD-2026-002', name: '青木测试商品', status: '待处理' }
  ]
  const state = { submissions: [], uploads: [] }
  const metrics = { uploadAttempts: 0, submitAttempts: 0 }
  const csv = '\uFEFF订单编号,商品名称,状态\nORD-2026-001,青木测试商品,待处理\nORD-2026-002,青木测试商品,待处理\n'
  const hash = (value) => createHash('sha256').update(value).digest('hex')
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const json = (status, data) => res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify(data))
    if (req.method === 'GET' && url.pathname === '/') return res.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'no-store'}).end(html)
    if (req.method === 'GET' && url.pathname === '/api/records') return json(200, records.filter(r => r.id.includes(url.searchParams.get('q') ?? '')).map(r => ({ ...r, status: state.submissions.some(s => s.recordId === r.id) ? '已提交' : r.status })))
    if (req.method === 'GET' && url.pathname === '/api/state') return json(200, state)
    if (req.method === 'GET' && url.pathname === '/api/metrics') return json(200, metrics)
    if (req.method === 'GET' && url.pathname === '/report.csv') return res.writeHead(200, {'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="report.csv"','cache-control':'no-store'}).end(csv)
    if (req.method !== 'POST' || !['/api/upload','/api/submit'].includes(url.pathname)) return json(404, {error:'Not found'})
    if (url.pathname === '/api/upload') metrics.uploadAttempts++
    else metrics.submitAttempts++
    let raw = ''
    for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) return json(413, {error:'Too large'}) }
    let data
    try { data = JSON.parse(raw) } catch { return json(400, {error:'Invalid JSON'}) }
    if (!records.some(r => r.id === data.recordId)) return json(400, {error:'Unknown record'})
    if (url.pathname === '/api/upload') {
      if (typeof data.name !== 'string' || typeof data.content !== 'string' || !data.name.endsWith('.csv')) return json(400, {error:'Invalid file'})
      const upload = { recordId:data.recordId, name:data.name, sha256:hash(data.content), size:Buffer.byteLength(data.content) }
      state.uploads.push(upload)
      return json(200, upload)
    }
    if (!state.uploads.some(u => u.recordId === data.recordId && u.sha256 === data.sha256)) return json(400, {error:'Upload not found'})
    if (state.submissions.some(s => s.recordId === data.recordId)) return json(409, {error:'Already submitted'})
    const submission = { recordId:data.recordId, sha256:data.sha256, status:'已提交' }
    state.submissions.push(submission)
    return json(200, submission)
  })
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve) })
  return { url:`http://127.0.0.1:${server.address().port}`, csv, close:() => new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())) }
}
