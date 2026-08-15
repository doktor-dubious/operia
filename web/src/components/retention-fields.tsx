// Opbevaringsperioder (GDPR art. 5(1)(e)) i to udgaver med ét fælles katalog:
//
//   CompanyRetentionFields  — Konfigurér → Persondata. Kunden er DATAANSVARLIG
//     og bestemmer selv; tomt felt = arv platformens standard.
//   PlatformRetentionFields — Operia → Opbevaring. DCA's standard for kunder
//     der ikke selv har sat noget; tomt felt = gem indtil videre.
//
// Kategorierne og deres sletteregler ligger i 20260814140000_retention_per_company.sql
// (run_retention_purge). Nøglerne her SKAL matche kolonnenavnene i
// company_retention og platform_settings — en nøgle der kun findes her, gemmer
// ingenting.
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { describeError } from '@/lib/errors'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { supabase } from '@/lib/supabase'
import type { TablesInsert, TablesUpdate } from '@/lib/database.types'

// column = kolonnen i company_retention, platform = standardkolonnen på
// platform_settings.
export const RETENTION_CATEGORIES = [
  { key: 'parcels', column: 'parcels_days', platform: 'parcels_retention_days' },
  { key: 'parcelFiles', column: 'parcel_files_days', platform: 'parcel_files_retention_days' },
  { key: 'notifications', column: 'notifications_days', platform: 'notifications_retention_days' },
  { key: 'audit', column: 'audit_days', platform: 'audit_retention_days' },
  { key: 'imports', column: 'imports_days', platform: 'import_retention_days' },
  { key: 'assetLoans', column: 'asset_loans_days', platform: 'asset_loans_retention_days' },
  { key: 'employees', column: 'employees_days', platform: 'employees_retention_days' },
  { key: 'routes', column: 'routes_days', platform: 'routes_retention_days' },
] as const

type Form = Record<string, string>

const toForm = (row: Record<string, unknown> | null | undefined, field: 'column' | 'platform'): Form =>
  Object.fromEntries(
    RETENTION_CATEGORIES.map((c) => [c[field], row?.[c[field]] == null ? '' : String(row[c[field]])]),
  )

