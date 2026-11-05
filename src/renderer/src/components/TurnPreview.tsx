import { useTranslation } from '../i18n'
import type { ReactNode } from 'react'
import type { ContentBlock } from '@shared/types'
import type { Turn } from '../lib/turns'
import { formatDuration, timeOfDay } from '../lib/format'
import { CopyButton, Markdown } from './Markdown'

/**
 * Hover preview for one tick on the turn rail: the question, an excerpt of the
 * answer, images the turn produced, and its cost in steps/time. Rendered as a
 * fixed overlay so the rail's clipping cannot cut it off.
 */
export function TurnPreview({
  turn,
  index,
  left,
  top,
  onKeep,
  onLeave,
  onJump
}: {
  turn: Turn
  index: number
  left: number
  top: number
  onKeep: () => void
  onLeave: () => void
  onJump: () => void
}): ReactNode {
  const t = useTranslation()
  const images = (turn.finalMessage?.content ?? []).filter(
    (block): block is Extract<ContentBlock, { type: 'image' }> => block.type === 'image'
  )
  const operations =
    turn.stats.steps + Object.values(turn.stats.tools).reduce((total, n) => total + n, 0)
  const elapsed =
    turn.stats.startedAt && turn.stats.endedAt
      ? formatDuration(turn.stats.endedAt - turn.stats.startedAt)
      : ''
  const copyText = [turn.userText, turn.finalText].filter(Boolean).join('\n\n')

  return (
    <div
      className="turn-preview"
      id="turn-preview"
      style={{ left, top }}
      onPointerEnter={onKeep}
      onPointerLeave={onLeave}
      onClick={onJump}
      role="dialog"
      aria-label={t('第 {count} 轮').replace('{count}', String(index))}
    >
      <div className="turn-preview-head">
        <span className="turn-preview-index">
          {t('第 {count} 轮').replace('{count}', String(index))}
        </span>
        <span className="turn-preview-time">{timeOfDay(turn.stats.startedAt)}</span>
        <span className="turn-preview-copy" onClick={(event) => event.stopPropagation()}>
          <CopyButton text={copyText} />
        </span>
      </div>
      {turn.userText && <div className="turn-preview-question">{turn.userText}</div>}
      {images.length > 0 && (
        <div className="turn-preview-images">
          {images.slice(0, 2).map((image, i) => (
            <img key={i} src={`data:${image.mimeType};base64,${image.data}`} alt="" />
          ))}
        </div>
      )}
      {turn.finalText && (
        <div className="turn-preview-answer">
          <Markdown>{turn.finalText}</Markdown>
        </div>
      )}
      <div className="turn-preview-meta">
        {operations > 0
          ? t('{count} 次操作').replace('{count}', String(operations))
          : t('一条回答')}
        {elapsed ? ` · ${elapsed}` : ''}
      </div>
    </div>
  )
}
