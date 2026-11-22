import assert from 'node:assert/strict'
import { normalizeBrowserUrl, isPrivateHost, normalizeIpLiteral } from '../src/shared/url-guard.ts'

// Private addresses hidden behind encodings the URL parser does not
// canonicalize must be blocked — each of these previously bypassed the
// prefix-regex check. (Decimal/hex/octal IPv4 forms are canonicalized by the
// WHATWG URL parser to dotted form before we see them; loopback stays an
// allowed dev-server target by design.)
const blocked = [
  'http://[::1]/',                       // bracketed IPv6 loopback
  'http://[::ffff:10.0.0.1]/',           // IPv4-mapped IPv6 private
  'http://[fe80::1]/',                   // link-local
  'http://[fc00::1]/',                   // unique local
  'http://0.0.0.0/',
  'http://100.64.1.1/',                  // CGNAT range
  'http://10.0.0.1/',
  'http://192.168.1.1/',
  'http://172.16.0.1/',
  'http://169.254.169.254/',             // cloud metadata
  'http://198.18.0.1/'                   // benchmark range
]
for (const url of blocked) {
  assert.equal(normalizeBrowserUrl(url), null, `must block ${url}`)
}

// Public URLs and local dev servers keep working.
const allowed = [
  'https://example.com/',
  'http://example.com/path',
  'http://127.0.0.1:8080/',              // local dev servers stay reachable
  'http://localhost:3000/'
]
for (const url of allowed) {
  assert.notEqual(normalizeBrowserUrl(url), null, `must allow ${url}`)
}

// Non-http schemes and embedded credentials stay blocked.
assert.equal(normalizeBrowserUrl('javascript:alert(1)'), null)
assert.equal(normalizeBrowserUrl('file:///etc/passwd'), null)
assert.equal(normalizeBrowserUrl('http://user:pass@example.com/'), null)
assert.equal(normalizeBrowserUrl(''), null)

// Canonicalization details.
assert.equal(normalizeIpLiteral('2130706433'), '127.0.0.1')
assert.equal(normalizeIpLiteral('0x7f000001'), '127.0.0.1')
assert.equal(normalizeIpLiteral('127.1'), '127.0.0.1')
assert.equal(normalizeIpLiteral('[::1]'), '::1')
assert.equal(normalizeIpLiteral('::ffff:10.0.0.1'), '10.0.0.1')
assert.equal(normalizeIpLiteral('fe80::'), 'fe80:0:0:0:0:0:0:0')
assert.equal(normalizeIpLiteral('example.com'), null)
assert.equal(normalizeIpLiteral('300.1.1.1'), null)

assert.equal(isPrivateHost('localhost'), true)
assert.equal(isPrivateHost('example.com'), false)
assert.equal(isPrivateHost('172.32.0.1'), false)  // outside 172.16/12

// A very large decimal literal that is still a public IP must stay reachable.
assert.notEqual(normalizeBrowserUrl('http://134744072/'), null) // 8.8.8.8

console.log(`browser-url-guard: ${blocked.length} blocked cases + ${allowed.length} allowed cases OK`)
