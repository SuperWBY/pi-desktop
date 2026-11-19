import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, statSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepareChromePairing } from '../extensions/computer-use/src/chrome-bridge-pairing.ts'
const dir = mkdtempSync(join(tmpdir(), 'pi-pair-'))
try {
 const secret = join(dir, 'private', 'secret.json'), extension = join(dir, 'extension')
 mkdirSync(extension)
 prepareChromePairing(secret, extension, 19317)
 const saved = JSON.parse(readFileSync(secret, 'utf8')), copy = JSON.parse(readFileSync(join(extension,'pairing.json'), 'utf8'))
 assert.match(saved.key,/^[a-f0-9]{64}$/)
 assert.equal(copy.key,saved.key)
 assert.equal(copy.port,19317,'worker receives the configured bridge port')
 assert.equal(statSync(secret).mode & 0o777,0o600)
 assert.equal(statSync(join(extension,'pairing.json')).mode & 0o777,0o600)
 prepareChromePairing(secret, extension)
 assert.equal(JSON.parse(readFileSync(secret,'utf8')).key,saved.key, 'upgrades preserve pairing key')
 writeFileSync(secret, '{invalid')
 assert.throws(() => prepareChromePairing(secret, extension), /pairing/i, 'corrupt key must not silently rotate')
 console.log('PASS pairing generation: private permissions, stable key, corruption fail-closed')
} finally { rmSync(dir,{recursive:true,force:true}) }
