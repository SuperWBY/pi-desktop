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
    // Passwords, one-time codes and payment fields are secure: values are
    // masked and typing needs the user's explicit approval (secureApproved).
    // Keep this predicate in sync with computer-use and src/main/browser.ts.
    const secure = (type === 'password'
      || /(?:^|\s)(?:current-password|new-password|one-time-code|cc-[a-z]+)(?:\s|$)/i.test(el.getAttribute('autocomplete') || '')
      || /(?:^|[^a-z])(?:card[-_ ]?(?:number|no|expiry|exp|code|csc)|cv[vc]|csc|security[-_ ]?code|有效期|安全码|信用卡)(?:[^a-z]|$)/i.test(`${el.getAttribute('autocomplete') || ''} ${el.getAttribute('name') || ''} ${el.getAttribute('id') || ''}`))
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
  // Kept with the snapshot in the extension’s isolated world for the action-time check.
  const inspectInteraction = (attribute) => {
    const parseUrl = value => {
      try { return new URL(value, location.href); }
      catch { return undefined; }
    };
    const visible = el => {
      const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
      return rect.width >= 2 && rect.height >= 2 && style.visibility === 'visible' && style.opacity !== '0' && !el.matches(':disabled,[aria-disabled="true"]');
    };
    const fields = [...document.querySelectorAll('input[type="password" i],[autocomplete~="current-password" i],[autocomplete~="new-password" i],[autocomplete~="one-time-code" i]')].filter(visible);
    if (fields.some(el => el.matches('[autocomplete~="one-time-code" i]'))) return { blocker: 'verification' };
    if (fields.length) {
      const field = fields[0], form = field.form;
      if (fields.length === 1 && field.matches('input[type="password" i]:autofill:not([autocomplete~="new-password" i])') && form) {
        const buttons = [...form.elements].filter(el => el.type === 'submit' && visible(el));
        const button = buttons.length === 1 ? buttons[0] : undefined;
        if (button) {
          const id = button.getAttribute(attribute);
          const label = (button.getAttribute('aria-label') || button.textContent || '').trim();
          const destination = parseUrl(button.hasAttribute('formaction') ? button.formAction : form.action);
          const method = button.getAttribute('formmethod') || form.method;
          const target = button.getAttribute('formtarget') || form.target;
          if (id && /^(?:sign[ -]?in|log[ -]?in|登录|登入|登錄)$/i.test(label) && location.protocol === 'https:' && destination?.origin === location.origin
            && !destination.username && !destination.password && method.toLowerCase() === 'post' && (!target || target.toLowerCase() === '_self')) return { login: id };
        }
      }
      return { blocker: 'login' };
    }
    const navigation = [...document.querySelectorAll('a[href][' + attribute + ']')].filter(el => {
      if (!visible(el) || el.hasAttribute('download') || el.hasAttribute('ping') || el.hasAttribute('onclick') || el.getAttribute('role') === 'button') return false;
      if (el.target && el.target.toLowerCase() !== '_self') return false;
      const url = parseUrl(el.href);
      if (!url || !/^https?:$/.test(url.protocol) || url.origin !== location.origin || url.username || url.password) return false;
      return !/delete|remove|logout|log[ -]?out|sign[ -]?out|submit|publish|pay|unsubscribe|授权|删除|退出|注销|提交|支付|发布/i.test(url.pathname + url.search + ' ' + (el.getAttribute('aria-label') || el.textContent || ''));
    }).map(el => el.getAttribute(attribute));
    return { navigation };
  }
  globalThis.__piChromeTargets = { snapshotId, targets, inspectInteraction }
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width >= 2 && r.height >= 2 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' }
  const frames = document.querySelectorAll('iframe[src*="recaptcha" i],iframe[src*="hcaptcha" i],iframe[src*="challenges.cloudflare.com" i],iframe[title*="captcha" i],iframe[title*="验证" i]')
  const text = (document.body?.innerText || '').slice(0, 20000)
  const requiresHuman = Array.from(frames).some(visible) || /请完成(?:安全|人机)?验证|请(?:先)?拖动滑块|验证您是真人|verify you are human|verify you are not a robot|checking your browser before accessing/i.test(text)
  return { candidates, requiresHuman, title: globalThis.__piTabControl?.title ?? document.title, interaction: inspectInteraction('data-pi-chrome-id') }
}

