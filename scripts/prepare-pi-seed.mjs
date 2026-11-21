#!/usr/bin/env node
/**
 * Prepare the offline Pi runtime seed that ships inside Pi Desktop.
 *
 * The app never imports Pi as a library: Pi stays an external process so
 * `pi update`, auth, models and extensions keep their normal semantics. This
 * script copies the installed managed release (not the user's config) and
 * writes a small launcher that runs Pi with Electron's embedded Node.
 *
 * Usage:
 *   node scripts/prepare-pi-seed.mjs
 *   node scripts/prepare-pi-seed.mjs --embed="release/.../Pi Desktop.app"
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const seedRoot = join(root, 'build', 'pi-seed')
const agentRoot = join(homedir(), '.pi', 'agent')
const installRoot = join(agentRoot, 'install')

function installedVersion() {
  if (process.env.PI_SEED_VERSION?.trim()) return process.env.PI_SEED_VERSION.trim()
  try {
    return readFileSync(join(installRoot, 'current-version'), 'utf8').trim()
  } catch {
    return ''
  }
}

function candidates(version) {
  return [
    process.env.PI_SEED_SOURCE?.trim(),
    join(installRoot, 'releases', version, 'node_modules', '@earendil-works', 'pi-coding-agent'),
    join(installRoot, 'releases', version, 'node_modules', '.bin', 'pi')
  ].filter(Boolean)
}

function findPackage(version) {
  for (const candidate of candidates(version)) {
    if (!existsSync(candidate)) continue
    if (statSync(candidate).isFile()) {
      // .bin/pi is a symlink to dist/bundle/cli.js; resolve its package dir.
      try {
        const target = readFileSync(candidate, 'utf8')
        if (target.includes('cli')) continue
      } catch { /* fall through */ }
      continue
    }
    if (existsSync(join(candidate, 'dist', 'bundle', 'cli.js'))) return candidate
  }
  return null
}

function writeLauncher(target, version) {
  const launcher = join(target, 'pi')
  writeFileSync(launcher, `#!/bin/sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -z "\${PI_DESKTOP_ELECTRON:-}" ]; then
  printf 'Pi runtime is managed by Pi Desktop; open Pi Desktop to use it.\\n' >&2
  exit 1
fi
exec env ELECTRON_RUN_AS_NODE=1 "$PI_DESKTOP_ELECTRON" "$DIR/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js" "$@"
`)
  chmodSync(launcher, 0o755)
  writeFileSync(join(target, 'seed.json'), JSON.stringify({
    version,
    source: 'Pi Desktop offline runtime',
    launcher: 'pi'
  }, null, 2) + '\n')
}

function prepare() {
  const version = installedVersion()
  if (!version) {
    console.error('Could not determine the installed Pi version. Set PI_SEED_VERSION.')
    process.exit(1)
  }
  const release = join(installRoot, 'releases', version)
  const pkg = findPackage(version)
  if (!pkg) {
    console.error(`No managed Pi release found for ${version} under ${release}.`)
    console.error('Install Pi first, or set PI_SEED_VERSION and PI_SEED_SOURCE.')
    process.exit(1)
  }

  const target = join(seedRoot, version)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  // Keep the full release dependency tree: Pi loads extensions through jiti
  // and uses a few runtime packages that are intentionally external to its
  // bundled CLI. Copying only dist/bundle is not sufficient.
  cpSync(join(release, 'node_modules'), join(target, 'node_modules'), {
    recursive: true,
    dereference: true,
    filter: (source) => !source.endsWith('/.cache')
  })
  cpSync(join(release, 'package.json'), join(target, 'package.json'))
  cpSync(join(release, 'package-lock.json'), join(target, 'package-lock.json'))
  writeLauncher(target, version)
  console.log(`Prepared Pi ${version} seed at ${target}`)
  return { version, target }
}

function resourcesDir(bundle) {
  const mac = join(bundle, 'Contents', 'Resources')
  if (existsSync(mac)) return mac
  const winOrLinux = join(bundle, 'resources')
  if (existsSync(winOrLinux)) return winOrLinux
  return ''
}

const embedArg = process.argv.find((arg) => arg.startsWith('--embed='))
const built = prepare()
if (embedArg) {
  const bundle = embedArg.slice('--embed='.length).replace(/^"|"$/g, '')
  const resources = resourcesDir(bundle)
  if (!resources) {
    console.error(`App resources not found for: ${bundle}`)
    process.exit(1)
  }
  const destination = join(resources, 'pi-seed')
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(join(destination, built.version), { recursive: true })
  // Embed only the version prepared above — never ship leftover e2e stubs.
  cpSync(built.target, join(destination, built.version), { recursive: true, dereference: true })
  console.log(`Embedded Pi seed into ${join(destination, built.version)}`)
  const authModule = join(destination, built.version, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js')
  if (!existsSync(authModule)) {
    console.error(`Packaged seed is missing auth module: ${authModule}`)
    process.exit(1)
  }
  console.log(`Verified auth module at ${authModule}`)
}
