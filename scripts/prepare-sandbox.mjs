#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const source = join(root, 'node_modules', '@anthropic-ai', 'sandbox-runtime', 'dist', 'cli.js')
const output = join(root, 'build', 'srt-cli.cjs')
if (!existsSync(source)) throw new Error('sandbox-runtime is not installed; run npm ci first.')
mkdirSync(join(root, 'build'), { recursive: true })
await build({
  entryPoints: [source], bundle: true, platform: 'node', format: 'cjs', outfile: output,
  define: { 'import.meta.url': '__srt_import_meta_url' },
  banner: { js: 'const __srt_import_meta_url = require("node:url").pathToFileURL(__filename).href;' },
  plugins: [{ name: 'pi-network-policy', setup(builder) {
    builder.onLoad({ filter: /cli\.js$/ }, (args) => {
      if (args.path !== source) return
      const original = readFileSync(source, 'utf8')
      const marker = 'await SandboxManager.initialize(runtimeConfig);'
      if (original.split(marker).length !== 2) throw new Error('Unsupported sandbox runtime initialization; review the network policy before packaging.')
      return { contents: original.replace(marker, "await SandboxManager.initialize(runtimeConfig, async () => process.env.PI_DESKTOP_ALLOW_NETWORK === '1');"), loader: 'js', resolveDir: dirname(source) }
    })
  } }]
})

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