/** Fælles felt-liste. `inherited` er kun sat i kunde-udgaven. */
function RetentionRows({
  form,
  setForm,
  field,
  inheritedFor,
}: {
  form: Form
  setForm: (fn: (f: Form) => Form) => void
  field: 'column' | 'platform'
  inheritedFor?: (platformKey: string) => number | null
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4">
      {RETENTION_CATEGORIES.map((c) => {
        const name = c[field]
        const own = (form[name] ?? '').trim()
        const inherited = inheritedFor?.(c.platform) ?? null
        return (
          <div key={c.key} className="rounded-md border p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label className="text-label">{t(`retention.cat.${c.key}.label`)}</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(`retention.cat.${c.key}.desc`)}
                </p>
              </div>
              <div className="w-40 shrink-0">
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={form[name] ?? ''}
                  // Feltet er smalt, så pladsholderen er kun enheden — hvad
                  // et tomt felt betyder, står i linjen nedenunder.
                  placeholder={t('retention.daysUnit')}
                  onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
                />
                <p className="mt-1 text-right text-xs text-muted-foreground">
                  {own !== ''
                    ? t('retention.daysUnit')
                    : inheritedFor
                      ? inherited == null
                        ? t('retention.inheritedForever')
                        : t('retention.inherited', { days: inherited })
                      : t('retention.platformEmpty')}
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Fælles validering: tomt felt = null, ellers et helt tal > 0 (spejler
 * check-constrainten i databasen, så fejlen bliver læselig frem for en
 * constraint-fejl). Returnerer tal pr. kolonnenavn, eller den kategori der
 * ikke kunne læses — selve rækken bygges i hver komponent, hvor de genererede
 * DB-typer kender kolonnerne.
 */
function parseDays(
  form: Form,
  field: 'column' | 'platform',
): { days: Map<string, number | null> } | { invalid: string } {
  const days = new Map<string, number | null>()
  for (const c of RETENTION_CATEGORIES) {
    const raw = (form[c[field]] ?? '').trim()
    if (raw === '') {
      days.set(c[field], null)
      continue
    }
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1) return { invalid: c.key }
    days.set(c[field], n)
  }
  return { days }
}

export function CompanyRetentionFields({ companyId }: { companyId: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: platform } = usePlatformSettings()
  const [form, setForm] = useState<Form>(toForm(null, 'column'))
  const [saving, setSaving] = useState(false)

  const { data: row, isPending } = useQuery({
    queryKey: ['company-retention', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_retention')
        .select('*')
        .eq('company_id', companyId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const initial = toForm(row ?? null, 'column')
  useEffect(() => {
    setForm(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row])

  const dirty = JSON.stringify(form) !== JSON.stringify(initial)

  const save = async () => {
    const parsed = parseDays(form, 'column')
    if ('invalid' in parsed) {
      toast.error(t('retention.invalid', { category: t(`retention.cat.${parsed.invalid}.label`) }))
      return
    }
    // Rækken bygges ud fra kataloget, men typen kommer fra de genererede
    // DB-typer, så en kolonne der ikke findes, fanges her og ikke først som en
    // fejl fra PostgREST.
    const values: TablesInsert<'company_retention'> = { company_id: companyId }
    for (const c of RETENTION_CATEGORIES) values[c.column] = parsed.days.get(c.column) ?? null

    setSaving(true)
    const { data, error } = await supabase
      .from('company_retention')
      .upsert(values, { onConflict: 'company_id' })
      .select('company_id')
    setSaving(false)
    if (error || !data?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['company-retention', companyId] })
  }

  if (isPending) return <Skeleton className="h-96 w-full" />

  const inheritedFor = (key: string): number | null => {
    const v = (platform as Record<string, unknown> | undefined)?.[key]
    return typeof v === 'number' ? v : null
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-sm text-foreground-light">{t('retention.intro')}</p>
      <RetentionRows form={form} setForm={setForm} field="column" inheritedFor={inheritedFor} />
      <p className="flex gap-2 rounded-md bg-muted/60 p-3 text-xs text-foreground-light">
        <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" />
        <span>{t('retention.explainer')}</span>
      </p>
      {dirty && (
        <div className="flex justify-end gap-3">
          <Button variant="outline" size="sm" onClick={() => setForm(initial)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}
    </div>
  )
}

export function PlatformRetentionFields() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: platform, isPending } = usePlatformSettings()
  const [form, setForm] = useState<Form>(toForm(null, 'platform'))
  const [saving, setSaving] = useState(false)

  const initial = toForm(platform as Record<string, unknown> | undefined, 'platform')
  useEffect(() => {
    setForm(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform])

  const dirty = JSON.stringify(form) !== JSON.stringify(initial)

  const save = async () => {
    const parsed = parseDays(form, 'platform')
    if ('invalid' in parsed) {
      toast.error(t('retention.invalid', { category: t(`retention.cat.${parsed.invalid}.label`) }))
      return
    }
    const values: TablesUpdate<'platform_settings'> = {}
    for (const c of RETENTION_CATEGORIES) values[c.platform] = parsed.days.get(c.platform) ?? null

    setSaving(true)
    // Én række (id = true); triggeren audit_platform_retention logger før/efter
    // for hver ændret kategori.
    const { data, error } = await supabase
      .from('platform_settings')
      .update(values)
      .eq('id', true)
      .select('id')
    setSaving(false)
    if (error || !data?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['platform-settings'] })
  }

  if (isPending) return <Skeleton className="h-96 w-full" />

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-sm text-foreground-light">{t('retention.platformIntro')}</p>
      <RetentionRows form={form} setForm={setForm} field="platform" />
      <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-foreground-light">
        <Info className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
        <span>{t('retention.platformExplainer')}</span>
      </p>
      {dirty && (
        <div className="flex justify-end gap-3">
          <Button variant="outline" size="sm" onClick={() => setForm(initial)} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}
    </div>
  )
}
