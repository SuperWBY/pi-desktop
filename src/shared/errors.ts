/** Strip Electron's IPC wrapper so users never see raw invoke errors. */
export function stripRemoteError(message: string): string {
  return message
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

/** Map spawn errno text to a short Chinese line (leave other IPC errors alone). */
export function mapErrnoMessage(message: string): string {
  const text = message.trim()
  if (!text) return ''
  // Only rewrite process-spawn failures — bare ENOENT/EACCES from file I/O stay as-is.
  if (/\bspawn\s+EINVAL\b/i.test(text)) {
    return '无法启动内置运行时，请重试或改用 API Key'
  }
  if (/\bspawn\s+ENOENT\b/i.test(text)) {
    return '找不到所需程序，请重试'
  }
  if (/\bspawn\s+EACCES\b/i.test(text)) {
    return '没有权限执行该操作'
  }
  if (/\bspawn\s+[A-Z]+\b/.test(text)) {
    return '操作失败，请重试'
  }
  return text
}

export function userFacingError(error: unknown, fallback = '操作失败'): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  return mapErrnoMessage(stripRemoteError(raw)) || fallback
}
