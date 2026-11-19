import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
const source = await readFile(new URL('../extensions/computer-use/index.ts', import.meta.url),'utf8')
const section = source.slice(source.indexOf('async function verify('),source.indexOf('async function doAction('))
let observations = 0
const verify = runInNewContext(`${stripTypeScriptTypes(section)}\nverify`, {assertDesktopUseEnabled:()=>{throw Error('disabled')},runHelper:async()=>{observations++;return {}},diffSnapshots:()=>({})})
await verify({snapshot:{app:'Fixture'}})
assert.equal(observations,0,'disabling during an action must prevent a subsequent verification read')
console.log('PASS desktop verification: no new read after disabling')
