// Indsigtsudtræk (GDPR art. 15): find alt om én person i én virksomhed.
//
// To indgange, fordi personoplysninger ligger to steder — se sar_export i
// 20260814150000_sar_export.sql. Medarbejder-opslaget følger fremmednøglerne;
// fritekst-søgningen finder dem, der ikke har en række (fuldmagtsafhentere,
// private afsendere), fordi de kun findes som tekst i en anden persons pakke.
//
// Al udvælgelse og autorisation sker serverside i RPC'en — denne skærm sender
// kun forespørgslen og viser resultatet. Udtrækket logges (privacy.sar_exported).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download, Info, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmployeePicker, type PickedEmployee } from '@/components/employee-picker'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// Visningsrækkefølgen. En sektion der ikke står her (ny i RPC'en) placeres
// sidst i stedet for først — se sectionRank.
const SECTION_ORDER = [
  'employee',
  'user_account',
  'parcels_as_subject',
  'parcels_mentioning',
  'parcel_events_on_subject_parcels',
  'parcel_events_as_actor',
  'notifications',
  'asset_loans',
  'asset_events_as_actor',
  'files',
  'audit_as_actor',
]

const sectionRank = (key: string) => {
  const i = SECTION_ORDER.indexOf(key)
  return i === -1 ? SECTION_ORDER.length : i
}

type SarResult = {
  generated_at: string
  company: { id: string; name: string }
  subject: { employee_id: string | null; employee_no: string | null; name: string | null; query: string | null }
  section_limit: number
  counts: Record<string, { rows: number; truncated: boolean }>
  sections: Record<string, unknown>
}

export function CompanySarExport({ companyId }: { companyId: string }) {
  const { t } = useTranslation()
  const [employee, setEmployee] = useState<PickedEmployee | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SarResult | null>(null)

  const run = async () => {
    if (!employee && !query.trim()) {
      toast.error(t('sar.needSubject'))
      return
    }
    setBusy(true)
    const { data, error } = await supabase.rpc('sar_export', {
      p_company_id: companyId,
      p_employee_id: employee?.id ?? undefined,
      p_query: query.trim() || undefined,
    })
    setBusy(false)
    if (error) {
      toast.error(describeError(error, t))
      return
    }
    setResult(data as unknown as SarResult)
  }

  // Downloades som JSON: udtrækket er en struktureret kopi af rækkerne, og et
  // maskinlæsbart format er også det, art. 20 lægger op til. Filen dannes i
  // browseren — den passerer aldrig en server igen.
  const download = () => {
    if (!result) return
    const subject =
      result.subject.employee_no || result.subject.name || result.subject.query || 'udtraek'
    const safe = subject.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60)
    const stamp = result.generated_at.slice(0, 10)
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `indsigt-${safe}-${stamp}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Fast rækkefølge: personen først, derefter pakkerne, sporet og resten.
  // Serverens jsonb_object_agg har ingen defineret orden, og en liste der
  // skifter rækkefølge mellem to udtræk er svær at læse for den der skal
  // besvare anmodningen.
  // `counts` dækker kun listeafsnittene; stamdata-afsnittet er ét objekt og
  // ville ellers mangle på skærmen, selv om det ligger i filen.
  const sections = result
    ? [
        ...(result.sections?.employee
          ? ([['employee', { rows: 1, truncated: false }]] as [string, { rows: number; truncated: boolean }][])
          : []),
        ...Object.entries(result.counts),
      ].sort((a, b) => sectionRank(a[0]) - sectionRank(b[0]))
    : []
  const total = sections.reduce((n, [, v]) => n + v.rows, 0)

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-sm text-foreground-light">{t('sar.intro')}</p>

      <div className="flex flex-col gap-4 rounded-md border p-4">
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('sar.employee')}</Label>
          <EmployeePicker companyId={companyId} value={employee} onChange={setEmployee} />
          <p className="text-xs text-muted-foreground">{t('sar.employeeHint')}</p>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('sar.query')}</Label>
          <Input
            value={query}
            placeholder={t('sar.queryPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('sar.queryHint')}</p>
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={run} disabled={busy}>
            <Search className="size-3.5" />
            {busy ? t('common.loading') : t('sar.run')}
          </Button>
        </div>
      </div>

      {result && (
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label className="text-label">{t('sar.resultTitle')}</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('sar.resultSubject', {
                  subject: result.subject.name || result.subject.query || '—',
                  date: new Date(result.generated_at).toLocaleString('da-DK'),
                })}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={download}>
              <Download className="size-3.5" />
              {t('sar.download')}
            </Button>
          </div>

          <ul className="flex flex-col gap-1 text-[13px]">
            {sections.map(([key, v]) => (
              <li key={key} className="flex items-center justify-between gap-4 border-b py-1 last:border-0">
                <span className={v.rows === 0 ? 'text-muted-foreground' : ''}>
                  {t(`sar.section.${key}`, { defaultValue: key })}
                </span>
                <span className="tabular-nums">
                  {v.rows}
                  {v.truncated && (
                    <span className="ml-2 text-xs text-amber-600 dark:text-amber-500">
                      {t('sar.truncated', { limit: result.section_limit })}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {total === 0 && <p className="text-xs text-muted-foreground">{t('sar.noData')}</p>}

          <p className="flex gap-2 rounded-md bg-muted/60 p-3 text-xs text-foreground-light">
            <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" />
            <span>{t('sar.limitations')}</span>
          </p>
        </div>
      )}
    </div>
  )
}
