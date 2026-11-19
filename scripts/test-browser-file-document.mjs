import assert from 'node:assert/strict'
import {BrowserRouter} from '../extensions/computer-use/src/browser-router.ts'
let tab=1,doc='doc-1',selected=false
const adapter={async observe(){return {url:'https://example.test/',tabId:tab,documentId:doc,candidates:[{id:'file',name:'选择文件',role:'input',type:'file',fileCount:selected?1:0,files:selected?[{name:'fixture.csv',size:4,type:'text/csv'}]:[],filesTruncated:false}]}},async checkFile(o){if(tab!==o.tabId||doc!==o.documentId)throw new Error('document changed')},async act(){return {ok:true}},async close(){}}
let pending=null
const journal={pending:(backend)=>backend==='extension'?pending:null,claim:()=>pending={id:'a'},acknowledge(_b,id){assert.equal(id,pending.id);pending=null},resolve(){}}
const router=new BrowserRouter({inapp:adapter,cdp:adapter,extension:adapter},{journal})
await router.open('extension');await router.observe();await router.act({candidateId:'file',type:'click'});selected=true
tab=2;doc='doc-2'
await assert.rejects(router.verifyFileSelection('fixture.csv'),/tab|document|page changed/i,'same URL in another tab must not confirm selection')
assert.ok(pending);assert.equal(router.current().paused,true)
tab=1;doc='doc-2'
await assert.rejects(router.verifyFileSelection('fixture.csv'),/tab|document|page changed/i,'reloading the same URL must not confirm selection')
assert.ok(pending);assert.equal(router.current().paused,true)
doc='doc-1'
assert.equal((await router.confirmFileSelection(await router.previewFileSelection())).file.name,'fixture.csv')
assert.equal(pending,null);await router.close()
for (const backend of ['inapp','cdp']) {
 let documentId='first', fileChosen=false, writes=0
 const candidateAdapter={async observe(){return {url:'https://example.test/',documentId,candidates:[{id:'file',name:'选择文件',type:'file',fileCount:fileChosen?1:0,files:fileChosen?[{name:'fixture.csv',size:4,type:'text/csv'}]:[],filesTruncated:false}]}},async checkFile(o){if(documentId!==o.documentId)throw new Error('document changed')},async act(){writes++;return {ok:true}},async close(){}}
 const r=new BrowserRouter({inapp:candidateAdapter,cdp:candidateAdapter,extension:candidateAdapter})
 await r.open(backend);await r.observe();await r.act({candidateId:'file',type:'click'});fileChosen=true;documentId='second'
 await assert.rejects(r.verifyFileSelection('fixture.csv'),/document|page changed/i,`${backend} must reject a same-URL reloaded document`)
 assert.equal(r.current().paused,true);assert.equal(writes,1)
 documentId='first';assert.equal((await r.confirmFileSelection(await r.previewFileSelection())).file.name,'fixture.csv');await r.close()
}
console.log('PASS file selection is bound to the observed Chrome tab and document')
