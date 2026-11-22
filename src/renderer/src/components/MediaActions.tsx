import { useState, type ReactNode } from 'react'
import { Copy, Download, Loader2 } from 'lucide-react'
import { useTranslation } from '../i18n'
import { useApp } from '../store'
import { userFacingError } from '@shared/errors'
const MAX_INLINE_IMAGE_BYTES = 32 * 1024 * 1024

export function MediaActions({ src, name, kind }: { src: string; name: string; kind: 'image' | 'video' | 'file' }): ReactNode {
  const t = useTranslation()
  const { actions } = useApp()
  const [busy, setBusy] = useState<'save' | 'copy' | null>(null)
  const local = src.startsWith('pi-media:')

  const bytes = async (): Promise<{ data: Uint8Array; type: string }> => {
    const response = await fetch(src)
    if (!response.ok) throw new Error(t('无法读取附件。'))
    const blob = await response.blob()
    if (blob.size > MAX_INLINE_IMAGE_BYTES) throw new Error(t('附件超过 32 MB。'))
    return { data: new Uint8Array(await blob.arrayBuffer()), type: blob.type }
  }
  const perform = async (operation: 'save' | 'copy'): Promise<void> => {
    if (busy) return
    setBusy(operation)
    try {
      if (/^https:\/\//i.test(src)) {
        const completed = await window.pi.remoteMedia(src, name, kind, operation)
        if (completed) actions.notify('success', t(operation === 'save' ? '已保存附件' : kind === 'image' ? '已复制图片' : kind === 'video' ? '已复制视频文件' : '已复制文件'))
      } else if (operation === 'save') {
        const data = local ? null : await bytes()
        const saved = local ? await window.pi.saveMediaFile(src) : await window.pi.saveMediaBytes(data?.type === 'image/svg+xml' && name === '图片.png' ? '图片.svg' : name, data!.data)
        if (saved) actions.notify('success', t('已保存附件'))
      } else if (kind !== 'image') {
        if (!local) throw new Error(t('文件不可用。'))
        await window.pi.copyMediaFile(src)
        actions.notify('success', t(kind === 'video' ? '已复制视频文件' : '已复制文件'))
      } else {
        if (local) await window.pi.copyMediaImageFile(src)
        else {
          const image = new window.Image()
          image.src = src
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
          const context = canvas.getContext('2d')
          if (!context || !canvas.width || !canvas.height) throw new Error(t('图片预览不可用'))
          context.drawImage(image, 0, 0)
          const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error(t('无法复制此图片。'))), 'image/png'))
          await window.pi.copyMediaImage(new Uint8Array(await png.arrayBuffer()))
        }
        actions.notify('success', t('已复制图片'))
      }
    } catch (error) { actions.notify('error', t(operation === 'save' ? '保存失败' : '复制失败'), userFacingError(error)) }
    finally { setBusy(null) }
  }
  return <span className="media-actions">
    <button type="button" className="work-icon" aria-label={t(kind === 'image' ? '复制图片' : kind === 'video' ? '复制视频文件' : '复制文件')} title={t(kind === 'image' ? '复制图片' : kind === 'video' ? '复制视频文件' : '复制文件')} disabled={!!busy} onClick={() => void perform('copy')}>{busy === 'copy' ? <Loader2 className="spin" size={15} /> : <Copy size={15} />}</button>
    <button type="button" className="work-icon" aria-label={t('下载')} title={t('下载')} disabled={!!busy} onClick={() => void perform('save')}>{busy === 'save' ? <Loader2 className="spin" size={15} /> : <Download size={15} />}</button>
    {busy && <span className="sr-only" role="status">{t(busy === 'save' ? '正在下载…' : '正在复制…')}</span>}
  </span>
}
