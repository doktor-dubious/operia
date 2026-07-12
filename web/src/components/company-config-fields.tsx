import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ImageUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field as FieldBox,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CopyButton } from '@/components/copy-button'
import { Field } from '@/components/detail-field'
import { TimezonePicker } from '@/components/timezone-picker'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { CURRENCY_OPTIONS, currencyLabel } from '@/lib/currencies'
import { LANG_OPTIONS } from '@/lib/languages'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// Virksomhedens lokaliserings- og logo-felter — delt mellem Operia → Kunder
// (detaljepanelets faner, DCA redigerer en kunde) og Konfigurér-siderne
// (manager redigerer egen virksomhed). Komponenterne er rene formularfelter:
// tilstanden bor hos kalderen, som også ejer dirty-sporing og gem-bjælken.

// Stilletid vælges i halvtimes-trin (00:00–23:30). Radix Select tillader ikke
// tomme item-værdier, så "ingen" bruger en sentinel.
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0')
  return `${h}:${i % 2 ? '30' : '00'}`
})
const NONE = 'none'

function TimeSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  ariaLabel: string
}) {
  const { t } = useTranslation()
  // Værdier uden for halvtimes-rasteret (fx importeret "21:15") vises stadig.
  const options = !value || HALF_HOURS.includes(value) ? HALF_HOURS : [value, ...HALF_HOURS]
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)}>
      <SelectTrigger className="flex-1" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value={NONE}>{t('customerDetail.quietHoursNone')}</SelectItem>
        {options.map((time) => (
          <SelectItem key={time} value={time}>
            {time}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// Fjerner filer i virksomhedens logo-mappe — undtagen den fil keepUrl peger
// på. Bucket'en er offentlig, så udskiftede/fjernede logoer må ikke blive
// liggende tilgængelige (GDPR); kaldes efter gem og efter sletning af kunden.
export async function cleanupLogos(companyId: string, keepUrl: string | null) {
  const { data: files } = await supabase.storage.from('company-logos').list(companyId)
  if (!files?.length) return
  const stale = files
    .map((f) => `${companyId}/${f.name}`)
    .filter((path) => !keepUrl?.endsWith(path))
  if (stale.length) await supabase.storage.from('company-logos').remove(stale)
}

// Pakkeflowets to påmindelser (Notifikationer-siderne). Hver påmindelse kan
// slås fra; påmindelse 2 kan ikke stå alene og følger med når påmindelse 1
// deaktiveres. Påmindelse 2 holdes altid mindst én dag efter påmindelse 1.
// "Maks. påmindelser" gælder kun den sidste aktive påmindelsestype (den der
// gentages) — er begge aktive, sendes påmindelse 1 kun én gang.
export type ParcelFlowValue = {
  r1Enabled: boolean
  r2Enabled: boolean
  reminder1: number
  reminder2: number
  maxReminders: number
}

export function ParcelFlowFields({
  value,
  onChange,
}: {
  value: ParcelFlowValue
  onChange: (patch: Partial<ParcelFlowValue>) => void
}) {
  const { t } = useTranslation()
  const { r1Enabled, r2Enabled, reminder1, reminder2, maxReminders } = value

  // Samme boks-markering som standardsproget på Lokalisering.
  const box = (enabled: boolean) =>
    cn(
      'flex flex-col gap-3 rounded-lg border p-2.5',
      enabled && 'border-primary/30 bg-primary/5 dark:border-primary/20 dark:bg-primary/10',
    )

  return (
    <div className="flex flex-col gap-4">
      <div className={box(r1Enabled)}>
        <FieldLabel htmlFor="pf-reminder-1" className="font-normal">
          <Checkbox
            id="pf-reminder-1"
            checked={r1Enabled}
            onCheckedChange={(v) =>
              // Påmindelse 2 kan ikke stå alene — følger med fra.
              onChange(v === true ? { r1Enabled: true } : { r1Enabled: false, r2Enabled: false })
            }
          />
          <FieldTitle>{t('notificationsPage.reminder1')}</FieldTitle>
        </FieldLabel>
        {r1Enabled && (
          <div className="flex flex-col gap-2 pl-6">
            <Label className="text-label">{t('notificationsPage.sendAfterDays')}</Label>
            <Input
              type="number"
              min={1}
              value={reminder1}
              onChange={(e) => {
                const r1 = Math.max(1, Number(e.target.value) || 1)
                onChange({ reminder1: r1, reminder2: Math.max(r1 + 1, reminder2) })
              }}
            />
            <p className="text-xs text-muted-foreground">{t('notificationsPage.reminderHint')}</p>
          </div>
        )}
      </div>

      <div className={box(r2Enabled)}>
        <FieldLabel
          htmlFor="pf-reminder-2"
          className={cn('font-normal', !r1Enabled && 'opacity-50')}
        >
          <Checkbox
            id="pf-reminder-2"
            checked={r2Enabled}
            disabled={!r1Enabled}
            onCheckedChange={(v) => onChange({ r2Enabled: v === true })}
          />
          <FieldTitle>{t('notificationsPage.reminder2')}</FieldTitle>
        </FieldLabel>
        {r2Enabled && (
          <div className="flex flex-col gap-2 pl-6">
            <Label className="text-label">{t('notificationsPage.sendAfterDays')}</Label>
            <Input
              type="number"
              min={reminder1 + 1}
              value={reminder2}
              onChange={(e) =>
                onChange({
                  reminder2: Math.max(reminder1 + 1, Number(e.target.value) || reminder1 + 1),
                })
              }
            />
            <p className="text-xs text-muted-foreground">{t('notificationsPage.reminderHint')}</p>
          </div>
        )}
      </div>

      {(r1Enabled || r2Enabled) && (
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('notificationsPage.maxReminders')}</Label>
          <Input
            type="number"
            min={0}
            value={maxReminders}
            onChange={(e) => onChange({ maxReminders: Math.max(0, Number(e.target.value) || 0) })}
          />
          <p className="text-xs text-muted-foreground">
            {t('notificationsPage.maxRemindersHint')}
          </p>
        </div>
      )}
    </div>
  )
}

// Stilletid (bruges på Notifikationer-siderne under "Generelt").
export function QuietHoursField({
  start,
  end,
  onStartChange,
  onEndChange,
}: {
  start: string
  end: string
  onStartChange: (v: string) => void
  onEndChange: (v: string) => void
}) {
  const { t } = useTranslation()
  return (
    <Field label={t('customerDetail.quietHours')} info={t('customerDetail.quietHoursHint')}>
      <div className="flex items-center gap-2">
        <TimeSelect
          value={start}
          onChange={onStartChange}
          ariaLabel={t('customerDetail.quietHoursStart')}
        />
        <span className="text-muted-foreground">–</span>
        <TimeSelect
          value={end}
          onChange={onEndChange}
          ariaLabel={t('customerDetail.quietHoursEnd')}
        />
      </div>
    </Field>
  )
}

export type LocalizationValue = {
  supportedLangs: Set<string>
  defaultLang: string
  supportedCurrencies: Set<string>
  defaultCurrency: string
  timezone: string
}

export function CompanyLocalizationFields({
  value,
  onChange,
  idPrefix = 'company',
}: {
  value: LocalizationValue
  onChange: (patch: Partial<LocalizationValue>) => void
  idPrefix?: string
}) {
  const { t, i18n } = useTranslation()
  // Virksomhedens sprog- og valutavalg begrænses til platformens udvalg
  // (Operia → Lokalisering).
  const { data: platformSettings } = usePlatformSettings()
  const platformLangs = LANG_OPTIONS.filter((l) =>
    platformSettings?.supported_languages.includes(l.code),
  )
  const platformCurrencies = CURRENCY_OPTIONS.filter((c) =>
    platformSettings?.supported_currencies.includes(c.code),
  )
  const { supportedLangs, defaultLang, supportedCurrencies, defaultCurrency, timezone } = value

  const toggleSupported = (code: string, on: boolean) => {
    const next = new Set(supportedLangs)
    if (on) next.add(code)
    else next.delete(code)
    onChange({ supportedLangs: next })
  }

  const toggleCurrency = (code: string, on: boolean) => {
    const next = new Set(supportedCurrencies)
    if (on) next.add(code)
    else next.delete(code)
    onChange({ supportedCurrencies: next })
  }

  return (
    <div className="flex max-w-md flex-col gap-6">
      <Field label={t('customerDetail.supportedLanguages')}>
        <div className="flex flex-col gap-2">
          {platformLangs.map((l) =>
            l.code === defaultLang ? (
              // Standardsproget: FieldLabel-boksen markerer det, og
              // checkboksen er låst — det kan ikke fravælges.
              <FieldLabel key={l.code} htmlFor={`${idPrefix}-lang-${l.code}`}>
                <FieldBox orientation="horizontal">
                  <Checkbox id={`${idPrefix}-lang-${l.code}`} checked disabled />
                  <FieldContent>
                    <FieldTitle>{l.name}</FieldTitle>
                    <FieldDescription>{t('customerDetail.defaultMarker')}</FieldDescription>
                  </FieldContent>
                </FieldBox>
              </FieldLabel>
            ) : (
              <FieldLabel
                key={l.code}
                htmlFor={`${idPrefix}-lang-${l.code}`}
                className="px-2.5 py-1.5 font-normal"
              >
                <Checkbox
                  id={`${idPrefix}-lang-${l.code}`}
                  checked={supportedLangs.has(l.code)}
                  onCheckedChange={(v) => toggleSupported(l.code, v === true)}
                />
                {l.name}
              </FieldLabel>
            ),
          )}
        </div>
      </Field>
      <Field label={t('customerDetail.defaultLanguage')}>
        <RadioGroup
          value={defaultLang}
          onValueChange={(v) => onChange({ defaultLang: v })}
          className="gap-2"
        >
          {platformLangs.map((l) => (
            <FieldLabel
              key={l.code}
              htmlFor={`${idPrefix}-deflang-${l.code}`}
              className="px-2.5 py-1.5 font-normal"
            >
              <RadioGroupItem
                value={l.code}
                id={`${idPrefix}-deflang-${l.code}`}
                disabled={!supportedLangs.has(l.code)}
              />
              <span className={supportedLangs.has(l.code) ? undefined : 'text-muted-foreground'}>
                {l.name}
              </span>
            </FieldLabel>
          ))}
        </RadioGroup>
      </Field>
      <Field label={t('customerDetail.supportedCurrencies')}>
        <div className="flex flex-col gap-2">
          {platformCurrencies.map((c) =>
            c.code === defaultCurrency ? (
              // Standardvalutaen: boks-markering og låst — kan ikke fravælges.
              <FieldLabel key={c.code} htmlFor={`${idPrefix}-cur-${c.code}`}>
                <FieldBox orientation="horizontal">
                  <Checkbox id={`${idPrefix}-cur-${c.code}`} checked disabled />
                  <FieldContent>
                    <FieldTitle>{currencyLabel(c, i18n.language)}</FieldTitle>
                    <FieldDescription>
                      {t('customerDetail.currencyDefaultMarker')}
                    </FieldDescription>
                  </FieldContent>
                </FieldBox>
              </FieldLabel>
            ) : (
              <FieldLabel
                key={c.code}
                htmlFor={`${idPrefix}-cur-${c.code}`}
                className="px-2.5 py-1.5 font-normal"
              >
                <Checkbox
                  id={`${idPrefix}-cur-${c.code}`}
                  checked={supportedCurrencies.has(c.code)}
                  onCheckedChange={(v) => toggleCurrency(c.code, v === true)}
                />
                {currencyLabel(c, i18n.language)}
              </FieldLabel>
            ),
          )}
        </div>
      </Field>
      <Field label={t('customerDetail.defaultCurrency')}>
        <RadioGroup
          value={defaultCurrency}
          onValueChange={(v) => onChange({ defaultCurrency: v })}
          className="gap-2"
        >
          {platformCurrencies.map((c) => (
            <FieldLabel
              key={c.code}
              htmlFor={`${idPrefix}-defcur-${c.code}`}
              className="px-2.5 py-1.5 font-normal"
            >
              <RadioGroupItem
                value={c.code}
                id={`${idPrefix}-defcur-${c.code}`}
                disabled={!supportedCurrencies.has(c.code)}
              />
              <span
                className={supportedCurrencies.has(c.code) ? undefined : 'text-muted-foreground'}
              >
                {currencyLabel(c, i18n.language)}
              </span>
            </FieldLabel>
          ))}
        </RadioGroup>
      </Field>
      <Field label={t('customerDetail.timezone')}>
        <TimezonePicker value={timezone} onChange={(tz) => onChange({ timezone: tz })} />
      </Field>
    </div>
  )
}

export function CompanyLogoFields({
  companyId,
  logoUrl,
  onLogoUrlChange,
}: {
  companyId: string
  logoUrl: string
  onLogoUrlChange: (url: string) => void
}) {
  const { t } = useTranslation()
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Upload til den offentlige company-logos-bucket; den offentlige URL lægges
  // i logo-feltet, og selve gemningen sker via kalderens gem-bjælke.
  const uploadLogo = async (file: File) => {
    // Drag-and-drop omgår <input accept>, så filtypen tjekkes her.
    if (!file.type.startsWith('image/')) {
      toast.error(t('customerDetail.logoNotImage'))
      return
    }
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
    const path = `${companyId}/logo-${Date.now()}.${ext}`
    setUploading(true)
    const { error } = await supabase.storage.from('company-logos').upload(path, file, {
      upsert: true,
    })
    setUploading(false)
    if (error) {
      console.error('Kunne ikke uploade logo:', error)
      toast.error(t('common.error'))
      return
    }
    onLogoUrlChange(supabase.storage.from('company-logos').getPublicUrl(path).data.publicUrl)
  }

  return (
    <div className="flex flex-col gap-5">
      <Field label={`${t('customerDetail.logoUrl')} (${t('customerDetail.optional')})`}>
        <div className="relative">
          <Input
            value={logoUrl}
            placeholder="https://…/logo.png"
            className={logoUrl ? 'pr-10' : undefined}
            onChange={(e) => onLogoUrlChange(e.target.value)}
          />
          {logoUrl && (
            <div className="absolute right-1 top-1/2 -translate-y-1/2">
              <CopyButton value={logoUrl} label={t('customerDetail.copyLogoUrl')} />
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t('customerDetail.logoHint')}</p>
      </Field>
      {/* Dropzone som på Import → Lokale filer: træk-og-slip eller klik */}
      <div className="flex max-w-2xl flex-col gap-2">
        <button
          type="button"
          disabled={uploading}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border p-10 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground-light disabled:cursor-default disabled:opacity-60"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const file = e.dataTransfer.files?.[0]
            if (file) uploadLogo(file)
          }}
        >
          <ImageUp className="size-6" />
          <span className="text-[13px]">
            {uploading ? t('common.loading') : t('customerDetail.logoDropHint')}
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) uploadLogo(file)
            e.target.value = ''
          }}
        />
      </div>
      <Field label={t('customerDetail.logoPreview')}>
        {logoUrl ? (
          <>
            <div className="flex h-24 items-center justify-center rounded-md border bg-muted/30 p-3">
              <img src={logoUrl} alt="Logo" className="max-h-full max-w-full object-contain" />
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => onLogoUrlChange('')}
            >
              {t('customerDetail.removeLogo')}
            </Button>
          </>
        ) : (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            {t('customerDetail.logoEmpty')}
          </p>
        )}
      </Field>
    </div>
  )
}
