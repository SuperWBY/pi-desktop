/** Strip Electron's IPC wrapper so users never see raw invoke errors. */
export function stripRemoteError(message: string): string {
  return message
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

export function userFacingError(error: unknown, fallback = '操作失败'): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  return stripRemoteError(raw) || fallback
}
