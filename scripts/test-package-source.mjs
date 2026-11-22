import assert from 'node:assert/strict'
import { packageSource } from '../src/renderer/src/lib/package-source.ts'
for (const value of ['pi-demo', 'npm:pi-demo', 'https://www.npmjs.com/package/pi-demo', 'https://pi.dev/packages/pi-demo']) assert.equal(packageSource(value).source, 'npm:pi-demo')
assert.equal(packageSource('https://www.npmjs.com/package/@scope/demo/v/1.2.3').source, 'npm:@scope/demo@1.2.3')
assert.equal(packageSource('https://github.com/example/demo').source, 'https://github.com/example/demo')
for (const value of ['pi install npm:demo', '--help', 'javascript:alert(1)', 'https://attacker.test/package/demo', 'https://github.com/owner/repo/issues', 'https://user:pass@github.com/owner/repo', 'npm:../demo', 'demo@^1.0']) assert.equal(packageSource(value), null, value)
console.log('✓ Install links resolve npm names/versions and GitHub repositories, reject commands and unsafe URLs')
