import assert from 'node:assert/strict'
import { BrowserRouter } from '../extensions/computer-use/src/browser-router.ts'
const expected='a'.repeat(64)
let selected=false, digest='b'.repeat(64), enabled=true
const adapter={async observe(){return {url:'https://example.test/',documentId:'doc',tabId:1,candidates:[{id:'file',name:'选择文件',type:'file',fileCount:selected?1:0,files:selected?[{name:'data.csv',size:4,type:'text/csv'}]:[],filesTruncated:false}]}},async act(){return {ok:true}},async close(){},async hashFile(){if(!enabled)throw new Error('unsupported');return {sha256:digest,size:4}}}
const router=new BrowserRouter({inapp:adapter,cdp:adapter,extension:adapter})
await router.open('inapp');await router.observe();await router.act({candidateId:'file',type:'click'});selected=true
await assert.rejects(router.verifyFileSelection('data.csv','invalid'),/64 hexadecimal/i)
await assert.rejects(router.verifyFileSelection('data.csv',expected),/hash|sha|content/i)
assert.equal(router.current().paused,true)
enabled=false;await assert.rejects(router.verifyFileSelection('data.csv',expected),/unsupported/i);assert.equal(router.current().paused,true)
enabled=true;digest=expected
const result=await router.verifyFileSelection('data.csv',expected)
assert.equal(result.contentVerified,true);assert.equal(router.current().paused,false)
await router.close()
console.log('PASS selected file hash verification rejects mismatches and unavailable checks')
let name='data.csv'
const manualAdapter={...adapter,async checkFile(obs){if(obs.candidates[0].files[0].name!==name)throw new Error('Selected file changed')},async observe(){return {url:'https://example.test/',documentId:'doc',tabId:1,candidates:[{id:'file',name:'选择文件',type:'file',fileCount:selected?1:0,files:selected?[{name,size:4,type:'text/csv'}]:[],filesTruncated:false}]}}}
selected=false
const manual=new BrowserRouter({inapp:manualAdapter,cdp:manualAdapter,extension:manualAdapter})
await manual.open('inapp');await manual.observe();await manual.act({candidateId:'file',type:'click'});selected=true
await assert.rejects(manual.verifyFileSelection('data.csv'),/user|confirm/i,'metadata alone must not release the session')
assert.equal(manual.current().paused,true)
const preview=await manual.previewFileSelection()
assert.equal(preview.file.name,'data.csv');assert.equal(manual.current().paused,true)
name='other.csv'
await assert.rejects(manual.confirmFileSelection(preview),/changed/i,'confirmation must be bound to the displayed metadata')
assert.equal(manual.current().paused,true)
name='data.csv';await manual.confirmFileSelection(preview);assert.equal(manual.current().paused,false)
await manual.close()
console.log('PASS metadata-only file selection requires confirmation and rejects changes')
selected=false
const oldAdapter={...manualAdapter,checkFile:undefined}
const oldRouter=new BrowserRouter({inapp:oldAdapter,cdp:oldAdapter,extension:oldAdapter})
await oldRouter.open('extension');await oldRouter.observe();await oldRouter.act({candidateId:'file',type:'click'});selected=true
const oldPreview=await oldRouter.previewFileSelection()
await assert.rejects(oldRouter.confirmFileSelection(oldPreview),/unavailable|update/i)
assert.equal(oldRouter.current().paused,true,'unsupported identity checks must stay paused')
await oldRouter.cancelFileSelection();await oldRouter.close()
console.log('PASS unsupported file identity check fails closed')
