import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
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
import { Field } from '@/components/detail-field'
import { TimezonePicker } from '@/components/timezone-picker'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { CURRENCY_OPTIONS, currencyLabel } from '@/lib/currencies'
import { LANG_OPTIONS } from '@/lib/languages'
import { cn } from '@/lib/utils'

// Virksomhedens lokaliseringsfelter — delt mellem Operia → Kunder
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

// Statusbeskedens standard-tidspunkt (samme default som platform_settings).
export const DEFAULT_STATUS_TIME = '13:00'

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

// Pakkeflowet har derudover ankomstbeskeden (sendes når pakken registreres) og
// statusbeskeden (dagligt sammendrag på et fast klokkeslæt) — aktiv-varianten
// har ingen af delene og bruger ParcelFlowValue alene.
export type ParcelNotifyValue = ParcelFlowValue & {
  arrivalEnabled: boolean
  statusEnabled: boolean
  statusTime: string
}

// Tekster der adskiller pakke- fra aktiv-varianten (kun hint/labels; selve
// felterne og reglerne er ens).
type ReminderTexts = {
  sendAfter: string
  hint: string
  maxHint: string
}

// Generisk to-påmindelses-editor. idPrefix holder checkbox-id'erne unikke, når
// begge varianter (pakke + aktiv) findes på samme side.
function ReminderFlowFields({
  value,
  onChange,
  texts,
  idPrefix,
}: {
  value: ParcelFlowValue
  onChange: (patch: Partial<ParcelFlowValue>) => void
  texts: ReminderTexts
  idPrefix: string
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
        <FieldLabel htmlFor={`${idPrefix}-reminder-1`} className="font-normal">
          <Checkbox
            id={`${idPrefix}-reminder-1`}
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
            <Label className="text-label">{texts.sendAfter}</Label>
            <Input
              type="number"
              min={1}
              value={reminder1}
              onChange={(e) => {
                const r1 = Math.max(1, Number(e.target.value) || 1)
                onChange({ reminder1: r1, reminder2: Math.max(r1 + 1, reminder2) })
              }}
            />
            <p className="text-xs text-muted-foreground">{texts.hint}</p>
          </div>
        )}
      </div>

      <div className={box(r2Enabled)}>
        <FieldLabel
          htmlFor={`${idPrefix}-reminder-2`}
          className={cn('font-normal', !r1Enabled && 'opacity-50')}
        >
          <Checkbox
            id={`${idPrefix}-reminder-2`}
            checked={r2Enabled}
            disabled={!r1Enabled}
            onCheckedChange={(v) => onChange({ r2Enabled: v === true })}
          />
          <FieldTitle>{t('notificationsPage.reminder2')}</FieldTitle>
        </FieldLabel>
        {r2Enabled && (
          <div className="flex flex-col gap-2 pl-6">
            <Label className="text-label">{texts.sendAfter}</Label>
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
            <p className="text-xs text-muted-foreground">{texts.hint}</p>
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
          <p className="text-xs text-muted-foreground">{texts.maxHint}</p>
        </div>
      )}
    </div>
  )
}

