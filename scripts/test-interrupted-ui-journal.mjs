import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InterruptedUiJournal } from '../src/main/interrupted-ui-journal.ts'

const dir=mkdtempSync(join(tmpdir(),'pi-ui-journal-test-')), file=join(dir,'journal.json')
try {
  let journal=new InterruptedUiJournal(file)
  journal.begin('pending-a',{cwd:'/test/project',sessionPath:null})
  journal.begin('finished-b',{cwd:'/test/project',sessionPath:'/test/session'})
  journal.finish('finished-b')
  journal=new InterruptedUiJournal(file)
  assert.deepEqual(journal.interrupted().map(item=>item.id),['pending-a'])
  assert.equal(journal.interrupted()[0].sessionPath,null)
  assert.ok(!readFileSync(file,'utf8').includes('password'))
  journal.acknowledge('pending-a')
  assert.equal(new InterruptedUiJournal(file).interrupted().length,0)
  journal.begin('dropped',{cwd:'/test/project',sessionPath:null})
  journal.interrupt('dropped')
  assert.equal(journal.interrupted()[0].id,'dropped')
  assert.throws(()=>journal.begin('dropped',{cwd:'/test/other',sessionPath:null}))
  const corrupt=join(dir,'corrupt.json'); writeFileSync(corrupt,'invalid')
  assert.throws(()=>new InterruptedUiJournal(corrupt))
  const blocked=join(dir,'not-a-directory'); writeFileSync(blocked,'x')
  assert.throws(()=>new InterruptedUiJournal(join(blocked,'journal.json')).begin('x',{cwd:'/test',sessionPath:null}))
  console.log('PASS interrupted UI journal: crash recovery, completed removal, process exit and acknowledgement')
} finally { rmSync(dir,{recursive:true,force:true}) }
