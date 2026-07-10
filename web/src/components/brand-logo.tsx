import logo from '@/assets/logo.png'
import { cn } from '@/lib/utils'

export function BrandLogo({ className }: { className?: string }) {
  return <img src={logo} alt="Operia" className={cn('rounded-full object-cover', className)} />
}
