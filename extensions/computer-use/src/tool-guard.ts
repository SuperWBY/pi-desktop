/** Commands that can destroy data, escalate privileges, or publish code. */
const DANGEROUS_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: '递归删除', pattern: /\brm\s+(-[^\s]*[rf][^\s]*|--recursive|--force)\b/i },
  { label: '权限提升', pattern: /\bsudo\b|\bdoas\b/i },
  { label: '过宽权限', pattern: /\b(chmod|chown)\b[^\n]*\b777\b/i },
  { label: '磁盘写入', pattern: /\b(dd|m[k]fs|diskutil\s+erase|fdisk)\b/i },
  { label: '强制推送', pattern: /\bgit\s+push\b[^\n]*\s(--force|-f)\b/i },
  { label: '破坏性 git 操作', pattern: /\bgit\s+(reset\s+--hard|clean\s+-[^\s]*f)/i },
  { label: '远程脚本安装', pattern: /\b(curl|wget)\b[^\n|]*\|\s*(sh|bash|zsh)\b/i },
  { label: '发布软件包', pattern: /\b(npm|pnpm|yarn)\s+publish\b/i },
  { label: '系统关机', pattern: /\b(shutdown|reboot|halt)\b/i },
  { label: '结束所有进程', pattern: /\bkill\s+-9\s+-1\b/i }
]

export function dangerousCommand(command: string): { label: string; command: string } | null {
  const text = String(command ?? '').trim()
  if (!text) return null
  for (const item of DANGEROUS_PATTERNS) {
    if (item.pattern.test(text)) return { label: item.label, command: text }
  }
  return null
}
