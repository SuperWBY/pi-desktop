const BRIDGE = 'http://127.0.0.1:9317'

function collectCandidates() {
  const selector = 'a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]'
  const candidates = []
  for (const el of document.querySelectorAll(selector)) {
    if (!(el instanceof HTMLElement)) continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) continue
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue
    const type = (el.getAttribute('type') || '').toLowerCase()
    const secure = type === 'password' || el.getAttribute('autocomplete') === 'current-password'
    const name = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || el.value || el.getAttribute('name') || el.getAttribute('title') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160)
    const id = 'h' + (candidates.length + 1)
    el.setAttribute('data-pi-chrome-id', id)
    candidates.push({
      id,
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      name,
      type,
      value: secure ? '' : String(el.value ?? '').slice(0, 160),
      secure,
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })
    if (candidates.length >= 120) break
  }
  return candidates
}

function performAction(candidateId, type, text, key) {
  const el = document.querySelector(`[data-pi-chrome-id="${candidateId}"]`)
  if (!el) return { ok: false, error: 'candidate not found' }
  if (type === 'click') {
    el.scrollIntoView({ block: 'center', inline: 'center' })
    el.click()
    return { ok: true, title: document.title, url: location.href }
  }
  if (type === 'type') {
    if (el instanceof HTMLInputElement && el.type === 'password') return { ok: false, error: 'secure field' }
    el.focus()
    if (el.isContentEditable) {
      el.textContent = text
    } else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (setter) setter.call(el, text)
      else el.value = text
    }
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, value: el.value }
  }
  if (type === 'press') {
    el.focus()
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
    if (key === 'Enter' && el.form) el.form.requestSubmit()
    return { ok: true }
  }
  return { ok: false, error: 'unknown action' }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id) throw new Error('No active Chrome tab.')
  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
    throw new Error('Chrome internal pages cannot be automated.')
  }
  return tab
}

async function executeTask(task) {
  const tab = task.tabId ? await chrome.tabs.get(task.tabId) : await activeTab()
  if (!tab?.id) throw new Error('No active Chrome tab.')
  const target = { tabId: tab.id }
  if (task.type === 'observe') {
    const [{ result }] = await chrome.scripting.executeScript({ target, func: collectCandidates })
    return result
  }
  if (task.type === 'act') {
    const [{ result }] = await chrome.scripting.executeScript({
      target,
      func: performAction,
      args: [
        String(task.action?.candidateId ?? ''),
        String(task.action?.type ?? ''),
        String(task.action?.text ?? ''),
        String(task.action?.key ?? 'Enter')
      ]
    })
    return result
  }
  throw new Error('Unknown bridge task')
}

async function poll() {
  try {
    const response = await fetch(`${BRIDGE}/next`, { cache: 'no-store' })
    if (response.status === 200) {
      const task = await response.json()
      let result
      try {
        result = { id: task.id, ok: true, result: await executeTask(task) }
      } catch (error) {
        result = { id: task.id, ok: false, error: String(error?.message || error) }
      }
      await fetch(`${BRIDGE}/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(result)
      })
    }
  } catch {
    // Pi Desktop is not running or the bridge is not active.
  }
  setTimeout(poll, 500)
}

poll()