// statusTest: valgfri testknap i statusbesked-boksen. Kun virksomhedssiden har
// den (der findes en konkret modtagerliste at teste med) — platformsiden sætter
// kun standarderne og lader den være tom.
export function ParcelFlowFields({
  value,
  onChange,
  statusTest,
}: {
  value: ParcelNotifyValue
  onChange: (patch: Partial<ParcelNotifyValue>) => void
  statusTest?: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4">
      <div
        className={cn(
          'flex flex-col gap-3 rounded-lg border p-2.5',
          value.arrivalEnabled &&
            'border-primary/30 bg-primary/5 dark:border-primary/20 dark:bg-primary/10',
        )}
      >
        <FieldLabel htmlFor="pf-arrival" className="font-normal">
          <Checkbox
            id="pf-arrival"
            checked={value.arrivalEnabled}
            onCheckedChange={(v) => onChange({ arrivalEnabled: v === true })}
          />
          <FieldTitle>{t('notificationsPage.arrival')}</FieldTitle>
        </FieldLabel>
        <p className="pl-6 text-xs text-muted-foreground">
          {t('notificationsPage.arrivalHint')}
        </p>
      </div>

      <div
        className={cn(
          'flex flex-col gap-3 rounded-lg border p-2.5',
          value.statusEnabled &&
            'border-primary/30 bg-primary/5 dark:border-primary/20 dark:bg-primary/10',
        )}
      >
        <FieldLabel htmlFor="pf-status" className="font-normal">
          <Checkbox
            id="pf-status"
            checked={value.statusEnabled}
            onCheckedChange={(v) => onChange({ statusEnabled: v === true })}
          />
          <FieldTitle>{t('notificationsPage.status')}</FieldTitle>
        </FieldLabel>
        <p className="pl-6 text-xs text-muted-foreground">{t('notificationsPage.statusHint')}</p>
        {value.statusEnabled && (
          <div className="flex flex-col gap-2 pl-6">
            <Label htmlFor="pf-status-time" className="text-label">
              {t('notificationsPage.statusTime')}
            </Label>
            <Input
              id="pf-status-time"
              type="time"
              step={60}
              className="w-40"
              value={value.statusTime}
              // Tomt felt (browseren tillader det) må ikke slå tidspunktet ud —
              // fald tilbage til standarden.
              onChange={(e) => onChange({ statusTime: e.target.value || DEFAULT_STATUS_TIME })}
            />
            <p className="text-xs text-muted-foreground">{t('notificationsPage.statusTimeHint')}</p>
          </div>
        )}
        {statusTest && <div className="pl-6">{statusTest}</div>}
      </div>

      <ReminderFlowFields
        value={value}
        onChange={onChange}
        idPrefix="pf"
        texts={{
          sendAfter: t('notificationsPage.sendAfterDays'),
          hint: t('notificationsPage.reminderHint'),
          maxHint: t('notificationsPage.maxRemindersHint'),
        }}
      />
    </div>
  )
}

// Aktiv-påmindelser: samme felter, men forankret på udlånets udløb. Den første
// besked sendes på udløbsdagen; disse to påmindelser følger et antal dage efter.
export function AssetFlowFields(props: {
  value: ParcelFlowValue
  onChange: (patch: Partial<ParcelFlowValue>) => void
}) {
  const { t } = useTranslation()
  return (
    <ReminderFlowFields
      {...props}
      idPrefix="af"
      texts={{
        sendAfter: t('notificationsPage.assetSendAfterDays'),
        hint: t('notificationsPage.assetReminderHint'),
        maxHint: t('notificationsPage.assetMaxRemindersHint'),
      }}
    />
  )
}

// Kanalvalg (Generelt-sektionen): e-mail og/eller SMS. Gælder alle
// notifikationstyper. SMS kræver desuden sms_notifications-feature pr. kunde.
export function ChannelToggles({
  email,
  sms,
  onEmailChange,
  onSmsChange,
}: {
  email: boolean
  sms: boolean
  onEmailChange: (v: boolean) => void
  onSmsChange: (v: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <Field label={t('notificationsPage.channels')} info={t('notificationsPage.channelsHint')}>
      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor="ch-email" className="px-2.5 py-1.5 font-normal">
          <Checkbox
            id="ch-email"
            checked={email}
            onCheckedChange={(v) => onEmailChange(v === true)}
          />
          {t('notificationsPage.channelEmail')}
        </FieldLabel>
        <FieldLabel htmlFor="ch-sms" className="px-2.5 py-1.5 font-normal">
          <Checkbox id="ch-sms" checked={sms} onCheckedChange={(v) => onSmsChange(v === true)} />
          {t('notificationsPage.channelSms')}
        </FieldLabel>
      </div>
    </Field>
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
