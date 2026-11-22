import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { estimateContextCategories, reconcileContextCategories } from '../extensions/computer-use/src/context-metrics.ts'
import { registerContextReport } from '../extensions/computer-use/src/context-report.ts'
import { matchingContextBreakdown } from '../src/main/context-usage.ts'

let checks = 0
const check = (label, run) => { run(); checks++; console.log(`✓ ${label}`) }
const asMap = (rows) => Object.fromEntries(rows.map(({ id, tokens }) => [id, tokens]))
const schema = { name: 'read', description: 'Read files', parameters: { type: 'object' } }
const visible = [
  { role: 'system', content: '', sections: { preamble: 'base', project_context: 'rule', skills: 'list' }, toolsAdded: [schema, { ...schema, name: 'mcp__docs__search' }] },
  { role: 'system', content: '', sections: { preamble: 'replaced', project_context: null }, toolsAdded: [schema], toolsRemoved: [{ name: 'mcp__docs__search' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'text' }, { type: 'toolCall', id: 'skill', name: 'read', arguments: { path: '/skills/demo/SKILL.md' } }] },
  { role: 'toolResult', toolCallId: 'skill', content: [{ type: 'text', text: 'skill body must not be counted twice' }] },
  { role: 'compactionSummary', summary: 'summary text' },
  { role: 'bashExecution', command: 'ignored', output: 'excluded'.repeat(100), excludeFromContext: true }
]
const estimated = estimateContextCategories(visible)
check('Replay replaced sections and removed tools without double counting', () => {
  const values = asMap(estimated)
  assert.equal(values.system, 2)
  assert.equal(values.rules, undefined)
  assert.equal(values.tools, Math.ceil(JSON.stringify(schema).length / 4))
  assert.equal(values.mcp, undefined)
})
check('Attribute read skill content once; keep tool arguments separate', () => {
  const values = asMap(estimated)
  assert.equal(values.skills, 1 + Math.ceil('skill body must not be counted twice'.length / 4))
  assert.equal(values.conversation, 1)
  assert.equal(values.toolResults, Math.ceil(('read' + JSON.stringify(visible[2].content[1].arguments)).length / 4))
  assert.equal(values.summary, 3)
})
check('Paths in arbitrary tools do not misclassify their results', () => {
  const values = asMap(estimateContextCategories([
    { role: 'assistant', content: [{ type: 'toolCall', id: 'a', name: 'write', arguments: { path: '/SKILL.md' } }] },
    { role: 'toolResult', toolCallId: 'a', content: 'done' }
  ]))
  assert.equal(values.skills, undefined)
  assert.ok(values.toolResults > 0)
})
check('Images use an explicit estimate rather than base64 length', () => {
  assert.equal(asMap(estimateContextCategories([{ role: 'user', content: [{ type: 'image', data: 'a'.repeat(100000) }] }])).conversation, 1200)
})
check('Unexplained usage remains unclassified', () => {
  assert.deepEqual(reconcileContextCategories(10, [{ id: 'system', tokens: 3 }]), { calibrated: false, categories: [{ id: 'system', tokens: 3 }, { id: 'other', tokens: 7 }] })
})
check('Calibration preserves integer totals, even for tiny and zero contexts', () => {
  for (const total of [0, 1, 2, 7, 99]) {
    const result = reconcileContextCategories(total, [{ id: 'system', tokens: 101 }, { id: 'tools', tokens: 77 }, { id: 'conversation', tokens: 25 }])
    assert.equal(result.categories.reduce((n, row) => n + row.tokens, 0), total)
    assert.ok(result.categories.every((row) => Number.isInteger(row.tokens) && row.tokens > 0))
  }
})

const folder = mkdtempSync(join(tmpdir(), 'pi-context-test-'))
const previous = process.env.PI_DESKTOP_CONTEXT_FILE
try {
  const file = join(folder, 'snapshot.json')
  process.env.PI_DESKTOP_CONTEXT_FILE = file
  const handlers = new Map()
  registerContextReport({ on: (name, handler) => handlers.set(name, handler) })
  let total = 200
  const ctx = {
    model: { provider: 'mock', id: 'model' },
    sessionManager: { getSessionId: () => 'session-a', buildSessionProjection: () => ({ messages: visible }) },
    getContextUsage: () => ({ tokens: total, contextWindow: 300000, percent: total / 3000 })
  }
  handlers.get('agent_end')({}, ctx)
  const snapshot = JSON.parse(readFileSync(file, 'utf8'))
  const stats = { sessionId: 'session-a', contextUsage: { tokens: 200, contextWindow: 300000, percent: 200 / 3000 } }
  check('Lifecycle snapshot matches total, session and capacity', () => {
    assert.ok(matchingContextBreakdown(stats, snapshot))
    assert.equal(snapshot.categories.reduce((n, row) => n + row.tokens, 0), 200)
    assert.equal(snapshot.modelKey, 'mock/model')
  })
  check('Snapshots contain counts only and are private files', () => {
    assert.ok(!readFileSync(file, 'utf8').includes('skill body'))
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600)
  })
  check('Reject another session, old capacity, old total, and malformed rows', () => {
    for (const patch of [
      { sessionId: 'other' }, { contextWindow: 256000 }, { totalTokens: 199 },
      { categories: [{ id: 'invalid', tokens: 200 }] },
      { categories: [{ id: 'system', tokens: 100 }, { id: 'system', tokens: 100 }] },
      { categories: [{ id: 'system', tokens: -1 }, { id: 'other', tokens: 201 }] }
    ]) assert.equal(matchingContextBreakdown(stats, { ...snapshot, ...patch }), null)
  })
  check('After compaction, unknown is retained rather than converted to zero', () => {
    total = null
    handlers.get('session_compact')({}, ctx)
    const pending = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(pending.totalTokens, null)
    assert.deepEqual(pending.categories, [])
    assert.equal(matchingContextBreakdown(stats, pending), null)
  })
  check('Missing runtime capabilities cannot break a request', () => {
    assert.doesNotThrow(() => handlers.get('session_start')({}, {}))
  })
} finally {
  if (previous === undefined) delete process.env.PI_DESKTOP_CONTEXT_FILE
  else process.env.PI_DESKTOP_CONTEXT_FILE = previous
  rmSync(folder, { recursive: true, force: true })
}
console.log(`${checks} context checks passed`)
