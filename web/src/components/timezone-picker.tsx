import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronsUpDown, LocateFixed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

// Tidszonevælger efter shadcn.io's "timezone picker"-mønster, men som
// combobox: en knap viser den valgte zone + UTC-offset; klik åbner en søgbar
// popover forankret under feltet med alle IANA-zoner grupperet pr. region,
// live klokkeslæt for den valgte zone og et punkt der auto-detekterer
// enhedens tidszone.

function utcOffset(tz: string): string {
  try {
    return (
      new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'longOffset' })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName')
        ?.value.replace('GMT', 'UTC') ?? ''
    )
  } catch {
    return ''
  }
}

// Offsets for ~430 zoner koster et par hundrede ms at beregne — gør det én
// gang (ved første åbning) og genbrug på tværs af komponenter.
let zoneCache: { region: string; zones: { tz: string; offset: string }[] }[] | null = null

function getZones() {
  if (!zoneCache) {
    const groups = new Map<string, { tz: string; offset: string }[]>()
    for (const tz of Intl.supportedValuesOf('timeZone')) {
      const region = tz.includes('/') ? tz.split('/')[0] : 'UTC'
      const group = groups.get(region) ?? []
      if (!groups.has(region)) groups.set(region, group)
      group.push({ tz, offset: utcOffset(tz) })
    }
    zoneCache = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([region, zones]) => ({ region, zones }))
  }
  return zoneCache
}

export function TimezonePicker({
  value,
  onChange,
}: {
  value: string
  onChange: (tz: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const groups = useMemo(() => (open ? getZones() : []), [open])
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  // Live klokkeslæt for den valgte zone, mens dialogen er åben.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!open) return
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [open])

  const localTime = (tz: string) => {
    try {
      return new Intl.DateTimeFormat(undefined, { timeZone: tz, timeStyle: 'medium' }).format(now)
    } catch {
      return ''
    }
  }

  const pick = (tz: string) => {
    onChange(tz)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{value || t('timezonePicker.placeholder')}</span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {value ? utcOffset(value) : null}
            <ChevronsUpDown className="size-3.5" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0"
      >
        <Command>
          <CommandInput placeholder={t('timezonePicker.searchPlaceholder')} />
          {value && (
            <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
              <span className="truncate">{value}</span>
              <span className="font-mono tabular-nums">{localTime(value)}</span>
            </div>
          )}
          <CommandList className="max-h-72">
            <CommandEmpty>{t('timezonePicker.empty')}</CommandEmpty>
            <CommandGroup>
              <CommandItem value={`auto ${deviceZone}`} onSelect={() => pick(deviceZone)}>
                <LocateFixed className="size-4" />
                <span>{t('timezonePicker.autoDetect')}</span>
                <span className="ml-auto text-xs text-muted-foreground">{deviceZone}</span>
              </CommandItem>
            </CommandGroup>
            {groups.map((group) => (
              <CommandGroup key={group.region} heading={group.region}>
                {group.zones.map(({ tz, offset }) => (
                  <CommandItem
                    key={tz}
                    value={tz}
                    keywords={[tz.replaceAll('/', ' ').replaceAll('_', ' '), offset]}
                    onSelect={() => pick(tz)}
                  >
                    <span className="truncate">{tz}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{offset}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
