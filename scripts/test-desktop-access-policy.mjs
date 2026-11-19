import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assertDesktopUseEnabled, desktopToolBlockReason } from '../extensions/computer-use/src/desktop-access-policy.ts'

const dir = await mkdtemp(join(tmpdir(), 'pi-desktop-access-'))
const file = join(dir, 'settings.json')
try {
  assert.doesNotThrow(() => assertDesktopUseEnabled(undefined), 'standalone Pi keeps its own policy')
  assert.throws(() => assertDesktopUseEnabled(file), /disabled|settings/i, 'missing settings must fail closed')
  await writeFile(file, '{}')
  process.env.PI_DESKTOP_SETTINGS_FILE = file
  let onTool
  const guardSource = await readFile(new URL('../extensions/computer-use/src/desktop-access-extension.ts', import.meta.url), 'utf8')
  const guardCode = stripTypeScriptTypes(guardSource.replace(/^import .*$/gm, '').replace('export default function', 'function').replaceAll('import.meta.url', "'file:///tmp/desktop-access-extension.ts'"))
  const desktopAccessExtension = runInNewContext(`${guardCode}\ndesktopAccessExtension`, {desktopToolBlockReason,computerUse:()=>{}})
  desktopAccessExtension({registerCommand:()=>{},on:(name, handler) => { if (name === 'tool_call') onTool = handler }})
  assert.equal((await onTool({toolName:'computer_use_observe'})).block, true, 'old extensions are blocked by the desktop hook')
  assert.equal(await onTool({toolName:'computer_use_session_observe'}), undefined, 'browser tools are independent')
  assert.throws(() => assertDesktopUseEnabled(file), /disabled/i, 'default is off')
  for (const tool of ['computer_use_apps','computer_use_observe','computer_use_act','computer_use_batch','computer_use_desktop_reconcile']) assert.match(desktopToolBlockReason(tool,file), /disabled/i)
  for (const tool of ['computer_use_session_open','computer_use_session_act','computer_use_chrome_observe','computer_use_permissions']) assert.equal(desktopToolBlockReason(tool,file), undefined, 'web tools and permission checks stay available')
  await writeFile(file, '{"computerUseEnabled":true}')
  assert.doesNotThrow(() => assertDesktopUseEnabled(file))
  assert.equal(await onTool({toolName:'computer_use_observe'}), undefined, 'the same running hook observes newly enabled settings')
  await writeFile(file, '{"computerUseEnabled":false}')
  assert.throws(() => assertDesktopUseEnabled(file), /disabled/i, 'disabling is effective in the same session')
  await writeFile(file, '{')
  assert.throws(() => assertDesktopUseEnabled(file), /disabled|settings/i, 'invalid settings must fail closed')
  console.log('PASS desktop access policy: default off, live changes and fail closed')
} finally { delete process.env.PI_DESKTOP_SETTINGS_FILE; await rm(dir, {recursive:true,force:true}) }
