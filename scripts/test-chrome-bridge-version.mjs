import assert from 'node:assert/strict'
import * as bridge from '../src/main/chrome-bridge-check.ts'
assert.equal(typeof bridge.classifyBridgeVersion,'function','connection check must classify bridge versions')
assert.equal(bridge.classifyBridgeVersion('0.1.13','0.1.13'),'current')
assert.equal(bridge.classifyBridgeVersion('0.1.12','0.1.13'),'outdated')
assert.equal(bridge.classifyBridgeVersion('0.1.14','0.1.13'),'current')
assert.equal(bridge.classifyBridgeVersion(undefined,'0.1.13'),'unknown')
assert.equal(bridge.classifyBridgeVersion('not-a-version','0.1.13'),'unknown')
assert.equal(bridge.classifyBridgeVersion('0.1.13',undefined),'unknown')
console.log('PASS Chrome bridge version classification')
