import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { itemLabel, normVat, useAccountingItems, type AccountingItemKind } from '@/hooks/use-accounting-items'
import type { AccountingProvider } from '@/lib/accounting'
import { cn } from '@/lib/utils'

// Feltet "Produktnr. i <regnskabssystem>" på ydelse, kategori og niveau.
//
// En søgbar liste fra regnskabssystemets egen produktliste, så et nummer, der
// ikke findes, ikke kan tastes — den fejl ville ellers først vise sig ved
// overførslen, på en kladde, langt fra den ydelse, den kom af. Listen kan
// have hundredvis af produkter (edge-funktionen henter alle sider), derfor
// søgning og ikke en rulleliste. Kan listen ikke hentes, falder feltet
// tilbage på fritekst og siger det: siden skal kunne bruges, selv om
// regnskabssystemet er nede.
//
// Tomt = "standard": typeproduktet fra mapningen. Et valgt produkt ERSTATTER
// det for linjen — konto og moms følger produktet. Derfor følger momskoden
// med: vælges et produkt, sættes Operias momskode til den, produktet giver
// (onChange's andet argument), og afviger den, siges det under feltet.
//
// compact: uden label og forklaring, til en række i en tabel (niveaulisten);
// afvigelsen vises da som ravgul kant + title.

export function AccountingItemField({
  companyId,
  provider,
  kind,
  value,
  onChange,
  vatCode,
  hint,
  id,
  className,
  compact = false,
}: {
  companyId: string | null
  provider: AccountingProvider
  kind: AccountingItemKind
  value: string
  /** Produktet — og produktets momskode, når den er kendt, så begge kan gemmes i ét skriv. */
  onChange: (v: string, vatCode?: string) => void
  /** Operias momskode på tingen — til at vise en afvigelse fra produktet. */
  vatCode?: string
  hint?: string
  id?: string
  className?: string
  compact?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data, isError, isPending } = useAccountingItems(companyId, true)
  const label = t('economicMapping.itemProduct', { provider: provider.label })
  const wrap = className ?? (compact ? 'contents' : 'flex flex-col gap-2')

  // Listen hentet: søgbar vælger. Et gemt nummer, listen ikke kender (slettet
  // i regnskabet), vises stadig — markeret — så det kan ses og fjernes.
  if (data && !isError) {
    const { items, defaults } = data
    const byNo = new Map(items.map((i) => [i.number, i]))
    const known = byNo.has(value)
    const effective = byNo.get(value || (defaults[kind] ?? ''))
    const def = defaults[kind] ? byNo.get(defaults[kind]!) : undefined
    const differs = vatCode !== undefined && effective?.vatCode != null && normVat(vatCode) !== normVat(effective.vatCode)
    const differsText = differs
      ? t('economicMapping.vatDiffers', { operia: vatCode || '—', economic: effective!.vatCode || t('economicMapping.vatNone'), provider: provider.label })
      : undefined
    const pick = (next: string) => {
      const p = byNo.get(next || (defaults[kind] ?? ''))
      onChange(next, p && p.vatCode !== null ? p.vatCode : undefined)
      setOpen(false)
    }
    const defaultLabel = compact
      ? t('economicMapping.itemDefaultShort')
      : def ? t('economicMapping.itemDefaultWith', { product: itemLabel(def, t) }) : t('economicMapping.itemDefault')
    const current = !value ? defaultLabel
      : known ? itemLabel(byNo.get(value)!, t)
      : `${value} · ${t('economicMapping.itemUnknown', { provider: provider.label })}`
    const picker = (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label={compact ? label : undefined}
            title={compact ? differsText : undefined}
            className={cn('justify-between gap-1.5 font-normal', compact ? 'w-44' : 'w-96 max-w-full', differs && compact && 'border-amber-500')}
          >
            <span className={cn('truncate', !value && 'text-muted-foreground')}>{current}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] p-0">
          <Command>
            <CommandInput placeholder={t('economicMapping.itemSearch')} />
            <CommandList>
              <CommandEmpty>{t('economicMapping.itemNoMatch')}</CommandEmpty>
              <CommandGroup>
                <CommandItem value="__default__" onSelect={() => pick('')} className="gap-2">
                  <Check className={cn('size-3.5 shrink-0', !value ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{def ? t('economicMapping.itemDefaultWith', { product: itemLabel(def, t) }) : t('economicMapping.itemDefault')}</span>
                </CommandItem>
                {value && !known && (
                  <CommandItem value={`__unknown__ ${value}`} onSelect={() => pick(value)} className="gap-2">
                    <Check className="size-3.5 shrink-0 opacity-100" />
                    <span className="truncate text-muted-foreground">{value} · {t('economicMapping.itemUnknown', { provider: provider.label })}</span>
                  </CommandItem>
                )}
                {items.map((i) => (
                  <CommandItem key={i.number} value={`${i.number} ${i.name}`} onSelect={() => pick(i.number)} className="gap-2">
                    <Check className={cn('size-3.5 shrink-0', value === i.number ? 'opacity-100' : 'opacity-0')} />
                    <span className="truncate">{itemLabel(i, t)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    )
    if (compact) return picker
    return (
      <div className={wrap}>
        <Label htmlFor={id} className="text-label">{label}</Label>
        {picker}
        {differs && <p className="text-xs text-amber-600 dark:text-amber-400">{differsText}</p>}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    )
  }

  // Listen kunne ikke hentes (eller hentes stadig): fritekst, med besked.
  const unavailable = isPending ? t('common.loading') : t('economicMapping.itemListUnavailable', { provider: provider.label })
  if (compact) {
    return (
      <Input
        id={id}
        key={value}
        defaultValue={value}
        maxLength={25}
        className="w-44"
        placeholder={t('economicMapping.itemProductPlaceholder')}
        aria-label={label}
        title={unavailable}
        onBlur={(e) => { if (e.target.value !== value) onChange(e.target.value) }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      />
    )
  }
  return (
    <div className={wrap}>
      <Label htmlFor={id} className="text-label">{label}</Label>
      <Input
        id={id}
        value={value}
        maxLength={25}
        className="w-44"
        placeholder={t('economicMapping.itemProductPlaceholder')}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        {unavailable}
        {hint ? ` ${hint}` : ''}
      </p>
    </div>
  )
}
