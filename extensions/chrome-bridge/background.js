let bridgeUrl = ''

function collectCandidates(snapshotId) {
  if (snapshotId) document.documentElement.setAttribute('data-pi-chrome-snapshot', snapshotId)
  const selector = 'a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]'
  const candidates = []
  const targets = new Map()
  const fileInputs = Array.from(document.querySelectorAll('input[type="file" i]'))
  if (fileInputs.length > 100 || fileInputs.some(el => (el.files?.length || 0) > 100)) throw new Error('Too many file inputs or selected files to verify safely.')
  globalThis.__piFileContext = fileInputs.map(el => ({ element:el, refs:Array.from(el.files || []), files:JSON.stringify(Array.from(el.files || [], file => [file.name,file.size,file.type,file.lastModified])) }))
  for (const el of document.querySelectorAll(selector)) {
    if (!(el instanceof HTMLElement)) continue
    const rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) continue
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue
    const type = (el.getAttribute('type') || '').toLowerCase()
    const secure = type === 'password' || /(?:^|\s)(?:current-password|new-password|one-time-code)(?:\s|$)/i.test(el.getAttribute('autocomplete') || '')
    const name = (el.getAttribute('aria-label') || Array.from(el.labels || [], label => { const copy = label.cloneNode(true); copy.querySelectorAll('input,textarea,select,button').forEach(node => node.remove()); return copy.textContent || '' }).join(' ').trim() || el.getAttribute('placeholder') || (!secure && el.innerText) || (!secure && type !== 'file' && el.value) || el.getAttribute('name') || el.getAttribute('title') || '')
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
      value: secure || type === 'file' ? '' : String(el.value ?? '').slice(0, 160),
      ...(type === 'file' && !secure ? { files:Array.from(el.files || []).slice(0,20).map(file => ({name:file.name.slice(0,256),size:file.size,type:file.type.slice(0,128)})), fileCount:el.files?.length || 0, filesTruncated:(el.files?.length || 0)>20 } : {}),
      secure,
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })
    const destination = JSON.stringify([el.getAttribute('href'), el.href || '', el.getAttribute('target'), el.getAttribute('formaction'), el.getAttribute('formmethod'), el.getAttribute('formtarget'), el.form?.action || '', el.form?.method || '', el.form?.target || ''])
    targets.set(id, { element: el, name, role: el.getAttribute('role') || el.tagName.toLowerCase(), type, secure, destination })
    if (candidates.length >= 120) break
  }
  globalThis.__piChromeTargets = { snapshotId, targets }
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width >= 2 && r.height >= 2 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' }
  const frames = document.querySelectorAll('iframe[src*="recaptcha" i],iframe[src*="hcaptcha" i],iframe[src*="challenges.cloudflare.com" i],iframe[title*="captcha" i],iframe[title*="验证" i]')
  const text = (document.body?.innerText || '').slice(0, 20000)
  const requiresHuman = Array.from(frames).some(visible) || /请完成(?:安全|人机)?验证|请(?:先)?拖动滑块|验证您是真人|verify you are human|verify you are not a robot|checking your browser before accessing/i.test(text)
  return { candidates, requiresHuman }
}

