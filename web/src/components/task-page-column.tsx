import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Fast opgaveside-kolonne: alle scan-/flow-sider (Modtag, Udlever, Flyt, Søg,
// tavle-overblik, …) deler samme centrerede maks-bredde med venstrestillet
// indhold, så siden ikke hopper vandret, når man skifter mellem dem. Nye
// opgavesider skal bruge denne — også om loading-/tomtilstande, så skelettet
// står præcis hvor den færdige side ender med at stå.
export function TaskPageColumn({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('mx-auto w-full max-w-6xl', className)}>{children}</div>
}
