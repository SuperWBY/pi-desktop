import { diffLines, parsePatch, type StructuredPatch } from 'diff'
import { editPairs, type EditPair } from './tools'

export interface EditPatch {
  text: string
  hunks: StructuredPatch['hunks']
}

export function editChange(args: Record<string, unknown>, details: unknown): {
  patch?: EditPatch
  pairs: EditPair[]
  additions: number
  deletions: number
  firstChangedLine?: number
} {
  const result = details as { patch?: unknown; firstChangedLine?: unknown } | null
  const line = result?.firstChangedLine
  const firstChangedLine = typeof line === 'number' && Number.isSafeInteger(line) && line > 0 ? line : undefined
  if (typeof result?.patch === 'string' && result.patch.startsWith('--- ')) {
    try {
      const [file, ...more] = parsePatch(result.patch)
      if (file && !more.length && file.oldFileName !== undefined && file.newFileName !== undefined) {
        let additions = 0
        let deletions = 0
        for (const hunk of file.hunks) {
          for (const line of hunk.lines) {
            if (line.startsWith('+')) additions++
            else if (line.startsWith('-')) deletions++
          }
        }
        return { patch: { text: result.patch, hunks: file.hunks }, pairs: [], additions, deletions, firstChangedLine }
      }
    } catch {
      // Older or incomplete results can still show the original edit fragments.
    }
  }
  const pairs = editPairs(args)
  let additions = 0
  let deletions = 0
  for (const pair of pairs) {
    for (const part of diffLines(pair.oldText, pair.newText)) {
      if (part.added) additions += part.count ?? 0
      else if (part.removed) deletions += part.count ?? 0
    }
  }
  return { pairs, additions, deletions, firstChangedLine }
}
