import type { ReactNode } from 'react'
import clsx from 'clsx'
import { diffParts } from '../lib/tools'
import type { EditPatch } from '../lib/edit-change'
import { useTranslation } from '../i18n'

export function DiffView({
  oldText,
  newText,
  context = 3
}: {
  oldText: string
  newText: string
  context?: number
}): ReactNode {
  const parts = diffParts(oldText, newText, context)
  return (
    <div className="diff">
      {parts.map((part, index) => {
        const marker = part.added ? '+' : part.removed ? '-' : ' '
        const lines = part.value.replace(/\n$/, '').split('\n')
        return (
          <pre
            key={index}
            className={clsx('diff-part', part.added && 'added', part.removed && 'removed')}
          >
            {lines.map((line, lineIndex) => (
              <div className="diff-line" key={lineIndex}>
                <span className="diff-marker">{marker}</span>
                <span>{line || ' '}</span>
              </div>
            ))}
          </pre>
        )
      })}
    </div>
  )
}

export function PatchView({ patch }: { patch: EditPatch }): ReactNode {
  const t = useTranslation()
  if (!patch.hunks.length) return <p className="diff-empty">{t('没有行变更')}</p>
  return (
    <div className="diff diff-with-lines">
      {patch.hunks.map((hunk, index) => {
        let oldLine = hunk.oldStart
        let newLine = hunk.newStart
        return (
          <pre className="diff-part" key={index}>
            <span className="diff-hunk">{`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}</span>
            {hunk.lines.map((line, row) => {
              const marker = line[0]
              if (marker === '\\') return <span className="diff-hunk" key={row}>{line}</span>
              const previous = marker !== '+' ? oldLine++ : ''
              const current = marker !== '-' ? newLine++ : ''
              return (
                <span className={clsx('diff-line', marker === '+' && 'added', marker === '-' && 'removed')} key={row}>
                  <span className="diff-line-number" aria-hidden="true">{previous}</span>
                  <span className="diff-line-number" aria-hidden="true">{current}</span>
                  <span className="diff-marker">{marker}</span>
                  <span>{line.slice(1) || ' '}</span>
                </span>
              )
            })}
          </pre>
        )
      })}
    </div>
  )
}
