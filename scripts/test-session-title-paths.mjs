import assert from 'node:assert/strict'
import { isTemporaryWorkspace } from '../src/shared/paths.ts'

const scratch = '/Users/me/Library/Application Support/Pi Desktop/scratch'
assert.equal(isTemporaryWorkspace(scratch, scratch), true)
const temporary = `${scratch}/conversations/8c7cdb65-9867-4a92-9caf-455e17f6bed4`
assert.equal(isTemporaryWorkspace(temporary, scratch), true)
assert.equal(isTemporaryWorkspace(`${temporary}/nested-project`, scratch), false)
assert.equal(isTemporaryWorkspace(`${scratch}/conversations/unrelated-project`, scratch), false)
assert.equal(isTemporaryWorkspace('/tmp/real-project', scratch), false)
assert.equal(isTemporaryWorkspace('/var/folders/xx/T/checkout', scratch), false)
assert.equal(isTemporaryWorkspace('/tmp/anything'), false)
assert.equal(isTemporaryWorkspace(null, scratch), false)

console.log('temp-workspace paths ok')
