// Isolated experiment: a real Pi RPC command pauses after approval, then Electron is killed.
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root=resolve(import.meta.dirname,'..'), temp=realpathSync(mkdtempSync(join(tmpdir(),'pi-approved-crash-')))
const userData=join(temp,'userData'),agent=join(temp,'agent'),sessions=join(temp,'sessions'),workspace=join(temp,'project'),pidFile=join(temp,'fixture-pid'),startedFile=join(temp,'started')
for(const dir of [userData,agent,sessions,workspace,join(workspace,'.pi','extensions')]) mkdirSync(dir,{recursive:true})
writeFileSync(join(agent,'trust.json'),JSON.stringify({[workspace]:true}))
writeFileSync(join(userData,'settings.json'),JSON.stringify({workspaces:[workspace],lastWorkspace:workspace}))
writeFileSync(join(workspace,'.pi','extensions','fixture.ts'),`import {writeFileSync} from 'node:fs'; export default function(pi){ pi.registerCommand('fixture-confirm',{description:'Local crash test',handler:async(_args,ctx)=>{writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); if(await ctx.ui.confirm('Local approval fixture','Local test')) { writeFileSync(${JSON.stringify(startedFile)},'started'); await new Promise(r=>setTimeout(r,30000)); }}}) }`)
const options={args:['.',`--user-data-dir=${userData}`],cwd:root,env:{...process.env,HOME:temp,PI_DESKTOP_PI_PATH:join(homedir(),'.local/bin/pi'),PI_CODING_AGENT_DIR:agent,PI_CODING_AGENT_SESSION_DIR:sessions}}
let app,restarted,pid
try {
  app=await electron.launch(options)
  let page=await app.firstWindow(); await page.waitForSelector('.composer-input, .welcome',{timeout:45000}); await page.waitForTimeout(1200)
  assert.equal((await page.evaluate(cwd=>window.pi.openSession({cwd,sessionPath:null}),workspace)).ok,true)
  await page.evaluate(()=>{void window.pi.command({type:'prompt',message:'/fixture-confirm'})})
  const dialog=page.getByRole('dialog'); await dialog.getByText('Local approval fixture',{exact:true}).waitFor({timeout:15000})
  pid=Number(readFileSync(pidFile,'utf8')); assert.ok(Number.isSafeInteger(pid)&&pid>1)
  await dialog.getByRole('button',{name:'是',exact:true}).click()
  await page.waitForFunction(path=>window.pi.readDir(path).then(items=>items.some(item=>item.name==='started')),temp,{timeout:15000})
  assert.ok(existsSync(startedFile))
  const exited=new Promise(resolve=>app.process().once('exit',resolve)); app.process().kill('SIGKILL'); await exited
  try {process.kill(pid,'SIGTERM')} catch(error) {if(error.code!=='ESRCH') throw error}; pid=undefined
  restarted=await electron.launch(options); page=await restarted.firstWindow()
  await page.waitForSelector('.composer-input, .welcome',{timeout:45000}); await page.waitForTimeout(1200)
  assert.equal(await page.locator('.interrupted-approval').count(),0,'baseline: approved action is not recorded after the confirmation returns')
  console.log('BASELINE: an approved but unfinished command can be interrupted without an interruption notice; actual action outcome remains unknown')
} finally {
  if(pid) {try {process.kill(pid,'SIGTERM')} catch {}}
  await restarted?.close().catch(()=>{}); await app?.close().catch(()=>{})
  rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:150})
}
