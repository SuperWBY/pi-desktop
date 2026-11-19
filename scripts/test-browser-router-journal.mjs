import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { BrowserRouter } from '../extensions/computer-use/src/browser-router.ts'
import { BrowserActionJournal } from '../extensions/computer-use/src/browser-action-journal.ts'

if (process.argv[2] === '--crash-worker') {
  const journal=new BrowserActionJournal(process.argv[3])
  const adapter={async observe(){return {candidates:[{id:'one',name:'提交'}]}},async act(){process.stdout.write('sent');await new Promise(()=>{})},async close(){}}
  const router=new BrowserRouter({inapp:adapter,cdp:adapter,extension:adapter},{journal})
  await router.open('cdp');await router.observe()
  setInterval(()=>{},1000)
  await router.act({candidateId:'one',type:'click'})
}

const root=await mkdtemp(join(tmpdir(),'pi-router-journal-'))
const file=join(root,'journal.sqlite')
const journal=new BrowserActionJournal(file)
let writes=0, closes=0, shouldFail=false
const adapter={async observe(){return {url:'https://example.test',candidates:[{id:'one',name:'提交'}]}},async act(){assert.ok(journal.pending('cdp'),'record must exist before the action');writes++;if(shouldFail)throw new Error('connection lost');return {ok:true}},async close(){closes++}}
const adapters={inapp:adapter,cdp:adapter,extension:adapter}
try {
  const router=new BrowserRouter(adapters,{journal,approve:async()=>true})
  await router.open('cdp');await router.observe();await router.act({candidateId:'one',type:'click'})
  assert.equal(journal.pending('cdp'),null,'an acknowledged action is cleared')
  shouldFail=true
  await router.observe();await assert.rejects(router.act({candidateId:'one',type:'click'}),/result is unknown/i)
  const saved=journal.pending('cdp');assert.ok(saved)
  await router.close()
  assert.equal(closes,0,'the browser must stay open for inspection after an uncertain action')
  const otherBackend=new BrowserRouter(adapters,{journal})
  await otherBackend.open('extension');await otherBackend.observe()
  await assert.rejects(otherBackend.act({candidateId:'one',type:'click'}),/result is unknown/i,'switching backends must not bypass a pending action')
  otherBackend.pauseForUser()
  assert.throws(()=>otherBackend.resumeAfterUser(),/another browser backend/i)
  await otherBackend.close()
  const resumed=new BrowserRouter(adapters,{journal,approve:async()=>true})
  await resumed.open('cdp');await resumed.observe()
  await assert.rejects(resumed.act({candidateId:'one',type:'click'}),/result is unknown/i)
  assert.equal(writes,2)
  resumed.pauseForUser()
  assert.throws(()=>resumed.resumeAfterUser('wrong-id'),/changed|not found/i,'confirmation applies only to the selected action')
  assert.equal(journal.pending('cdp').id,saved.id)
  resumed.resumeAfterUser(saved.id)
  assert.equal(journal.pending('cdp'),null)
  await resumed.close()
  const failedJournal={pending(){return null},claim(){throw new Error('disk unavailable')},acknowledge(){throw new Error('unexpected')},resolve(){throw new Error('unexpected')}}
  const diskFailure=new BrowserRouter(adapters,{journal:failedJournal})
  await diskFailure.open('cdp');await diskFailure.observe()
  await assert.rejects(diskFailure.act({candidateId:'one',type:'click'}),/disk unavailable/i)
  assert.equal(writes,2,'failed write-ahead record must prevent the action')
  let savedRecord=null
  const brokenAck={pending(){return savedRecord},claim(){return savedRecord={id:'guard-record'}},acknowledge(){throw new Error('disk unavailable')},resolve(){throw new Error('unexpected')}}
  const rejected={async observe(){return {candidates:[{id:'one',name:'提交'}]}},async act(){return {__piGuardRejected:'target_changed'}},async close(){}}
  const unableToClear=new BrowserRouter({inapp:rejected,cdp:rejected,extension:rejected},{journal:brokenAck})
  await unableToClear.open('cdp');await unableToClear.observe()
  await assert.rejects(unableToClear.act({candidateId:'one',type:'click'}),/result is unknown/i,'a guard result must not hide a failed journal update')
  assert.equal(savedRecord.id,'guard-record')
  const hidden={async observe(){return {url:'https://example.test',documentId:'fixture-document',candidates:[{id:'file',type:'file',name:'选择文件'}]}},async act(){return {__piGuardRejected:'view_hidden'}},async close(){}}
  const hiddenRouter=new BrowserRouter({inapp:hidden,cdp:hidden,extension:hidden},{journal})
  await hiddenRouter.open('inapp');await hiddenRouter.observe()
  await assert.rejects(hiddenRouter.act({candidateId:'file',type:'click'}),/open the in-app browser panel/i)
  assert.equal(journal.pending('inapp'),null,'pre-action hidden view rejection safely releases the record')
  await hiddenRouter.close()
  const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',new URL(import.meta.url).pathname,'--crash-worker',file],{stdio:['ignore','pipe','pipe']})
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(new Error(`worker exited early: ${code}`)))})
  child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve))
  const afterCrash=journal.pending('cdp');assert.ok(afterCrash,'process crash after dispatch leaves a pending record')
  const restarted=new BrowserRouter(adapters,{journal})
  await restarted.open('cdp');await restarted.observe()
  await assert.rejects(restarted.act({candidateId:'one',type:'click'}),/result is unknown/i)
  restarted.pauseForUser();restarted.resumeAfterUser(afterCrash.id)
  assert.equal(journal.pending('cdp'),null)
  await restarted.close()
  console.log('PASS router journal: write-before-act, recovery, confirmed resolution and storage failure')
} finally {journal.close();await rm(root,{recursive:true,force:true})}
