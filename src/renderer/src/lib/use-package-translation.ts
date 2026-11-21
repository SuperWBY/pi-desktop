import { useEffect, useState } from 'react'
import { useApp } from '../store'

const cache = new Map<string, string[]>()
const requests = new Map<string, { requestId: string; promise: Promise<{ ok: boolean; texts?: string[] }> }>()
export function usePackageTranslation(texts: string[], markdown = false, enabled = true): { texts: string[]; busy: boolean; failed: boolean; progress: { completed: number; total: number } | null; retry: () => void } {
  const { state } = useApp()
  const language = state.settings.language ?? 'zh-CN'
  const key = JSON.stringify([language, markdown, texts])
  const [result, setResult] = useState<{ key: string; texts: string[] }>({ key: '', texts: [] })
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setFailed(false)
    setProgress(null)
    if (!enabled) { setBusy(false); return }
    if (!texts.some((text) => language === 'en' ? /\p{Script=Han}/u.test(text) : /[A-Za-z]{3,}/.test(text))) { setBusy(false); return }
    const stored = cache.get(key)
    if (stored) { setResult({ key, texts: stored }); setBusy(false); return }
    setBusy(true)
    let unsubscribe: (() => void) | undefined
    const timer = setTimeout(() => {
      let request = requests.get(key)
      if (!request) {
        const requestId = crypto.randomUUID()
        const promise = typeof window.pi.translatePackageContent === 'function' ? Promise.all(Array.from({ length: Math.ceil(texts.length / 24) }, (_, index) => window.pi.translatePackageContent({ language, texts: texts.slice(index * 24, (index + 1) * 24), markdown, ...(markdown ? { requestId } : {}) }))).then((chunks) => chunks.every((chunk) => chunk.ok) ? { ok: true, texts: chunks.flatMap((chunk) => chunk.ok ? chunk.texts : []) } : { ok: false }).catch(() => ({ ok: false })) : Promise.resolve({ ok: false })
        request = { requestId, promise }
        requests.set(key, request)
        void promise.finally(() => requests.delete(key))
      }
      const requestId = request.requestId
      if (markdown && typeof window.pi.onPackageTranslationProgress === 'function') unsubscribe = window.pi.onPackageTranslationProgress((value) => {
        if (active && value.requestId === requestId) {
          setResult({ key, texts: [value.text] })
          setProgress({ completed: value.completed, total: value.total })
        }
      })
      void request.promise.then((value) => {
        if (value.ok && value.texts) {
          if (cache.size >= 64) cache.delete(cache.keys().next().value!)
          cache.set(key, value.texts)
          if (active) setResult({ key, texts: value.texts })
        } else if (active) { setFailed(true); setResult({ key: '', texts: [] }) }
        if (active) setBusy(false)
      })
    }, 250)
    return () => { active = false; clearTimeout(timer); unsubscribe?.() }
  }, [key, attempt, enabled])
  return { texts: enabled && result.key === key ? result.texts : texts, busy: enabled && busy, failed: enabled && failed, progress: enabled ? progress : null, retry: () => setAttempt((value) => value + 1) }
}
