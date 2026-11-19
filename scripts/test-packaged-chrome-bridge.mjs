import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdtemp, readFile, readdir, rm, access, writeFile, mkdir, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
const root=resolve(import.meta.dirname,'..')
const dir=await mkdtemp(join(tmpdir(),'pi-packaged-bridge-'))
let app
try {
 if (process.env.PI_TEST_DIRECT_EXTENSION) {
  await mkdir(join(dir,'agent'), {recursive:true})
  await writeFile(join(dir,'agent','settings.json'), JSON.stringify({extensions:[join(root,'extensions','computer-use')]}))
 }
 app=await electron.launch({ executablePath:join(root,'release/Pi Desktop-darwin-arm64/Pi Desktop.app/Contents/MacOS/Pi Desktop'), args:[`--user-data-dir=${join(dir,'data')}`], env:{...process.env,HOME:dir,PI_CHROME_BRIDGE_SECRET_FILE:join(dir,'secret.json'),PI_DESKTOP_PI_PATH:join(root,'scripts/mock-pi.mjs'),PI_CODING_AGENT_DIR:join(dir,'agent'),PI_CODING_AGENT_SESSION_DIR:join(dir,'sessions'),MOCK_RPC_ARGS_FILE:join(dir,'rpc-args.json'),MOCK_RPC_ENV_FILE:join(dir,'rpc-env.json')} })
 const page=await app.firstWindow()
 await page.waitForSelector('.composer-input, .welcome',{timeout:30000})
 const extension=join(dir,'data','chrome-bridge')
 const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'))
 const pairing=JSON.parse(await readFile(join(extension,'pairing.json'),'utf8'))
 const secret=JSON.parse(await readFile(join(dir,'secret.json'),'utf8'))
 const sourceManifest=JSON.parse(await readFile(join(root,'extensions/chrome-bridge/manifest.json'),'utf8'))
 assert.equal(manifest.version,sourceManifest.version)
 assert.equal(pairing.key,secret.key)
 assert.equal(pairing.port,9317)
 const session = await page.evaluate((cwd) => window.pi.openSession({ cwd, scratch:true }), dir)
 assert.equal(session.ok, true, JSON.stringify(session))
 const runtimes = await readdir(join(dir,'data','computer-use-runtimes'))
 assert.equal(runtimes.length, 1, 'a fresh packaged app prepares its own computer use runtime')
 const runtime = join(dir,'data','computer-use-runtimes',runtimes[0])
 await Promise.all(['index.ts','src/browser-router.ts','src/browser-target.ts','src/desktop-permissions.ts','src/desktop-access-extension.ts','skills/computer-use/SKILL.md','bin/computer-use-helper'].map((file) => access(join(runtime,file))))
 const rpcArgs = JSON.parse(await readFile(join(dir,'rpc-args.json'),'utf8'))
 const rpcEnv = JSON.parse(await readFile(join(dir,'rpc-env.json'),'utf8'))
 assert.ok(rpcArgs.includes(await realpath(join(runtime,'src','desktop-access-extension.ts'))), 'desktop policy hook is loaded in packaged sessions')
 assert.ok(!rpcArgs.includes(await realpath(join(runtime,'index.ts'))), 'bundled tools are selected after existing extensions load')
 assert.ok(rpcArgs.includes(await realpath(join(runtime,'desktop-guidance'))), 'desktop safety guidance loads alongside unrelated extensions')
 assert.equal(rpcEnv.desktopSettingsFile, join(await realpath(join(dir,'data')),'settings.json'), 'Pi reads the live desktop setting')
 if (process.platform !== 'win32') await access(join(runtime,'bin','computer-use-helper'), constants.X_OK)
 if (process.env.PI_TEST_PI) {
  await mkdir(join(dir,'probe-agent'), { recursive:true })
  await writeFile(join(dir,'probe-agent','settings.json'), JSON.stringify({defaultTools:['read','bash','edit','write','grep','find','ls']}))
  const rpc = execFileSync(process.env.PI_TEST_PI, ['--mode','rpc','--no-session','--no-extensions','--no-mcp','--no-skills','--extension',join(runtime,'src','desktop-access-extension.ts'),'--skill',join(runtime,'desktop-guidance')], { cwd:dir, input:'{"id":"1","type":"get_commands"}\n', env:{...process.env,HOME:dir,PI_CODING_AGENT_DIR:join(dir,'probe-agent'),PI_OFFLINE:'1'}, timeout:30000, encoding:'utf8', stdio:['pipe','pipe','pipe'] })
  const response = rpc.split('\n').filter(Boolean).map(line=>JSON.parse(line)).find(item=>item.id==='1')
  assert.ok(response?.data?.commands?.some(item=>item.name==='skill:pi-desktop-access-guide'), 'bundled guidance is available')
  execFileSync(process.execPath, [join(root,'scripts','test-desktop-guard-rpc.mjs')], { cwd:root, env:{...process.env,PI_TEST_PI:process.env.PI_TEST_PI,PI_TEST_GUARD:join(runtime,'src','desktop-access-extension.ts')}, timeout:30000, stdio:['ignore','pipe','pipe'] })
  console.log('PASS packaged runtime: real Pi executed guarded browser and desktop tools without developer checkout')
 }
 console.log('PASS packaged app: prepared authenticated extension and private pairing in isolated user data')
 console.log('PASS packaged app: fresh session prepared the bundled computer use runtime')
} finally { await app?.close(); await rm(dir,{recursive:true,force:true}) }
