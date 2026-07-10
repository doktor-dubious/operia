import { Boxes } from 'lucide-react'
import { cn } from '@/lib/utils'

// Brandmærke. (Puma-logoet fra /home/rune/Downloads/operia/logo.png blev
// prøvet og rullet tilbage 2026-07-10 — komponenten er stedet at skifte,
// hvis et nyt logo skal ind.)
export function BrandLogo({ className }: { className?: string }) {
  return <Boxes className={cn('text-primary', className)} />
}
