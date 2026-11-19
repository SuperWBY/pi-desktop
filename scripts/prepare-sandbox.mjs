#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = join(root, 'node_modules', '@anthropic-ai', 'sandbox-runtime', 'dist', 'cli.js')
const output = join(root, 'build', 'srt-cli.cjs')
if (!existsSync(source)) throw new Error('sandbox-runtime is not installed; run npm ci first.')
mkdirSync(join(root, 'build'), { recursive: true })
execFileSync(join(root, 'node_modules', '.bin', 'esbuild'), [
  source,
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--define:import.meta.url=__srt_import_meta_url',
  '--banner:js=const __srt_import_meta_url = require("node:url").pathToFileURL(__filename).href;',
  `--outfile=${output}`
], { stdio: 'inherit' })

const arg = process.argv.find((value) => value.startsWith('--embed='))
if (arg) {
  const app = arg.slice('--embed='.length).replace(/^"|"$/g, '')
  const mac = join(app, 'Contents', 'Resources')
  const resources = existsSync(mac) ? mac : join(app, 'resources')
  if (!existsSync(resources)) throw new Error(`App bundle not found: ${app}`)
  copyFileSync(output, join(resources, 'srt-cli.cjs'))
  console.log(`Embedded sandbox runtime into ${join(resources, 'srt-cli.cjs')}`)
} else {
  console.log(`Sandbox runtime bundle: ${output}`)
}
