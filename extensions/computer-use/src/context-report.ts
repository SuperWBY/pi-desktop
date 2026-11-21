import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { renameSync, writeFileSync } from 'node:fs'
import { estimateContextCategories, reconcileContextCategories } from './context-metrics.ts'

export function registerContextReport(pi: ExtensionAPI): void {
  const file = process.env.PI_DESKTOP_CONTEXT_FILE
  if (!file) return
  const report = (ctx: ExtensionContext, messages?: unknown[]): void => {
    try {
      const usage = ctx.getContextUsage()
      const visible = messages ?? ctx.sessionManager.buildSessionProjection().messages
      const total = usage?.tokens
      const result = typeof total === 'number' && Number.isFinite(total)
        ? reconcileContextCategories(total, estimateContextCategories(visible))
        : { categories: [], calibrated: false }
      const snapshot = {
        sessionId: ctx.sessionManager.getSessionId(),
        modelKey: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
        contextWindow: usage?.contextWindow ?? null,
        totalTokens: total ?? null,
        capturedAt: Date.now(), estimated: true, ...result
      }
      writeFileSync(`${file}.tmp`, JSON.stringify(snapshot), { mode: 0o600 })
      renameSync(`${file}.tmp`, file)
    } catch { /* Diagnostics must never interrupt a request or session lifecycle. */ }
  }
  pi.on('session_start', (_event, ctx) => report(ctx))
  pi.on('agent_end', (_event, ctx) => report(ctx))
  pi.on('turn_end', (_event, ctx) => report(ctx))
  pi.on('session_compact', (_event, ctx) => report(ctx))
  pi.on('model_select', (_event, ctx) => report(ctx))
  pi.on('context_with_system', (event, ctx) => report(ctx, event.messages))
}
