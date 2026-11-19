import assert from 'node:assert/strict'
import { quoteWindowsPiPaths } from '../src/main/pi-launch.ts'
const path = 'C:\\Users\\Jane Doe\\Pi Desktop\\desktop-access-extension.ts'
assert.deepEqual(quoteWindowsPiPaths(['--extension',path,'--mode','rpc']), ['--extension',`"${path}"`,'--mode','rpc'])
assert.deepEqual(quoteWindowsPiPaths(['--skill','C:\\Pi\\skills']), ['--skill','"C:\\Pi\\skills"'])
console.log('PASS Windows Pi launch: extension and skill paths are quoted')
