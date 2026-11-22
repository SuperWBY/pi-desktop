import assert from 'node:assert/strict'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { hideInstallInstructions, readmeImageSources } from '../src/renderer/src/lib/package-readme.ts'
const markdown = `# Plugin

## Installation

Run this command.

\`\`\`bash
pi install npm:demo
\`\`\`

### Global
Still installation documentation.

## Features

Useful features.

## Quick Start

\`\`\`sh
pi install npm:demo
# configure
cat config.json
\`\`\`

\`\`\`json
{"server":"https://example.com"}
\`\`\`

## Features

More features.
`
const tree = unified().use(remarkParse).parse(markdown)
hideInstallInstructions()(tree)
const encoded = JSON.stringify(tree)
assert.ok(!encoded.includes('pi install'))
assert.ok(!encoded.includes('Still installation'))
assert.ok(encoded.includes('cat config.json'))
assert.ok(encoded.includes('https://example.com'))
const headings = tree.children.filter((node) => node.type === 'heading')
assert.deepEqual(headings.map((node) => node.data.hProperties.id), ['market-readme-plugin', 'market-readme-features', 'market-readme-quick-start', 'market-readme-features-1'])
console.log('✓ README removes installation instructions, preserves configuration, and assigns stable section anchors')

const nested = unified().use(remarkParse).parse('## Quick Start\n\n1. Install:\n\n   ```bash\n   pi install npm:demo\n   ```\n\n2. Configure:\n\n   ```json\n   {"extensions":["-builtin:mcp"]}\n   ```\n')
hideInstallInstructions()(nested)
assert.ok(!JSON.stringify(nested).includes('pi install'))
assert.ok(JSON.stringify(nested).includes('-builtin:mcp'))
console.log('✓ Nested quick-start installation commands are removed while compatibility configuration survives')

const imageContext = { baseUrl: 'https://cdn.jsdelivr.net/npm/demo@1.0.0/docs/', imageFallbackBaseUrl: 'https://raw.githubusercontent.com/example/demo/' + 'a'.repeat(40) + '/packages/demo/docs/' }
assert.deepEqual(readmeImageSources('../images/chart.svg', imageContext), ['https://cdn.jsdelivr.net/npm/demo@1.0.0/images/chart.svg', 'https://raw.githubusercontent.com/example/demo/' + 'a'.repeat(40) + '/packages/demo/images/chart.svg'])
assert.deepEqual(readmeImageSources('https://images.example.com/chart.png', imageContext), ['https://images.example.com/chart.png'])
assert.deepEqual(readmeImageSources('//images.example.com/chart.png', imageContext), ['https://images.example.com/chart.png'])
for (const src of ['javascript:alert(1)', 'file:///private/image.png', 'data:image/svg+xml,<svg/>', 'https://user:secret@example.com/image.png']) assert.deepEqual(readmeImageSources(src, imageContext), [])
assert.deepEqual(readmeImageSources('image.png', { baseUrl: imageContext.baseUrl }), ['https://cdn.jsdelivr.net/npm/demo@1.0.0/docs/image.png'])
console.log('✓ Relative image fallbacks preserve pinned monorepo paths, absolute URLs and safe protocols')

const pinnedRoot = {baseUrl:'https://cdn.jsdelivr.net/npm/demo@1.0.0/',imageFallbackBaseUrl:'https://raw.githubusercontent.com/example/demo/'+'a'.repeat(40)+'/'}
for(const src of ['../docs/graph.svg','%2e%2e/docs/graph.svg','../../other/graph.svg']) assert.equal(readmeImageSources(src,pinnedRoot).length,1)
console.log('✓ Repository image fallbacks cannot escape the selected commit root')
