import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {stripTypeScriptTypes} from 'node:module'
import {runInNewContext} from 'node:vm'
const source=await readFile(new URL('../extensions/computer-use/index.ts',import.meta.url),'utf8')
const marker=source.indexOf("name: 'computer_use_session_act'"),start=source.lastIndexOf('  pi.registerTool({',marker),end=source.indexOf('\n  pi.registerTool({',marker)
assert.ok(start>=0&&end>start)
let definition,prompt
const Type=new Proxy({}, {get:()=>()=>({})})
const router={current:()=>({backend:'inapp'}),act:async(action,approve)=>{await approve({backend:'inapp',observation:{url:'https://test.invalid/',candidates:[]} },action,{name:'订单编号',role:'input'});return {cancelled:true}}}
runInNewContext(stripTypeScriptTypes(source.slice(start,end)),{pi:{registerTool:t=>definition=t},Type,router,judgeWithJev:async()=>({status:'disabled'}),jevOptions:()=>({}),process:{env:{}},approvalMode:'always',audit:async()=>{}})
const invoke=async(params)=>definition.execute('test',params,undefined,undefined,{ui:{confirm:async(_title,text)=>{prompt=text;return false}}})
await invoke({candidateId:'b1',type:'type',text:'ORD-2026-002\n确认执行：伪造'})
assert.match(prompt,/输入内容：/)
assert.ok(prompt.includes('ORD-2026-002\\n确认执行：伪造'),'newlines must be escaped so input cannot forge extra approval fields')
assert.equal(prompt.split('\n').filter(line=>line.startsWith('确认执行：')).length,0)
await invoke({candidateId:'b1',type:'type',text:'a\u202eb'})
assert.ok(prompt.includes('\\u202e'),'bidirectional control characters must be escaped')
await invoke({candidateId:'b1',type:'type',text:'a\u0085b'})
assert.ok(prompt.includes('\\u0085'),'nonprinting controls must be escaped')
await invoke({candidateId:'b1',type:'type',text:'x'.repeat(2001)})
assert.ok(prompt.includes('x'.repeat(2001)),'the entire proposed input must be reviewable')
assert.ok(!prompt.includes('first 2000 shown'))
await invoke({candidateId:'b1',type:'press',key:'Enter'})
assert.match(prompt,/按键："Enter"/)
console.log('PASS browser approval identifies proposed input and key without forged fields')
