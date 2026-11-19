import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export function chromePairingPath(): string {
  return process.env.PI_CHROME_BRIDGE_SECRET_FILE || join(homedir(), '.pi', 'computer-use', 'chrome-bridge-secret.json')
}

export function readChromePairing(path = chromePairingPath()): string {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const key = (value as { key?: unknown })?.key
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('invalid')
    return key
  } catch { throw new Error('Chrome bridge pairing is unavailable or invalid. Reopen Pi Desktop setup.') }
}

export function prepareChromePairing(path: string, extensionDir: string, port = Number(process.env.PI_CHROME_BRIDGE_PORT ?? '9317')): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Chrome bridge pairing port.')
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  try { writeFileSync(path, JSON.stringify({ key: randomBytes(32).toString('hex') }), { flag: 'wx', mode: 0o600 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  const key = readChromePairing(path)
  chmodSync(path, 0o600)
  const target = join(extensionDir, 'pairing.json')
  const tmp = join(extensionDir, `.pairing-${randomBytes(8).toString('hex')}.tmp`)
  try {
    writeFileSync(tmp, JSON.stringify({ key, port }), { flag: 'wx', mode: 0o600 })
    renameSync(tmp, target)
    chmodSync(target, 0o600)
  } finally { try { unlinkSync(tmp) } catch {} }
}
