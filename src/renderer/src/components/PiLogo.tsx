import type { ReactNode } from 'react'

/**
 * pi's brand mark (https://pi.dev/logo-auto.svg), used in the app chrome so
 * Pi Desktop reads as the same product as pi itself.
 */
export function PiLogo({
  size = 16,
  className
}: {
  size?: number
  className?: string
}): ReactNode {
  return (
    <svg
      viewBox="0 0 800 800"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="pi"
    >
      <path fill="#F09082" d="M165.29 165.29H517.36V400H400V282.65H165.29Z" />
      <path fill="#4D9ABF" d="M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z" />
      <path fill="#F1BE58" d="M517.36 400H634.72V634.72H517.36Z" />
    </svg>
  )
}
