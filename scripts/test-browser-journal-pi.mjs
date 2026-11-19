import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

if (!process.env.PI_TEST_PI) throw new Error('Set PI_TEST_PI to the Pi executable.')
const root = await mkdtemp(join(tmpdir(), 'pi-journal-runtime-'))
const agent = join(root, 'agent'), extension = join(root, 'probe.mjs'), result = join(root, 'result.json'), db = join(root, 'journal.sqlite')
await mkdir(agent, {recursive:true})
const moduleUrl = pathToFileURL(resolve('extensions/computer-use/src/browser-action-journal.ts')).href
await writeFile(extension, `import { writeFileSync } from 'node:fs'; import { BrowserActionJournal } from ${JSON.stringify(moduleUrl)}; export default pi => { pi.on('session_start', () => { const journal = new BrowserActionJournal(process.env.TEST_JOURNAL_DB); const action = journal.claim('cdp'); writeFileSync(process.env.TEST_JOURNAL_RESULT, JSON.stringify({node:process.version,id:action.id,pending:journal.pending('cdp')?.id})); journal.close(); }); };`)
const child = spawn(process.env.PI_TEST_PI, ['--mode','rpc','--no-session','--no-extensions','--no-skills','--no-mcp','--extension',extension], {cwd:root,env:{...process.env,HOME:root,PI_CODING_AGENT_DIR:agent,TEST_JOURNAL_DB:db,TEST_JOURNAL_RESULT:result},stdio:['pipe','pipe','pipe']})
let stderr=''
child.stderr.on('data',chunk => { stderr += chunk })
try {
  child.stdin.write('{"type":"get_state"}\n')
  let value
  for (let i=0;i<100;i++) {
    try { value=JSON.parse(await readFile(result,'utf8')); break } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (child.exitCode !== null) throw new Error(`Pi exited before loading the journal: ${stderr}`)
    await new Promise(resolve => setTimeout(resolve,100))
  }
  assert.ok(value, `Pi did not load the journal in time: ${stderr}`)
  assert.equal(value.id,value.pending)
  console.log(`PASS real Pi extension runtime loads and writes the isolated journal (${value.node})`)
} finally {
  if (child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise(resolve => child.once('exit',resolve)) }
  await rm(root,{recursive:true,force:true})
}
