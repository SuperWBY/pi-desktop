import type { ReactNode } from 'react'
import clsx from 'clsx'
import { diffParts } from '../lib/tools'

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

