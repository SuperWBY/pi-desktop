// Isolated crash experiment with real Pi RPC; never touches the installed app or user data.
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root=resolve(import.meta.dirname,'..'), temp=realpathSync(mkdtempSync(join(tmpdir(),'pi-crash-confirm-')))
const userData=join(temp,'userData'),agent=join(temp,'agent'),sessions=join(temp,'sessions'),workspace=join(temp,'project'),pidFile=join(temp,'fixture-pid')
for(const dir of [userData,agent,sessions,workspace,join(workspace,'.pi','extensions')]) mkdirSync(dir,{recursive:true})
writeFileSync(join(agent,'trust.json'),JSON.stringify({[workspace]:true}))
writeFileSync(join(userData,'settings.json'),JSON.stringify({workspaces:[workspace],lastWorkspace:workspace}))
writeFileSync(join(workspace,'.pi','extensions','fixture.ts'),`import {writeFileSync} from 'node:fs'; export default function(pi){ pi.registerCommand('fixture-confirm',{description:'Local crash test',handler:async(_args,ctx)=>{writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); await ctx.ui.confirm('Local crash fixture','Awaiting a local confirmation');}}) }`)
const options={args:['.',`--user-data-dir=${userData}`],cwd:root,env:{...process.env,HOME:temp,PI_DESKTOP_PI_PATH:join(homedir(),'.local/bin/pi'),PI_CODING_AGENT_DIR:agent,PI_CODING_AGENT_SESSION_DIR:sessions}}
let app, restarted, fixturePid
try {
  app=await electron.launch(options)
  let page=await app.firstWindow()
  await page.waitForSelector('.composer-input, .welcome',{timeout:45000}); await page.waitForTimeout(1200)
  const session=await page.evaluate(cwd=>window.pi.openSession({cwd,sessionPath:null}),workspace)
  assert.equal(session.ok,true); assert.ok(session.sessionPath)
  await page.evaluate(()=>{void window.pi.command({type:'prompt',message:'/fixture-confirm'})})
  await page.locator('.conversation-prompt:not([hidden])').getByText('Local crash fixture',{exact:true}).waitFor({timeout:15000})
  fixturePid=Number(readFileSync(pidFile,'utf8')); assert.ok(Number.isSafeInteger(fixturePid)&&fixturePid>1)
  const exited=new Promise(resolve=>app.process().once('exit',resolve))
  app.process().kill('SIGKILL'); await exited
  // Only terminate the Pi child recorded by our isolated fixture.
  try { process.kill(fixturePid,'SIGTERM') } catch (error) { if (error.code!=='ESRCH') throw error }
  fixturePid=undefined
  restarted=await electron.launch(options)
  page=await restarted.firstWindow()
  await page.waitForSelector('.composer-input, .welcome',{timeout:45000}); await page.waitForTimeout(1200)
  const result=await page.evaluate(({cwd,path})=>window.pi.openSession({cwd,sessionPath:path}),{cwd:workspace,path:session.sessionPath})
  assert.equal(result.ok,false,'an unmaterialized session remains unavailable after its process dies')
  assert.equal(await page.locator('.conversation-prompt:not([hidden])').getByText('Local crash fixture',{exact:true}).count(),0)
  assert.equal(await page.getByText('后台任务等待确认',{exact:true}).count(),0)
  const notice=page.locator('.interrupted-approval').filter({hasText:'任务在等待确认时中断'})
  await notice.waitFor({timeout:15000})
  assert.ok((await notice.innerText()).includes('请先核对实际结果'))
  await notice.getByRole('button',{name:'知道了'}).click()
  await notice.waitFor({state:'detached'})
  await page.reload()
  await page.waitForSelector('.composer-input, .welcome',{timeout:45000})
  assert.equal(await page.locator('.interrupted-approval').filter({hasText:'任务在等待确认时中断'}).count(),0)
  console.log('PASS isolated Electron crash and real Pi RPC: interrupted confirmation is reported, never replayed, and can be acknowledged')
} finally {
  if (fixturePid) { try { process.kill(fixturePid,'SIGTERM') } catch {} }
  await restarted?.close().catch(()=>{})
  await app?.close().catch(()=>{})
  rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:150})
}
