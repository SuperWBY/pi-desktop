import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

if (!process.env.PI_TEST_PI) throw new Error('Set PI_TEST_PI to the real Pi executable.')
const root = resolve(import.meta.dirname, '..')
const dir = await mkdtemp(join(tmpdir(), 'pi-existing-computer-use-'))
const agent = join(dir, 'agent')
await mkdir(agent, { recursive: true })
const settings = JSON.stringify({ packages: [join(root, 'extensions', 'computer-use')] })
await writeFile(join(agent, 'settings.json'), settings)
let app
try {
  app = await electron.launch({ executablePath: join(root, 'release/Pi Desktop-darwin-arm64/Pi Desktop.app/Contents/MacOS/Pi Desktop'), args: [`--user-data-dir=${join(dir, 'data')}`], env: { ...process.env, HOME: dir, PI_DESKTOP_PI_PATH: process.env.PI_TEST_PI, PI_CODING_AGENT_DIR: agent, PI_CODING_AGENT_SESSION_DIR: join(dir, 'sessions'), PI_CHROME_BRIDGE_SECRET_FILE: join(dir, 'secret.json'), PI_OFFLINE: '1' } })
  const page = await app.firstWindow()
  await page.waitForSelector('.composer-input, .welcome', { timeout: 30000 })
  const session = await page.evaluate((cwd) => window.pi.openSession({ cwd, scratch: true }), dir)
  assert.equal(session.ok, true, JSON.stringify(session))
  const commands = await page.evaluate(() => window.pi.command({ type:'get_commands' }))
  const skill = commands.data?.commands?.find((item) => item.name === 'skill:computer-use')
  assert.ok(skill?.sourceInfo?.path?.startsWith(join(root, 'extensions', 'computer-use')), 'the existing package supplies the computer use skill')
  assert.ok(commands.data?.commands?.some((item) => item.name === 'skill:pi-desktop-access-guide'), 'desktop safety guidance remains available alongside existing packages')
  assert.equal(await readFile(join(agent, 'settings.json'), 'utf8'), settings, 'existing user settings remain unchanged')
  console.log('PASS packaged app: existing Computer Use package and user configuration preserved')
  const appBridgePath=await app.evaluate(()=>process.env.PI_DESKTOP_BROWSER_BRIDGE_FILE)
  assert.ok(appBridgePath,'packaged app must scope its browser bridge')
  const childBridge=await page.evaluate(()=>window.pi.command({type:'bash',command:'node -p "process.env.PI_DESKTOP_BROWSER_BRIDGE_FILE || \'\'"',excludeFromContext:true}))
  assert.equal(childBridge.success,true)
  assert.equal(childBridge.data.output.trim(),appBridgePath,'real Pi process receives its app instance bridge path')
  const bridge=JSON.parse(await readFile(appBridgePath,'utf8'))
  const bridgeStatus=await fetch(`http://127.0.0.1:${bridge.port}/state`,{headers:{authorization:`Bearer ${bridge.token}`}})
  assert.equal(bridgeStatus.status,200,'packaged app bridge is reachable')
  const helper = join(root, 'extensions', 'computer-use', 'bin', 'computer-use-helper')
  const quoted = `'${helper.replaceAll("'", "'\\''")}'`
  const permissionCheck = await page.evaluate((command) => window.pi.command({ type:'bash', command, excludeFromContext:true }), `${quoted} check`)
  assert.equal(permissionCheck.success, true, 'helper permission check should execute through Pi')
  const actual = JSON.parse(permissionCheck.data.output)
  const settingsStatus = await page.evaluate(() => window.pi.desktopPermissionCheck())
  assert.deepEqual(settingsStatus, {accessibility:actual.accessibility,screenRecording:actual.screenRecording,provisional:true}, 'settings check uses the active session helper and identifies a preliminary result')
  console.log('Desktop helper check through packaged Pi:', JSON.stringify(permissionCheck.data))
} finally { await app?.close(); await rm(dir, { recursive:true, force:true }) }
