// cmd.exe needs explicit quotes around file paths passed through shell:true.
export function quoteWindowsPiPaths(args: string[]): string[] {
  const pathOptions = new Set(['--extension', '-e', '--skill'])
  return args.map((arg, index) => {
    if (!pathOptions.has(args[index - 1] ?? '')) return arg
    if (/["%!]/.test(arg)) throw new Error('The Windows Pi extension path contains unsupported shell characters.')
    return `"${arg}"`
  })
}
