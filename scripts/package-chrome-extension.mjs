import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = join(root, 'extensions', 'chrome-bridge')
const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'))
if (manifest.manifest_version !== 3) throw new Error('Chrome bridge must use Manifest V3.')
if (typeof manifest.version !== 'string' || !/^\d+(\.\d+){0,3}$/.test(manifest.version)) throw new Error('Invalid extension version.')
if (!Array.isArray(manifest.permissions) || !manifest.permissions.includes('activeTab')) throw new Error('activeTab permission is required.')
if (!Array.isArray(manifest.host_permissions) || !manifest.host_permissions.includes('http://127.0.0.1/*')) throw new Error('Local bridge host permission is required.')
if (!manifest.icons?.['128']) throw new Error('A 128px extension icon is required for the Chrome Web Store.')

const staging = join(root, 'release', 'chrome-bridge')
const output = join(root, 'release', `pi-desktop-chrome-bridge-${manifest.version}.zip`)
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
cpSync(source, staging, {
  recursive: true,
  filter: (path) => {
    const name = path.split('/').pop()
    return name !== 'README.md' && name !== 'pairing.json' && name !== '.DS_Store'
  }
})
if (!existsSync(join(staging, 'manifest.json'))) throw new Error('Staged extension is missing manifest.json.')
rmSync(output, { force: true })
execFileSync('zip', ['-qr', output, '.'], { cwd: staging, stdio: 'inherit' })
console.log(`Chrome extension package: ${output}`)
