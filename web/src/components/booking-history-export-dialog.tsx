import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FieldLabel, FieldTitle } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useCompany } from '@/components/company-provider'
import { sanitizeFileName } from '@/lib/booking-export'
import { buildHistoryReport } from '@/lib/booking-history-report'
import { useCompanyCurrency } from '@/lib/booking-services'
import { dateStamp } from '@/lib/csv-export'
import { describeError } from '@/lib/errors'
import { renderCsv, renderDocx, renderPdf } from '@/lib/reports/report-render'
import { supabase } from '@/lib/supabase'
import type { HistoryRow, Lookups } from '@/lib/booking-history'

// Eksport af bookinghistorikken (EVU-krav D-06): CSV, PDF og Word.
//
// Indholdet bygges én gang som en ReportDoc og renderes af de renderere,
// pakkerapporterne allerede bruger — så historikken ser ens ud i alle tre
// formater, og et nyt format senere er én linje her og ingen i indholdet.
//
// Rækkerne er dem tabellen VISER, ikke alt i basen: kravet siger "de
// filtrerede poster", og filtrene sidder i tabellen brugeren kigger på.

type Format = 'csv' | 'pdf' | 'docx'

const FORMATS: { value: Format; labelKey: string; hintKey: string }[] = [
  { value: 'pdf', labelKey: 'bookingHistory.export.pdf', hintKey: 'bookingHistory.export.pdfHint' },
  {
    value: 'docx',
    labelKey: 'bookingHistory.export.docx',
    hintKey: 'bookingHistory.export.docxHint',
  },
  { value: 'csv', labelKey: 'bookingHistory.export.csv', hintKey: 'bookingHistory.export.csvHint' },
]

export function BookingHistoryExportDialog({
  open,
  onOpenChange,
  companyId,
  rows,
  lookups,
  filters,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string | null
  rows: HistoryRow[]
  lookups: Lookups
  filters: { from?: string; to?: string; actor?: string }
}) {
  const { t, i18n } = useTranslation()
  const { activeCompany } = useCompany()
  const currency = useCompanyCurrency(companyId)
  const [format, setFormat] = useState<Format>('pdf')
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)

  // Renderne sætter selv endelsen på, så navnet holdes uden.
  useEffect(() => {
    if (open) setFileName(`operia-bookinghistorik-${dateStamp()}`)
  }, [open])

  const run = async () => {
    if (!companyId || busy) return
    if (rows.length === 0) {
      toast.error(t('bookingExport.nothingToExport'))
      return
    }
    setBusy(true)
    try {
      const report = buildHistoryReport({
        rows,
        lookups,
        company: activeCompany?.name ?? '',
        currency,
        lang: i18n.language,
        t,
        filters,
      })
      // sanitizeFileName sætter '.csv' på; endelsen kommer fra renderen, så
      // den fjernes igen her.
      const base = sanitizeFileName(fileName).replace(/\.csv$/i, '')
      if (format === 'pdf') await renderPdf(report, base)
      else if (format === 'docx') await renderDocx(report, base)
      else await renderCsv(report, base)

      const { error } = await supabase.rpc('log_booking_export', {
        p_company_id: companyId,
        p_scope: 'history',
        p_rows: rows.length,
        p_detail: { shape: 'history', profile: format },
      })
      if (error) {
        console.error('Historik-eksporten blev ikke logget:', error)
        toast.warning(t('bookingExport.logFailed'))
      } else {
        toast.success(t('bookingExport.doneToast', { count: rows.length }))
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(describeError(error as { message?: string }, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('bookingHistory.export.title')}</DialogTitle>
          <DialogDescription>
            {t('bookingHistory.export.subtitle', { count: rows.length })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('bookingHistory.export.format')}</Label>
            <RadioGroup
              value={format}
              onValueChange={(v) => setFormat(v as Format)}
              className="flex flex-col gap-2"
            >
              {FORMATS.map((f) => (
                <FieldLabel
                  key={f.value}
                  htmlFor={`hist-fmt-${f.value}`}
                  className="items-start px-2.5 py-2 font-normal"
                >
                  <RadioGroupItem id={`hist-fmt-${f.value}`} value={f.value} className="mt-0.5" />
                  <div className="flex flex-col gap-0.5">
                    <FieldTitle>{t(f.labelKey)}</FieldTitle>
                    <span className="text-xs text-muted-foreground">{t(f.hintKey)}</span>
                  </div>
                </FieldLabel>
              ))}
            </RadioGroup>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="hist-filename" className="text-label">
              {t('bookingExport.fileName')}
            </Label>
            <Input
              id="hist-filename"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || rows.length === 0} onClick={() => void run()}>
            <Download className="size-4" />
            {busy ? t('common.loading') : t('bookingExport.export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
