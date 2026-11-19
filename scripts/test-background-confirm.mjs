// Isolated Electron and mock Pi processes; exercises actual IPC routing.
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..'), temp = mkdtempSync(join(tmpdir(), 'pi-confirm-test-'))
const userData = join(temp, 'userData'), agent = join(temp, 'agent'), sessions = join(temp, 'sessions')
for (const dir of [userData, agent, sessions]) mkdirSync(dir, { recursive: true })
const project = join(sessions, '--mock-project--'); mkdirSync(project)
const seed = (id) => { const path = join(project, `2026-01-01T00-00-00-000Z_${id}.jsonl`); writeFileSync(path, `${JSON.stringify({type:'session', id, cwd:root, timestamp:new Date().toISOString()})}\n`); return path }
const a = seed('confirm-a'), b = seed('confirm-b')
writeFileSync(join(userData, 'settings.json'), JSON.stringify({workspaces:[root],lastWorkspace:root}))
let app
try {
  app = await electron.launch({args:['.', `--user-data-dir=${userData}`],cwd:root,env:{...process.env,HOME:temp,PI_DESKTOP_PI_PATH:join(root,'scripts/mock-pi.mjs'),PI_CODING_AGENT_DIR:agent,PI_CODING_AGENT_SESSION_DIR:sessions,MOCK_BACKGROUND_CONFIRM:'1'}})
  const page = await app.firstWindow()
  await page.waitForSelector('.composer-input, .welcome', {timeout:45000}); await page.waitForTimeout(1200)
  await page.evaluate(() => { window.fixtureEvents = []; window.pi.onRecord((record) => window.fixtureEvents.push(record)) })
  const call = (method, ...args) => page.evaluate(({method,args}) => window.pi[method](...args), {method,args})
  assert.equal((await call('openSession',{cwd:root,sessionPath:a})).ok,true)
  await call('command',{type:'prompt',message:'local approval test'})
  assert.equal((await call('openSession',{cwd:root,sessionPath:b})).ok,true)
  await page.waitForTimeout(1100)
  assert.equal(await page.evaluate(() => window.fixtureEvents.filter((r) => r.method === 'confirm').length),0,'background request must not appear in another session')
  await call('command',{type:'prompt',message:'local approval test'})
  await page.waitForFunction(() => window.fixtureEvents.some((r) => r.method === 'confirm'))
  const bRequest = await page.evaluate(() => window.fixtureEvents.filter((r) => r.method === 'confirm').at(-1))
  await page.getByRole('dialog').getByText(bRequest.title, {exact:true}).waitFor()
  assert.equal((await call('openSession',{cwd:root,sessionPath:a})).ok,true)
  await page.waitForFunction((id) => window.fixtureEvents.some((r) => r.method === 'confirm' && r.id !== id), bRequest.id)
  const aRequest = await page.evaluate(() => window.fixtureEvents.filter((r) => r.method === 'confirm').at(-1))
  assert.notEqual(aRequest.id,bRequest.id)
  await page.getByRole('dialog').getByText(aRequest.title, {exact:true}).waitFor()
  assert.equal(await page.getByRole('dialog').getByText(bRequest.title, {exact:true}).count(),0)
  await call('uiResponse',{type:'extension_ui_response',id:bRequest.id,confirmed:true})
  await page.getByRole('dialog').getByRole('button',{name:'是',exact:true}).click()
  await page.waitForTimeout(150)
  let messages = (await call('command',{type:'get_messages'})).data.messages
  assert.ok(JSON.stringify(messages).includes('approval:true'))
  assert.equal((await call('openSession',{cwd:root,sessionPath:b})).ok,true)
  messages = (await call('command',{type:'get_messages'})).data.messages
  assert.ok(!JSON.stringify(messages).includes('approval:true'),'stale response must not reach the wrong process')
  const replay = await page.evaluate(() => window.fixtureEvents.filter((r) => r.method === 'confirm').at(-1))
  assert.equal(replay.id,bRequest.id)
  await page.getByRole('dialog').getByText(bRequest.title,{exact:true}).waitFor()
  await page.getByRole('dialog').getByRole('button',{name:'否',exact:true}).click()
  await page.waitForTimeout(150)
  messages = (await call('command',{type:'get_messages'})).data.messages
  assert.ok(JSON.stringify(messages).includes('approval:false'))
  console.log('PASS isolated Electron: background confirmations replay only in their own session; stale responses are rejected')
} finally { await app?.close(); rmSync(temp,{recursive:true,force:true}) }
