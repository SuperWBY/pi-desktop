const MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.html': 'text/html',
  '.htm': 'text/html'
}

export function mediaMimeType(path: string): string | undefined {
  const extension = /\.[a-z\d]+$/i.exec(path)?.[0]
  return extension ? MEDIA_TYPES[extension.toLowerCase()] : undefined
}
