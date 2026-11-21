// Real local Pi RPC in an isolated Electron instance; no model calls or user data.
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..'), temp = realpathSync(mkdtempSync(join(tmpdir(), 'pi-real-confirm-')))
const userData = join(temp, 'userData'), agent = join(temp, 'agent'), sessions = join(temp, 'sessions'), workspace = join(temp, 'project'), results = join(temp, 'results')
for (const dir of [userData, agent, sessions, workspace, results, join(workspace,'.pi','extensions')]) mkdirSync(dir,{recursive:true})
writeFileSync(join(agent,'trust.json'), JSON.stringify({[workspace]:true}))
writeFileSync(join(userData,'settings.json'),JSON.stringify({workspaces:[workspace],lastWorkspace:workspace}))
writeFileSync(join(workspace,'.pi','extensions','fixture.ts'), `import { writeFileSync } from 'node:fs'; import { join } from 'node:path'; export default function(pi) { pi.registerCommand('fixture-confirm', { description:'Local test', handler: async (_args, ctx) => { await new Promise(r=>setTimeout(r,800)); const answer = await ctx.ui.confirm('Fixture '+process.pid, 'Local confirmation'); writeFileSync(join(${JSON.stringify(results)},String(process.pid)), JSON.stringify({answer})); } }); }`)
let app
try {
  app = await electron.launch({args:['.',`--user-data-dir=${userData}`],cwd:root,env:{...process.env,HOME:temp,PI_DESKTOP_PI_PATH:join(homedir(),'.local/bin/pi'),PI_CODING_AGENT_DIR:agent,PI_CODING_AGENT_SESSION_DIR:sessions}})
  const page = await app.firstWindow()
  await page.waitForSelector('.composer-input, .welcome',{timeout:45000}); await page.waitForTimeout(1200)
  await page.evaluate(() => { window.fixtureEvents=[]; window.pi.onRecord(r=>window.fixtureEvents.push(r)) })
  const call = (method,...args) => page.evaluate(({method,args})=>window.pi[method](...args),{method,args})
  const first=await call('openSession',{cwd:workspace,sessionPath:null}); assert.equal(first.ok,true,JSON.stringify(first)); assert.ok(first.sessionPath)
  await page.evaluate(() => { void window.pi.command({type:'prompt',message:'/fixture-confirm'}) })
  const second=await call('openSession',{cwd:workspace,sessionPath:null}); assert.equal(second.ok,true,JSON.stringify(second)); assert.ok(second.sessionPath)
  assert.notEqual(first.sessionPath,second.sessionPath)
  await page.waitForTimeout(1300)
  assert.equal(await page.evaluate(()=>window.fixtureEvents.filter(r=>r.method==='confirm').length),0)
  await page.getByRole('button',{name:/后台任务等待确认/}).waitFor({timeout:15000})
  await page.getByRole('button',{name:/后台任务等待确认/}).click()
  await page.locator('.conversation-prompt:not([hidden])').getByText(/Local confirmation/).waitFor()
  assert.equal((await call('openSession',{cwd:workspace,sessionPath:second.sessionPath})).ok,true)
  await page.evaluate(() => { window.fixtureEvents=[] })
  await page.evaluate(() => { void window.pi.command({type:'prompt',message:'/fixture-confirm'}) })
  await page.waitForFunction(()=>window.fixtureEvents.some(r=>r.method==='confirm'),null,{timeout:15000})
  const b=await page.evaluate(()=>window.fixtureEvents.filter(r=>r.method==='confirm').at(-1))
  await page.locator('.conversation-prompt:not([hidden])').getByText(b.title,{exact:true}).waitFor()
  assert.equal((await call('openSession',{cwd:workspace,sessionPath:first.sessionPath})).ok,true)
  await page.getByRole('button',{name:/后台任务等待确认/}).waitFor({timeout:15000})
  await page.waitForFunction(id=>window.fixtureEvents.some(r=>r.method==='confirm'&&r.id!==id),b.id,{timeout:15000})
  const a=await page.evaluate(()=>window.fixtureEvents.filter(r=>r.method==='confirm').at(-1))
  await page.locator('.conversation-prompt:not([hidden])').getByText(a.title,{exact:true}).waitFor()
  await call('uiResponse',{type:'extension_ui_response',id:b.id,confirmed:true})
  await page.locator('.conversation-prompt:not([hidden])').getByRole('button',{name:'是',exact:true}).click()
  await page.waitForFunction(path=>window.pi.readDir(path).then(items=>items.length===1),results,{timeout:15000})
  assert.equal((await call('openSession',{cwd:workspace,sessionPath:second.sessionPath})).ok,true)
  assert.equal(readdirSync(results).length,1,'stale response must not approve other process')
  await page.locator('.conversation-prompt:not([hidden])').getByText(b.title,{exact:true}).waitFor()
  await page.locator('.conversation-prompt:not([hidden])').getByRole('button',{name:'否',exact:true}).click()
  await page.waitForFunction(path=>window.pi.readDir(path).then(items=>items.length===2),results,{timeout:15000})
  assert.deepEqual(readdirSync(results).map(f=>JSON.parse(readFileSync(join(results,f),'utf8')).answer).sort(),[false,true])
  assert.equal(await page.getByRole('button',{name:/后台任务等待确认/}).count(),0)
  assert.deepEqual(JSON.parse(readFileSync(join(userData,'interrupted-ui-requests.json'),'utf8')),[],'answered confirmations must not leave false interruption notices')
  console.log('PASS isolated Electron and real Pi RPC: background confirmations replay to their own sessions and stale response is rejected')
} finally { await app?.close(); rmSync(temp,{recursive:true,force:true}) }
