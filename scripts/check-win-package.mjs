import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const app = join(root, 'release', 'Pi Desktop-win32-x64')
const exe = join(app, 'Pi Desktop.exe')
const asar = join(app, 'resources', 'app.asar')
const helper = join(app, 'resources', 'pi-auth-helper.mjs')
const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

check('Windows app directory exists', existsSync(app))
check('Windows executable exists', existsSync(exe))
if (existsSync(exe)) {
  const header = readFileSync(exe).subarray(0, 2).toString('ascii')
  check('Windows executable has PE header', header === 'MZ', header)
  check('Windows executable is non-empty', statSync(exe).size > 1_000_000, `${statSync(exe).size} bytes`)
}
check('app.asar exists', existsSync(asar))
check('auth helper is packaged', existsSync(helper))
if (existsSync(asar)) {
  const list = execFileSync('npx', ['asar', 'list', asar], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  check('computer-use extension is packaged', list.includes('/extensions/computer-use/index.ts'))
  check('PowerShell helper is packaged', list.includes('computer-use-helper.ps1'))
  check('renderer is packaged', list.includes('/out/renderer/index.html'))
  check('macOS pi seed is not packaged', !list.includes('/pi-seed/'))
}
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}
console.log('\nWindows package static checks passed.')
