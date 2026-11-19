import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, mkdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { chromium } from 'playwright'
import { BrowserRouter } from '../extensions/computer-use/src/browser-router.ts'
import { judgeWithJev } from '../extensions/computer-use/src/jev.ts'
import { browserChallengeCode } from '../extensions/computer-use/src/browser-challenge.ts'
import { browserTargetGuardCode } from '../extensions/computer-use/src/browser-target.ts'
import { browserFileSnapshotCode } from '../extensions/computer-use/src/browser-file-context.ts'
import { browserPageTextCode } from '../extensions/computer-use/src/browser-page-text.ts'

const temp = await mkdtemp(join(tmpdir(), 'pi-router-cdp-'))
const site = createServer((req, res) => {
  if (req.url === '/never') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.flushHeaders()
    return
  }
  if (req.url === '/redirect') return res.writeHead(302, { location:'/slow' }).end()
  if (req.url === '/slow') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.flushHeaders()
    setTimeout(() => res.end('<title>Slow page</title><button>Delayed document</button>'), 1100)
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<title>Router test</title><p>上传成功</p><div hidden>hidden-secret</div><button onclick="this.textContent=\'clicked\'">Go</button><textarea autocomplete="one-time-code">otp-secret</textarea>')
})
const reserve = createServer()
let browser
try {
  await Promise.all([new Promise((resolve) => site.listen(0, '127.0.0.1', resolve)), new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve))])
  const cdpPort = reserve.address().port
  await new Promise((resolve) => reserve.close(resolve))
  browser = await chromium.launchPersistentContext(join(temp, 'profile'), { headless: true, executablePath: process.env.PI_TEST_CHROME || undefined, args: [`--remote-debugging-port=${cdpPort}`] })
  const page = browser.pages()[0] || await browser.newPage()
  const source = await readFile(new URL('../extensions/computer-use/index.ts', import.meta.url), 'utf8')
  const cdpSource = source.slice(source.indexOf('const cdpProfileDir ='), source.indexOf('const chromeBridgePort =')) + source.slice(source.indexOf('async function ensureCdpPage'), source.indexOf('async function audit('))
  class FailedSocket {
    constructor() { this.readyState = 0; this.listeners = {}; setTimeout(() => this.listeners.error?.(), 0) }
    addEventListener(type, callback) { this.listeners[type] = callback }
    close() { this.readyState = 3 }
  }
  const failedCdp = runInNewContext(`${stripTypeScriptTypes(cdpSource)}\n({ cdpConnect, socketState: () => cdpSocket?.readyState ?? null })`, { browserChallengeCode, browserTargetGuardCode, browserFileSnapshotCode, homedir: () => temp, join, spawn, mkdir, unlink, fetch: async () => ({ ok: true, json: async () => [{ type:'page', webSocketDebuggerUrl:'ws://127.0.0.1/' }] }), WebSocket: FailedSocket, AbortSignal, setTimeout, clearTimeout, process: { env: {} } })
  await assert.rejects(failedCdp.cdpConnect(temp), /connection failed/i)
  assert.equal(failedCdp.socketState(), null, 'failed CDP handshake must release the socket so reconnect can start')
  const hangingCdp = runInNewContext(`${stripTypeScriptTypes(cdpSource)}\n({ cdpConnect })`, { browserChallengeCode, browserTargetGuardCode, browserFileSnapshotCode, homedir: () => temp, join, spawn, mkdir, unlink, fetch: (_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))), WebSocket: FailedSocket, AbortSignal, setTimeout, clearTimeout, process: { env: {} } })
  await assert.rejects(Promise.race([hangingCdp.cdpConnect(temp, 250), new Promise((_resolve, reject) => setTimeout(() => reject(new Error('test deadline exceeded')), 1200))]), /CDP.*timed out/i, 'a stalled discovery endpoint must respect the connection deadline')
  const cdp = runInNewContext(`${stripTypeScriptTypes(cdpSource)}\n({ ensureCdpPage, releaseCdpSocket, cdpSend, cdpEval, cdpAction, closeCdp, cdpObserveCode, wrapEval: (wrap) => { cdpEval = wrap(cdpEval) }, socketState: () => cdpSocket?.readyState ?? null })`, { browserChallengeCode, browserTargetGuardCode, browserFileSnapshotCode, homedir: () => temp, join, spawn, mkdir, unlink, fetch, WebSocket, AbortSignal, setTimeout, clearTimeout, process: { env: { PI_CDP_PORT: String(cdpPort) } } })
  for (const action of [{ candidateId: 'bad', type: 'click' }, { candidateId: 'c1', type: 'type', text: '' }, { candidateId: 'c1', type: 'unknown' }]) {
    await assert.rejects(cdp.cdpAction(action))
    assert.equal(cdp.socketState(), null, 'invalid actions must not leave the CDP connection open')
  }
  await cdp.ensureCdpPage(`http://127.0.0.1:${site.address().port}/`)
  const legacyCandidates = await cdp.cdpEval(cdp.cdpObserveCode)
  const legacyButton = legacyCandidates.find(candidate => candidate.name === 'Go')
  assert.ok(legacyButton)
  await page.locator('button').evaluate(el => { el.textContent = 'Delete' })
  try {
    await assert.rejects(cdp.cdpAction({candidateId:legacyButton.id,type:'click'}), /unified session|observe/i, 'an unbound legacy action must be refused before it can click a changed target')
    assert.equal(await page.locator('button').textContent(), 'Delete')
  } finally {
    await page.locator('button').evaluate(el => { el.textContent = 'Go' })
    cdp.releaseCdpSocket()
  }
  const start = source.indexOf('export default function computerUse(')
  const end = source.indexOf("  pi.registerTool({\n    name: 'computer_use_apps'", start)
  const registration = stripTypeScriptTypes(source.slice(start, end).replace('export default function', 'function') + '\n}')
  const definitions = new Map()
  const Type = new Proxy({}, { get: () => (...args) => ({ args }) })
  const factory = runInNewContext(`${registration}\ncomputerUse`, { ...cdp, BrowserRouter, browserChallengeCode, browserTargetGuardCode, browserPageTextCode, judgeWithJev, Type, createBrowserActionJournal: () => undefined, approvalMode: 'always', audit: async () => {}, process: { env: {} }, randomUUID, URL, setTimeout })
  factory({ registerTool: (definition) => definitions.set(definition.name, definition), on: () => {} })
  const invoke = async (name, params = {}) => definitions.get(name).execute('test', params, undefined, undefined, { ui: { confirm: async () => true } })
  await invoke('computer_use_session_open', { backend: 'cdp' })
  const slow = JSON.parse((await invoke('computer_use_session_observe', { url: `http://127.0.0.1:${site.address().port}/slow` })).content[0].text)
  assert.ok(slow.candidates.some(candidate => candidate.name === 'Delayed document'), 'navigation must wait for the target document, even when headers arrive before the body')
  const sameDocument = JSON.parse((await invoke('computer_use_session_observe', { url: `http://127.0.0.1:${site.address().port}/slow#section` })).content[0].text)
  assert.ok(sameDocument.url.endsWith('/slow#section') && sameDocument.candidates.some(candidate => candidate.name === 'Delayed document'), 'same-document navigation must preserve the correct page')
  const redirected = JSON.parse((await invoke('computer_use_session_observe', { url: `http://127.0.0.1:${site.address().port}/redirect` })).content[0].text)
  assert.ok(redirected.url.endsWith('/slow') && redirected.candidates.some(candidate => candidate.name === 'Delayed document'), 'redirects must wait for the final document')
  const closed = createServer()
  await new Promise(resolve => closed.listen(0, '127.0.0.1', resolve))
  const closedPort = closed.address().port
  await new Promise(resolve => closed.close(resolve))
  await assert.rejects(invoke('computer_use_session_observe', {url:`http://127.0.0.1:${closedPort}/`}), /navigation failed|ERR_CONNECTION/i, 'connection failure must not be treated as a successful observation')
  await assert.rejects(invoke('computer_use_session_observe', {url:`http://127.0.0.1:${site.address().port}/never`}), /timed out/i, 'a document that never finishes must time out')
  const observation = JSON.parse((await invoke('computer_use_session_observe', { url: `http://127.0.0.1:${site.address().port}/` })).content[0].text)
  const text = (await invoke('computer_use_session_read')).content[0].text
  assert.ok(text.includes('上传成功') && !text.includes('hidden-secret') && !text.includes('otp-secret'), 'read visible text without hidden or secure field contents')
  await page.evaluate(() => { const frame = document.createElement('iframe'); frame.title = 'reCAPTCHA challenge'; document.body.append(frame) })
  const challengeObservation = JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  assert.equal(challengeObservation.requiresHuman, true, 'visible challenge iframe must pause the session')
  await assert.rejects(invoke('computer_use_session_observe'), /human/i)
  await page.locator('iframe').evaluate((frame) => frame.remove())
  await definitions.get('computer_use_session_takeover').execute('test', { reason:'完成验证' }, undefined, undefined, { ui:{ confirm:async()=>true } })
  await invoke('computer_use_session_observe')
  await page.evaluate(() => { const frame = document.createElement('iframe'); frame.title = 'reCAPTCHA challenge'; document.body.append(frame) })
  await assert.rejects(invoke('computer_use_session_act', { candidateId: observation.candidates[0].id, type: 'click' }), /human|verification|challenge/i, 'a challenge appearing after observation must block action')
  await assert.rejects(invoke('computer_use_session_observe'), /human/i)
  await page.locator('iframe').evaluate((frame) => frame.remove())
  await definitions.get('computer_use_session_takeover').execute('test', { reason:'完成验证' }, undefined, undefined, { ui:{ confirm:async()=>true } })
  await invoke('computer_use_session_observe')
  await page.locator('button').evaluate(el => { el.textContent = 'Delete' })
  await assert.rejects(invoke('computer_use_session_act', { candidateId: observation.candidates[0].id, type: 'click' }), /target changed|observe again/i, 'changed target must be rejected')
  assert.equal(await page.locator('button').textContent(), 'Delete')
  await page.locator('button').evaluate(el => { el.textContent = 'Go' })
  await invoke('computer_use_session_observe')
  await page.locator('button').evaluate(el => { el.replaceWith(el.cloneNode(true)) })
  await assert.rejects(invoke('computer_use_session_act', { candidateId: observation.candidates[0].id, type: 'click' }), /target changed|observe again/i, 'a replacement element with the same label and marker must be rejected')
  await page.reload()
  await invoke('computer_use_session_observe')
  await page.locator('button').evaluate(el => { el.disabled = true })
  await assert.rejects(invoke('computer_use_session_act', { candidateId: observation.candidates[0].id, type: 'click' }), /target changed|observe again/i, 'disabled elements must be rejected')
  await page.locator('button').evaluate(el => { el.disabled = false })
  await page.evaluate(() => { const a = document.createElement('a'); a.href = '/safe'; a.textContent = 'Open'; document.body.append(a) })
  const linkObservation = JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  await page.locator('a').evaluate(el => { el.href = '/other' })
  await assert.rejects(invoke('computer_use_session_act', { candidateId: linkObservation.candidates.find(c => c.name === 'Open').id, type: 'click' }), /target changed|observe again/i, 'a changed link destination must be rejected')
  await page.locator('a').evaluate(el => el.remove())
  await invoke('computer_use_session_observe')
  const button = observation.candidates.find((candidate) => candidate.name === 'Go')
  assert.ok(button)
  await invoke('computer_use_session_act', { candidateId: button.id, type: 'click' })
  assert.equal(await page.locator('button').textContent(), 'clicked')
  assert.match((await invoke('computer_use_session_read')).content[0].text,/clicked/, 'a post-action read must use the verified observation')
  await page.reload()
  await assert.rejects(invoke('computer_use_session_read'), /changed|observe/i, 'reloading must invalidate the post-action read observation')
  await assert.rejects(invoke('computer_use_session_act', { candidateId: button.id, type: 'click' }), /observe/i)
  const fresh = JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  await page.reload()
  await assert.rejects(invoke('computer_use_session_read'), /changed|observe/i, 'reading must reject a reloaded page')
  await assert.rejects(invoke('computer_use_session_act', { candidateId: fresh.candidates[0].id, type: 'click' }), /changed|observe/i)
  const takeover = definitions.get('computer_use_session_takeover')
  const declined = await takeover.execute('test', { reason:'请完成验证' }, undefined, undefined, { ui:{ confirm:async()=>false } })
  assert.equal(declined.details.paused, true)
  await assert.rejects(invoke('computer_use_session_observe'), /human/i)
  const confirmed = await takeover.execute('test', { reason:'请完成验证' }, undefined, undefined, { ui:{ confirm:async()=>true } })
  assert.equal(confirmed.details.paused, false)
  assert.ok(JSON.parse((await invoke('computer_use_session_observe')).content[0].text).candidates.length)
  await page.evaluate(() => { window.testActionCount = 0; document.querySelector('button').addEventListener('click', () => window.testActionCount++) })
  let evalCalls = 0
  cdp.wrapEval(original => async (...args) => {
    if (++evalCalls === 2) throw new Error('simulated post-action page read failure')
    return original(...args)
  })
  const acknowledged = await invoke('computer_use_session_act', { candidateId: 'c1', type: 'click' })
  assert.equal(acknowledged.details?.result?.pageStateUnavailable, true, 'a failed post-action read must not report an acknowledged click as failed')
  assert.match(acknowledged.content[0].text, /Do not repeat the action/)
  assert.equal(await page.evaluate(() => window.testActionCount), 1, 'the original action must happen exactly once')
  await invoke('computer_use_session_observe')
  let loseReply = true
  cdp.wrapEval(original => async (...args) => {
    const value = await original(...args)
    if (loseReply) { loseReply = false; throw new Error('CDP Runtime.evaluate timed out') }
    return value
  })
  await assert.rejects(invoke('computer_use_session_act', { candidateId: 'c1', type: 'click' }), /result is unknown/i)
  assert.equal(await page.evaluate(() => window.testActionCount), 2, 'the action may have run before its reply was lost')
  await invoke('computer_use_session_observe')
  await assert.rejects(invoke('computer_use_session_act', { candidateId: 'c1', type: 'click' }), /result is unknown/i)
  assert.equal(await page.evaluate(() => window.testActionCount), 2, 're-observation must not permit an unconfirmed repeat')
  let prompt = ''
  const unresolved = await takeover.execute('test', { reason:'核对后台提交状态' }, undefined, undefined, { ui:{ confirm:async (_title, message)=>{ prompt = message; return false } } })
  assert.equal(unresolved.details.paused, true)
  assert.match(prompt, /结果未知/)
  await assert.rejects(invoke('computer_use_session_observe'), /human/i)
  await takeover.execute('test', { reason:'核对后台提交状态' }, undefined, undefined, { ui:{ confirm:async()=>true } })
  await invoke('computer_use_session_observe')
  await invoke('computer_use_session_close')
  console.log('PASS unified CDP router: isolated profile, observe, click, stale and reload')
} finally {
  await browser?.close()
  site.closeAllConnections()
  await new Promise((resolve) => site.close(resolve))
  await rm(temp, { recursive: true, force: true })
}
