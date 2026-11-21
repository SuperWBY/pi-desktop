import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {sendCreatorControl} from '../src/main/creator-control.ts'
import {CREATOR_RESULT_PREFIX,decodeCreatorRecord,isCreatorState} from '../extensions/creator/types.ts'
let checks=0
async function test(name,run){await run();checks++;console.log('✓ '+name)}
class Process extends EventEmitter {
 constructor(mode){super();this.mode=mode}
 async send(command){
  const {requestId}=JSON.parse(command.message.slice(command.message.indexOf(' ')+1))
  if(this.mode==='reject')return {success:false,error:'RPC rejected'}
  queueMicrotask(()=>{
   this.emit('record',{type:'extension_ui_request',method:'notify',message:CREATOR_RESULT_PREFIX+JSON.stringify({requestId:'wrong',result:{ok:true}})})
   if(this.mode==='exit')this.emit('exit',{code:1})
   else this.emit('record',{type:'extension_ui_request',method:'notify',message:CREATOR_RESULT_PREFIX+JSON.stringify({requestId,result:this.mode==='fail'?{ok:false,error:'actual extension failure'}:{ok:true}})})
  })
  return {success:true,data:{disposition:'handled'}}
 }
}
await test('A handled RPC ACK cannot hide an extension command failure',async()=>{
 const process=new Process('fail'),result=await sendCreatorControl(process,{action:'check',id:'my-mode'})
 assert.equal(result.ok,false);assert.equal(result.error,'actual extension failure');assert.equal(process.listenerCount('record'),0)
})
await test('Only the matching operation result completes the control request',async()=>{
 const process=new Process('ok');assert.equal((await sendCreatorControl(process,{action:'enable'})).ok,true);assert.equal(process.listenerCount('record'),0)
})
await test('Rejected RPC and early exit reject immediately and remove listeners',async()=>{
 for(const mode of ['reject','exit']){const process=new Process(mode);await assert.rejects(()=>sendCreatorControl(process,{action:'enable'}),/rejected|exited/);assert.equal(process.listenerCount('record'),0);assert.equal(process.listenerCount('exit'),0)}
})
await test('Malformed creator notifications do not become state or control replies',()=>{
 const invalid={type:'extension_ui_request',method:'notify',message:'PI_DESKTOP_CREATOR_STATE:{"enabled":true,"drafts":[{}]}'}
 assert.equal(decodeCreatorRecord(invalid),invalid);assert.equal(isCreatorState({enabled:true,drafts:[{}]}),false)
})
console.log(`${checks} creator control checks passed`)
