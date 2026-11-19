#!/usr/bin/env node
/**
 * Verify a packaged Pi Desktop build includes the OAuth auth helper and
 * pi-coding-agent module outside app.asar (required for ELECTRON_RUN_AS_NODE).
 *
 * Usage:
 *   node scripts/check-pack-auth.mjs
 *   node scripts/check-pack-auth.mjs --app="release/Pi Desktop-darwin-arm64/Pi Desktop.app"
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const arg = process.argv.find((value) => value.startsWith('--app='))
const defaults = [
  join(root, 'release', 'Pi Desktop-darwin-arm64', 'Pi Desktop.app'),
  join(root, 'release', 'Pi Desktop-darwin-x64', 'Pi Desktop.app'),
  join(root, 'release', 'Pi Desktop-linux-x64'),
  join(root, 'release', 'Pi Desktop-win32-x64')
]
const app = arg
  ? arg.slice('--app='.length).replace(/^"|"$/g, '')
  : defaults.find((candidate) => existsSync(candidate))

const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

if (!app || !existsSync(app)) {
  console.error('Packaged app not found. Pass --app=… after npm run pack.')
  process.exit(1)
}

const macResources = join(app, 'Contents', 'Resources')
const resources = existsSync(macResources) ? macResources : join(app, 'resources')
const helper = join(resources, 'pi-auth-helper.mjs')
const seed = join(resources, 'pi-seed')

check('resources directory exists', existsSync(resources), resources)
check('pi-auth-helper.mjs is packaged', existsSync(helper), helper)
check('pi-seed is packaged outside asar', existsSync(seed), seed)

let authModule = ''
if (existsSync(seed)) {
  const versions = readdirSync(seed).filter((name) => /^\d+\.\d+\.\d+/.test(name))
  for (const version of versions) {
    const file = join(seed, version, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js')
    if (existsSync(file) && statSync(file).isFile()) {
      authModule = file
      break
    }
  }
}
check('pi-coding-agent auth module is packaged', Boolean(authModule), authModule || 'missing dist/index.js')

if (failures.length) {
  console.error(`\n${failures.length} pack auth check(s) failed.`)
  process.exit(1)
}
console.log('\nPack auth checks passed.')
