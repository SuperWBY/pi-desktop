import { copyFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const appPath = 'release/Pi Desktop-darwin-arm64/Pi Desktop.app'
const resources = join(appPath, 'Contents/Resources')
const plist = join(appPath, 'Contents/Info.plist')

if (!existsSync(appPath)) {
  console.error('App bundle not found; run npm run pack first.')
  process.exit(1)
}

copyFileSync('build/icon.icns', join(resources, 'icon.icns'))
execFileSync('plutil', ['-replace', 'CFBundleIconFile', '-string', 'icon.icns', plist])
execFileSync('touch', [appPath])
console.log('Applied app icon to', appPath)
