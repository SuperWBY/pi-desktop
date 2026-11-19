import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {runGuardedHelper,DesktopGuardRejected} from '../extensions/computer-use/src/guarded-helper.ts'
import {BrowserActionJournal} from '../extensions/computer-use/src/browser-action-journal.ts'
const dir=mkdtempSync(join(tmpdir(),'pi-guard-result-'))
try{
 const helper=join(dir,'helper')
 writeFileSync(helper,`#!/bin/sh\nprintf '%s\\n' '{"ok":false,"code":"PI_COORDINATE_GUARD","reason":"window_changed"}'\nexit 73\n`)
 chmodSync(helper,0o700)
 await assert.rejects(runGuardedHelper(helper,['click','--expected-window','{}'],()=>{}),e=>e instanceof DesktopGuardRejected && e.reason==='window_changed')
 await assert.rejects(runGuardedHelper(helper,['type','--text','value'],()=>{}),e=>!(e instanceof DesktopGuardRejected) && /unknown/i.test(String(e)))
 writeFileSync(helper,`#!/bin/sh\nprintf '%s\\n' '{"ok":false,"code":"PI_COORDINATE_GUARD","reason":"unexpected"}'\nexit 73\n`)
 await assert.rejects(runGuardedHelper(helper,['click','--expected-window','{}'],()=>{}),e=>!(e instanceof DesktopGuardRejected) && /unknown/i.test(String(e)))
 if(process.platform==='darwin'){
  const native=fileURLToPath(new URL('../extensions/computer-use/bin/computer-use-helper',import.meta.url))
  const journal=new BrowserActionJournal(join(dir,'native.sqlite')), record=journal.claim('desktop')
  await assert.rejects(runGuardedHelper(native,['click','--x','0','--y','0','--expected-window','{}'],pid=>journal.attachRunner('desktop',record.id,pid)),e=>e instanceof DesktopGuardRejected && e.reason==='window_changed')
  await assert.rejects(runGuardedHelper(native,['key','--key','a','--target-app','Pi Missing Fixture','--target-window','1'],()=>{}),e=>e instanceof DesktopGuardRejected && e.reason==='window_changed')
  journal.acknowledge('desktop',record.id)
  assert.equal(journal.pending('desktop'),null,'native pre-action rejection permits safe record release')
  journal.close()
 }
 console.log('PASS desktop guard rejection protocol: only expected pre-action rejection is recognized')
}finally{rmSync(dir,{recursive:true,force:true})}
