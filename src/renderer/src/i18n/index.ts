import { useCallback } from 'react'
import { useApp } from '../store'
import { translate } from './dictionary'

export function useTranslation(): (text: string) => string {
  const { state } = useApp()
  const language = state.settings.language ?? 'zh-CN'
  return useCallback((text: string) => translate(language, text), [language])
}
