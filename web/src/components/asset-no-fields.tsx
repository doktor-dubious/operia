import { useTranslation } from 'react-i18next'
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

// Nummerserien for Aktiv-nr. — de samme felter på Konfigurér → Aktivdata
// (kundens egen serie) og Operia → Aktivdata (platformens standard for nye
// kunder). Serverens next_asset_no er facit; felterne her er kun valget.

export type AssetNoType = 'uuid' | 'sequential'

export type AssetNoValue = {
  type: AssetNoType
  prefix: string
  // Fast længde som tekst, så feltet kan stå tomt ("ingen polstring") uden at
  // skulle jonglere med null i en talinput.
  length: string
}

export const MAX_PREFIX_LENGTH = 16
export const MIN_FIXED_LENGTH = 1
export const MAX_FIXED_LENGTH = 12

// Spejler serverens kolonne-checks, så en ulovlig værdi fanges før gemmet.
export function assetNoError(value: AssetNoValue): 'prefixTooLong' | 'lengthInvalid' | null {
  if (value.type !== 'sequential') return null
  if (value.prefix.length > MAX_PREFIX_LENGTH) return 'prefixTooLong'
  if (value.length.trim() === '') return null
  const n = Number(value.length)
  if (!Number.isInteger(n) || n < MIN_FIXED_LENGTH || n > MAX_FIXED_LENGTH) return 'lengthInvalid'
  return null
}

// Hvordan det n'te nummer kommer til at se ud. Bruges til eksempellinjen —
// UUID'er er tilfældige, så dér vises en fast prøve i stedet for en ny hver
// gang komponenten tegnes.
const SAMPLE_UUIDS = [
  '3f2b8c14-7a91-4d6e-b0c5-1e8d9a24f7b3',
  '9c47e6a0-2d15-4b83-8f6a-5c0e71b9d248',
]

export function assetNoSamples(value: AssetNoValue): string[] {
  if (value.type === 'uuid') return SAMPLE_UUIDS
  const width = Number(value.length)
  const pad = (n: number) =>
    Number.isInteger(width) && width >= MIN_FIXED_LENGTH && width <= MAX_FIXED_LENGTH
      ? String(n).padStart(width, '0')
      : String(n)
  return [1, 2, 42].map((n) => `${value.prefix}${pad(n)}`)
}

// DB-rækkens tre kolonner ⇄ formularens værdi.
export function toAssetNoValue(row: {
  asset_no_type: string
  asset_no_prefix: string
  asset_no_length: number | null
}): AssetNoValue {
  return {
    type: row.asset_no_type === 'sequential' ? 'sequential' : 'uuid',
    prefix: row.asset_no_prefix,
    length: row.asset_no_length == null ? '' : String(row.asset_no_length),
  }
}

export function fromAssetNoValue(value: AssetNoValue) {
  const sequential = value.type === 'sequential'
  const length = Number(value.length)
  return {
    asset_no_type: value.type,
    // UUID-serien har hverken præfiks eller længde — nulstil dem, så en
    // gemt-og-skiftet konfiguration ikke efterlader døde værdier i basen.
    asset_no_prefix: sequential ? value.prefix : '',
    asset_no_length: sequential && value.length.trim() !== '' && Number.isInteger(length)
      ? length
      : null,
  }
}

export function assetNoKey(value: AssetNoValue): string {
  const normalized = fromAssetNoValue(value)
  return [normalized.asset_no_type, normalized.asset_no_prefix, normalized.asset_no_length].join('|')
}

export function AssetNoFields({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string
  value: AssetNoValue
  onChange: (patch: Partial<AssetNoValue>) => void
}) {
  const { t } = useTranslation()
  const error = assetNoError(value)
  const samples = assetNoSamples(value)

  return (
    <div className="flex flex-col gap-8">
      <section className="flex max-w-md flex-col gap-3">
        <div>
          <Label className="text-label">{t('assetDataConfig.typeTitle')}</Label>
          <p className="mt-1 text-xs text-muted-foreground">{t('assetDataConfig.typeHint')}</p>
        </div>
        <RadioGroup
          value={value.type}
          onValueChange={(v) => onChange({ type: v as AssetNoType })}
          className="gap-2"
        >
          <FieldLabel htmlFor={`${idPrefix}-asset-no-uuid`}>
            <Field orientation="horizontal">
              <RadioGroupItem value="uuid" id={`${idPrefix}-asset-no-uuid`} />
              <FieldContent>
                <FieldTitle>{t('assetDataConfig.typeUuid')}</FieldTitle>
                <FieldDescription>{t('assetDataConfig.typeUuidHint')}</FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
          <FieldLabel htmlFor={`${idPrefix}-asset-no-sequential`}>
            <Field orientation="horizontal">
              <RadioGroupItem value="sequential" id={`${idPrefix}-asset-no-sequential`} />
              <FieldContent>
                <FieldTitle>{t('assetDataConfig.typeSequential')}</FieldTitle>
                <FieldDescription>{t('assetDataConfig.typeSequentialHint')}</FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
        </RadioGroup>
      </section>

      {value.type === 'sequential' && (
        <section className="flex max-w-md flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-asset-no-prefix`} className="text-label">
              {t('assetDataConfig.prefix')}
            </Label>
            <Input
              id={`${idPrefix}-asset-no-prefix`}
              value={value.prefix}
              className="font-mono"
              maxLength={MAX_PREFIX_LENGTH}
              placeholder={t('assetDataConfig.prefixPlaceholder')}
              aria-invalid={error === 'prefixTooLong'}
              onChange={(e) => onChange({ prefix: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t('assetDataConfig.prefixHint')}</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-asset-no-length`} className="text-label">
              {t('assetDataConfig.fixedLength')}
            </Label>
            <Input
              id={`${idPrefix}-asset-no-length`}
              value={value.length}
              type="number"
              min={MIN_FIXED_LENGTH}
              max={MAX_FIXED_LENGTH}
              className="max-w-32 font-mono"
              placeholder={t('assetDataConfig.fixedLengthPlaceholder')}
              aria-invalid={error === 'lengthInvalid'}
              onChange={(e) => onChange({ length: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t('assetDataConfig.fixedLengthHint')}</p>
          </div>

          {error && <p className="text-xs text-destructive">{t(`assetDataConfig.${error}`)}</p>}
          <p className="text-xs text-muted-foreground">
            {t('assetDataConfig.sequentialGapNote')}
          </p>
        </section>
      )}

      <section className="flex max-w-md flex-col gap-2">
        <Label className="text-label">{t('assetDataConfig.preview')}</Label>
        <p className="text-xs text-muted-foreground">{t('assetDataConfig.previewHint')}</p>
        <ul className="flex flex-col gap-1 rounded-md border border-border bg-panel px-3 py-2">
          {samples.map((sample, i) => (
            <li key={i} className="font-mono text-xs text-foreground">
              {sample}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
