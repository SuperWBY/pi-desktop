import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
if (process.platform === 'darwin') {
  const candidates = [resolve(dirname(process.execPath), '../include/node'), '/opt/homebrew/include/node', '/usr/local/include/node']
  const include = candidates.find(path => existsSync(join(path, 'node_api.h')))
  if (!include) throw new Error('Node headers are required to build the macOS trackpad phase monitor.')
  mkdirSync('build', { recursive: true })
  const flags = ['-bundle', '-fblocks', '-undefined', 'dynamic_lookup', '-I', include]
  execFileSync('/usr/bin/clang', [...flags, '-framework', 'Cocoa', '-o', 'build/scroll-phase.node', 'native/scroll-phase.m'], { stdio: 'inherit' })
  execFileSync('/usr/bin/clang', [
    ...flags, '-fobjc-arc', '-framework', 'Foundation', '-framework', 'AVFoundation', '-framework', 'Speech',
    '-o', 'build/dictation.node', 'native/dictation.m'
  ], { stdio: 'inherit' })
}
