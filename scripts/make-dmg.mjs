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

// Ad-hoc signing keeps the arm64 binary runnable on other machines.
// A Developer ID + notarization is still required to skip the Gatekeeper warning.
try {
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  console.log('Ad-hoc signed', appPath)
} catch (error) {
  console.warn('codesign failed (continuing):', error instanceof Error ? error.message : error)
}

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
