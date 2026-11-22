export interface SearchDescription {
  scope: string
  pattern: string
  files: boolean
}

/** Recognize a single literal search command. Shell expressions keep their original label. */
export function describeSearch(command: string): SearchDescription | undefined {
  if (command.length > 8000 || /[\r\n]/.test(command)) return
  const words: string[] = []
  let end = 0
  for (const match of command.matchAll(/"(?:(?:\\.)|[^"\\])*"|'[^']*'|[^\s"'\\&|;<>()$`*?\[\]{}]+/g)) {
    const index = match.index ?? 0
    if (command.slice(end, index).trim() || (words.length && end === index)) return
    const token = match[0]
    if (token.startsWith('"') && /[$`]/.test(token)) return
    words.push(token.startsWith("'") ? token.slice(1, -1)
      : token.startsWith('"') ? token.slice(1, -1).replace(/\\(["\\])/g, '$1') : token)
    end = index + token.length
  }
  if (command.slice(end).trim()) return
  const [executable, ...args] = words
  if (executable !== 'rg' && executable !== 'grep') return
  const common = new Set(['-n', '-i', '-s', '-F', '-w', '-l', '-c', '--line-number', '--ignore-case', '--fixed-strings', '--color=never'])
  const rg = new Set(['--hidden', '--no-ignore', '--no-heading', '-S', '--smart-case', '-N'])
  const operands: string[] = []
  const globs: string[] = []
  let pattern: string | undefined
  let files = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--') {
      operands.push(...args.slice(index + 1))
      break
    }
    if (arg === '--files' && executable === 'rg') {
      files = true
    } else if (arg === '-e' || arg === '--regexp') {
      if (pattern !== undefined || !args[index + 1]) return
      pattern = args[++index]
    } else if (executable === 'rg' && (arg === '-g' || arg === '--glob')) {
      if (!args[index + 1]) return
      globs.push(args[++index])
    } else if (common.has(arg) || (executable === 'rg' && rg.has(arg)) || (executable === 'grep' && /^-[rRE]$/.test(arg))) {
      continue
    } else if (arg.startsWith('-')) {
      return
    } else {
      operands.push(arg)
    }
  }
  if (files && pattern !== undefined) return
  if (!files && pattern === undefined) pattern = operands.shift()
  if (!files && !pattern) return
  return { scope: operands.join('、'), pattern: files ? globs.join('、') : pattern ?? '', files }
}

function numberField(value: unknown, key: string): number | undefined {
  const field = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
  return typeof field === 'number' && Number.isSafeInteger(field) ? field : undefined
}

const legacyExit = /(?:^|\r?\n)Command exited with code (-?\d+)\s*$/

export function shellOutput(text: string, failed: boolean, structured?: unknown, details?: unknown): {
  text: string
  exitCode?: number
  fullOutputPath?: string
} {
  const reported = failed ? legacyExit.exec(text) : null
  const exitCode = numberField(structured, 'exit_code') ?? numberField(details, 'exitCode')
    ?? (reported ? Number(reported[1]) : undefined)
  const path = (structured as { full_output_path?: unknown } | undefined)?.full_output_path
    ?? (details as { fullOutputPath?: unknown } | undefined)?.fullOutputPath
  return {
    text: reported && Number(reported[1]) === exitCode ? text.slice(0, reported.index) : text,
    exitCode,
    fullOutputPath: typeof path === 'string' && path ? path : undefined
  }
}
