import wordmarkLight from '../assets/moka-wordmark-light.png'
import wordmarkDark from '../assets/moka-wordmark-dark.png'
import './Brand.css'

interface BrandWordmarkProps {
  className?: string
  /** 'light' = off-white logo for dark backgrounds (default); 'dark' = graphite logo. */
  variant?: 'light' | 'dark'
}

/** The official Moka & Co wordmark (extracted from the brand style sheet, unaltered). */
export function BrandWordmark({ className = '', variant = 'light' }: BrandWordmarkProps) {
  return (
    <img
      src={variant === 'dark' ? wordmarkDark : wordmarkLight}
      alt="Moka & Co"
      className={`brand-wordmark-img ${className}`.trim()}
      draggable={false}
    />
  )
}

/** The Moka & Co brand slogan. */
export function BrandSlogan({ className = '' }: { className?: string }) {
  return (
    <span className={`brand-slogan ${className}`.trim()}>Grounded in History.</span>
  )
}
