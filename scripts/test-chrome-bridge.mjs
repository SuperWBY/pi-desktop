import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

class Element {
  constructor(type, value, autocomplete = '') { this.type = type; this.value = value; this.autocomplete = autocomplete; this.tagName = 'INPUT'; this.innerText = ''; this.isConnected = true }
  getAttribute(name) { return ({ type: this.type, autocomplete: this.autocomplete })[name] ?? null }
  getBoundingClientRect() { return { x: 0, y: 0, width: 100, height: 20 } }
  setAttribute() {}
  matches() { return false }
}
const nodes = [new Element('password', 'secret-password'), new Element('text', 'secret-autocomplete', 'current-password'), new Element('text', 'secret-new', 'new-password')]
const source = readFileSync(new URL('../extensions/chrome-bridge/background.js', import.meta.url), 'utf8')
const context = { HTMLElement: Element, HTMLInputElement: Element, location: { href: 'https://example.test/' }, document: { documentElement: { setAttribute() {}, getAttribute: () => 'snapshot' }, querySelectorAll: (selector) => selector.startsWith('iframe') ? [] : nodes, querySelector: () => nodes[1] }, getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }), fetch: async () => { throw new Error('offline') }, setTimeout() {} }
const candidates = runInNewContext(`${source}\ncollectCandidates('snapshot').candidates`, context)
for (const [index, candidate] of candidates.entries()) {
  assert.equal(candidate.secure, true)
  assert.equal(candidate.value, '')
  assert.ok(!JSON.stringify(candidate).includes(nodes[index].value), 'secure value must never appear in candidate metadata')
}
assert.equal(runInNewContext("performAction('h2', 'type', 'replacement', 'Enter', 'snapshot', 'https://example.test/')", context).error, 'secure field', 'do not type into a password autocomplete field')
assert.equal(runInNewContext("performAction('h2', 'click', '', 'Enter', 'snapshot', 'https://example.test/previous')", context).__piGuardRejected, 'page_changed', 'do not act after the page address changes')
assert.equal(runInNewContext("performAction('h2', 'click', '', 'Enter', 'old-snapshot', 'https://example.test/')", context).__piGuardRejected, 'page_changed', 'do not act on an obsolete snapshot')
console.log('PASS Chrome bridge secure field redaction')

let activeTabId = 1
const calls = []
const browserContext = {
  crypto: { randomUUID: () => 'snapshot-1' },
  chrome: {
    tabs: { query: async () => [{ id: activeTabId, url: 'https://example.test/' }], get: async (id) => ({ id }) },
    scripting: { executeScript: async (options) => { calls.push(options); return [{ documentId: 'doc-1', result: options.func.name === 'collectCandidates' ? [{ id: 'h1' }] : { ok: true } }] } }
  },
  fetch: async () => { throw new Error('offline') },
  setTimeout() {}
}
const observe = runInNewContext(`${source}\nexecuteTask({type:'observe'})`, browserContext)
const observed = await observe
assert.equal(observed.tabId, 1, 'observe identifies the tab')
assert.equal(observed.documentId, 'doc-1', 'observe identifies the document')
activeTabId = 2
await assert.rejects(runInNewContext("executeTask({type:'act', tabId:1, documentId:'doc-1', snapshotId:'snapshot-1', url:'https://example.test/', action:{candidateId:'h1',type:'click'}})", browserContext), /changed/i, 'old clients must receive an error after switching tabs')
assert.equal((await runInNewContext("executeTask({type:'act', guardProtocol:1, tabId:1, documentId:'doc-1', snapshotId:'snapshot-1', url:'https://example.test/', action:{candidateId:'h1',type:'click'}})", browserContext)).__piGuardRejected, 'page_changed', 'new clients receive a structured guard rejection')
assert.equal(calls.length, 1, 'switched tab must not execute an action')
activeTabId = 1
await runInNewContext("executeTask({type:'act', tabId:1, documentId:'doc-1', snapshotId:'snapshot-1', url:'https://example.test/', action:{candidateId:'h1',type:'click'}})", browserContext)
assert.deepEqual(JSON.parse(JSON.stringify(calls[1].target)), { tabId: 1, documentIds: ['doc-1'] }, 'action targets observed document')
console.log('PASS Chrome bridge tab and document binding')

console.log('Authenticated transport and replay protection are covered by test-chrome-auth.mjs')
