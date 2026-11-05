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
