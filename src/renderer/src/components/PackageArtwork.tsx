import { useState, type ReactNode } from 'react'
import { Package } from 'lucide-react'
import { useTranslation } from '../i18n'

/** Match pi.dev's neutral grid placeholder; only published artwork represents a plugin. */
export function PackageArtwork(props: { src?: string | null; name: string }): ReactNode {
  return <ArtworkImage key={props.src || 'default'} {...props} />
}

function ArtworkImage({ src, name }: { src?: string | null; name: string }): ReactNode {
  const t = useTranslation()
  const [image, setImage] = useState<{ src: string; status: 'loaded' | 'error' } | null>(null)
  const loaded = Boolean(src && image?.src === src && image.status === 'loaded')
  const failed = Boolean(src && image?.src === src && image.status === 'error')
  return <div className="market-art" data-artwork={loaded ? 'image' : 'default'}>
    {!loaded && <div className="market-art-placeholder" role="img" aria-label={`${name} ${t('默认封面')}`}>
      <Package size={32} strokeWidth={1.25} aria-hidden="true" />
    </div>}
    {src && !failed && <img key={src} src={src} alt={`${name} ${t('插件图标')}`} aria-hidden={!loaded}
      className={loaded ? 'is-loaded' : undefined} referrerPolicy="no-referrer"
      onLoad={() => setImage({ src, status: 'loaded' })}
      onError={() => setImage({ src, status: 'error' })} />}
  </div>
}
