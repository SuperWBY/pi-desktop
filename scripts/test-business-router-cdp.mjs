import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { judgeWithJev } from '../extensions/computer-use/src/jev.ts'
import { mkdtemp, mkdir, unlink, rm, readFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { chromium } from 'playwright'
import { BrowserRouter } from '../extensions/computer-use/src/browser-router.ts'
import { BrowserActionJournal } from '../extensions/computer-use/src/browser-action-journal.ts'
import { browserChallengeCode } from '../extensions/computer-use/src/browser-challenge.ts'
import { browserTargetGuardCode } from '../extensions/computer-use/src/browser-target.ts'
import { browserFileSnapshotCode, browserFileHashCode } from '../extensions/computer-use/src/browser-file-context.ts'
import { browserPageTextCode } from '../extensions/computer-use/src/browser-page-text.ts'
import { startBackoffice } from './fixtures/business-backoffice/server.mjs'

const fixture=await startBackoffice()
const temp=await mkdtemp(join(tmpdir(),'pi-business-cdp-'))
const reserve=createServer()
let browser, journal
try {
  await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve))
  const port=reserve.address().port
  await new Promise(resolve=>reserve.close(resolve))
  browser=await chromium.launchPersistentContext(join(temp,'profile'),{headless:true,executablePath:process.env.PI_TEST_CHROME || undefined,args:[`--remote-debugging-port=${port}`]})
  const page=browser.pages()[0] || await browser.newPage()
  await page.addInitScript(() => { globalThis.__piDocumentIdentity = 'forged' })
  const source=await readFile(new URL('../extensions/computer-use/index.ts',import.meta.url),'utf8')
  const cdpSource=source.slice(source.indexOf('const cdpProfileDir ='),source.indexOf('const chromeBridgePort ='))+source.slice(source.indexOf('async function ensureCdpPage'),source.indexOf('async function audit('))
  const cdp=runInNewContext(`${stripTypeScriptTypes(cdpSource)}\n({ ensureCdpPage, releaseCdpSocket, cdpSend, cdpEval, cdpAction, closeCdp, cdpObserveCode, wrapEval: (wrap) => { cdpEval = wrap(cdpEval) } })`,{browserChallengeCode,browserTargetGuardCode,browserFileSnapshotCode,homedir,join,spawn,mkdir,unlink,fetch,WebSocket,AbortSignal,setTimeout,clearTimeout,process:{env:{PI_CDP_PORT:String(port)}}})
  const start=source.indexOf('export default function computerUse(')
  const end=source.indexOf("  pi.registerTool({\n    name: 'computer_use_apps'",start)
  const registration=stripTypeScriptTypes(source.slice(start,end).replace('export default function','function')+'\n}')
  const definitions=new Map()
  const Type=new Proxy({}, {get:()=> (...args)=>({args})})
  journal=new BrowserActionJournal(join(temp,'actions.sqlite'))
  const factory=runInNewContext(`${registration}\ncomputerUse`,{...cdp,BrowserRouter,browserChallengeCode,browserTargetGuardCode,browserPageTextCode,browserFileHashCode,judgeWithJev,Type,createBrowserActionJournal:()=>journal,approvalMode:'always',audit:async()=>{},process:{env:{}},randomUUID,URL,setTimeout})
  factory({registerTool:definition=>definitions.set(definition.name,definition),on:()=>{}})
  const invoke=async(name,params={})=>definitions.get(name).execute('test',params,undefined,undefined,{ui:{confirm:async()=>true}})
  await invoke('computer_use_session_open',{backend:'cdp'})
  let observed=JSON.parse((await invoke('computer_use_session_observe',{url:fixture.url})).content[0].text)
  const input=observed.candidates.find(candidate=>candidate.name==='订单编号' && candidate.role==='input')
  assert.ok(input, 'the accessible label must identify the order field')
  await page.locator('label').first().evaluate(label=>label.firstChild.textContent='其他编号 ')
  await assert.rejects(invoke('computer_use_session_act',{candidateId:input.id,type:'type',text:'ORD-2026-002'}),/target changed/i,'changing the label must invalidate the observed target')
  assert.equal(journal.pending('cdp'),null,'a confirmed guard rejection must release its journal entry')
  await page.locator('label').first().evaluate(label=>label.firstChild.textContent='订单编号 ')
  const beforeLostGuard=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  await page.locator('label').first().evaluate(label=>label.firstChild.textContent='其他编号 ')
  let loseGuardReply=true
  cdp.wrapEval(original=>async (...args)=>{const value=await original(...args);if(loseGuardReply){loseGuardReply=false;throw new Error('CDP Runtime.evaluate timed out')}return value})
  await assert.rejects(invoke('computer_use_session_act',{candidateId:beforeLostGuard.candidates.find(c=>c.name==='订单编号').id,type:'type',text:'ORD-2026-002'}),/result is unknown/i,'a lost guard response cannot be assumed safe')
  assert.ok(journal.pending('cdp'),'a lost response retains the durable record')
  await invoke('computer_use_session_takeover',{reason:'核对操作状态'})
  await page.locator('label').first().evaluate(label=>label.firstChild.textContent='订单编号 ')
  observed=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  await invoke('computer_use_session_act',{candidateId:observed.candidates.find(c=>c.name==='订单编号').id,type:'type',text:'ORD-2026-002'})
  observed=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  await invoke('computer_use_session_act',{candidateId:observed.candidates.find(c=>c.name==='查询订单').id,type:'click'})
  const waited=await invoke('computer_use_session_wait',{name:'ORD-2026-002 青木测试商品 待处理',timeoutMs:3000})
  assert.equal(waited.details.matched,true,'the matching record appears after search')
  await invoke('computer_use_session_act',{candidateId:waited.details.candidate.id,type:'click'})
  assert.equal(await page.locator('#selected').innerText(),'已选择订单：ORD-2026-002')
  const state=await (await fetch(fixture.url+'/api/state')).json()
  assert.deepEqual(state,{submissions:[],uploads:[]},'lookup must not submit or upload')
  console.log('PASS Pi CDP business fixture: labeled input, changed-label guard, exact lookup, unique target and independent no-write check')
  const replaceFile = async (content) => page.evaluate(value => {
    const dt=new DataTransfer()
    dt.items.add(new File([value],'same.csv',{type:'text/csv',lastModified:12345}))
    document.querySelector('#file').files=dt.files
  },content)
  await replaceFile('aaa')
  const beforeApproval=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  let confirmations=0
  let approvalText=''
  await assert.rejects(definitions.get('computer_use_session_act').execute('test',{candidateId:beforeApproval.candidates.find(c=>c.name==='上传资料').id,type:'click'},undefined,undefined,{ui:{confirm:async(_title,message)=>{confirmations++;approvalText=message;await replaceFile('bbb');return true}}}),/target changed/i,'a file replaced during confirmation must invalidate the action even when metadata is identical')
  assert.equal(journal.pending('cdp'),null)
  assert.equal(confirmations,1)
  assert.ok(approvalText.includes('same.csv (3 bytes)') && !approvalText.includes('aaa'),'the confirmation displays file metadata, not file contents')
  assert.deepEqual(await (await fetch(fixture.url+'/api/state')).json(),{submissions:[],uploads:[]},'a changed file must not be uploaded')
  // File selection is simulated by Playwright; Pi executes and reads the following steps.
  const payload='订单编号,结果\nORD-2026-002,已核对\n'
  const beforeFile=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  await page.locator('#file').setInputFiles({name:'fixture.csv',mimeType:'text/csv',buffer:Buffer.from(payload)})
  await assert.rejects(invoke('computer_use_session_act',{candidateId:beforeFile.candidates.find(c=>c.name==='上传资料').id,type:'click'}),/target changed/i,'a file change must invalidate a previously observed upload action')
  assert.equal(journal.pending('cdp'),null)
  await page.locator('#file').setInputFiles([])
  const beforeChooser=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  const chooserPromise=page.waitForEvent('filechooser',{timeout:5000})
  const openChooser=invoke('computer_use_session_act',{candidateId:beforeChooser.candidates.find(c=>c.type==='file').id,type:'click'})
  const chooser=await chooserPromise
  const chooserAction=await openChooser
  assert.equal(chooserAction.details.verification.reason,'file_selection')
  assert.ok(journal.pending('cdp'),'file chooser must retain the cross-process action record until selection is verified')
  await assert.rejects(invoke('computer_use_session_observe'),/human/i,'browser must stay paused while a file is being selected')
  await chooser.setFiles({name:'fixture.csv',mimeType:'text/csv',buffer:Buffer.from(payload)})
  await assert.rejects(invoke('computer_use_session_verify_file',{expectedName:'fixture.csv',expectedSha256:'0'.repeat(64)}),/content|hash/i)
  const verified=await invoke('computer_use_session_verify_file',{expectedName:'fixture.csv',expectedSha256:createHash('sha256').update(payload).digest('hex')})
  assert.equal(verified.details.contentVerified,true)
  assert.equal(verified.details.file.name,'fixture.csv')
  assert.equal(verified.details.file.size,Buffer.byteLength(payload))
  assert.equal(journal.pending('cdp'),null,'successful selection verification releases the action record')
  console.log('PASS Pi CDP file chooser: action opens chooser, pauses, and verifies the test-selected file')
  const afterFile=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  const fileField=afterFile.candidates.find(candidate=>candidate.type==='file')
  assert.deepEqual(fileField.files,[{name:'fixture.csv',size:Buffer.byteLength(payload),type:'text/csv'}])
  assert.equal(fileField.value,'', 'file input values must not expose browser fake paths')
  const click = async name => {
    const snapshot=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
    const matches=snapshot.candidates.filter(candidate=>candidate.name===name)
    assert.equal(matches.length,1,`unique candidate for ${name}`)
    await invoke('computer_use_session_act',{candidateId:matches[0].id,type:'click'})
  }
  const waitForText = async expected => {
    for (let i=0;i<30;i++) {
      await invoke('computer_use_session_observe')
      const result=await invoke('computer_use_session_read')
      if (result.content[0].text.includes(expected)) return
      await new Promise(resolve=>setTimeout(resolve,100))
    }
    throw new Error(`Page text did not contain ${expected}`)
  }
  await click('上传资料')
  await waitForText('上传成功：fixture.csv · ORD-2026-002')
  const submitSnapshot=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  const submit=submitSnapshot.candidates.find(candidate=>candidate.name==='提交订单')
  let dropReply=true
  cdp.wrapEval(original=>async (...args)=>{
    const value=await original(...args)
    if(dropReply){dropReply=false;throw new Error('CDP Runtime.evaluate timed out')}
    return value
  })
  await assert.rejects(invoke('computer_use_session_act',{candidateId:submit.id,type:'click'}),/result is unknown/i)
  assert.ok(journal.pending('cdp'),'the lost response must leave a durable record')
  definitions.clear()
  factory({registerTool:definition=>definitions.set(definition.name,definition),on:()=>{}})
  const reopened=await invoke('computer_use_session_open',{backend:'cdp'})
  assert.deepEqual(reopened.details.pendingBackends,['cdp'],'a new router reports the pending action')
  await waitForText('已提交：ORD-2026-002')
  const afterTimeout=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  await assert.rejects(invoke('computer_use_session_act',{candidateId:afterTimeout.candidates.find(c=>c.name==='提交订单').id,type:'click'}),/result is unknown/i,'the UI must not re-submit after a lost result')
  const finalState=await (await fetch(fixture.url+'/api/state')).json()
  const digest=createHash('sha256').update(payload).digest('hex')
  assert.deepEqual(finalState.uploads,[{recordId:'ORD-2026-002',name:'fixture.csv',sha256:digest,size:Buffer.byteLength(payload)}])
  assert.deepEqual(finalState.submissions,[{recordId:'ORD-2026-002',sha256:digest,status:'已提交'}])
  let takeoverPrompt=''
  const declined=await definitions.get('computer_use_session_takeover').execute('test',{reason:'核对订单提交状态'},undefined,undefined,{ui:{confirm:async(_title,message)=>{takeoverPrompt=message;return false}}})
  assert.equal(declined.details.paused,true)
  assert.match(takeoverPrompt,/结果未知/)
  await definitions.get('computer_use_session_takeover').execute('test',{reason:'核对订单提交状态'},undefined,undefined,{ui:{confirm:async()=>true}})
  assert.equal((await (await fetch(fixture.url+'/api/state')).json()).submissions.length,1,'recovery must not repeat the submission')
  assert.deepEqual(await (await fetch(fixture.url+'/api/metrics')).json(),{uploadAttempts:1,submitAttempts:1},'recovery must not even attempt a duplicate request')
  console.log('PASS business recovery: lost submit reply, independent server readback, no repeat and human confirmation')
  console.log('PASS Pi CDP business fixture: upload and submit actions, status text and independent server readback (file chosen by test harness)')
  await page.locator('#file').setInputFiles([])
  const cancelSnapshot=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  const cancelChooserPromise=page.waitForEvent('filechooser',{timeout:5000})
  const cancelOpening=invoke('computer_use_session_act',{candidateId:cancelSnapshot.candidates.find(c=>c.type==='file').id,type:'click'})
  const cancelChooser=await cancelChooserPromise
  await cancelOpening
  const declinedCancel=await definitions.get('computer_use_session_cancel_file').execute('test',{},undefined,undefined,{ui:{confirm:async()=>false}})
  assert.equal(declinedCancel.details.paused,true)
  assert.ok(journal.pending('cdp'),'declining cancellation must retain the record')
  await cancelChooser.setFiles([])
  const cancelled=await invoke('computer_use_session_cancel_file')
  assert.equal(cancelled.details.cancelled,true)
  assert.equal(journal.pending('cdp'),null,'confirmed cancellation releases the record')
  console.log('PASS Pi CDP file chooser cancellation: explicit confirmation and journal release')
  await page.locator('#file').evaluate(element=>{element.multiple=true})
  const files=Array.from({length:21},(_,index)=>({name:`item-${index}.csv`,mimeType:'text/csv',buffer:Buffer.from('x')}))
  await page.locator('#file').setInputFiles(files)
  const many=JSON.parse((await invoke('computer_use_session_observe')).content[0].text).candidates.find(candidate=>candidate.type==='file')
  assert.equal(many.fileCount,21)
  assert.equal(many.files.length,20)
  assert.equal(many.filesTruncated,true)
  await page.locator('#file').setInputFiles(Array.from({length:101},(_,index)=>({name:`item-${index}.csv`,mimeType:'text/csv',buffer:Buffer.from('x')})))
  await assert.rejects(invoke('computer_use_session_observe'),/too many file/i,'oversized file selection must fail closed')
  console.log('PASS file selection limits: bounded output and fail closed')
  await page.locator('#file').setInputFiles([])
  const docBefore=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  const reloadChooserPromise=page.waitForEvent('filechooser',{timeout:5000})
  const reloadOpening=invoke('computer_use_session_act',{candidateId:docBefore.candidates.find(c=>c.type==='file').id,type:'click'})
  const reloadChooser=await reloadChooserPromise
  await reloadOpening
  await reloadChooser.setFiles({name:'fixture.csv',mimeType:'text/csv',buffer:Buffer.from(payload)})
  await page.reload()
  await page.locator('#file').setInputFiles({name:'fixture.csv',mimeType:'text/csv',buffer:Buffer.from(payload)})
  await assert.rejects(invoke('computer_use_session_verify_file',{expectedName:'fixture.csv'}),/document changed/i,'same-URL reload must not confirm a different document')
  assert.ok(journal.pending('cdp'),'document mismatch must retain pending selection')
  await invoke('computer_use_session_cancel_file')
  assert.equal(journal.pending('cdp'),null)
  console.log('PASS CDP file chooser rejects same-URL document reload')
  await page.locator('#file').setInputFiles([])
  const manualObs=JSON.parse((await invoke('computer_use_session_observe')).content[0].text)
  const manualChooserPromise=page.waitForEvent('filechooser',{timeout:5000})
  const manualAction=invoke('computer_use_session_act',{candidateId:manualObs.candidates.find(c=>c.type==='file').id,type:'click'})
  const manualChooser=await manualChooserPromise
  await manualAction
  await manualChooser.setFiles({name:'fixture.csv',mimeType:'text/csv',buffer:Buffer.from(payload)})
  const needConfirmation=await invoke('computer_use_session_verify_file',{expectedName:'fixture.csv'})
  assert.equal(needConfirmation.details.paused,true)
  assert.match(needConfirmation.content[0].text,/takeover/i)
  assert.ok(journal.pending('cdp'),'metadata alone must retain pending selection')
  const prompts=[]
  const takeover=definitions.get('computer_use_session_takeover')
  const decline=await takeover.execute('test',{reason:'请核对文件'},undefined,undefined,{ui:{confirm:async(title,message)=>{prompts.push({title,message});return false}}})
  assert.equal(decline.details.paused,true)
  assert.match(prompts[0].message,/fixture\.csv/)
  assert.match(prompts[0].message,/字节/)
  assert.match(prompts[0].message,/无法确认文件内容/)
  assert.ok(journal.pending('cdp'),'declined confirmation must retain pending selection')
  const changed=await takeover.execute('test',{reason:'请核对文件'},undefined,undefined,{ui:{confirm:async()=>{await page.locator('#file').setInputFiles({name:'fixture.csv',mimeType:'text/csv',buffer:Buffer.alloc(Buffer.byteLength(payload), 120)});return true}}})
  assert.equal(changed.details.paused,true,'same-name and same-size file replacement during confirmation keeps selection paused')
  assert.ok(journal.pending('cdp'))
  await page.locator('#file').setInputFiles({name:'fixture.csv',mimeType:'text/csv',buffer:Buffer.from(payload)})
  const accepted=await takeover.execute('test',{reason:'请核对文件'},undefined,undefined,{ui:{confirm:async()=>true}})
  assert.equal(accepted.details.paused,false)
  assert.equal(journal.pending('cdp'),null)
  console.log('PASS Pi CDP file selection: metadata review, decline keeps paused, explicit confirmation resumes')
  await invoke('computer_use_session_close')
} finally {await browser?.close();journal?.close();await fixture.close();await rm(temp,{recursive:true,force:true})}
