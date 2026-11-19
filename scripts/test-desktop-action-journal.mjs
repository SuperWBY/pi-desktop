import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserActionJournal } from '../extensions/computer-use/src/browser-action-journal.ts'

if (process.argv[2] === '--hold') {
  const journal=new BrowserActionJournal(process.argv[3])
  journal.claim('desktop'); process.stdout.write('ready')
  setInterval(()=>{},1000)
  await new Promise(()=>{})
} else {
  const temp=mkdtempSync(join(tmpdir(),'pi-desktop-journal-')), path=join(temp,'desktop.sqlite')
  let child, helper
  try {
    child=spawn(process.execPath,[new URL(import.meta.url).pathname,'--hold',path],{stdio:['ignore','pipe','pipe']})
    await new Promise((resolve,reject)=>{ child.stdout.once('data',resolve); child.once('error',reject); child.once('exit',code=>reject(Error(`worker exited ${code}`))) })
    const journal=new BrowserActionJournal(path), pending=journal.pending('desktop')
    assert.ok(pending)
    assert.throws(()=>journal.claim('desktop'),/pending/i)
    assert.throws(()=>journal.resolve('desktop',pending.id,true),/active/i)
    child.kill('SIGKILL'); await new Promise(resolve=>child.once('exit',resolve)); child=null
    assert.equal(journal.pending('desktop').id,pending.id)
    assert.throws(()=>journal.resolve('desktop',pending.id,false),/confirm/i)
    journal.resolve('desktop',pending.id,true)
    assert.equal(journal.pending('desktop'),null)
    const next=journal.claim('desktop')
    helper=spawn(process.execPath,['-e','process.stdout.write("ready");setInterval(()=>{},1000)'],{stdio:['ignore','pipe','ignore']})
    await new Promise((resolve,reject)=>{ helper.stdout.once('data',resolve); helper.once('error',reject) })
    journal.attachRunner('desktop',next.id,helper.pid)
    assert.throws(()=>journal.resolve('desktop',next.id,true),/runner.*active/i,'a live helper must prevent reconciliation')
    const helperExit=new Promise(resolve=>helper.once('exit',resolve)); helper.kill('SIGKILL'); await helperExit; helper=null
    journal.resolve('desktop',next.id,true)
    assert.equal(journal.pending('desktop'),null)
    assert.equal(statSync(path).mode & 0o077,0)
    journal.close()
    console.log('PASS desktop action journal: process crash, concurrent protection and explicit recovery')
  } finally { child?.kill('SIGKILL'); helper?.kill('SIGKILL'); rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100}) }
}
