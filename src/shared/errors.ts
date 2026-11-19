/** Strip Electron's IPC wrapper so users never see raw invoke errors. */
export function stripRemoteError(message: string): string {
  return message
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

/** Map raw errno / spawn text to a short Chinese line. */
export function mapErrnoMessage(message: string): string {
  const text = message.trim()
  if (!text) return ''
  if (/^(spawn\s+)?EINVAL\b/i.test(text) || /\bspawn\s+EINVAL\b/i.test(text)) {
    return '无法启动内置运行时，请重试或改用 API Key'
  }
  if (/^(spawn\s+)?ENOENT\b/i.test(text) || /\bspawn\s+ENOENT\b/i.test(text)) {
    return '找不到所需程序，请重试'
  }
  if (/^(spawn\s+)?EACCES\b/i.test(text) || /permission denied/i.test(text)) {
    return '没有权限执行该操作'
  }
  if (/^spawn\s+[A-Z]+\b/.test(text)) {
    return '操作失败，请重试'
  }
  return text
}

export function userFacingError(error: unknown, fallback = '操作失败'): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  return mapErrnoMessage(stripRemoteError(raw)) || fallback
}
