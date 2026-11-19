import assert from 'node:assert/strict'
import {BrowserRouter} from '../extensions/computer-use/src/browser-router.ts'
let needsHuman=false, reads=0, observations=0
const adapter={async observe(){observations++;return {url:'https://example.test/',documentId:'test-document',requiresHuman:needsHuman,candidates:[{id:'one',name:'Go',role:'button'}]}},async readText(o){reads++;assert.equal(o.url,'https://example.test/');return {text:'verified result',truncated:false}},async act(){return {ok:true}},async close(){}}
const router=new BrowserRouter({inapp:adapter,cdp:adapter,extension:adapter},{approve:async()=>true})
await router.open('inapp');await router.observe();await router.act({candidateId:'one',type:'click'})
const before=observations
assert.equal((await router.readText()).text,'verified result','a read after an action should observe safely first')
assert.equal(observations,before,'read uses the existing post-action observation')
assert.equal(router.current().observation,null,'read-only observation must not authorize a later action')
await assert.rejects(router.act({candidateId:'one',type:'click'}),/observe/i)
needsHuman=true
await router.observe()
await assert.rejects(router.readText(),/human action/i)
assert.equal(reads,1,'challenge detection must stop page text reading')
await assert.rejects(router.readText(),/human action/i)
await router.close()
let currentUrl='https://example.test/',tab=1,doc='doc-a',count=0
const switching={async observe(){return {url:currentUrl,tabId:tab,documentId:doc,candidates:[{id:'one',name:'Go'}]}},async readText(){count++;return {text:'read',truncated:false}},async act(){tab=2;return {ok:true}},async close(){}}
const extension=new BrowserRouter({inapp:switching,cdp:switching,extension:switching})
await extension.open('extension');await extension.observe();await extension.act({candidateId:'one',type:'click'})
await assert.rejects(extension.readText(),/observe/i,'switching the active Chrome tab must require an explicit observation')
assert.equal(count,0);await extension.close()
tab=1;switching.act=async()=>{currentUrl='https://example.test/other';return {ok:true}}
const navigation=new BrowserRouter({inapp:switching,cdp:switching,extension:switching})
await navigation.open('inapp');await navigation.observe();await navigation.act({candidateId:'one',type:'click'})
await assert.rejects(navigation.readText(),/observe/i,'navigation must require an explicit observation')
assert.equal(count,0);await navigation.close()
currentUrl='https://example.test/';doc='doc-a';switching.act=async()=>{doc='doc-b';return {ok:true}}
const reloaded=new BrowserRouter({inapp:switching,cdp:switching,extension:switching})
await reloaded.open('inapp');await reloaded.observe();await reloaded.act({candidateId:'one',type:'click'})
await assert.rejects(reloaded.readText(),/observe/i,'same URL with a different document must require observation')
assert.equal(count,0);await reloaded.close()
console.log('PASS read-only fresh observation preserves action and human-verification boundaries')
