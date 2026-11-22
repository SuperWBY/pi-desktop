import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { renderSvgPreview } from './artifact-preview.ts'

export default function artifactPreviewExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'preview_svg', label: '查看 SVG',
    description: 'Render a self-contained local SVG as an image for visual inspection. Read-only: the original file is not modified. macOS only.',
    parameters: Type.Object({ path: Type.String({ description: 'Local SVG path, absolute or relative to the current workspace.' }) }),
    async execute(_id, params, signal, _update, ctx) {
      try {
        const image = await renderSvgPreview(params.path, ctx.cwd, signal)
        return { content: [{ type: 'text', text: 'SVG preview rendered successfully.' }, { type: 'image', data: image.toString('base64'), mimeType: 'image/png' }], details: {} }
      } catch (error) {
        throw new Error(`SVG preview failed: ${error instanceof Error ? error.message : String(error)}. Check SVG syntax or unsupported external resources; do not repeatedly retry the same failure.`)
      }
    }
  })
}
