import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { FLEXOKI_SWATCHES } from '@/lib/flexoki'

// Let farvevælger: flexoki-swatches + brugerdefineret hex (solid) eller en
// simpel 2-stops lineær gradient. Værdien er enten en hex-streng eller
// 'linear-gradient(<deg>deg, <hex>, <hex>)'.

const isHex = (v: string) => /^#[0-9a-fA-F]{3,8}$/.test(v)

function parseGradient(v: string): { angle: number; from: string; to: string } | null {
  const m = v.match(
    /^linear-gradient\((\d+)deg,\s*(#[0-9a-fA-F]{3,8})\s*,\s*(#[0-9a-fA-F]{3,8})\)$/,
  )
  return m ? { angle: parseInt(m[1], 10), from: m[2], to: m[3] } : null
}

export function ColorPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (v: string) => void
}) {
  const { t } = useTranslation()
  const grad = value ? parseGradient(value) : null
  const [mode, setMode] = useState<'solid' | 'gradient'>(grad ? 'gradient' : 'solid')

  const solid = value && isHex(value) ? value : '#4385BE'
  const from = grad?.from ?? '#4385BE'
  const to = grad?.to ?? '#8B7EC8'
  const angle = grad?.angle ?? 135
  const preview = value || solid

  const setGrad = (next: { angle?: number; from?: string; to?: string }) =>
    onChange(
      `linear-gradient(${next.angle ?? angle}deg, ${next.from ?? from}, ${next.to ?? to})`,
    )

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-9 w-full justify-start gap-2 font-normal"
        >
          <span className="size-5 shrink-0 rounded border" style={{ background: preview }} />
          <span className="truncate text-xs text-muted-foreground">
            {value ?? t('colorPicker.none')}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <div className="flex gap-1 rounded-md bg-muted p-0.5 text-xs">
          {(['solid', 'gradient'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m)
                if (m === 'solid') onChange(solid)
                else setGrad({})
              }}
              className={cn(
                'flex-1 rounded px-2 py-1 transition-colors',
                mode === m ? 'bg-background shadow-sm' : 'text-muted-foreground',
              )}
            >
              {t(`colorPicker.${m}`)}
            </button>
          ))}
        </div>

        {mode === 'solid' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-7 gap-1.5">
              {FLEXOKI_SWATCHES.map((s) => (
                <button
                  key={s.hex}
                  type="button"
                  title={s.name}
                  onClick={() => onChange(s.hex)}
                  className={cn(
                    'size-6 rounded border',
                    solid.toLowerCase() === s.hex.toLowerCase() &&
                      'ring-2 ring-ring ring-offset-1',
                  )}
                  style={{ background: s.hex }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={isHex(solid) ? solid : '#4385BE'}
                onChange={(e) => onChange(e.target.value)}
                className="h-8 w-10 cursor-pointer rounded border bg-transparent"
              />
              <Input
                value={solid}
                onChange={(e) => onChange(e.target.value)}
                className="h-8 font-mono text-xs"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div
              className="h-10 rounded border"
              style={{ background: `linear-gradient(${angle}deg, ${from}, ${to})` }}
            />
            {(
              [
                ['from', from],
                ['to', to],
              ] as const
            ).map(([key, hex]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="w-10 text-xs text-muted-foreground">{t(`colorPicker.${key}`)}</span>
                <input
                  type="color"
                  value={hex}
                  onChange={(e) => setGrad({ [key]: e.target.value })}
                  className="h-8 w-10 cursor-pointer rounded border bg-transparent"
                />
                <Input
                  value={hex}
                  onChange={(e) => setGrad({ [key]: e.target.value })}
                  className="h-8 font-mono text-xs"
                />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="w-10 text-xs text-muted-foreground">{t('colorPicker.angle')}</span>
              <input
                type="range"
                min={0}
                max={360}
                value={angle}
                onChange={(e) => setGrad({ angle: parseInt(e.target.value, 10) })}
                className="flex-1"
              />
              <span className="w-9 text-right text-xs tabular-nums">{angle}°</span>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
