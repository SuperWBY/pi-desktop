import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserFileSnapshotCode } from '../extensions/computer-use/src/browser-file-context.ts'

const sources = [
  ['in-app', await readFile(new URL('../src/main/browser.ts', import.meta.url), 'utf8'), 'domObserveCode', 'browserDomAct', 'b'],
  ['CDP', await readFile(new URL('../extensions/computer-use/index.ts', import.meta.url), 'utf8'), 'cdpObserveCode', 'cdpAction', 'c'],
  ['legacy Chrome', await readFile(new URL('../extensions/computer-use/index.ts', import.meta.url), 'utf8'), 'browserObserveCode', 'browserAction', 'b']
]
const browser = await chromium.launch({ headless: true, executablePath: process.env.PI_TEST_CHROME || undefined })
let failures = 0
try {
  for (const [label, source, observeName, actionName, prefix] of sources) {
    const page = await browser.newPage()
    await page.setContent(`<input type="password" value="secret-password"><input autocomplete="section-signin current-password" value="secret-current"><input autocomplete="new-password" value="secret-new"><input autocomplete="one-time-code" value="secret-otp"><div contenteditable="true" autocomplete="one-time-code">secret-editable</div><input value="ordinary-value">`)
    const observeTemplate = source.match(new RegExp('const ' + observeName + ' = (`[\\s\\S]*?`)\\n'))?.[1]
    assert.ok(observeTemplate, `${label}: observation code exists`)
    const observeCode = Function('browserFileSnapshotCode', `return ${observeTemplate}`)(browserFileSnapshotCode)
    const raw = await page.evaluate(observeCode)
    const candidates = typeof raw === 'string' ? JSON.parse(raw) : raw
    try {
      assert.equal(candidates.length, 6)
      for (const candidate of candidates.slice(0, 5)) {
        assert.equal(candidate.secure, true, `${candidate.id} marked secure`)
        assert.equal(candidate.value, '')
        assert.equal(candidate.name, '', `${candidate.id} must not use sensitive contents as its name`)
        assert.ok(!JSON.stringify(candidate).includes('secret-'), `${candidate.id} must not reveal its secret`)
      }
      assert.equal(candidates[5].value, 'ordinary-value')
      console.log(`PASS ${label}: sensitive observation`)
    } catch (error) { failures++; console.error(`FAIL ${label}: ${error.message}`) }
    const actionSection = source.slice(source.indexOf(`function ${actionName}(`))
    const typeSection = actionSection.slice(actionSection.indexOf("type === 'type'"))
    const template = typeSection.match(/(?:code\s*=|const code\s*=)\s*(`(?:[^`\\]|\\[\s\S])*`)/)?.[1]
    assert.ok(template, `${label}: type action code exists`)
    for (let i = 1; i <= 5; i++) {
      const selector = `[data-pi-${label === 'CDP' ? 'cdp' : 'cua'}-id="${prefix}${i}"]`
      const code = Function('selector', 'text', `return ${template}`)(selector, 'replacement')
      let rejected = false
      try {
        const result = await page.evaluate(code)
        const parsed = typeof result === 'string' ? JSON.parse(result) : result
        rejected = parsed?.ok === false
      } catch { rejected = true }
      if (!rejected) { failures++; console.error(`FAIL ${label}: typed into sensitive field ${i}`) }
    }
    await page.close()
  }
} finally { await browser.close() }
assert.equal(failures, 0, `${failures} sensitive-field checks failed`)
