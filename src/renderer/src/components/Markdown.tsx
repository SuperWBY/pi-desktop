import { useTranslation } from '../i18n'
import { memo, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy } from 'lucide-react'
import { useApp } from '../store'

function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (typeof node === 'object' && 'props' in (node as object)) {
    return nodeText((node as { props?: { children?: ReactNode } }).props?.children)
  }
  return ''
}

export function CopyButton({ text, label }: { text: string; label?: string }): ReactNode {
  const t = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="copy-button"
      aria-label={label ?? t('Copy')}
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {label && <span>{copied ? t("Copied") : label}</span>}
    </button>
  )
}

export const Markdown = memo(function Markdown({ children }: { children: string }): ReactNode {
  const { actions } = useApp()

  const components: Components = {
    pre: ({ children }) => {
      const first = Array.isArray(children) ? children[0] : children
      const className =
        (first as { props?: { className?: string } } | undefined)?.props?.className ?? ''
      const language = /language-([\w+-]+)/.exec(className)?.[1]
      const text = nodeText(children)
      return (
        <div className="code-block">
          <div className="code-head">
            <span>{language ?? 'plain'}</span>
            <CopyButton text={text} />
          </div>
          <pre>{children}</pre>
        </div>
      )
    },
    code: ({ className, children }) => {
      const isBlock = typeof className === 'string' && className.includes('language-')
      if (isBlock) return <code className={className}>{children}</code>
      return <code className="inline-code">{children}</code>
    },
    a: ({ href, children }) => (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault()
          if (href) actions.openExternal(href)
        }}
      >
        {children}
      </a>
    ),
    table: ({ children }) => (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    ),
    img: ({ src, alt }) => <img className="md-image" src={src} alt={alt ?? ''} />
  }

  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
})
