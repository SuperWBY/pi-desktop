#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = process.argv.find((value) => value.startsWith('--app='))
const app = arg ? arg.slice('--app='.length).replace(/^"|"$/g, '') : join(root, 'release', 'Pi Desktop-darwin-arm64', 'Pi Desktop.app')
const macResources = join(app, 'Contents', 'Resources')
const resources = existsSync(macResources) ? macResources : join(app, 'resources')
if (!existsSync(resources)) {
  console.error(`App bundle not found: ${app}`)
  process.exit(1)
}
mkdirSync(resources, { recursive: true })
copyFileSync(join(root, 'build', 'pi-auth-helper.mjs'), join(resources, 'pi-auth-helper.mjs'))
console.log(`Copied auth helper to ${join(resources, 'pi-auth-helper.mjs')}`)
