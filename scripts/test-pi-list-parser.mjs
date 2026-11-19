import assert from 'node:assert/strict'
import { parsePiListPaths } from '../src/main/pi-list-parser.ts'
const paths = parsePiListPaths('User packages:\n  /Users/test/My Project/computer-use\n    /Users/test/My Project/computer-use\n  npm:some-tool\n    /Users/test/.pi/agent/npm/node_modules/some-tool\n')
assert.equal(paths.get('/Users/test/My Project/computer-use'), '/Users/test/My Project/computer-use')
assert.equal(paths.get('npm:some-tool'), '/Users/test/.pi/agent/npm/node_modules/some-tool')
console.log('PASS Pi package parser: sources and paths containing spaces')
