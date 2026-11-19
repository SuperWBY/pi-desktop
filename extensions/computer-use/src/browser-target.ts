import { browserFileGuardCode } from './browser-file-context.ts'
// Runs in the page's execution context; detects accidental changes, not malicious page tampering.
export const browserTargetGuardCode = `(candidateId, selector, targetKey, includeTitle) => {
  const el = document.querySelector(selector);
  const target = globalThis[targetKey]?.get(candidateId);
  if (!${browserFileGuardCode}) return false;
  if (!el || !target || target.element !== el || !el.isConnected) return false;
  const type = (el.getAttribute('type') || '').toLowerCase();
  const secure = type === 'password' || (el.getAttribute('autocomplete') || '').toLowerCase().split(/\\s+/).some(token => ['current-password', 'new-password', 'one-time-code'].includes(token));
  const name = (el.getAttribute('aria-label') || Array.from(el.labels || [], label => { const copy = label.cloneNode(true); copy.querySelectorAll('input,textarea,select,button').forEach(node => node.remove()); return copy.textContent || '' }).join(' ').trim() || el.getAttribute('placeholder') || (!secure && el.innerText) || (!secure && type !== 'file' && el.value) || el.getAttribute('name') || (includeTitle && el.getAttribute('title')) || '').replace(/\\s+/g, ' ').trim().slice(0, 160);
  const destination = JSON.stringify([el.getAttribute('href'), el.href || '', el.getAttribute('target'), el.getAttribute('formaction'), el.getAttribute('formmethod'), el.getAttribute('formtarget'), el.form?.action || '', el.form?.method || '', el.form?.target || '']);
  const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
  return target.name === name && target.role === (el.getAttribute('role') || el.tagName.toLowerCase()) && target.type === type && target.secure === secure && target.destination === destination && !el.matches(':disabled,[aria-disabled="true"]') && r.width >= 2 && r.height >= 2 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
}`
