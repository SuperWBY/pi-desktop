import assert from 'node:assert/strict'
import { isTemporaryWorkspace } from '../src/shared/paths.ts'

const scratch = '/Users/me/Library/Application Support/Pi Desktop/scratch'
assert.equal(isTemporaryWorkspace(scratch, scratch), true)
assert.equal(isTemporaryWorkspace('/tmp/real-project', scratch), false)
assert.equal(isTemporaryWorkspace('/var/folders/xx/T/checkout', scratch), false)
assert.equal(isTemporaryWorkspace('/tmp/anything'), false)
assert.equal(isTemporaryWorkspace(null, scratch), false)

console.log('temp-workspace paths ok')
