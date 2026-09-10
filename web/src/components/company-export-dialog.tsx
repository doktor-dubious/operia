import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  EXPORT_GROUPS,
  beginExport,
  buildExport,
  downloadBlob,
  fetchManifest,
  type ExportManifest,
  type ExportProgress,
} from '@/lib/company-export'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// Samlet kundeudtræk (EVU-krav F-08): "kunden skal ved ophør kunne få udleveret
// sine data i et almindeligt anvendeligt format".
//
// Grupperne er kerne + produkterne. Kernen er som udgangspunkt slået til og bør
// blive der: uden medarbejdere, afdelinger og lokationer er en pakkefil en liste
// over UUID'er. Dialogen siger det, i stedet for at forbyde det — den, der
// beder om ét produkts data alene, har typisk en grund.
//
// Rækketallene hentes FØR pakken bygges, så både afsenderen og modtageren kan
// se hvad der skulle være i den. Manifestet ryger med i filen af samme grund.
//
// Sporet skrives af SERVEREN: `company_export_begin` logger udtrækket og giver
// en billet (export_id), som hvert rækkeopslag bærer — så et udtræk uden spor
// ikke kan finde sted, heller ikke uden om dialogen. Kvitteringen bagefter
// (`log_company_export`) fortæller hvad pakken faktisk kom til at indeholde.

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  companyName: string
  /** Produktnøgler kunden har adgang til — de er sat til på forhånd. */
  entitledProducts: Set<string>
}

const SEPARATORS = [
  { value: ';', labelKey: 'companyExport.sepSemicolon' },
  { value: ',', labelKey: 'companyExport.sepComma' },
]

