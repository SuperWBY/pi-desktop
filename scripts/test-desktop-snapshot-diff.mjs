import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
const source = await readFile(new URL('../extensions/computer-use/index.ts', import.meta.url), 'utf8')
const section = source.slice(source.indexOf('function diffSnapshots('), source.indexOf('\nfunction point(', source.indexOf('function diffSnapshots(')))
const diff = runInNewContext(`${stripTypeScriptTypes(section)}\ndiffSnapshots`)
const element = (id, title) => ({id, role:'AXButton', title, enabled:true, focused:false, bounds:{x:1,y:2,width:3,height:4}})
const snap = (...elements) => ({windowTitle:'Fixture',elements})
assert.equal(diff(snap(element('e1','Start')), snap(element('e1','Done'))).status,'changed','interface changes do not prove business success')
const removed = diff(snap(element('e1','Still visible'), element('e2','Dismissed')), snap(element('e1','Still visible')))
assert.equal(removed.changed,true,'a removed element is an interface change')
assert.equal(removed.changedElements,1,'removed elements are included in the count')
assert.equal(diff(snap(element('e1','Same')),snap(element('e1','Same'))).status,'unverified')
console.log('PASS desktop snapshot diff: changes, removals and unverified results')
