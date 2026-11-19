import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
const source = await readFile(new URL('../extensions/computer-use/index.ts', import.meta.url), 'utf8')
const actionStart = source.indexOf('async function browserAction(')
const actionEnd = source.indexOf('\nasync function ', actionStart + 1)
const journalStart = source.indexOf('  const runLegacyJournaled =')
const journalEnd = source.indexOf('\n\n  pi.registerTool(', journalStart)
assert.ok(actionStart >= 0 && actionEnd > actionStart && journalStart >= 0 && journalEnd > journalStart)
let pending = null, failedAck = false, bridge = null, sendCalls = 0
const journal = {
  claim() { pending = { id: 'action-1' }; return pending },
  acknowledge(_backend, id) { assert.equal(id, pending.id); if (failedAck) throw Error('disk unavailable'); pending = null }
}
const errorClass = source.match(/class BrowserBridgeUnavailableBeforeDispatch extends Error \{\}/)?.[0]
assert.ok(errorClass, 'production pre-dispatch error class must exist')
const legacyErrorClass = source.match(/class LegacyBrowserActionBeforeDispatch extends Error \{\}/)?.[0]
assert.ok(legacyErrorClass)
const chromeErrorClass = source.match(/class LegacyChromeGuardBeforeDispatch extends Error \{\}/)?.[0]
assert.ok(chromeErrorClass)
const snippets = `${errorClass}\n${legacyErrorClass}\n${chromeErrorClass}\n${source.slice(actionStart, actionEnd)}\n${source.slice(journalStart, journalEnd)}\n({browserAction,runLegacyJournaled})`
const tools = runInNewContext(stripTypeScriptTypes(snippets), {
  process: {env:{PI_DESKTOP_BROWSER_BRIDGE_FILE:'/missing'}},
  readBrowserBridge: async () => bridge,
  bridgeRequest: async () => { sendCalls++; throw Error('connection lost') },
  chromeJS: async () => { throw Error('unexpected Chrome fallback') },
  actionJournal: journal, router: {hasAnyPendingAction: () => !!pending}
})
const action = () => tools.browserAction({candidateId:'b1',type:'click'})
await assert.rejects(tools.runLegacyJournaled('extension',action), /bridge.*not available/i)
assert.equal(pending,null,'missing bridge before dispatch must release the record')
assert.equal(sendCalls,0)
failedAck = true
await assert.rejects(tools.runLegacyJournaled('extension',action), /result is unknown/i)
assert.ok(pending,'failed journal cleanup must retain unknown result')
pending = null; failedAck = false; bridge = {port:1,token:'test'}
await assert.rejects(tools.runLegacyJournaled('extension',action), /computer_use_session_open/i)
assert.equal(pending,null,'unsupported unguarded action must release the record')
assert.equal(sendCalls,0,'unsupported action must not be sent')
await assert.rejects(tools.runLegacyJournaled('extension',async()=>{sendCalls++;throw Error('connection lost')}), /result is unknown/i)
assert.ok(pending,'transport failure after dispatch must retain the record')
assert.equal(sendCalls,1)
console.log('PASS legacy bridge pre-dispatch rejection and uncertain transport handling')
