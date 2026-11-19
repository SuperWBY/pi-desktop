import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

const HEX = /^[a-f0-9]{64}$/
type Options = { key: string; task: { id: string; type: string; [key: string]: unknown }; port: number; timeoutMs: number }

/** One authenticated, at-most-once exchange. A shared key does not protect against same-user malware. */
export function createAuthenticatedBridge(options: Options): { ready: Promise<AddressInfo>; result: Promise<unknown> } {
  if (!HEX.test(options.key)) throw new Error('Chrome bridge pairing key is missing or invalid. Reload the extension setup.')
  const secret = Buffer.from(options.key, 'hex')
  const sign = (...parts: string[]): string => createHmac('sha256', secret).update(parts.join('\n')).digest('hex')
  const verify = (proof: unknown, ...parts: string[]): boolean => typeof proof === 'string' && HEX.test(proof) && timingSafeEqual(Buffer.from(proof, 'hex'), Buffer.from(sign(...parts), 'hex'))
  let delivered: { client: string; nonce: string } | null = null
  let finished = false
  const challenges = new Map<string, { client: string; expires: number }>()
  let resolveResult!: (value: unknown) => void
  let rejectResult!: (error: Error) => void
  const result = new Promise<unknown>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
  const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      const data = Buffer.from(chunk)
      size += data.length
      if (size > 2_000_000) throw new Error('Body too large')
      chunks.push(data)
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body')
    return body as Record<string, unknown>
  }
  const server = createServer((req, res) => void (async () => {
    const origin = req.headers.origin ?? ''
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) { res.writeHead(403).end(); return }
    const headers = { 'content-type': 'application/json', ...(origin ? { 'access-control-allow-origin': origin } : {}) }
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...headers, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type' }).end(); return }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/challenge') {
      const client = url.searchParams.get('client') ?? ''
      if (!HEX.test(client) || delivered) { res.writeHead(400, headers).end(); return }
      const now = Date.now()
      for (const [nonce, item] of challenges) if (item.expires <= now) challenges.delete(nonce)
      if (challenges.size >= 64) { res.writeHead(429, headers).end(); return }
      const nonce = randomBytes(32).toString('hex')
      challenges.set(nonce, { client, expires: now + 10_000 })
      res.writeHead(200, headers).end(JSON.stringify({ nonce, proof: sign('server', client, nonce) }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/next') {
      const body = await readBody(req)
      const client = String(body.client ?? ''), nonce = String(body.nonce ?? '')
      const challenge = challenges.get(nonce)
      if (delivered) { res.writeHead(409, headers).end(); return }
      if (!challenge || challenge.client !== client || challenge.expires <= Date.now() || !verify(body.proof, 'client', client, nonce)) { res.writeHead(403, headers).end(); return }
      challenges.clear()
      delivered = { client, nonce }
      const payload = JSON.stringify(options.task)
      res.writeHead(200, headers).end(JSON.stringify({ payload, proof: sign('task', client, nonce, payload) }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/result') {
      const body = await readBody(req)
      const client = String(body.client ?? ''), nonce = String(body.nonce ?? ''), payload = body.payload
      if (finished || !delivered || delivered.client !== client || delivered.nonce !== nonce || typeof payload !== 'string' || !verify(body.proof, 'result', client, nonce, payload)) { res.writeHead(403, headers).end(); return }
      const answer = JSON.parse(payload) as { id?: string; ok?: boolean; result?: unknown; error?: string }
      if (answer.id !== options.task.id || typeof answer.ok !== 'boolean') { res.writeHead(400, headers).end(); return }
      finished = true
      res.writeHead(200, headers).end('{"ok":true}', () => { cleanup(); answer.ok ? resolveResult(answer.result) : rejectResult(new Error(answer.error || 'Chrome extension action failed')) })
      return
    }
    res.writeHead(404, headers).end()
  })().catch(() => { if (!res.headersSent) res.writeHead(400).end(); else res.destroy() }))
  const cleanup = (): void => { clearTimeout(timer); server.close(); server.closeAllConnections?.() }
  const timer = setTimeout(() => {
    if (finished) return
    finished = true
    cleanup()
    rejectResult(new Error(delivered ? 'Chrome bridge did not return a result. The action may have run; observe the page before retrying.' : 'Authenticated Chrome extension did not connect. Reload the extension or check pairing.'))
  }, options.timeoutMs)
  const ready = new Promise<AddressInfo>((resolve, reject) => {
    server.once('error', (error) => { clearTimeout(timer); finished = true; rejectResult(error); reject(error) })
    server.listen(options.port, '127.0.0.1', () => { server.unref(); resolve(server.address() as AddressInfo) })
  })
  return { ready, result }
}
