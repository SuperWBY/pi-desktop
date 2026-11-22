#!/usr/bin/env node
/**
 * Ensure node-pty's spawn-helper exists as a real executable file inside the
 * packaged app. electron-packager only unpacks *.node from asar; node-pty
 * needs its plain-file helper executable next to the native binary or
 * posix_spawnp fails with "Operation not permitted".
 *
 * Usage: node scripts/fix-node-pty.mjs --app="release/Pi Desktop-darwin-arm64/Pi Desktop.app"
 */
import { chmodSync, copyFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const arg = process.argv.find((value) => value.startsWith('--app='))
const app = arg
  ? arg.slice('--app='.length).replace(/^"|"$/g, '')
  : join(root, 'release', 'Pi Desktop-darwin-arm64', 'Pi Desktop.app')

if (!existsSync(app)) {
  console.error(`fix-node-pty: packaged app not found: ${app}`)
  process.exit(1)
}

const platformDir = `${process.platform}-${process.arch}`
const macResources = join(app, 'Contents', 'Resources')
const resources = existsSync(macResources) ? macResources : join(app, 'resources')
const unpacked = join(resources, 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds', platformDir)
const source = join(root, 'node_modules', 'node-pty', 'prebuilds', platformDir, 'spawn-helper')

if (!existsSync(unpacked)) {
  console.error(`fix-node-pty: unpacked node-pty directory missing: ${unpacked}`)
  process.exit(1)
}

if (process.platform === 'win32') {
  console.log('fix-node-pty: Windows uses ConPTY, no spawn-helper needed.')
  process.exit(0)
}

if (!existsSync(source)) {
  console.error(`fix-node-pty: spawn-helper missing in node_modules: ${source}`)
  process.exit(1)
}

const target = join(unpacked, 'spawn-helper')
copyFileSync(source, target)
chmodSync(target, 0o755)
console.log(`fix-node-pty: spawn-helper installed with executable bit: ${target}`)
