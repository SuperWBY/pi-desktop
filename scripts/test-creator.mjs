import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {CreatorWorkspace} from '../extensions/creator/workspace.ts'
import {validCreatorAction} from '../extensions/creator/types.ts'
const root=mkdtempSync(join(tmpdir(),'pi-creator-test-'))
const previous=process.env.PI_DESKTOP_CREATOR_CLI
process.env.PI_DESKTOP_CREATOR_CLI=resolve('build/pi-seed/1.5.2/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js')
let checks=0
async function test(name,run){await run();checks++;console.log('✓ '+name)}
try{
 const workspace=new CreatorWorkspace(root)
 await test('Creator actions reject malformed payloads and traversal',()=>{
  assert.ok(validCreatorAction({action:'enable'}));assert.ok(validCreatorAction({action:'create',kind:'context',name:'my-context'}))
  for(const input of [{action:['check'],id:'my-mode'},{action:{toString:'check'},id:'my-mode'},{action:'enable',cwd:'/etc'},{action:'install',id:'../../etc'},{action:'create',kind:'shell',name:'my-mode'},null])assert.equal(validCreatorAction(input),false)
 })
 for(const kind of ['mode','context','subagent']){
  const id='test-'+kind
  await test(`Create and check a real ${kind} package`,()=>{
   const draft=workspace.create(kind,id);assert.equal(draft.status,'draft')
   assert.equal(workspace.check(id).status,'checked');assert.equal(workspace.list().some(d=>d.id===id),true)
   assert.throws(()=>workspace.create(kind,id),/already exists/)
  })
  await test(`Actual Pi loads ${kind} extension without model tokens`,async()=>{
   const draft=await workspace.test(id)
   assert.equal(draft.status,'tested');assert.ok(draft.commands.length>0)
   assert.ok(workspace.testedFiles(id).files.some(file=>file.relative==='extension.ts'))
  })
 }
 await test('Editing checked code invalidates verification and installation eligibility',()=>{
  const draft=workspace.get('test-mode');writeFileSync(join(draft.path,'extension.ts'),readFileSync(join(draft.path,'extension.ts'),'utf8')+'\n// change\n')
  assert.equal(workspace.get(draft.id).status,'draft');assert.throws(()=>workspace.testedFiles(draft.id),/Run the current/)
 })
 await test('Installation scripts and escaping entry paths cannot pass checks',()=>{
  const draft=workspace.create('mode','bad-package'),path=join(draft.path,'package.json'),manifest=JSON.parse(readFileSync(path))
  writeFileSync(path,JSON.stringify({...manifest,scripts:{postinstall:'anything'}}));assert.throws(()=>workspace.check(draft.id),/installation scripts/)
  writeFileSync(path,JSON.stringify({...manifest,pi:{extensions:['../../outside.ts']}}));assert.throws(()=>workspace.check(draft.id),/inside this plugin/)
 })
 await test('Symlinked package files are rejected before runtime execution',()=>{
  const draft=workspace.create('mode','unsafe-links');symlinkSync('/etc/hosts',join(draft.path,'outside.txt'));assert.throws(()=>workspace.check(draft.id),/symbolic links/)
 })
 await test('Broken code cannot pass a real Pi load test',async()=>{
  const draft=workspace.create('mode','broken-code');writeFileSync(join(draft.path,'extension.ts'),'export default function( { BROKEN')
  await assert.rejects(()=>workspace.test(draft.id),/Failed to load extension|No plugin command|timed out|Pi exited/)
  assert.notEqual(workspace.get(draft.id).status,'tested')
 })
 console.log(`${checks} creator checks passed`)
}finally{rmSync(root,{recursive:true,force:true});if(previous===undefined)delete process.env.PI_DESKTOP_CREATOR_CLI;else process.env.PI_DESKTOP_CREATOR_CLI=previous}
