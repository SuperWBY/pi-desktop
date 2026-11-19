/** Comparison key for workspace paths. Not a path to display or persist. */
export function canonicalWorkspacePath(input: string): string {
  let path = input.trim().replace(/[/\\]+/g, '/')
  if (path.length > 3 && path.endsWith('/')) path = path.slice(0, -1)
  // macOS: /var and /tmp are symlinks into /private. slice('/private'.length)
  // already leaves the /var or /tmp prefix, so do not add it again.
  if (path.startsWith('/private/var/') || path === '/private/var') path = path.slice('/private'.length)
  else if (path.startsWith('/private/tmp/') || path === '/private/tmp') path = path.slice('/private'.length)
  try {
    path = path.normalize('NFC')
  } catch {
    // Some runtimes reject unpaired surrogates; the raw string still compares.
  }
  if (/^[A-Za-z]:\//.test(path)) path = path.toLowerCase()
  return path
}

export function pathsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return canonicalWorkspacePath(a) === canonicalWorkspacePath(b)
}

/**
 * OS temp directories and the app's scratch chat folder. These are not
 * projects a person chose, and their raw paths should never be shown.
 */
export function isTemporaryWorkspace(path: string | null | undefined, scratchPath?: string | null): boolean {
  if (!path) return false
  if (scratchPath && pathsEqual(path, scratchPath)) return true
  const value = canonicalWorkspacePath(path)
  if (value.startsWith('/var/folders/') || value.startsWith('/tmp/')) return true
  if (value.includes('/appdata/local/temp/') || value.endsWith('/appdata/local/temp')) return true
  return false
}

export function looksLikeRawPath(value: string): boolean {
  return value.startsWith('/') || value.startsWith('~') || /^[A-Za-z]:[\\/]/.test(value) || value.includes('/private/var/')
}
