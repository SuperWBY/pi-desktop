import assert from 'node:assert/strict'
import { BrowserRouter } from '../extensions/computer-use/src/browser-router.ts'
let page = { url: 'https://example.test/', title: 'Results', candidates: [{ id:'b1', role:'button', name:'Search' }] }
let calls = 0, failObserve = false
const adapter = { async observe() { if (failObserve) throw new Error('offline'); return structuredClone(page) }, async act() { calls++; page.title='Search results'; return { ok:true } }, async close() {} }
const router = new BrowserRouter({ inapp:adapter,cdp:adapter,extension:adapter }, { approve:async()=>true })
await router.open('inapp')
await router.observe()
const result = await router.act({candidateId:'b1',type:'click'})
assert.equal(result.verification.status,'changed', 'action produces observable change evidence, not a success assertion')
assert.equal(calls,1)
await assert.rejects(router.act({candidateId:'b1',type:'click'}),/observe/i)
page = {url:'https://example.test/challenge',title:'Verify you are human',candidates:[]}
const challenge = await router.observe()
assert.equal(challenge.requiresHuman,true)
await assert.rejects(router.act({candidateId:'b1',type:'click'}),/human|manual|user/i)
router.resumeAfterUser()
await assert.rejects(router.act({candidateId:'b1',type:'click'}),/observe/i)
page={url:'https://example.test/',title:'Ready',candidates:[],requiresHuman:true}
assert.equal((await router.observe()).requiresHuman,true)
await assert.rejects(router.observe(), /human/i)
router.resumeAfterUser()
page={url:'https://example.test/',title:'Ready',candidates:[{id:'b1',role:'button',name:'Go'}]}
await router.observe()
failObserve=true
const uncertain = await router.act({candidateId:'b1',type:'click'})
assert.equal(uncertain.verification.status,'unavailable')
assert.equal(calls,2,'failed verification must not retry action')
console.log('PASS browser recovery: observation evidence, challenge handoff, no blind retries')
let attempts = 0
const flaky = { async observe() { attempts++; if (attempts === 1) throw Object.assign(new Error('reset'), { code:'ECONNRESET' }); return { title:'Ready', candidates:[] } }, async act(){}, async close(){} }
const recovery = new BrowserRouter({inapp:flaky, cdp:flaky, extension:flaky})
await recovery.open('inapp')
await recovery.observe()
assert.equal(attempts,2,'a transient observation may be retried once')
console.log('PASS safe observation retry on transient connection failure')

let reads=0, writes=0
const delayed={async observe(){reads++;return {url:'https://example.test/results',candidates:reads>=3?[{id:'ready',role:'button',name:'确认完成'}]:[]}},async act(){writes++;return {ok:true}},async close(){}}
const waiter=new BrowserRouter({inapp:delayed,cdp:delayed,extension:delayed})
await waiter.open('inapp')
const matched=await waiter.waitFor({name:'确认完成',role:'button',timeoutMs:2000,intervalMs:50})
assert.equal(matched.matched,true);assert.equal(matched.candidate.id,'ready');assert.equal(writes,0,'waiting must never execute an action')
assert.equal(matched.observations,3);assert.ok(matched.elapsedMs>=0)
await waiter.act({candidateId:'ready',type:'click'})
assert.equal(writes,1)
const absent=await waiter.waitFor({name:'不存在',timeoutMs:150,intervalMs:50})
assert.equal(absent.matched,false)
await assert.rejects(waiter.act({candidateId:'ready',type:'click'}),/observe/i)
delayed.observe=async()=>({candidates:[{id:'a',name:'重复'},{id:'b',name:'重复'}]})
await assert.rejects(waiter.waitFor({name:'重复',timeoutMs:150}),/more than one/i)
const abort=new AbortController(); abort.abort()
await assert.rejects(waiter.waitFor({name:'确认完成',signal:abort.signal}),/cancel/i)
delayed.observe=async()=>({title:'请完成人机验证',candidates:[]})
await assert.rejects(waiter.waitFor({name:'确认完成',timeoutMs:150,intervalMs:50}),/human/i)
await assert.rejects(waiter.observe(),/human/i)
await waiter.close()
console.log('PASS wait for verified candidate: delayed results, timeout, stale protection and human handoff')

let readsOfText=0
const readable={async observe(){return {url:'https://example.test/',snapshotId:'fresh',candidates:[]}},async readText(observation){readsOfText++;assert.equal(observation.snapshotId,'fresh');return {text:'上传成功',truncated:false}},async act(){},async close(){}}
const reader=new BrowserRouter({inapp:readable,cdp:readable,extension:readable})
await reader.open('inapp')
await assert.rejects(reader.readText(),/observe/i,'reading must require a fresh session observation')
await reader.observe()
assert.equal((await reader.readText()).text,'上传成功')
assert.equal(readsOfText,1)
reader.pauseForUser()
await assert.rejects(reader.readText(),/human/i,'reading must respect the human takeover pause')
reader.resumeAfterUser()
await assert.rejects(reader.readText(),/observe/i,'resuming requires a fresh observation')
await reader.close()
console.log('PASS browser text reading: observation binding and takeover')