function performAction(candidateId, type, text, key, snapshotId, expectedUrl, interaction, secureApproved) {
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
  // Same sensitive-field predicate as collectCandidates above; keep in sync.
  const secure = (currentType === 'password'
    || /(?:^|\s)(?:current-password|new-password|one-time-code|cc-[a-z]+)(?:\s|$)/i.test(el.getAttribute('autocomplete') || '')
    || /(?:^|[^a-z])(?:card[-_ ]?(?:number|no|expiry|exp|code|csc)|cv[vc]|csc|security[-_ ]?code|有效期|安全码|信用卡)(?:[^a-z]|$)/i.test(`${el.getAttribute('autocomplete') || ''} ${el.getAttribute('name') || ''} ${el.getAttribute('id') || ''}`))
  const name = (el.getAttribute('aria-label') || Array.from(el.labels || [], label => { const copy = label.cloneNode(true); copy.querySelectorAll('input,textarea,select,button').forEach(node => node.remove()); return copy.textContent || '' }).join(' ').trim() || el.getAttribute('placeholder') || (!secure && el.innerText) || (!secure && currentType !== 'file' && el.value) || el.getAttribute('name') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 160)
  const rect = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  const destination = JSON.stringify([el.getAttribute('href'), el.href || '', el.getAttribute('target'), el.getAttribute('formaction'), el.getAttribute('formmethod'), el.getAttribute('formtarget'), el.form?.action || '', el.form?.method || '', el.form?.target || ''])
  if (!target || target.element !== el || !el.isConnected || target.name !== name || target.role !== (el.getAttribute('role') || el.tagName.toLowerCase()) || target.type !== currentType || target.secure !== secure || target.destination !== destination || el.matches(':disabled,[aria-disabled="true"]') || rect.width < 2 || rect.height < 2 || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return { ok: false, __piGuardRejected: 'target_changed' }
  if (interaction === 'login' || interaction === 'navigation') {
    const current = snapshot.inspectInteraction('data-pi-chrome-id')
    const matches = interaction === 'login' ? current.login === candidateId : current.navigation?.includes(candidateId)
    if (!matches) return { ok: false, __piGuardRejected: 'target_changed' }
  }
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
    if (secure && !secureApproved) return { ok: false, error: 'secure field' }
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
    // Pressing keys on a password/payment field, or pressing Enter to submit a
    // form that contains one, sends credentials: require the same explicit
    // approval the desktop side obtained (secureApproved).
    if (secure && !secureApproved) return { ok: false, error: 'secure field' }
    const formSecure = !secureApproved && el.form && Array.from(el.form.elements).some(f => f instanceof HTMLInputElement && (f.type === 'password'
      || /(?:^|\s)(?:current-password|new-password|one-time-code|cc-[a-z]+)(?:\s|$)/i.test(f.getAttribute('autocomplete') || '')
      || /(?:^|[^a-z])(?:card[-_ ]?(?:number|no|expiry|exp|code|csc)|cv[vc]|csc|security[-_ ]?code|有效期|安全码|信用卡)(?:[^a-z]|$)/i.test(`${f.getAttribute('autocomplete') || ''} ${f.getAttribute('name') || ''} ${f.getAttribute('id') || ''}`)))
    el.focus()
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }))
    if (key === 'Enter' && el.form) {
      if (formSecure) return { ok: false, error: 'secure form' }
      el.form.requestSubmit()
    }
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

const setTabControl = (owner, state) => {
  let marker = globalThis.__piTabControl;
  if (!state) {
    if (marker?.owner === owner) marker.clear();
    return;
  }
  if (!marker) {
    marker = { title: document.title, displayed: document.title };
    const update = () => {
      if (document.title !== marker.displayed) marker.title = document.title;
      const desired = (marker.state === 'waiting' ? '⏸ ' : '🖱 ') + marker.title;
      marker.displayed = desired;
      if (document.title !== desired) document.title = desired;
    };
    const observer = new MutationObserver(update);
    observer.observe(document.head || document.documentElement, { childList: true, subtree: true, characterData: true });
    marker.update = update;
    marker.clear = () => {
      observer.disconnect();
      clearTimeout(marker.timer);
      if (document.title === marker.displayed) document.title = marker.title;
      delete globalThis.__piTabControl;
    };
    globalThis.__piTabControl = marker;
  }
  marker.owner = owner;
  marker.state = state;
  clearTimeout(marker.timer);
  marker.timer = setTimeout(marker.clear, 18000);
  marker.update();
}

async function executeTask(task) {
  if (task.type === 'ping') return { protocol: 1, version: chrome.runtime.getManifest().version }
  if (task.type === 'control') {
    if (!Number.isInteger(task.tabId) || typeof task.owner !== 'string' || ![null, 'active', 'waiting'].includes(task.control)) throw new Error('Invalid tab control state.')
    await chrome.scripting.executeScript({ target: { tabId: task.tabId }, func: setTabControl, args: [task.owner, task.control] })
    return { ok: true }
  }
  if (task.type === 'preview') {
    if (!Number.isInteger(task.tabId) || typeof task.documentId !== 'string' || typeof task.snapshotId !== 'string' || typeof task.url !== 'string') throw new Error('Missing preview observation.')
    let changed = false
    const onActivated = () => { changed = true }
    const onUpdated = (id, info) => { if (id === task.tabId && (info.url || info.status === 'loading')) changed = true }
    const onRemoved = id => { if (id === task.tabId) changed = true }
    const onFocusChanged = () => { changed = true }
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.tabs.onRemoved.addListener(onRemoved)
    chrome.windows.onFocusChanged.addListener(onFocusChanged)
    try {
      const tab = await activeTab()
      if (changed || tab.id !== task.tabId || tab.url !== task.url || !Number.isInteger(tab.windowId)) throw new Error('The task tab is not visible.')
      const verify = async () => {
        const [{ result }] = await chrome.scripting.executeScript({ target:{tabId:task.tabId,documentIds:[task.documentId]}, func:(url, snapshot) => location.href === url && document.documentElement.getAttribute('data-pi-chrome-snapshot') === snapshot, args:[task.url, task.snapshotId] })
        return result === true
      }
      if (!await verify() || changed) throw new Error('Browser page changed; observe again.')
      const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format:'jpeg', quality:55 })
      const current = await activeTab()
      if (changed || current.id !== task.tabId || current.windowId !== tab.windowId || current.url !== task.url || !await verify() || changed) throw new Error('Browser page changed during capture.')
      if (typeof image !== 'string' || image.length > 1_500_000 || !image.startsWith('data:image/jpeg;base64,')) throw new Error('Preview image unavailable.')
      return { image }
    } finally {
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      chrome.tabs.onRemoved.removeListener(onRemoved)
      chrome.windows.onFocusChanged.removeListener(onFocusChanged)
    }
  }
  const tab = task.type === 'observe' && Number.isInteger(task.tabId) ? await chrome.tabs.get(task.tabId) : await activeTab()
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
    if (!/^h\d+$/.test(String(task.action?.candidateId ?? ''))) throw new Error('Invalid candidate id; observe again.')
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
        task.url,
        task.action?.interaction ?? null,
        task.action?.secureApproved === true
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