export function CompanyExportDialog({
  open,
  onOpenChange,
  companyId,
  companyName,
  entitledProducts,
}: Props) {
  const { t, i18n } = useTranslation()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [separator, setSeparator] = useState(';')
  const [includeFiles, setIncludeFiles] = useState(true)
  const [manifest, setManifest] = useState<ExportManifest | null>(null)
  const [counting, setCounting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)

  // Ved åbning: kernen plus det kunden faktisk har købt. Et produkt uden
  // adgang kan stadig vælges — data fra et opsagt produkt er stadig kundens.
  useEffect(() => {
    if (!open) return
    const init = new Set<string>(['core'])
    for (const g of EXPORT_GROUPS) if (g.product && entitledProducts.has(g.key)) init.add(g.key)
    setSelected(init)
    setManifest(null)
    setProgress(null)
    setIncludeFiles(true)
  }, [open, entitledProducts])

  const groups = useMemo(() => [...selected].sort(), [selected])

  // Rækketallene følger valget. Kaldet er billigt (count pr. tabel) og gør
  // knappen ærlig: man ved hvad man henter, før man henter det.
  useEffect(() => {
    if (!open || groups.length === 0) {
      setManifest(null)
      return
    }
    let cancelled = false
    setCounting(true)
    fetchManifest(companyId, groups)
      .then((m) => {
        if (!cancelled) setManifest(m)
      })
      .catch((e) => {
        if (!cancelled) toast.error(describeError(e as { message?: string }, t))
      })
      .finally(() => {
        if (!cancelled) setCounting(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, companyId, groups, t])

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const readmeText = (m: ExportManifest) =>
    [
      t('companyExport.readmeTitle', { company: m.company.name }),
      '',
      t('companyExport.readmeGenerated', {
        date: new Date(m.generated_at).toLocaleString(i18n.language.startsWith('en') ? 'en-GB' : 'da-DK'),
      }),
      t('companyExport.readmeRows', { rows: m.total_rows, tables: m.tables.length }),
      '',
      t('companyExport.readmeFormat'),
      '',
      includeFiles ? t('companyExport.readmeFiles') : t('companyExport.readmeNoFiles'),
      '',
      t('companyExport.readmeExcludesTitle'),
      // Fillinjen i manifestets `excludes` gælder kun, når filerne er fravalgt;
      // ellers ville pakken påstå, at den mangler noget, den bærer.
      ...m.excludes
        .filter((e) => !includeFiles || !e.startsWith('Filernes indhold'))
        .map((e) => `  - ${e}`),
      '',
      t('companyExport.readmeManifest'),
    ].join('\n')

  const run = async () => {
    if (!manifest || busy) return
    setBusy(true)
    try {
      // Logget serverside før første række — se hovedkommentaren.
      const started = await beginExport(companyId, groups)
      const result = await buildExport({
        companyId,
        companyName,
        manifest: started,
        separator,
        includeFiles,
        readme: readmeText(started),
        onProgress: setProgress,
      })
      downloadBlob(result.fileName, result.blob)

      const { error } = await supabase.rpc('log_company_export', {
        p_company_id: companyId,
        p_export_id: started.export_id,
        p_tables: result.files,
        p_rows: result.rows,
        p_files: result.attachments,
      })
      if (error) {
        console.error('Kundeudtrækket blev ikke logget:', error)
        toast.warning(t('companyExport.logFailed'))
      } else {
        toast.success(
          t(includeFiles ? 'companyExport.doneToastFiles' : 'companyExport.doneToast', {
            rows: result.rows,
            files: result.files,
            attachments: result.attachments,
          }),
        )
      }
      onOpenChange(false)
    } catch (e) {
      toast.error(describeError(e as { message?: string }, t))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  // To faser, to tællere. Rækkerne fylder den første halvdel af bjælken, filerne
  // den anden — ellers ville bjælken stå stille i det led, der tager længst.
  const pct = !progress
    ? 0
    : progress.phase === 'rows'
      ? progress.rowsTotal > 0
        ? Math.min(50, Math.round((progress.rowsDone / progress.rowsTotal) * 50))
        : 50
      : progress.filesTotal > 0
        ? 50 + Math.min(50, Math.round((progress.filesDone / progress.filesTotal) * 50))
        : 100
  const nonEmpty = manifest?.tables.filter((x) => x.rows > 0) ?? []

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('companyExport.title')}</DialogTitle>
          <DialogDescription>{t('companyExport.subtitle', { company: companyName })}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('companyExport.include')}</Label>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border p-3">
              {EXPORT_GROUPS.map((g) => (
                <label key={g.key} className="flex items-center gap-2 text-[13px]">
                  <Checkbox
                    checked={selected.has(g.key)}
                    onCheckedChange={() => toggle(g.key)}
                    disabled={busy}
                  />
                  <span>{t(g.labelKey)}</span>
                </label>
              ))}
            </div>
            {!selected.has('core') && (
              <p className="text-xs text-status-neutral-to-bad">{t('companyExport.coreWarning')}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('companyExport.separator')}</Label>
            <RadioGroup
              value={separator}
              onValueChange={setSeparator}
              className="flex gap-4"
              disabled={busy}
            >
              {SEPARATORS.map((s) => (
                <label key={s.value} className="flex items-center gap-2 text-[13px]">
                  <RadioGroupItem value={s.value} />
                  <span>{t(s.labelKey)}</span>
                </label>
              ))}
            </RadioGroup>
          </div>

          <label className="flex items-start gap-2 rounded-md border p-3 text-[13px]">
            <Checkbox
              checked={includeFiles}
              onCheckedChange={(v) => setIncludeFiles(v === true)}
              disabled={busy}
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              <span>{t('companyExport.includeFiles')}</span>
              <span className="text-xs text-muted-foreground">
                {t('companyExport.includeFilesHint')}
              </span>
            </span>
          </label>

          <div className="rounded-md border p-3 text-xs text-muted-foreground">
            {counting ? (
              t('common.loading')
            ) : manifest ? (
              <div className="flex flex-col gap-1">
                <span className="text-foreground">
                  {t('companyExport.summary', {
                    rows: manifest.total_rows,
                    files: manifest.tables.length,
                  })}
                </span>
                <span className="line-clamp-2">
                  {nonEmpty
                    .slice(0, 6)
                    .map((x) => `${x.table} (${x.rows})`)
                    .join(', ')}
                  {nonEmpty.length > 6 ? ' …' : ''}
                </span>
                <span>
                  {includeFiles
                    ? t('companyExport.excludesHintWithFiles')
                    : t('companyExport.excludesHint')}
                </span>
              </div>
            ) : (
              t('companyExport.pickSomething')
            )}
          </div>

          {busy && (
            <div className="flex flex-col gap-1.5">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-[width] duration-200"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {!progress
                  ? t('common.loading')
                  : progress.phase === 'rows'
                    ? t('companyExport.progress', {
                        table: progress.label,
                        done: progress.rowsDone,
                        total: progress.rowsTotal,
                      })
                    : t('companyExport.progressFiles', {
                        file: progress.label,
                        done: progress.filesDone,
                        total: progress.filesTotal,
                      })}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => void run()}
            disabled={busy || counting || !manifest || manifest.tables.length === 0}
          >
            {busy ? <Package className="size-4" /> : <Download className="size-4" />}
            {busy ? t('companyExport.building') : t('companyExport.export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