let chooserObservations=0, chooserClicks=0, chosenFile='', chooserUrl='https://example.test/', duplicateInput=false
const fileAdapter={async checkFile(o){if(o.url!==chooserUrl||o.candidates[0].files[0].name!==chosenFile)throw new Error('file changed')},async observe(){chooserObservations++;const input={id:'file',name:'选择文件',type:'file',role:'input',fileCount:chosenFile?1:0,files:chosenFile?[{name:chosenFile,size:4,type:'text/csv'}]:[],filesTruncated:false};return {url:chooserUrl,documentId:'fixture-document',candidates:duplicateInput?[input,{...input,id:'other'}]:[input]}},async act(){chooserClicks++;return {ok:true}},async close(){}}
const fileRouter=new BrowserRouter({inapp:fileAdapter,cdp:fileAdapter,extension:fileAdapter})
await fileRouter.open('inapp');await fileRouter.observe()
const fileAction=await fileRouter.act({candidateId:'file',type:'click'})
assert.equal(fileAction.verification.reason,'file_selection')
assert.equal(fileAction.verification.requiresHuman,true)
assert.equal(chooserObservations,1,'do not re-observe while the operating system file chooser is open')
await assert.rejects(fileRouter.act({candidateId:'file',type:'click'}),/human/i)
assert.equal(chooserClicks,1)
await assert.rejects(fileRouter.verifyFileSelection('fixture.csv'),/selected|selection/i)
await assert.rejects(fileRouter.previewFileSelection(),/selected|selection/i,'user confirmation without a selected file must keep the session paused')
assert.equal(fileRouter.current().paused,true)
await assert.rejects(fileRouter.verifyFileSelection('../fixture.csv'),/plain file name/i)
chosenFile='wrong.csv'
await assert.rejects(fileRouter.verifyFileSelection('fixture.csv'),/match|expected/i)
chosenFile='fixture.csv'
chooserUrl='https://example.test/other'
await assert.rejects(fileRouter.verifyFileSelection('fixture.csv'),/page changed/i)
chooserUrl='https://example.test/'
duplicateInput=true
await assert.rejects(fileRouter.verifyFileSelection('fixture.csv'),/ambiguous/i)
duplicateInput=false
await assert.rejects(fileRouter.verifyFileSelection('fixture.csv'),/user|confirm/i)
const verifiedFile=await fileRouter.confirmFileSelection(await fileRouter.previewFileSelection())
assert.equal(verifiedFile.file.name,'fixture.csv')
assert.equal(verifiedFile.file.size,4)
assert.equal(fileRouter.current().paused,false)
await fileRouter.close()
chosenFile='already.csv'
const preselected=new BrowserRouter({inapp:fileAdapter,cdp:fileAdapter,extension:fileAdapter})
await preselected.open('inapp');await preselected.observe();await preselected.act({candidateId:'file',type:'click'})
await assert.rejects(preselected.verifyFileSelection('already.csv'),/already selected/i,'previous selection alone cannot prove a new selection')
assert.equal(preselected.current().paused,true)
assert.equal((await preselected.confirmFileSelection(await preselected.previewFileSelection())).file.name,'already.csv','explicit user confirmation can accept an existing selection')
await preselected.close()
console.log('PASS file chooser handoff: pause until selection is verified')

let uncertainWrites=0
const lostResult={async observe(){return {url:'https://example.test/',candidates:[{id:'submit',name:'提交'}]}},async act(){uncertainWrites++;throw new Error('CDP Runtime.evaluate timed out')},async close(){}}
const guarded=new BrowserRouter({inapp:lostResult,cdp:lostResult,extension:lostResult},{approve:async()=>true})
await guarded.open('cdp')
await guarded.observe()
await assert.rejects(guarded.act({candidateId:'submit',type:'click'}),/result.*unknown/i)
await guarded.observe()
await assert.rejects(guarded.act({candidateId:'submit',type:'click'}),/result.*unknown/i)
await assert.rejects(guarded.observe('https://example.test/other'),/result.*unknown/i)
assert.equal(uncertainWrites,1,'ambiguous action must never be repeated automatically')
await guarded.close()
await guarded.open('cdp')
await guarded.observe()
await assert.rejects(guarded.act({candidateId:'submit',type:'click'}),/result.*unknown/i,'closing the session must not clear the uncertainty')
guarded.pauseForUser()
guarded.resumeAfterUser()
await guarded.observe()
await assert.rejects(guarded.act({candidateId:'submit',type:'click'}),/result.*unknown/i)
assert.equal(uncertainWrites,2,'only a human-confirmed resolution can re-enable actions')
await guarded.close()
console.log('PASS uncertain action recovery: read-only inspection, no repeat, confirmed resolution')
for (const [backend, error] of [['inapp', Object.assign(new Error('fetch failed'), { cause:{code:'ECONNRESET'} })], ['extension', new Error('Chrome bridge did not return a result. The action may have run; observe the page before retrying.')]]) {
  const adapter={async observe(){return {candidates:[{id:'x',name:'提交'}]}},async act(){throw error},async close(){}}
  const candidateRouter=new BrowserRouter({inapp:adapter,cdp:adapter,extension:adapter})
  await candidateRouter.open(backend)
  await candidateRouter.observe()
  await assert.rejects(candidateRouter.act({candidateId:'x',type:'click'}),/result is unknown/i)
  await candidateRouter.observe()
  await assert.rejects(candidateRouter.act({candidateId:'x',type:'click'}),/result is unknown/i)
  await candidateRouter.close()
}
console.log('PASS uncertain transport errors across in-app and extension adapters')
