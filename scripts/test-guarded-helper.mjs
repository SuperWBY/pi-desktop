import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserActionJournal } from '../extensions/computer-use/src/browser-action-journal.ts'
import { runGuardedHelper } from '../extensions/computer-use/src/guarded-helper.ts'

const temp=mkdtempSync(join(tmpdir(),'pi-helper-gate-')), helper=join(temp,'helper.mjs'), worker=join(temp,'worker.mjs')
writeFileSync(helper, `import {writeFileSync} from 'node:fs'; writeFileSync(process.argv[2],String(process.pid)); setTimeout(()=>{writeFileSync(process.argv[3],'done'); process.stdout.write(JSON.stringify({pid:process.pid,arg:process.argv[4]}))},600)`)
const journalUrl=new URL('../extensions/computer-use/src/browser-action-journal.ts',import.meta.url).href
const gateUrl=new URL('../extensions/computer-use/src/guarded-helper.ts',import.meta.url).href
writeFileSync(worker, `import {writeFileSync} from 'node:fs'; import {BrowserActionJournal} from ${JSON.stringify(journalUrl)}; import {runGuardedHelper} from ${JSON.stringify(gateUrl)}; const [db,helper,start,done,attached,mode]=process.argv.slice(2); const j=new BrowserActionJournal(db), a=j.claim('desktop'); void runGuardedHelper(process.execPath,[helper,start,done,'literal'],pid=>{j.attachRunner('desktop',a.id,pid);writeFileSync(attached,String(pid)); if(mode==='before') while(true){} });`)
let owner
try {
  const first=join(temp,'first'), done=join(temp,'done'), literal='$(not a shell command)'
  let recordedPid
  const output=await runGuardedHelper(process.execPath,[helper,first,done,literal],pid=>{recordedPid=pid})
  assert.equal(JSON.parse(output).pid,recordedPid,'exec must preserve the recorded PID')
  assert.equal(JSON.parse(output).arg,literal,'arguments must not be evaluated by a shell')
  const deniedStart=join(temp,'denied-start'), deniedDone=join(temp,'denied-done')
  await assert.rejects(runGuardedHelper(process.execPath,[helper,deniedStart,deniedDone,'x'],()=>{throw Error('disk failure')}),/could not be recorded/i)
  await new Promise(r=>setTimeout(r,150))
  assert.equal(existsSync(deniedStart),false,'recording failure must not start the helper')
  const waitFile=async path=>{for(let i=0;i<100&&!existsSync(path);i++) await new Promise(r=>setTimeout(r,50)); assert.ok(existsSync(path),`missing ${path}`)}
  const runCrash=async mode=>{
    const db=join(temp,`${mode}.sqlite`), started=join(temp,`${mode}-started`), finished=join(temp,`${mode}-done`), attached=join(temp,`${mode}-attached`)
    owner=spawn(process.execPath,[worker,db,helper,started,finished,attached,mode],{stdio:['ignore','ignore','pipe']})
    await waitFile(attached)
    if(mode==='after') await waitFile(started)
    const exit=new Promise(resolve=>owner.once('exit',resolve)); owner.kill('SIGKILL'); await exit; owner=null
    const journal=new BrowserActionJournal(db), pending=journal.pending('desktop'); assert.ok(pending)
    if(mode==='before') {
      await new Promise(r=>setTimeout(r,900)); assert.equal(existsSync(started),false,'EOF before the gate must not start the helper')
    } else {
      assert.throws(()=>journal.resolve('desktop',pending.id,true),/runner.*active/i)
      await waitFile(finished)
    }
    let resolved=false
    for(let i=0;i<100&&!resolved;i++) { try {journal.resolve('desktop',pending.id,true); resolved=true} catch(error) {if(!/runner.*active/i.test(String(error))) throw error; await new Promise(r=>setTimeout(r,50))} }
    assert.equal(resolved,true,'recovery should unlock after the helper exits')
    journal.close()
  }
  await runCrash('before'); await runCrash('after')
  if(process.platform==='darwin') {
    const nativeJournal=new BrowserActionJournal(join(temp,'native.sqlite')), nativeAction=nativeJournal.claim('desktop')
    const nativePath=new URL('../extensions/computer-use/bin/computer-use-helper',import.meta.url).pathname
    const result=JSON.parse(await runGuardedHelper(nativePath,['check'],pid=>nativeJournal.attachRunner('desktop',nativeAction.id,pid)))
    assert.equal(result.ok,true,'the bundled macOS helper must work through the guarded launcher')
    nativeJournal.acknowledge('desktop',nativeAction.id); nativeJournal.close()
  }
  console.log('PASS guarded helper: PID identity, argument isolation, parent death before and after authorization')
} finally { owner?.kill('SIGKILL'); rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100}) }
