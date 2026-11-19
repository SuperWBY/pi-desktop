import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

export function macSigningIdentity() {
  const configPath = join(homedir(), 'Library', 'Application Support', 'Pi Desktop', 'local-signing-identity.json')
  const configured = process.env.PI_MAC_SIGNING_IDENTITY ?? (existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')).identity : '-')
  if (typeof configured !== 'string' || !configured.trim()) throw new Error('Invalid macOS signing identity configuration')
  return configured.trim()
}

export function signMacApp(appPath) {
  const identity = macSigningIdentity()
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', identity, appPath], { stdio: 'inherit' })
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
  console.log(identity === '-' ? 'Signed with ad-hoc identity; privacy permissions may not survive updates.' : 'Signed with configured macOS identity.')
}
