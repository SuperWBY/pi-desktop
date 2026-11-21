import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, randomBytes, createHmac, createHash } from 'node:crypto'
import { createAuthenticatedBridge } from '../extensions/computer-use/src/chrome-bridge-auth.ts'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { chromium } from 'playwright'
import { checkChromeBridge } from '../src/main/chrome-bridge-check.ts'
import { BrowserRouter } from '../extensions/computer-use/src/browser-router.ts'
import { BrowserActionJournal } from '../extensions/computer-use/src/browser-action-journal.ts'
import { judgeWithJev } from '../extensions/computer-use/src/jev.ts'

const tmp = await mkdtemp(join(tmpdir(), 'pi-chrome-test-'))
const source = new URL('../extensions/chrome-bridge/', import.meta.url).pathname
const extension = join(tmp, 'extension')
const pairingKey = randomBytes(32).toString('hex')
let forgedNext = 0, forgedResults = 0, simulateTampering = false
const bridge = createServer((req, res) => {
  if (req.url.startsWith('/challenge')) {
    const client = new URL(req.url, 'http://localhost').searchParams.get('client')
    const nonce = '1'.repeat(64)
    const proof = simulateTampering ? createHmac('sha256', Buffer.from(pairingKey, 'hex')).update(['server', client, nonce].join('\n')).digest('hex') : '0'.repeat(64)
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ nonce, proof }))
  }
  if (req.url === '/next') {
    forgedNext++
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ payload: JSON.stringify({ id:'fake', type:'act' }), proof: '0'.repeat(64) }))
  }
  if (req.url === '/result') forgedResults++
  return res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
})
const site = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<title>Pi test</title><p>上传成功</p><span hidden>hidden-secret</span><button id="go" onclick="this.textContent=\'clicked\'">Go</button><input type="password" value="test-secret"><label>登录码 <textarea autocomplete="one-time-code">otp-secret</textarea></label>')
})
let browser
try {
  await Promise.all([new Promise((resolve) => bridge.listen(0, '127.0.0.1', resolve)), new Promise((resolve) => site.listen(0, '127.0.0.1', resolve))])
  await cp(source, extension, { recursive: true })
  await writeFile(join(extension, 'pairing.json'), JSON.stringify({ key: pairingKey, port: bridge.address().port }), { mode: 0o600 })
  browser = await chromium.launchPersistentContext(join(tmp, 'profile'), { headless: true, executablePath: process.env.PI_TEST_CHROME || undefined, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] })
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker')
  let alarm
  for (let i = 0; i < 30 && !alarm; i++) {
    alarm = await worker.evaluate(() => chrome.alarms.get('pi-bridge-wake'))
    if (!alarm) await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.equal(alarm?.periodInMinutes, 0.5, 'a periodic wake alarm must be installed')
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${site.address().port}/`)
  await page.bringToFront()
  await new Promise((resolve) => setTimeout(resolve, 900))
  assert.equal(forgedNext, 0, 'extension must not request or execute commands from a forged bridge')
  assert.equal(await page.locator('#go').textContent(), 'Go')
  simulateTampering = true
  await new Promise((resolve) => setTimeout(resolve, 900))
  assert.ok(forgedNext > 0, 'test reached a forged task response')
  assert.equal(forgedResults, 0, 'extension must not execute or report a tampered task')
  assert.equal(await page.locator('#go').textContent(), 'Go')
  const bridgePort = bridge.address().port
  await new Promise((resolve) => bridge.close(resolve))
  const versionCheck = await checkChromeBridge({ port: bridgePort, timeoutMs: 5000, key: pairingKey, expectedVersion:JSON.parse(await readFile(join(extension, 'manifest.json'),'utf8')).version })
  assert.equal(versionCheck.connected, true, 'real extension must answer the connection check')
  assert.equal(versionCheck.versionStatus, 'current', 'authenticated ping reports the running extension version')
  const piSource = await readFile(new URL('../extensions/computer-use/index.ts', import.meta.url), 'utf8')
  const bridgeSource = piSource.slice(piSource.indexOf('const chromeBridgePort ='), piSource.indexOf('async function ensureCdpPage'))
  const bridgeTask = runInNewContext(`${stripTypeScriptTypes(bridgeSource)}\nchromeBridgeTask`, { process: { env: { PI_CHROME_BRIDGE_PORT: String(bridgePort) } }, createAuthenticatedBridge, readChromePairing: () => pairingKey, randomUUID, Set, setTimeout, clearTimeout })
  async function run(type, data = {}) {
    try { const result = await bridgeTask({ type, ...data }, 12000); return result?.__piGuardRejected ? { ok:false, error:result.__piGuardRejected } : { ok:true, result } }
    catch (error) { return { ok: false, error: String(error) } }
  }
  const observed = await run('observe')
  assert.equal(observed.ok, true, JSON.stringify(observed))
  const marker = { tabId: observed.result.tabId, owner: randomUUID() }
  assert.equal((await run('control', { ...marker, control: 'active' })).ok, true)
  assert.equal(await page.title(), '🖱 Pi test')
  const unrelatedPage = await browser.newPage()
  await unrelatedPage.goto(page.url())
  await unrelatedPage.bringToFront()
  assert.equal(await unrelatedPage.title(), 'Pi test', 'the marker must stay on the original tab')
  const pinnedObservation = await run('observe', { tabId: marker.tabId })
  assert.equal(pinnedObservation.result.tabId, marker.tabId)
  assert.equal(pinnedObservation.result.title, 'Pi test', 'control text does not enter observation results')
  await page.evaluate(() => { document.title = 'Updated page' })
  await page.waitForFunction(() => document.title === '🖱 Updated page')
  assert.equal((await run('control', { ...marker, control: 'waiting' })).ok, true)
  assert.equal(await page.title(), '⏸ Updated page')
  assert.equal((await run('control', { ...marker, owner: randomUUID(), control: null })).ok, true)
  assert.equal(await page.title(), '⏸ Updated page', 'a stale owner cannot clear the marker')
  assert.equal((await run('control', { ...marker, control: null })).ok, true)
  assert.equal(await page.title(), 'Updated page')
  await unrelatedPage.close()
  await page.bringToFront()
  console.log('PASS Chrome tab marker follows its tab and restores the latest page title')
  assert.equal(observed.result.interaction.blocker, 'verification', 'a visible OTP requires handoff')
  await page.evaluate(() => {
    document.querySelectorAll('input[type="password"],textarea[autocomplete]').forEach(field => { field.hidden = true })
    const link = document.createElement('a')
    link.id = 'navigation'
    link.href = '/help'
    link.textContent = 'Help'
    document.body.append(link)
  })
  let observation = (await run('observe')).result
  const preview = await run('preview', observation)
  assert.ok(preview.ok && /^data:image\/jpeg;base64,/.test(preview.result.image), `visible task tab should provide a JPEG preview: ${JSON.stringify({ok:preview.ok,error:preview.error})}`)
  const otherTab = await browser.newPage()
  await otherTab.goto(page.url())
  await otherTab.bringToFront()
  assert.equal((await run('preview', observation)).ok, false, 'do not capture an unrelated active tab')
  await otherTab.close()
  await page.bringToFront()
  observation = (await run('observe')).result
  const navigation = observation.candidates.find(candidate => candidate.name === 'Help')
  assert.ok(observation.interaction.navigation.includes(navigation.id))
  await page.locator('#navigation').evaluate(el => el.download = 'file')
  assert.equal((await run('act',{...observation,action:{type:'click',interaction:'navigation',candidateId:navigation.id}})).ok,false,'navigation grant must be rechecked before the click')
  await page.locator('#navigation').evaluate(el => el.remove())
  await page.evaluate(() => document.querySelectorAll('input[type="password"],textarea[autocomplete]').forEach(field => { field.hidden = false }))
  observation = (await run('observe')).result
  const pageText = await run('read', observation)
  assert.equal(pageText.ok,true,JSON.stringify(pageText))
  assert.ok(pageText.result.text.includes('上传成功') && !pageText.result.text.includes('hidden-secret') && !pageText.result.text.includes('otp-secret'))
  await page.evaluate(() => {const input=document.createElement('input');input.type='file';input.id='test-file';document.body.append(input)})
  observation=(await run('observe')).result
  const priorGo=observation.candidates.find(candidate=>candidate.name==='Go')
  await page.locator('#test-file').setInputFiles({name:'fixture.csv',mimeType:'text/csv',buffer:Buffer.from('abc')})
  assert.equal((await run('act',{...observation,action:{type:'click',candidateId:priorGo.id}})).ok,false,'file change must invalidate an observed button action')
  observation=(await run('observe')).result
  const selected=observation.candidates.find(candidate=>candidate.type==='file')
  assert.deepEqual(selected.files,[{name:'fixture.csv',size:3,type:'text/csv'}])
  assert.equal(selected.value,'')
  const stableAction=await run('act',{...observation,action:{type:'click',candidateId:observation.candidates.find(candidate=>candidate.name==='Go').id}})
  assert.equal(stableAction.ok,true,'unchanged file selection must not block actions')
  await page.locator('#go').evaluate(el=>{el.textContent='Go'})
  observation=(await run('observe')).result
  await page.locator('#test-file').evaluate(el=>{const previous=el.files[0],dt=new DataTransfer();dt.items.add(new File(['xyz'],previous.name,{type:previous.type,lastModified:previous.lastModified}));el.files=dt.files})
  assert.equal((await run('act',{...observation,action:{type:'click',candidateId:observation.candidates.find(candidate=>candidate.name==='Go').id}})).ok,false,'a different file with matching metadata must invalidate the action')
  await page.locator('#test-file').evaluate(el=>el.remove())
  await page.evaluate(() => { const label = document.createElement('label'); label.id = 'order-label'; label.innerHTML = '订单编号 <input>'; document.body.append(label) })
  observation = (await run('observe')).result
  const labeled = observation.candidates.find((candidate) => candidate.name === '订单编号')
  assert.ok(labeled, 'associated labels must identify fields')
  await page.locator('#order-label').evaluate((label) => { label.firstChild.textContent = '其他编号 ' })
  assert.equal((await run('act', { ...observation, action: { type:'type', candidateId:labeled.id, text:'example' } })).ok, false, 'a changed label must invalidate the target')
  await page.locator('#order-label').evaluate((label) => label.remove())
  await page.evaluate(() => { const frame = document.createElement('iframe'); frame.title = 'reCAPTCHA challenge'; document.body.append(frame) })
  assert.equal((await run('observe')).result.requiresHuman, true, 'visible challenge iframe must be detected')
  await page.locator('iframe').evaluate((frame) => frame.remove())
  observation = (await run('observe')).result
  const originalButton = observation.candidates.find((candidate) => candidate.name === 'Go')
  await page.evaluate(() => { const frame = document.createElement('iframe'); frame.title = 'reCAPTCHA challenge'; document.body.append(frame) })
  assert.equal((await run('act', { ...observation, action: { type: 'click', candidateId: originalButton.id } })).ok, false, 'a challenge appearing after observation must block action')
  await page.locator('iframe').evaluate((frame) => frame.remove())
  observation = (await run('observe')).result
  await page.locator('#go').evaluate((el) => { el.textContent = 'Delete' })
  const changedTarget = await run('act', { ...observation, action: { type: 'click', candidateId: originalButton.id } })
  assert.equal(changedTarget.ok, false, 'a changed target must require a fresh observation')
  assert.equal(await page.locator('#go').textContent(), 'Delete')
  await page.locator('#go').evaluate((el) => { el.textContent = 'Go' })
  await page.evaluate(() => { const a = document.createElement('a'); a.href = '/safe'; a.textContent = 'Open'; document.body.append(a) })
  const linkObservation = (await run('observe')).result
  await page.locator('a').evaluate((el) => { el.href = '/other' })
  const changedLink = await run('act', { ...linkObservation, action: { type: 'click', candidateId: linkObservation.candidates.find(c => c.name === 'Open').id } })
  assert.equal(changedLink.ok, false, 'a changed link destination must be rejected')
  await page.locator('a').evaluate((el) => el.remove())
  observation = (await run('observe')).result
  assert.ok(observation.documentId && observation.snapshotId && observation.tabId)
  assert.ok(!JSON.stringify(observation).includes('test-secret'))
  assert.ok(!JSON.stringify(observation).includes('otp-secret'))
  const otp = observation.candidates.find((candidate) => candidate.role === 'textarea')
  assert.equal(otp?.secure, true)
  const blocked = await run('act', { ...observation, action: { type: 'type', candidateId: otp.id, text: 'replacement' } })
  assert.equal(blocked.ok, false, 'typing into an OTP textarea must fail')
  assert.equal(await page.locator('textarea').inputValue(), 'otp-secret')
  const button = observation.candidates.find((candidate) => candidate.name === 'Go')
  assert.ok(button)
  const secondPage = await browser.newPage()
  await secondPage.goto(`http://127.0.0.1:${site.address().port}/second`)
  await secondPage.bringToFront()
  const switched = await run('act', { ...observation, action: { type: 'click', candidateId: button.id } })
  assert.equal(switched.ok, false, 'switching tabs must reject the action')
  assert.equal((await run('read', observation)).ok, false, 'switching tabs must reject reading')
  assert.equal(await page.locator('#go').textContent(), 'Go')
  await page.bringToFront()
  await page.evaluate(() => history.pushState({}, '', '/new-route'))
  const routed = await run('act', { ...observation, action: { type: 'click', candidateId: button.id } })
  assert.equal(routed.ok, false, 'changing URL within a document must reject the action')
  assert.equal((await run('read', observation)).ok, false, 'changing URL must reject reading')
  await page.reload()
  assert.equal((await run('preview', {...observation,url:page.url()})).ok,false,'reloaded document must not use the prior snapshot')
  const replaced = await run('act', { ...observation, url: page.url(), action: { type: 'click', candidateId: button.id } })
  assert.equal(replaced.ok, false, 'reloading a page must reject the previous document')
  assert.equal((await run('read', {...observation,url:page.url()})).ok, false, 'reloading must reject reading a previous document')
  const fresh = (await run('observe')).result
  const freshButton = fresh.candidates.find((candidate) => candidate.name === 'Go')
  const result = await run('act', { ...fresh, action: { type: 'click', candidateId: freshButton.id } })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(await page.locator('#go').textContent(), 'clicked')
  const start = piSource.indexOf('export default function computerUse(')
  const end = piSource.indexOf("  pi.registerTool({\n    name: 'computer_use_apps'", start)
  const registration = stripTypeScriptTypes(piSource.slice(start, end).replace('export default function', 'function') + '\n}')
  const definitions = new Map()
  const Type = new Proxy({}, { get: () => (...args) => ({ args }) })
  await page.evaluate(() => document.querySelectorAll('input[type="password"],textarea[autocomplete]').forEach(field => { field.style.display = 'none' }))
  const previewFrames = [], previewTools = new Map()
  const previewFactory = runInNewContext(`${registration}\ncomputerUse`, { BrowserRouter, judgeWithJev, Type, createBrowserActionJournal: () => undefined, chromeBridgeTask: bridgeTask, bridgeRequest: async (path, value) => { if (path === '/external-preview') previewFrames.push(value); return {ok:true,generation:'test-generation'} }, approvalMode:'always', manualBrowserApproval:false, allowRoutineActions:true, audit:async()=>{}, process:{env:{PI_DESKTOP_BROWSER_BRIDGE_FILE:'fixture'}}, randomUUID, setTimeout, setInterval, clearInterval })
  previewFactory({registerTool:definition => previewTools.set(definition.name,definition), on:()=>{}})
  await previewTools.get('computer_use_session_open').execute('preview', {backend:'extension'})
  const previewObservation = await previewTools.get('computer_use_session_observe').execute('preview', {}, undefined, undefined, {hasUI:false})
  assert.ok(previewFrames.some(frame => frame.backend === 'extension' && frame.documentId && /^data:image\/jpeg;base64,/.test(frame.image ?? '')), 'real Chrome task should publish the observed tab screenshot')
  assert.ok(!JSON.stringify(previewObservation).includes('data:image'), 'preview bytes must not enter the model observation')
  await previewTools.get('computer_use_session_close').execute()
  await page.evaluate(() => document.querySelectorAll('input[type="password"],textarea[autocomplete]').forEach(field => { field.style.display = '' }))
  const journal = new BrowserActionJournal(join(tmp, 'actions.sqlite'))
  let dropGuardReply = false
  const unifiedBridge = async (...args) => { const value=await bridgeTask(...args); if(dropGuardReply && value?.__piGuardRejected){dropGuardReply=false;throw new Error('simulated lost bridge response')} return value }
  const factory = runInNewContext(`${registration}\ncomputerUse`, { BrowserRouter, judgeWithJev, Type, createBrowserActionJournal: () => journal, chromeBridgeTask: unifiedBridge, approvalMode: 'always', manualBrowserApproval: false, allowRoutineActions: true, audit: async () => {}, process: { env: {} }, randomUUID })
  factory({ registerTool: (definition) => definitions.set(definition.name, definition), on: () => {} })
  const invoke = async (name, params = {}) => definitions.get(name).execute('test', params, undefined, undefined, { ui: { confirm: async () => true } })
  await invoke('computer_use_session_open', { backend: 'extension' })
  let handoffs = 0
  const resumed = await definitions.get('computer_use_session_observe').execute('test', {}, undefined, undefined, {
    hasUI: true,
    ui: { confirm: async (title, message) => {
      handoffs++
      assert.equal(title, 'Computer Use: Sign-in Handoff')
      assert.deepEqual(JSON.parse(message), { kind: 'verification', host: '127.0.0.1', backend: 'extension' })
      assert.ok(!message.includes('otp-secret'))
      await page.evaluate(() => document.querySelectorAll('input[type="password"],textarea[autocomplete]').forEach(field => field.remove()))
      return true
    } }
  })
  assert.equal(handoffs, 1)
  assert.equal(resumed.details.paused, false)
  await assert.rejects(invoke('computer_use_session_act', { candidateId: freshButton.id, type: 'click' }), /observe/i)
  let unified = JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  assert.ok((await invoke('computer_use_session_read')).content[0].text.includes('上传成功'))
  let unifiedButton = unified.candidates.find((candidate) => candidate.name === 'clicked')
  assert.ok(unifiedButton, 'unified router observes the real extension page')
  await page.locator('#go').evaluate(el=>{el.textContent='Changed'})
  await assert.rejects(invoke('computer_use_session_act', { candidateId: unifiedButton.id, type: 'click' }), /target changed/i, 'a confirmed guard rejection must not be reported as an unknown action')
  assert.equal(journal.pending('extension'),null,'a confirmed pre-action rejection clears its record')
  assert.equal(await page.locator('#go').textContent(),'Changed','a rejected action must not click')
  await page.locator('#go').evaluate(el=>{el.textContent='clicked'})
  unified=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  unifiedButton=unified.candidates.find(candidate=>candidate.name==='clicked')
  await page.evaluate(()=>{const frame=document.createElement('iframe');frame.title='reCAPTCHA challenge';document.body.append(frame)})
  await assert.rejects(invoke('computer_use_session_act',{candidateId:unifiedButton.id,type:'click'}),/human verification/i)
  assert.equal(journal.pending('extension'),null,'a verified challenge rejection does not leave an unknown action')
  await page.locator('iframe').evaluate(frame=>frame.remove())
  await invoke('computer_use_session_takeover',{reason:'完成人机验证'})
  unified=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  unifiedButton=unified.candidates.find(candidate=>candidate.name==='clicked')
  await page.locator('#go').evaluate(el=>{el.textContent='Changed'})
  dropGuardReply=true
  await assert.rejects(invoke('computer_use_session_act',{candidateId:unifiedButton.id,type:'click'}),/result is unknown/i)
  assert.equal(dropGuardReply,false,'the test must lose the real authenticated guard response')
  assert.ok(journal.pending('extension'),'a lost guard response must retain its record')
  assert.equal(await page.locator('#go').textContent(),'Changed','the simulated lost rejection must not click')
  await invoke('computer_use_session_takeover',{reason:'核对网页操作'})
  await page.locator('#go').evaluate(el=>{el.textContent='clicked'})
  unified=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  unifiedButton=unified.candidates.find(candidate=>candidate.name==='clicked')
  await invoke('computer_use_session_act', { candidateId: unifiedButton.id, type: 'click' })
  assert.match((await invoke('computer_use_session_read')).content[0].text,/clicked/, 'post-action read uses the bound same-document observation')
  await assert.rejects(invoke('computer_use_session_act', { candidateId: unifiedButton.id, type: 'click' }), /observe/i)
  await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='chooser-check';input.setAttribute('aria-label','选择测试文件');document.body.append(input)})
  const beforeChooser=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  const fileChooserPromise=page.waitForEvent('filechooser',{timeout:5000})
  const chooserAction=invoke('computer_use_session_act',{candidateId:beforeChooser.candidates.find(candidate=>candidate.name==='选择测试文件').id,type:'click'})
  const fileChooser=await fileChooserPromise
  assert.equal((await chooserAction).details.verification.reason,'file_selection')
  assert.ok(journal.pending('extension'))
  await fileChooser.setFiles({name:'test.csv',mimeType:'text/csv',buffer:Buffer.from('test')})
  await secondPage.goto(page.url())
  await secondPage.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='chooser-check';input.setAttribute('aria-label','选择测试文件');document.body.append(input)})
  await secondPage.locator('#chooser-check').setInputFiles({name:'test.csv',mimeType:'text/csv',buffer:Buffer.from('test')})
  await secondPage.bringToFront()
  await assert.rejects(invoke('computer_use_session_verify_file',{expectedName:'test.csv'}),/tab|document|page changed/i,'same URL and file in another tab cannot satisfy the original chooser')
  assert.ok(journal.pending('extension'),'switching tabs must not clear the pending selection')
  await page.bringToFront()
  await assert.rejects(invoke('computer_use_session_verify_file',{expectedName:'test.csv',expectedSha256:'0'.repeat(64)}),/content|hash/i)
  const selection=await invoke('computer_use_session_verify_file',{expectedName:'test.csv',expectedSha256:createHash('sha256').update('test').digest('hex')})
  assert.equal(selection.details.contentVerified,true)
  assert.equal(selection.details.file.name,'test.csv')
  assert.equal(journal.pending('extension'),null)
  console.log('PASS isolated Chrome extension: open chooser, pause and verify the test-selected file')
  await page.locator('#chooser-check').setInputFiles([])
  const manualObs=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  const manualChooserPromise=page.waitForEvent('filechooser',{timeout:5000})
  const manualAction=invoke('computer_use_session_act',{candidateId:manualObs.candidates.find(c=>c.name==='选择测试文件').id,type:'click'})
  const manualChooser=await manualChooserPromise
  await manualAction
  await manualChooser.setFiles({name:'test.csv',mimeType:'text/csv',buffer:Buffer.from('test')})
  const takeover=definitions.get('computer_use_session_takeover')
  const switchTab=await takeover.execute('test',{reason:'核对文件'},undefined,undefined,{ui:{confirm:async()=>{await secondPage.bringToFront();return true}}})
  assert.equal(switchTab.details.paused,true,'switching tabs during confirmation must keep the session paused')
  await page.bringToFront()
  const swapped=await takeover.execute('test',{reason:'核对文件'},undefined,undefined,{ui:{confirm:async()=>{await page.locator('#chooser-check').setInputFiles({name:'test.csv',mimeType:'text/csv',buffer:Buffer.from('xxxx')});return true}}})
  assert.equal(swapped.details.paused,true,'same-metadata replacement must be rejected')
  assert.ok(journal.pending('extension'))
  const accepted=await takeover.execute('test',{reason:'核对文件'},undefined,undefined,{ui:{confirm:async()=>true}})
  assert.equal(accepted.details.paused,false)
  assert.equal(journal.pending('extension'),null)
  console.log('PASS isolated Chrome extension: manual confirmation rejects tab switch and same-metadata replacement')
  await invoke('computer_use_session_close')
  const legacyJournalStart=piSource.indexOf('  const runLegacyJournaled ='),legacyJournalEnd=piSource.indexOf('\n\n  pi.registerTool(',legacyJournalStart)
  const legacyStart=piSource.lastIndexOf('  pi.registerTool({',piSource.indexOf("name: 'computer_use_chrome_observe'")),legacyEnd=piSource.indexOf("  pi.registerTool({\n    name: 'computer_use_permissions'",legacyStart)
  const legacyDefinitions=new Map()
  const legacyCode=`class BrowserBridgeUnavailableBeforeDispatch extends Error {}\nclass LegacyBrowserActionBeforeDispatch extends Error {}\nclass LegacyChromeGuardBeforeDispatch extends Error {}\nlet chromeObservation=null;\n${piSource.slice(legacyJournalStart,legacyJournalEnd)}\n${piSource.slice(legacyStart,legacyEnd)}`
  runInNewContext(stripTypeScriptTypes(legacyCode),{pi:{registerTool:t=>legacyDefinitions.set(t.name,t)},Type,actionJournal:journal,router:{hasAnyPendingAction:()=>Boolean(journal.pending('extension'))},assertLegacyAvailable(){},chromeBridgeTask:unifiedBridge,approvalMode:'always',audit:async()=>{}})
  const legacyInvoke=async(name,params={})=>legacyDefinitions.get(name).execute('test',params,undefined,undefined,{ui:{confirm:async()=>true}})
  await legacyInvoke('computer_use_chrome_observe')
  await page.locator('#go').evaluate(el=>{el.textContent='Changed legacy'})
  await assert.rejects(legacyInvoke('computer_use_chrome_act',{candidateId:'h1',type:'click'}),/target changed|observe again/i)
  assert.equal(journal.pending('extension'),null,'legacy authenticated guard rejection must clear its record')
  assert.equal(await page.locator('#go').textContent(),'Changed legacy','legacy rejected action must not click')
  console.log('PASS legacy Chrome guard rejection over authenticated bridge')
  journal.close()
  console.log('PASS unified router with real isolated Chrome extension')
  console.log('PASS isolated Chrome: observe, tab switch, route change, reload, click')
} finally {
  await browser?.close()
  await Promise.all([new Promise((resolve) => bridge.close(resolve)), new Promise((resolve) => site.close(resolve))])
  await rm(tmp, { recursive: true, force: true })
}
