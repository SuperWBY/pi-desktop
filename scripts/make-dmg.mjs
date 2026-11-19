import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Builds a distributable DMG from the packaged app:
 *   release/Pi Desktop-darwin-arm64/Pi Desktop.app
 * The DMG contains the app plus an /Applications shortcut so the usual
 * drag-to-install gesture works.
 */

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const arch = process.env.DMG_ARCH ?? process.arch
const appDir = resolve(`release/Pi Desktop-darwin-${arch}`)
const appPath = join(appDir, 'Pi Desktop.app')

if (!existsSync(appPath)) {
  console.error(`App bundle not found at ${appPath}; run \`npm run pack\` first.`)
  process.exit(1)
}

// Keep the signature produced by pack; re-signing here changes the app identity.
execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })

const staging = resolve(`release/dmg-${arch}`)
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })

execFileSync('cp', ['-R', appPath, staging])
symlinkSync('/Applications', join(staging, 'Applications'))

const dmgName = `Pi-Desktop-${pkg.version}-${arch}.dmg`
const dmgPath = resolve(`release/${dmgName}`)
rmSync(dmgPath, { force: true })

execFileSync(
  'hdiutil',
  [
    'create',
    '-volname',
    'Pi Desktop',
    '-srcfolder',
    staging,
    '-ov',
    '-format',
    'UDZO',
    '-fs',
    'HFS+',
    dmgPath
  ],
  { stdio: 'inherit' }
)

rmSync(staging, { recursive: true, force: true })
console.log(`\nDMG ready: release/${dmgName}`)
