import type { CSSProperties } from 'react'
import type { BookingLifecycle } from '@/lib/booking'

// Hvordan en booking SER UD. Farven er ressourcens kategori; status lægges
// ovenpå som behandling — fyldt, grøn kant, falmet, skraveret. Reglen bor her
// ét sted, fordi tidslinjens bjælker og kalenderens brikker skal kunne læses
// med de samme øjne.

export type BookingLook = {
  style: CSSProperties
  /** Fyldt bjælke: en grå badge oveni skal være mørk, ikke lys. */
  solid: boolean
  strike: boolean
}

const hatch = (color: string) =>
  `repeating-linear-gradient(135deg, color-mix(in oklab, ${color} 40%, transparent) 0 5px, transparent 5px 10px)`

export function bookingBarLook(
  stage: BookingLifecycle,
  c: { background: string; color: string },
): BookingLook {
  switch (stage) {
    case 'in_use':
      return {
        style: {
          background: c.background,
          color: c.color,
          boxShadow: 'inset 3px 0 0 0 var(--status-good), 0 0 0 1px var(--status-good)',
        },
        solid: true,
        strike: false,
      }
    case 'completed':
      return {
        style: {
          background: `color-mix(in oklab, ${c.background} 30%, transparent)`,
          color: 'var(--foreground)',
          boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${c.background} 45%, transparent)`,
        },
        solid: false,
        strike: false,
      }
    case 'invoiced':
      return {
        style: {
          backgroundImage: hatch(c.background),
          color: 'var(--foreground)',
          boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${c.background} 60%, transparent)`,
        },
        solid: false,
        strike: false,
      }
    case 'cancelled':
      return {
        style: {
          backgroundImage: hatch('var(--status-bad)'),
          color: 'var(--muted-foreground)',
          boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--status-bad) 55%, transparent)',
        },
        solid: false,
        strike: true,
      }
    default:
      return { style: { background: c.background, color: c.color }, solid: true, strike: false }
  }
}

/** Tekstfarven på et statusnavn — kun det, der kræver en handling, larmer. */
export function bookingStageTextClass(stage: BookingLifecycle): string {
  if (stage === 'cancelled') return 'text-status-bad'
  if (stage === 'in_use') return 'text-status-good'
  return 'text-muted-foreground'
}
