import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {stripTypeScriptTypes} from 'node:module'
import {runInNewContext} from 'node:vm'
const source=await readFile(new URL('../extensions/computer-use/index.ts',import.meta.url),'utf8')
const body=source.slice(source.indexOf('async function doAction('),source.indexOf('export default function computerUse('))
let calls=[]
const act=runInNewContext(`${stripTypeScriptTypes(body)}\ndoAction`,{isWindows:false,findElement:()=>null,point:()=>{},runHelper:async(args)=>{calls.push(args);return {ok:true}},setTimeout})
const snapshot={app:'Fixture',bundleId:'dev.fixture',windowId:44,windowBounds:{x:10,y:20,width:200,height:100},screenWidth:800,screenHeight:600}
for(const type of ['click','double_click','right_click','hover','scroll']) {
  calls=[]; await act({type,x:30,y:40,delta:10},{snapshot})
  assert.equal(calls.length,1)
  const i=calls[0].indexOf('--expected-window')
  assert.ok(i>=0,`${type} must pass its observed window to the native helper`)
  assert.deepEqual(JSON.parse(calls[0][i+1]),{app:'Fixture',bundleId:'dev.fixture',windowId:44,bounds:snapshot.windowBounds})
}
calls=[]
await assert.rejects(act({type:'click',x:500,y:500},{snapshot}),/outside.*window/i)
assert.equal(calls.length,0)
await assert.rejects(act({type:'click',x:30,y:40},{snapshot:{...snapshot,windowId:null}}),/window.*ident/i)
assert.equal(calls.length,0)
console.log('PASS coordinate guard: observed window passed to helper and unsafe coordinates rejected')
