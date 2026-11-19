/** Max visible characters for a notification reply summary (Chinese-aware). */
export const NOTIFY_SUMMARY_MAX = 40

export type NotifyKind = 'done' | 'approval' | 'error'

/**
 * Turn a final assistant reply into a short, plain notification line:
 * first sentence, no markdown/code/URLs/ids/parenthetical metadata.
 */
export function cleanReplySummary(text: string, maxChars = NOTIFY_SUMMARY_MAX): string {
  let s = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~>]{1,}/g, '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\([^)]{0,240}\)/g, ' ')
    .replace(/\[[^\]]{0,240}\]/g, ' ')
    .replace(/\b[a-zA-Z0-9_-]{16,}\b/g, ' ')
    .replace(/\b[a-f0-9]{8,}\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([。！？.!?,，、；;])/g, '$1')
    .trim()

  if (!s) return ''

  const sentence = s.match(/^(.+?[。！？.!?])/u)
  if (sentence?.[1]) s = sentence[1].trim()

  const chars = [...s]
  if (chars.length <= maxChars) return s

  let cut = maxChars
  for (let i = maxChars; i >= Math.floor(maxChars * 0.55); i -= 1) {
    if (/\s|[，、；;,·]/.test(chars[i] ?? '')) {
      cut = i
      break
    }
  }
  return `${chars.slice(0, cut).join('').trimEnd()}…`
}

export function desktopNotifyCopy(options: {
  kind: NotifyKind
  sessionTitle?: string | null
  replyText?: string | null
  language?: string | null
}): { title: string; body: string } {
  const english = options.language === 'en'
  const title = options.sessionTitle?.trim() || 'Pi'
  const status =
    options.kind === 'error'
      ? english
        ? 'Something went wrong'
        : '出错了'
      : options.kind === 'approval'
        ? english
          ? 'Needs your confirmation'
          : '需要你确认'
        : english
          ? 'Done'
          : '已完成'

  if (options.kind === 'approval') return { title, body: status }

  const summary = cleanReplySummary(options.replyText ?? '')
  return { title, body: summary ? `${status} · ${summary}` : status }
}