function performAction(candidateId, type, text, key, snapshotId, expectedUrl) {
  if (!expectedUrl || location.href !== expectedUrl) return { ok: false, __piGuardRejected: 'page_changed' }
  if (!snapshotId || document.documentElement.getAttribute('data-pi-chrome-snapshot') !== snapshotId) return { ok: false, __piGuardRejected: 'page_changed' }
  const frames = document.querySelectorAll('iframe[src*="recaptcha" i],iframe[src*="hcaptcha" i],iframe[src*="challenges.cloudflare.com" i],iframe[title*="captcha" i],iframe[title*="验证" i]')
  const visibleChallenge = Array.from(frames).some((frame) => { const r = frame.getBoundingClientRect(); const s = getComputedStyle(frame); return r.width >= 2 && r.height >= 2 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' })
  if (visibleChallenge || /请完成(?:安全|人机)?验证|请(?:先)?拖动滑块|验证您是真人|verify you are human|verify you are not a robot|checking your browser before accessing/i.test((document.body?.innerText || '').slice(0, 20000))) return { ok: false, __piGuardRejected: 'human' }
  const el = document.querySelector(`[data-pi-chrome-id="${candidateId}"]`)
  if (!el) return { ok: false, __piGuardRejected: 'target_changed' }
  const snapshot = globalThis.__piChromeTargets
  const target = snapshot?.snapshotId === snapshotId ? snapshot.targets.get(candidateId) : undefined
  const fileInputs = Array.from(document.querySelectorAll('input[type="file" i]'))
  const priorFiles = globalThis.__piFileContext
  if (!Array.isArray(priorFiles) || fileInputs.length !== priorFiles.length || fileInputs.length > 100 || !fileInputs.every((item,index) => item === priorFiles[index].element && (item.files?.length || 0) <= 100 && Array.from(item.files || []).every((file,i) => file === priorFiles[index].refs[i]) && JSON.stringify(Array.from(item.files || [], file => [file.name,file.size,file.type,file.lastModified])) === priorFiles[index].files)) return { ok:false, __piGuardRejected:'target_changed' }
  const currentType = (el.getAttribute('type') || '').toLowerCase()
  const secure = currentType === 'password' || /(?:^|\s)(?:current-password|new-password|one-time-code)(?:\s|$)/i.test(el.getAttribute('autocomplete') || '')
  const name = (el.getAttribute('aria-label') || Array.from(el.labels || [], label => { const copy = label.cloneNode(true); copy.querySelectorAll('input,textarea,select,button').forEach(node => node.remove()); return copy.textContent || '' }).join(' ').trim() || el.getAttribute('placeholder') || (!secure && el.innerText) || (!secure && currentType !== 'file' && el.value) || el.getAttribute('name') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 160)
  const rect = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  const destination = JSON.stringify([el.getAttribute('href'), el.href || '', el.getAttribute('target'), el.getAttribute('formaction'), el.getAttribute('formmethod'), el.getAttribute('formtarget'), el.form?.action || '', el.form?.method || '', el.form?.target || ''])
  if (!target || target.element !== el || !el.isConnected || target.name !== name || target.role !== (el.getAttribute('role') || el.tagName.toLowerCase()) || target.type !== currentType || target.secure !== secure || target.destination !== destination || el.matches(':disabled,[aria-disabled="true"]') || rect.width < 2 || rect.height < 2 || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return { ok: false, __piGuardRejected: 'target_changed' }
  if (type === 'check-file') {
    if (!(el instanceof HTMLInputElement) || el.type.toLowerCase() !== 'file' || el.files?.length !== 1) return { ok: false, __piGuardRejected: 'target_changed' }
    return { ok: true }
  }
  if (type === 'click') {
    el.scrollIntoView({ block: 'center', inline: 'center' })
    el.click()
    return { ok: true, title: document.title, url: location.href }
  }
  if (type === 'type') {
    if ((el.getAttribute('type') || '').toLowerCase() === 'password' || /(?:^|\s)(?:current-password|new-password|one-time-code)(?:\s|$)/i.test(el.getAttribute('autocomplete') || '')) return { ok: false, error: 'secure field' }
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

async function hashSelectedFile(candidateId, snapshotId, expectedUrl) {
  const valid = () => {
    const inputs = Array.from(document.querySelectorAll('input[type="file" i]'))
    const previous = globalThis.__piFileContext
    return location.href === expectedUrl && document.documentElement.getAttribute('data-pi-chrome-snapshot') === snapshotId && Array.isArray(previous) && inputs.length === previous.length && inputs.length <= 100 && inputs.every((el, i) => el === previous[i].element && (el.files?.length || 0) <= 100 && Array.from(el.files || []).every((file, j) => file === previous[i].refs[j]) && JSON.stringify(Array.from(el.files || [], file => [file.name,file.size,file.type,file.lastModified])) === previous[i].files)
  }
  const targets = globalThis.__piChromeTargets
  const el = targets?.snapshotId === snapshotId ? targets.targets.get(candidateId)?.element : null
  if (!valid() || !(el instanceof HTMLInputElement) || !el.isConnected || el.type.toLowerCase() !== 'file' || el.files?.length !== 1) throw new Error('Selected file or page changed; observe again.')
  const file = el.files[0]
  if (file.size > 16 * 1024 * 1024) throw new Error('File is too large for content verification (16 MiB maximum).')
  if (!globalThis.crypto?.subtle) throw new Error('File content verification is unavailable on this page.')
  const bytes = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  if (!valid() || !el.isConnected || el.files?.length !== 1 || el.files[0] !== file) throw new Error('Selected file or page changed during content verification.')
  return { sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''), size: file.size }
}

function readPageText(snapshotId, expectedUrl) {
  if (location.href !== expectedUrl || document.documentElement.getAttribute('data-pi-chrome-snapshot') !== snapshotId) return { error:'Browser page changed; observe again.' }
  const frames = document.querySelectorAll('iframe[src*="recaptcha" i],iframe[src*="hcaptcha" i],iframe[src*="challenges.cloudflare.com" i],iframe[title*="captcha" i],iframe[title*="验证" i]')
  const visible = (el) => { const r=el.getBoundingClientRect(), s=getComputedStyle(el); return r.width>=2 && r.height>=2 && s.display!=='none' && s.visibility!=='hidden' && s.opacity!=='0' }
  if (Array.from(frames).some(visible) || /请完成(?:安全|人机)?验证|请(?:先)?拖动滑块|验证您是真人|verify you are human|verify you are not a robot|checking your browser before accessing/i.test((document.body?.innerText || '').slice(0,20000))) return { text:'', truncated:false, requiresHuman:true }
  const root=document.body
  if (!root) return {text:'',truncated:false}
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT)
  const excluded='script,style,noscript,template,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"]'
  const chunks=[]; let length=0, visited=0, truncated=false, node
  while ((node=walker.nextNode())) {
    if (++visited>10000) {truncated=true;break}
    const parent=node.parentElement
    if (!parent || parent.closest(excluded)) continue
    let shown=true
    for (let el=parent;el;el=el.parentElement) {const style=getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0){shown=false;break}}
    if (!shown || parent.getClientRects().length===0) continue
    const text=(node.nodeValue||'').replace(/\s+/g,' ').trim()
    if (!text) continue
    const remaining=8000-length
    if (remaining<=0){truncated=true;break}
    if (text.length+(chunks.length?1:0)>remaining){chunks.push(text.slice(0,Math.max(0,remaining-(chunks.length?1:0))));truncated=true;break}
    chunks.push(text);length+=text.length+(chunks.length>1?1:0)
  }
  return {text:chunks.join(' '),truncated}
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
  if (task.type === 'ping') return { protocol: 1, version: chrome.runtime.getManifest().version }
  const tab = await activeTab()
  if (!tab?.id) throw new Error('No active Chrome tab.')
  if (task.type === 'observe') {
    const snapshotId = crypto.randomUUID()
    const [{ result, documentId }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectCandidates, args: [snapshotId] })
    if (!documentId) throw new Error('Cannot identify the active document; Chrome version is unsupported.')
    return { tabId: tab.id, documentId, snapshotId, url: tab.url || '', title: tab.title || '', ...result }
  }
  if (task.type === 'read') {
    if (!task.tabId || !task.documentId || !task.snapshotId || !task.url) throw new Error('Missing observation. Observe the active tab again.')
    if (tab.id !== task.tabId || tab.url !== task.url) throw new Error('The active Chrome page changed. Observe again.')
    const [{result}] = await chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:[task.documentId]},func:readPageText,args:[task.snapshotId,task.url]})
    if (result?.error) throw new Error(result.error)
    return result
  }
  if (task.type === 'check-file') {
    if (!task.tabId || !task.documentId || !task.snapshotId || !task.url || !/^h\d+$/.test(String(task.action?.candidateId ?? ''))) throw new Error('Missing file observation; inspect again.')
    if (tab.id !== task.tabId || tab.url !== task.url) throw new Error('The active Chrome page changed. Inspect again.')
    const [{result}] = await chrome.scripting.executeScript({ target:{tabId:tab.id,documentIds:[task.documentId]}, func:performAction, args:[task.action.candidateId,'check-file','','',task.snapshotId,task.url] })
    if (!result?.ok || result.__piGuardRejected) throw new Error('Selected file or page changed; inspect and confirm again.')
    return {ok:true}
  }
  if (task.type === 'hash-file') {
    if (!task.tabId || !task.documentId || !task.snapshotId || !task.url || !/^h\d+$/.test(String(task.action?.candidateId ?? ''))) throw new Error('Missing file observation; observe again.')
    if (tab.id !== task.tabId || tab.url !== task.url) throw new Error('The active Chrome page changed. Observe again.')
    const [{result}] = await chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:[task.documentId]},func:hashSelectedFile,args:[task.action.candidateId,task.snapshotId,task.url]})
    return result
  }
  if (task.type === 'act') {
    const rejectGuard = (reason) => {
      if (task.guardProtocol === 1) return { __piGuardRejected: reason }
      const messages = { page_changed: 'The active Chrome page changed. Observe again.', human: 'Human verification required.', target_changed: 'Target changed; observe again.' }
      throw new Error(messages[reason] || 'Chrome action rejected.')
    }
    if (!task.tabId || !task.documentId || !task.snapshotId || !task.url) throw new Error('Missing observation. Observe the active tab again.')
    if (tab.id !== task.tabId) return rejectGuard('page_changed')
    if (tab.url !== task.url) return rejectGuard('page_changed')
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, documentIds: [task.documentId] },
      func: performAction,
      args: [
        String(task.action?.candidateId ?? ''),
        String(task.action?.type ?? ''),
        String(task.action?.text ?? ''),
        String(task.action?.key ?? 'Enter'),
        task.snapshotId,
        task.url
      ]
    })
    if (['page_changed', 'human', 'target_changed'].includes(result?.__piGuardRejected)) return rejectGuard(result.__piGuardRejected)
    if (!result?.ok) throw new Error(result?.error || 'Chrome action failed.')
    return result
  }
  throw new Error('Unknown bridge task')
}

