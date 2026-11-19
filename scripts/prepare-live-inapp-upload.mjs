#!/usr/bin/env node
// Temporary local fixture for validating the installed Pi process with real UI confirmations.
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { startBackoffice } from './fixtures/business-backoffice/server.mjs'

if (process.platform !== 'darwin') throw new Error('This fixture expects the macOS application.')
const root=join(homedir(),'Library','Application Support','Pi Desktop','computer-use-runtimes')
const entries=await Promise.all((await readdir(root)).map(async name=>({name,mtime:(await stat(join(root,name))).mtimeMs})))
entries.sort((a,b)=>b.mtime-a.mtime)
if(!entries.length) throw new Error('No installed computer-use runtime was found.')
const modulePath=join(root,entries[0].name,'index.ts')
const workspace=await mkdtemp(join(tmpdir(),'pi-live-upload-'))
await mkdir(join(workspace,'.pi','extensions'),{recursive:true})
const file=join(workspace,'pi-live-upload.csv'), result=join(workspace,'result.json'), progress=join(workspace,'progress.json')
const payload='订单编号,结果\nORD-2026-002,已核对\n'
await writeFile(file,payload)
const fixture=await startBackoffice()
const expectedHash=createHash('sha256').update(payload).digest('hex')
const template=await readFile(new URL('./fixtures/business-backoffice/live-upload.template.txt',import.meta.url),'utf8')
const extension=template.replace('__COMPUTER_USE_MODULE__',JSON.stringify(modulePath)).replaceAll('__FIXTURE_URL__',JSON.stringify(fixture.url)).replaceAll('__EXPECTED_HASH__',JSON.stringify(expectedHash)).replaceAll('__PROGRESS_PATH__',JSON.stringify(progress)).replaceAll('__RESULT_PATH__',JSON.stringify(result))
await writeFile(join(workspace,'.pi','extensions','live-upload.ts'),extension)
console.log(JSON.stringify({workspace,file,result,progress,url:fixture.url,command:'/pi-live-upload-fixture'}))
process.on('SIGTERM',async()=>{await fixture.close();process.exit(0)})
