export function parsePiListPaths(output: string): Map<string, string> {
  const paths = new Map<string, string>()
  let current = ''
  for (const line of output.split('\n')) {
    const source = /^ {2}(\S(?:.*\S)?)\s*$/.exec(line)
    if (source) { current = source[1]; continue }
    const path = /^ {4}(\/.*|[A-Za-z]:\\.*)\s*$/.exec(line)
    if (path && current) { paths.set(current, path[1].trimEnd()); current = '' }
  }
  return paths
}