let polling = false
let pollTimer
let signingKey

async function pairingKey() {
  if (signingKey) return signingKey
  const response = await fetch(chrome.runtime.getURL('pairing.json'), { cache: 'no-store' })
  if (!response.ok) throw new Error('Pairing has not been prepared.')
  const { key, port } = await response.json()
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid pairing.')
  bridgeUrl = `http://127.0.0.1:${port}`
  const bytes = Uint8Array.from(key.match(/../g), (pair) => parseInt(pair, 16))
  signingKey = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  return signingKey
}

const bytesToHex = (bytes) => Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('')
const randomNonce = () => bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
async function sign(key, ...parts) {
  return bytesToHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(parts.join('\n'))))
}
async function verify(key, proof, ...parts) {
  if (typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof)) return false
  const bytes = Uint8Array.from(proof.match(/../g), (pair) => parseInt(pair, 16))
  return crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(parts.join('\n')))
}
async function post(path, body) {
  return fetch(`${bridgeUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) })
}

async function poll() {
  if (polling) return
  polling = true
  try {
    const key = await pairingKey()
    const client = randomNonce()
    const response = await fetch(`${bridgeUrl}/challenge?client=${client}`, { cache: 'no-store', signal: AbortSignal.timeout(3000) })
    if (!response.ok) throw new Error('Bridge unavailable.')
    const challenge = await response.json()
    if (!/^[a-f0-9]{64}$/.test(challenge.nonce || '') || !await verify(key, challenge.proof, 'server', client, challenge.nonce)) throw new Error('Bridge authentication failed.')
    const nonce = challenge.nonce
    const next = await post('/next', { client, nonce, proof: await sign(key, 'client', client, nonce) })
    if (!next.ok) throw new Error('Bridge rejected pairing.')
    const envelope = await next.json()
    if (typeof envelope.payload !== 'string' || !await verify(key, envelope.proof, 'task', client, nonce, envelope.payload)) throw new Error('Task authentication failed.')
    const task = JSON.parse(envelope.payload)
    let result
    try { result = { id: task.id, ok: true, result: await executeTask(task) } }
    catch (error) { result = { id: task.id, ok: false, error: String(error?.message || error) } }
    const payload = JSON.stringify(result)
    await post('/result', { client, nonce, payload, proof: await sign(key, 'result', client, nonce, payload) })
  } catch {
    // No paired Pi bridge is available. Never execute an unauthenticated task.
  } finally {
    polling = false
    pollTimer = setTimeout(poll, 500)
  }
}

function wakeBridge() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = undefined
  void poll()
}

function scheduleWake() {
  void chrome.alarms.create('pi-bridge-wake', { periodInMinutes: 0.5 })
  wakeBridge()
}

globalThis.chrome?.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pi-bridge-wake') wakeBridge()
})
globalThis.chrome?.runtime?.onInstalled.addListener(scheduleWake)
globalThis.chrome?.runtime?.onStartup.addListener(scheduleWake)
globalThis.chrome?.action?.onClicked.addListener(wakeBridge)
poll()
