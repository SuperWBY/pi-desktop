import { copyFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { signMacApp } from './mac-signing.mjs'

const appArg = process.argv.find((arg) => arg.startsWith('--app='))
const appPath = appArg?.slice('--app='.length) || 'release/Pi Desktop-darwin-arm64/Pi Desktop.app'
const resources = join(appPath, 'Contents/Resources')
const plist = join(appPath, 'Contents/Info.plist')

if (!existsSync(appPath)) {
  console.error('App bundle not found; run npm run pack first.')
  process.exit(1)
}

copyFileSync('build/icon.icns', join(resources, 'icon.icns'))
copyFileSync('build/scroll-phase.node', join(resources, 'scroll-phase.node'))
copyFileSync('build/dictation.node', join(resources, 'dictation.node'))
const dictationPrivacy = {
  NSMicrophoneUsageDescription: 'Pi Desktop uses the microphone when you dictate a message.',
  NSSpeechRecognitionUsageDescription: 'Pi Desktop uses on-device speech recognition to turn dictation into text.'
}
for (const [key, description] of Object.entries(dictationPrivacy)) {
  execFileSync('plutil', ['-replace', key, '-string', description, plist])
}
execFileSync('plutil', ['-replace', 'CFBundleIconFile', '-string', 'icon.icns', plist])
signMacApp(appPath)
execFileSync('touch', [appPath])
console.log('Applied app icon to', appPath)
