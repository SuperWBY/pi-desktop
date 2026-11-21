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
    await page.setContent(`<input type="password" value="secret-password"><input autocomplete="section-signin current-password" value="secret-current"><input autocomplete="new-password" value="secret-new"><input autocomplete="one-time-code" value="secret-otp"><div contenteditable="true" autocomplete="one-time-code">secret-editable</div><input autocomplete="cc-number" value="4111111111111111"><input name="cvv" value="123"><input value="ordinary-value">`)
    // The shared sensitive-field predicate is a double-quoted string constant
    // interpolated into the page-side templates; recover its runtime value.
    const secureFieldMatch = source.match(/const secureFieldFnJs = ("(?:[^"\\]|\\[\s\S])*")/)?.[1]
    const secureFieldFnJs = secureFieldMatch ? JSON.parse(secureFieldMatch) : ''
    const observeTemplate = source.match(new RegExp('const ' + observeName + ' = (`[\\s\\S]*?`)\\n'))?.[1]
    assert.ok(observeTemplate, `${label}: observation code exists`)
    const observeCode = Function('browserFileSnapshotCode', 'secureFieldFnJs', `return ${observeTemplate}`)(browserFileSnapshotCode, secureFieldFnJs)
    const raw = await page.evaluate(observeCode)
    const candidates = typeof raw === 'string' ? JSON.parse(raw) : raw
    try {
      assert.equal(candidates.length, 8)
      for (const candidate of candidates.slice(0, 7)) {
        assert.equal(candidate.secure, true, `${candidate.id} marked secure`)
        assert.equal(candidate.value, '')
        assert.ok(!JSON.stringify(candidate).includes('secret-'), `${candidate.id} must not reveal its secret`)
        assert.ok(!JSON.stringify(candidate).includes('4111'), `${candidate.id} must not reveal card numbers`)
        assert.ok(!JSON.stringify(candidate).includes('123"'), `${candidate.id} must not reveal card verification values`)
      }
      assert.equal(candidates[7].value, 'ordinary-value')
      console.log(`PASS ${label}: sensitive observation`)
    } catch (error) { failures++; console.error(`FAIL ${label}: ${error.message}`) }
    const actionSection = source.slice(source.indexOf(`function ${actionName}(`))
    if (label === 'legacy Chrome' && actionSection.slice(0, actionSection.indexOf('\n}')).includes('LegacyBrowserActionBeforeDispatch')) {
      console.log('PASS legacy Chrome: writes require a unified browser session')
      await page.close()
      continue
    }
    const typeSection = actionSection.slice(actionSection.indexOf("type === 'type'"))
    const template = typeSection.match(/(?:code\s*=|const code\s*=)\s*(`(?:[^`\\]|\\[\s\S])*`)/)?.[1]
    assert.ok(template, `${label}: type action code exists`)
    for (let i = 1; i <= 7; i++) {
      const selector = `[data-pi-${label === 'CDP' ? 'cdp' : 'cua'}-id="${prefix}${i}"]`
      // Production interpolates `secureCheck` with the sensitive-field predicate
      // unless the user approved; the unapproved check must reject every field.
      const code = Function('selector', 'text', 'secureCheck', `return ${template}`)(selector, 'replacement', 'true')
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
