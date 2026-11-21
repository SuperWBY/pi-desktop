export const isMac = typeof window !== 'undefined' && window.pi?.platform === 'darwin'

/** Platform-correct modifier glyphs/suffixes for UI hints. */
export function mod(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl+${key}`
}

export function shiftMod(key: string): string {
  return isMac ? `⇧⌘${key}` : `Ctrl+Shift+${key}`
}

/** Convert a macOS-style shortcut string such as ⌘⇧E to the local platform. */
export function shortcutKeys(keys: string): string {
  if (isMac) return keys
  return keys.replace(/⇧/g, 'Shift+').replace(/⌘/g, 'Ctrl+')
}

/** Split a macOS-style shortcut into per-key parts for keycap display:
 * macOS follows the HIG order (⇧ before ⌘, then the key); Windows uses
 * conventional Ctrl/Shift prefixes. */
export function shortcutParts(keys: string): string[] {
  const shift = keys.includes('⇧')
  const cmd = keys.includes('⌘')
  const plain = keys.replace(/[⇧⌘]/g, '')
  const parts: string[] = []
  if (isMac) {
    if (shift) parts.push('⇧')
    if (cmd) parts.push('⌘')
  } else {
    if (cmd) parts.push('Ctrl')
    if (shift) parts.push('Shift')
  }
  if (plain) parts.push(plain)
  return parts
}
