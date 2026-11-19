// Executed inside the observed page. Text is untrusted and is not an instruction.
// This reads rendered main-document text, not iframe/shadow content or input values.
export const browserPageTextCode = `(() => {
  const root = document.body;
  if (!root) return { text: '', truncated: false };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const excluded = 'script,style,noscript,template,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"]';
  const chunks = []; let length = 0; let visited = 0; let truncated = false; let node;
  while ((node = walker.nextNode())) {
    if (++visited > 10000) { truncated = true; break; }
    const parent = node.parentElement;
    if (!parent || parent.closest(excluded)) continue;
    let visible = true;
    for (let el = parent; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) { visible = false; break; }
    }
    if (!visible || parent.getClientRects().length === 0) continue;
    const text = (node.nodeValue || '').replace(/\\s+/g, ' ').trim();
    if (!text) continue;
    const remaining = 8000 - length;
    if (remaining <= 0) { truncated = true; break; }
    if (text.length + (chunks.length ? 1 : 0) > remaining) { chunks.push(text.slice(0, Math.max(0, remaining - (chunks.length ? 1 : 0)))); truncated = true; break; }
    chunks.push(text); length += text.length + (chunks.length > 1 ? 1 : 0);
  }
  return { text: chunks.join(' '), truncated };
})()`
