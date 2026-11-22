import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { PackageReadme } from '@shared/types'
import { useApp } from '../store'
import { useTranslation } from '../i18n'
import { usePackageTranslation } from '../lib/use-package-translation'
import { PackageReadmeView } from './PackageReadme'

export function TranslatedPackageReadme({ readme, localeBusy = false }: { readme: PackageReadme; localeBusy?: boolean }): ReactNode {
  const t = useTranslation()
  const { state } = useApp()
  const language = state.settings.language ?? 'zh-CN'
  const identity = JSON.stringify([language, readme.url, readme.markdown])
  const [requested, setRequested] = useState<string | null>(null)
  const [showAI, setShowAI] = useState(false)
  const enabled = !localeBusy && requested === identity
  const translated = usePackageTranslation([readme.markdown], true, enabled)
  const changed = enabled && translated.texts[0] !== readme.markdown
  const displayingAI = changed && showAI
  const content = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const animation = content.current?.animate([{ opacity: .65 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' })
    return () => animation?.cancel()
  }, [displayingAI, readme.markdown])
  const author = readme.language === 'zh-CN' ? t('作者中文文档') : readme.language === 'en' ? t('作者英文文档') : t('作者原文')
  const fileName = readme.fileName ?? 'README'
  const requestTranslation = (): void => { setRequested(identity); setShowAI(true); if (enabled) translated.retry() }
  return <>
    <div className="market-readme-translation">
      <span role="status">{localeBusy ? <><LoaderCircle size={13} className="market-spin" />{t('正在查找作者对应语言的文档…')}</> : translated.busy ? <><LoaderCircle size={13} className="market-spin" />{translated.progress ? t('AI 翻译中 {completed}/{total}，未完成部分显示原文。').replace('{completed}', String(translated.progress.completed)).replace('{total}', String(translated.progress.total)) : t('正在准备 AI 翻译，先显示作者原文。')}</> : displayingAI ? t('AI 译文') : author}
        {!localeBusy && translated.failed && ` · ${t('AI 翻译失败，已保留作者原文。')}`}
        {!localeBusy && !translated.busy && !translated.failed && enabled && !changed && ` · ${t('内容无需翻译。')}`}
        {!localeBusy && readme.localizationStatus === 'not-found' && ` · ${t('未找到作者对应语言的文档')}`}
        {!localeBusy && readme.localizationStatus === 'unavailable' && ` · ${t('语言文档暂时无法检查')}`}
      </span>
      <a href={readme.url} onClick={event => { event.preventDefault(); void window.pi.openExternal(readme.url) }}>{fileName} · {readme.source === 'github' ? 'GitHub' : 'npm'}</a>
      {!localeBusy && readme.language !== language && <button disabled={translated.busy && !changed} onClick={changed ? () => setShowAI(value => !value) : requestTranslation}>{changed ? t(displayingAI ? '查看作者原文' : '查看 AI 译文') : t(translated.failed ? '重试 AI 翻译' : language === 'en' ? 'AI 翻译成英文' : 'AI 翻译成中文')}</button>}
    </div>
    <div ref={content}><PackageReadmeView readme={{ ...readme, markdown: displayingAI ? translated.texts[0] : readme.markdown }} source={readme.markdown} /></div>
  </>
}
