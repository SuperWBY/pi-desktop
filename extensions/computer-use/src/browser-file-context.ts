// Page-local correctness check, not a defense against a hostile page.
// Capture all top-document file inputs so changing a selected file invalidates
// actions on associated buttons too. File bytes are never read here.
export const browserFileSnapshotCode = `(() => {
  const inputs = Array.from(document.querySelectorAll('input[type="file" i]'));
  if (inputs.length > 100 || inputs.some(el => (el.files?.length || 0) > 100)) throw new Error('Too many file inputs or selected files to verify safely.');
  globalThis.__piFileContext = inputs.map(el => ({ element: el, refs: Array.from(el.files || []), files: JSON.stringify(Array.from(el.files || [], file => [file.name, file.size, file.type, file.lastModified])) }));
})()`

export const browserFileGuardCode = `(() => {
  const inputs = Array.from(document.querySelectorAll('input[type="file" i]'));
  const previous = globalThis.__piFileContext;
  if (!Array.isArray(previous) || inputs.length !== previous.length || inputs.length > 100) return false;
  return inputs.every((el, index) => el === previous[index].element && (el.files?.length || 0) <= 100 && Array.from(el.files || []).every((file, i) => file === previous[index].refs[i]) && JSON.stringify(Array.from(el.files || [], file => [file.name, file.size, file.type, file.lastModified])) === previous[index].files);
})()`

// Runs in the page context. This catches ordinary changes, not a malicious page.
// File contents stay in the browser and only the digest is returned.
export const browserFileHashCode = `(async (candidateId, snapshotId, expectedUrl, targetKey, snapshotAttribute) => {
  const valid = () => location.href === expectedUrl && document.documentElement.getAttribute(snapshotAttribute) === snapshotId && ${browserFileGuardCode};
  const targets = globalThis[targetKey];
  const target = targets?.targets ? (targets.snapshotId === snapshotId ? targets.targets.get(candidateId) : null) : targets?.get(candidateId);
  const el = target?.element;
  if (!valid() || !(el instanceof HTMLInputElement) || !el.isConnected || el.type.toLowerCase() !== 'file' || el.files?.length !== 1) throw new Error('Selected file or page changed; observe again.');
  const file = el.files[0];
  if (file.size > 16 * 1024 * 1024) throw new Error('File is too large for content verification (16 MiB maximum).');
  if (!globalThis.crypto?.subtle) throw new Error('File content verification is unavailable on this page.');
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  if (!valid() || !el.isConnected || el.files?.length !== 1 || el.files[0] !== file) throw new Error('Selected file or page changed during content verification.');
  return { sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''), size: file.size };
})`
