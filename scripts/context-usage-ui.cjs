const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

/** Runs against the existing isolated renderer harness; never calls a model. */
module.exports = async function checkContextUsage(page) {
  const screenshots = path.resolve(__dirname, '../output/context-usage')
  fs.mkdirSync(screenshots, { recursive: true })
  await page.evaluate(() => {
    const original = window.pi.command
    window.contextCalls = []
    window.contextAuto = true
    window.restoreContextCommand = () => { window.pi.command = original }
    window.setContextFixture = () => {
      const categories = [ ['system', 9300], ['rules', 1500], ['tools', 18000], ['mcp', 300], ['skills', 2400], ['summary', 1200], ['conversation', 30000], ['toolResults', 7500] ].map(([id, tokens]) => ({ id, tokens }))
      window.contextStats = { sessionId: 'context-fixture', contextUsage: { tokens: 70200, contextWindow: 300000, percent: 23.4,
        breakdown: { sessionId: 'context-fixture', modelKey: 'mock/test', contextWindow: 300000, totalTokens: 70200, capturedAt: Date.now(), estimated: true, calibrated: false, categories } } }
    }
    window.pi.command = async (command, timeout) => {
      if (command.type === 'set_auto_compaction') { window.contextAuto = command.enabled; window.contextCalls.push(command) }
      if (command.type === 'compact') {
        window.contextCalls.push(command)
        await new Promise((resolve) => { window.finishContextCompact = resolve })
        if (window.failContextCompact) { window.failContextCompact = false; return { success: false, error: 'Mock compaction failure' } }
        window.contextStats = { sessionId: 'context-fixture', contextUsage: { tokens: null, contextWindow: 300000, percent: null } }
        return { success: true, data: {} }
      }
      const reply = await original(command, timeout)
      if (command.type === 'get_state') reply.data = { ...reply.data, autoCompactionEnabled: window.contextAuto }
      if (command.type === 'get_session_stats' && window.contextStats) reply.data = structuredClone(window.contextStats)
      if (command.type === 'get_session_stats' && window.holdContextStats) {
        window.holdContextStats = false
        await new Promise((resolve) => { window.releaseContextStats = resolve })
      }
      return reply
    }
  })
  const trigger = page.getByRole('button', { name: /^查看上下文用量/ })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '上下文用量', exact: true })
  await dialog.getByText('等待用量更新', { exact: true }).waitFor()
  assert.equal((await trigger.innerText()).trim(), '—', 'Unknown usage was displayed as zero')
  await page.keyboard.press('Escape')
  await page.locator('.context-usage-panel').waitFor({ state: 'detached' })
  assert.ok(await trigger.evaluate((el) => el === document.activeElement), 'Escape did not restore focus')

  await page.evaluate(() => window.setContextFixture())
  await trigger.click()
  await dialog.getByText('23.4%', { exact: true }).waitFor()
  assert.equal(await dialog.locator('.context-usage-list li').count(), 8)
  assert.match(await dialog.innerText(), /70\.2K.*300K/)
  assert.equal(await dialog.getByRole('progressbar').getAttribute('aria-valuenow'), '23.4')
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.context-usage-panel')).opacity === '1')
  const width = await dialog.locator('.context-segment').evaluateAll((segments) => segments.reduce((sum, el) => sum + parseFloat(el.style.width), 0))
  assert.ok(Math.abs(width - 23.4) < 0.001, `Segment widths do not match total: ${width}`)
  assert.notEqual(await dialog.evaluate((el) => getComputedStyle(el).transitionDuration), '0s', 'Open animation is absent')
  await page.screenshot({ path: path.join(screenshots, 'dark.png') })
  await dialog.screenshot({ path: path.join(screenshots, 'dark-panel.png') })

  const auto = dialog.getByRole('switch', { name: '自动压缩上下文' })
  await auto.click()
  await page.waitForFunction(() => document.querySelector('.context-auto-switch')?.getAttribute('aria-checked') === 'false')
  await dialog.getByText('自动压缩已关闭，可手动整理历史内容。', { exact: true }).waitFor()
  await auto.click()
  await page.waitForFunction(() => document.querySelector('.context-auto-switch')?.getAttribute('aria-checked') === 'true')

  await page.evaluate(() => { window.mockStreaming = true; window.emitRecord({ type: 'agent_start' }) })
  await page.waitForFunction(() => document.querySelector('.context-compact-button')?.disabled === true)
  assert.equal(await auto.isDisabled(), true, 'Auto switch should be disabled during generation')
  await page.evaluate(() => { window.mockStreaming = false; window.emitRecord({ type: 'agent_settled' }) })
  await page.waitForFunction(() => document.querySelector('.context-compact-button')?.disabled === false)

  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.screenshot({ path: path.join(screenshots, 'light.png') })
  await dialog.screenshot({ path: path.join(screenshots, 'light-panel.png') })
  await page.setViewportSize({ width: 820, height: 640 })
  await page.waitForFunction(() => {
    const rect = document.querySelector('.context-usage-panel').getBoundingClientRect()
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
  })
  await page.screenshot({ path: path.join(screenshots, 'narrow.png') })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })

  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await dialog.evaluate((el) => getComputedStyle(el).transitionDuration), '0s')
  await page.keyboard.press('Escape')
  await page.locator('.context-usage-panel').waitFor({ state: 'detached' })
  await trigger.click()
  await dialog.waitFor()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await dialog.getByRole('button', { name: '关闭上下文用量' }).click()
  assert.equal(await page.locator('.context-usage-panel.is-closing').count(), 1, 'Close animation was skipped')
  await trigger.click()
  await dialog.waitFor()
  await page.waitForTimeout(200)
  assert.equal(await dialog.count(), 1, 'Reopening was removed by an old close timer')

  const compact = dialog.getByRole('button', { name: '压缩上下文', exact: true })
  await page.evaluate(() => { window.failContextCompact = true })
  await compact.click()
  await dialog.getByRole('button', { name: '正在压缩上下文…', exact: true }).waitFor()
  assert.equal(await page.locator('.context-compact-button').isDisabled(), true)
  await page.evaluate(() => window.finishContextCompact())
  await compact.waitFor()
  await dialog.getByText('23.4%', { exact: true }).waitFor()
  await compact.click()
  await page.evaluate(() => {
    document.querySelector('.context-compact-button').click()
    window.finishContextCompact()
  })
  await dialog.getByText('等待用量更新', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.contextCalls.filter((cmd) => cmd.type === 'compact').length), 2, 'Duplicate compaction was sent')
  assert.equal((await trigger.innerText()).trim(), '—')
  await page.screenshot({ path: path.join(screenshots, 'after-compaction.png') })

  await page.keyboard.press('Escape')
  await page.locator('.context-usage-panel').waitFor({ state: 'detached' })
  await page.evaluate(() => window.setContextFixture())
  await trigger.click()
  await dialog.getByText('23.4%', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.context-usage-panel').waitFor({ state: 'detached' })
  await page.evaluate(() => { window.holdContextStats = true })
  await trigger.click()
  await page.waitForFunction(() => typeof window.releaseContextStats === 'function')
  await page.evaluate(() => window.emitRecord({ type: 'compaction_start', reason: 'threshold' }))
  await page.waitForFunction(() => document.querySelector('.context-compact-button')?.disabled === true)
  await page.evaluate(() => {
    window.contextStats.contextUsage = { tokens: null, contextWindow: 300000, percent: null }
    window.emitRecord({ type: 'compaction_end', result: { summary: 'done' }, aborted: false })
  })
  await dialog.getByText('等待用量更新', { exact: true }).waitFor()
  await page.evaluate(() => window.releaseContextStats())
  await page.waitForTimeout(80)
  assert.equal((await trigger.innerText()).trim(), '—', 'An in-flight pre-compaction result restored old usage')
  await page.keyboard.press('Escape')
  await page.locator('.context-usage-panel').waitFor({ state: 'detached' })

  // A still-running compact must not lock a newly selected conversation.
  await page.evaluate(() => window.setContextFixture())
  await trigger.click()
  await dialog.getByText('23.4%', { exact: true }).waitFor()
  await compact.click()
  await page.evaluate(() => {
    window.finishContextCompactA = window.finishContextCompact
    const originalOpen = window.pi.openSession
    window.restoreContextOpen = () => { window.pi.openSession = originalOpen }
    window.pi.openSession = async (options) => {
      if (options.sessionPath === '/session/2') await new Promise((resolve) => { window.finishContextOpen = resolve })
      return originalOpen(options)
    }
  })
  await page.getByText('Beta 的会话', { exact: true }).click()
  await page.waitForFunction(() => typeof window.finishContextOpen === 'function')
  assert.equal((await trigger.innerText()).trim(), '—', 'Loading another session exposed previous usage')
  await trigger.click()
  await dialog.getByText('模型待确认', { exact: true }).waitFor()
  assert.equal(await dialog.locator('.context-usage-list').count(), 0)
  await page.evaluate(() => window.finishContextOpen())
  await page.waitForFunction(() => !document.querySelector('.context-compact-button')?.disabled)
  assert.equal(await auto.isDisabled(), false, 'A background compaction locked the new session')
  const previousCalls = await page.evaluate(() => window.contextCalls.filter((cmd) => cmd.type === 'compact').length)
  await compact.click()
  await page.waitForFunction((count) => window.contextCalls.filter((cmd) => cmd.type === 'compact').length === count + 1, previousCalls)
  await page.evaluate(() => window.finishContextCompact())
  await dialog.getByText('等待用量更新', { exact: true }).waitFor()
  await page.evaluate(() => { window.finishContextCompactA(); window.restoreContextOpen() })
  await page.keyboard.press('Escape')
  await page.locator('.context-usage-panel').waitFor({ state: 'detached' })
  await page.getByText('项目结构', { exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.project-row.active .project-row-main span')?.textContent === 'alpha')
  await page.evaluate(() => { window.restoreContextCommand(); delete window.contextStats })
  console.log('上下文浮层检查通过：未知状态、分类总分、键盘焦点、深浅主题、窄窗口、动画/减少动态效果、压缩防重/失败/旧请求隔离、会话切换与后台压缩隔离')
}
