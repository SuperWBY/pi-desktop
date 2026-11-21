import assert from 'node:assert/strict'
import { searchPackageCatalog } from '../src/main/package-catalog.ts'
const originalFetch = globalThis.fetch
try {
 globalThis.fetch = async () => new Response(JSON.stringify({ objects: [
  { package: { name: 'pi-web-access', version: '1.0.0', description: 'Web search tools', keywords: ['pi-package'], publisher: {username:'author'} } },
  { package: { name: 'pi-mcp-extension', version: '2.0.0', description: 'MCP service', keywords: ['pi-package'], publisher: {username:'another'} } }
 ] }), { status:200 })
 assert.deepEqual((await searchPackageCatalog('pi-mcp-extension')).entries.map((item) => item.name), ['pi-mcp-extension'])
 assert.equal((await searchPackageCatalog('author web')).entries.length, 1)
 assert.equal((await searchPackageCatalog('missing')).entries.length, 0)
 assert.equal((await searchPackageCatalog('')).entries.length, 2)
 const waiting = []
 let requests = 0
 globalThis.fetch = () => { requests++; return new Promise((resolve) => waiting.push(resolve)) }
 const first = searchPackageCatalog('parallel-test')
 const second = searchPackageCatalog('parallel-test')
 await new Promise((resolve) => setTimeout(resolve, 0))
 assert.equal(requests, 3, 'all three searches start together and duplicate callers share work')
 waiting.forEach((resolve) => resolve(new Response(JSON.stringify({ objects: [{ package: { name: 'parallel-test', version: '1.0.0', description: 'parallel-test' } }] }))))
 assert.equal((await first).entries.length, 1)
 assert.equal((await second).entries.length, 1)
 await searchPackageCatalog('parallel-test')
 assert.equal(requests, 3, 'subsequent catalog reads use cached results')
 console.log('✓ Catalog removes npm fuzzy mismatches, searches metadata, deduplicates and preserves discovery')
} finally { globalThis.fetch = originalFetch }
