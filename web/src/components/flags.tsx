import { cn } from '@/lib/utils'

// Små flag-ikoner til sprogvælgere (dansk først, engelsk).
export function DanishFlag({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 12" className={cn('shrink-0 rounded-[2px]', className)} aria-hidden>
      <rect width="16" height="12" fill="#C8102E" />
      <rect x="5" width="2" height="12" fill="#fff" />
      <rect y="5" width="16" height="2" fill="#fff" />
    </svg>
  )
}

export function BritishFlag({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 40" className={cn('shrink-0 rounded-[2px]', className)} aria-hidden>
      <rect width="60" height="40" fill="#012169" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#fff" strokeWidth="8" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#C8102E" strokeWidth="3.2" />
      <path d="M30,0 V40 M0,20 H60" stroke="#fff" strokeWidth="13" />
      <path d="M30,0 V40 M0,20 H60" stroke="#C8102E" strokeWidth="8" />
    </svg>
  )
}
