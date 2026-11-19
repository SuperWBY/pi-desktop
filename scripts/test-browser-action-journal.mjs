import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserActionJournal } from '../extensions/computer-use/src/browser-action-journal.ts'
import { DatabaseSync } from 'node:sqlite'

if (process.argv[2] === '--worker' || process.argv[2] === '--hold') {
  const journal = new BrowserActionJournal(process.argv[3])
  try { journal.claim('cdp'); process.stdout.write('claimed') }
  catch (error) { if (/pending/i.test(String(error))) process.stdout.write('blocked'); else throw error }
  if (process.argv[2] === '--hold') { setInterval(() => {}, 1000); await new Promise(() => {}) }
  else {
  journal.close()
  process.exit(0)
  }
} else if (process.argv[2] === '--uncommitted') {
  const db = new DatabaseSync(process.argv[3])
  db.exec("BEGIN IMMEDIATE; INSERT INTO pending_actions (backend,id,owner_pid,owner_id,created_at) VALUES ('cdp','uncommitted',1,'uncommitted',1)")
  process.stdout.write('ready')
  setInterval(() => {}, 1000)
  await new Promise(() => {})
}

const root = await mkdtemp(join(tmpdir(), 'pi-action-journal-'))
try {
  const file = join(root, 'state.sqlite')
  const journal = new BrowserActionJournal(file)
  const first = journal.claim('inapp')
  assert.throws(() => journal.claim('inapp'), /pending/i)
  assert.throws(() => journal.claim('extension'), /pending/i, 'a second backend cannot race with an unresolved action')
  assert.throws(() => journal.acknowledge('inapp', 'wrong-id'), /changed|not found/i)
  assert.equal(journal.pending('inapp').id, first.id)
  journal.acknowledge('inapp', first.id)
  const other = journal.claim('extension')
  assert.notEqual(first.id, other.id)
  journal.acknowledge('extension', other.id)
  assert.equal(journal.pending('extension'), null)
  const next = journal.claim('inapp')
  const reopened = new BrowserActionJournal(file)
  assert.equal(reopened.pending('inapp').id, next.id, 'pending action survives reopening')
  assert.throws(() => reopened.resolve('inapp', next.id, false), /confirm/i)
  assert.throws(() => reopened.resolve('inapp', next.id, true), /active|owner/i, 'another live owner cannot be overridden')
  journal.resolve('inapp', next.id, true)
  assert.equal(reopened.pending('inapp'), null)
  assert.equal((await stat(file)).mode & 0o077, 0, 'journal file must be private')
  reopened.close()
  journal.close()

  const runWorker = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', new URL(import.meta.url).pathname, '--worker', file], {stdio:['ignore','pipe','pipe']})
    let out='', err=''
    child.stdout.on('data', x => { out += x })
    child.stderr.on('data', x => { err += x })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve(out) : reject(new Error(err)))
  })
  const results = await Promise.all(Array.from({length:8},runWorker))
  assert.equal(results.filter(x => x === 'claimed').length, 1, 'one process claims the browser')
  assert.equal(results.filter(x => x === 'blocked').length, 7)
  const recovered = new BrowserActionJournal(file)
  const pending = recovered.pending('cdp')
  assert.ok(pending, 'abrupt process exit leaves a pending record')
  recovered.resolve('cdp', pending.id, true)
  assert.equal(recovered.pending('cdp'), null)
  recovered.close()
  const startHeld = async mode => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', new URL(import.meta.url).pathname, mode, file], {stdio:['ignore','pipe','pipe']})
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', code => reject(new Error(`worker exited early: ${code}`))) })
    return child
  }
  const live = await startHeld('--hold')
  const observer = new BrowserActionJournal(file)
  const active = observer.pending('cdp')
  assert.throws(() => observer.resolve('cdp', active.id, true), /active/i, 'a live process must not be overridden')
  live.kill('SIGKILL')
  await new Promise(resolve => live.once('exit', resolve))
  observer.resolve('cdp', active.id, true)
  assert.equal(observer.pending('cdp'), null)
  observer.close()
  const uncommitted = await startHeld('--uncommitted')
  uncommitted.kill('SIGKILL')
  await new Promise(resolve => uncommitted.once('exit', resolve))
  const rolledBack = new BrowserActionJournal(file)
  assert.equal(rolledBack.pending('cdp'), null, 'a killed uncommitted transaction must roll back')
  rolledBack.close()
  assert.ok(!(await readFile(file)).includes(Buffer.from('https://')), 'journal does not store page URLs')

  const corrupt = join(root, 'corrupt.sqlite')
  await writeFile(corrupt, 'invalid database')
  assert.throws(() => new BrowserActionJournal(corrupt), /database|file/i, 'corrupt storage must fail closed')
  assert.equal(spawnSync(process.execPath, ['--version']).status, 0)
  console.log('PASS action journal: durable records, conditional recovery, concurrent processes and corrupted storage')
} finally { await rm(root, {recursive:true,force:true}) }
