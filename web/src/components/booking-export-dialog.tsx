import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download } from 'lucide-react'
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
import { FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { buildCsv, downloadCsv } from '@/lib/csv-export'
import { BOOKING_SERVICE_LINE_SELECT, useCompanyCurrency, type BookingServiceLine } from '@/lib/booking-services'
import {
  AVAILABLE_PROFILES,
  PROFILE_DEFAULTS,
  buildBookingRows,
  buildLineRows,
  columnsFor,
  defaultFileName,
  sanitizeFileName,
  type ExportOptions,
  type ExportProfile,
  type ExportScope,
  type ExportShape,
} from '@/lib/booking-export'
import type { BookingHit } from '@/lib/booking'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// Eksportdialogen (EVU-krav B-01): ét sted for alle indgange — én booking, en
// ressource, kalenderens tidsrum og bookinglistens filtrerede/valgte rækker.
//
// Kalderen leverer et `load`, ikke en færdig liste, af to grunde: nogle
// indgange har allerede rækkerne i hånden (listen, kalenderen), andre skal
// hente dem (alle bookinger på en ressource, uanset tidsrum), og først når
// brugeren faktisk trykker Eksportér, er det rimeligt at lave det opslag.

const ID_CHUNK = 200

/** Ydelseslinjer for et sæt bookinger, hentet i bidder så URL'en ikke sprænges. */
async function fetchLines(bookingIds: string[]): Promise<Map<string, BookingServiceLine[]>> {
  const byBooking = new Map<string, BookingServiceLine[]>()
  for (let i = 0; i < bookingIds.length; i += ID_CHUNK) {
    const chunk = bookingIds.slice(i, i + ID_CHUNK)
    const { data, error } = await supabase
      .from('booking_service_lines')
      .select(`booking_id, ${BOOKING_SERVICE_LINE_SELECT}`)
      .in('booking_id', chunk)
    if (error) throw error
    for (const row of (data ?? []) as unknown as (BookingServiceLine & { booking_id: string })[]) {
      const list = byBooking.get(row.booking_id) ?? []
      list.push(row)
      byBooking.set(row.booking_id, list)
    }
  }
  return byBooking
}

export function BookingExportDialog({
  open,
  onOpenChange,
  companyId,
  scope,
  load,
  /** Vises som undertekst, fx ressourcens navn eller det valgte tidsrum. */
  scopeLabel,
  /** Går med i revisionssporet når udtrækket gælder én konkret ting. */
  entityId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string | null
  scope: ExportScope
  load: () => Promise<BookingHit[]>
  scopeLabel?: string
  entityId?: string
}) {
  const { t } = useTranslation()
  const currency = useCompanyCurrency(companyId)
  const [shape, setShape] = useState<ExportShape>('bookings')
  const [profile, setProfile] = useState<ExportProfile>('operia')
  const [separator, setSeparator] = useState(',')
  const [decimal, setDecimal] = useState<'.' | ','>('.')
  const [dateFormat, setDateFormat] = useState<'iso' | 'da'>('iso')
  const [header, setHeader] = useState(true)
  const [omitted, setOmitted] = useState<Set<string>>(new Set())
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)

  // Filnavnet foreslås ud fra rækkeform og udsnit, men er brugerens at rette.
  useEffect(() => {
    if (open) setFileName(defaultFileName(shape, scope))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shape, scope])

  // Profilvalget SÆTTER de tre formatvalg, men låser dem ikke: en kunde kan
  // have en modtager, der vil have semikolon og ISO-datoer på én gang.
  const applyProfile = (next: ExportProfile) => {
    setProfile(next)
    const d = PROFILE_DEFAULTS[next]
    setSeparator(d.separator)
    setDecimal(d.decimal)
    setDateFormat(d.dateFormat)
  }

  const allColumns = columnsFor(shape)
  const columns = allColumns.filter((c) => !omitted.has(c.key)).map((c) => c.key)

  const run = async () => {
    if (!companyId || busy || columns.length === 0) return
    setBusy(true)
    try {
      const bookings = await load()
      const lines = await fetchLines(bookings.map((b) => b.id))
      const opts: ExportOptions = {
        shape,
        profile,
        separator,
        decimal,
        dateFormat,
        header,
        columns,
      }
      const rows =
        shape === 'lines'
          ? buildLineRows(bookings, lines, opts, currency, t)
          : buildBookingRows(bookings, lines, opts, currency, t)

      if (rows.length === 0) {
        toast.error(t('bookingExport.nothingToExport'))
        setBusy(false)
        return
      }

      const csv = buildCsv(
        { hasHeader: header, hasFooter: false, separator, fields: columns },
        (field) => {
          const def = allColumns.find((c) => c.key === field)
          // Operia-profilen skriver de maskinlæsbare nøgler, så en eksport kan
          // læses ind igen; de øvrige profiler skriver læsbare overskrifter.
          return profile === 'operia' ? field : def ? t(def.labelKey) : field
        },
        rows,
      )
      downloadCsv(sanitizeFileName(fileName), csv)

      // Revisionsspor: hvem, hvad slags udsnit, hvor mange rækker og hvilke
      // kolonner — aldrig indholdet. Fejler logningen, er filen allerede
      // hentet; så siger vi det, frem for at lade som om intet skete.
      const { error } = await supabase.rpc('log_booking_export', {
        p_company_id: companyId,
        p_scope: scope,
        p_rows: rows.length,
        p_detail: { shape, profile, columns, ...(entityId ? { entity_id: entityId } : {}) },
      })
      if (error) {
        console.error('Eksporten blev ikke logget:', error)
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
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('bookingExport.title')}</DialogTitle>
          <DialogDescription>
            {scopeLabel || t(`bookingExport.scope_${scope}`)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('bookingExport.shape')}</Label>
            <Select value={shape} onValueChange={(v) => setShape(v as ExportShape)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bookings">{t('bookingExport.shapeBookings')}</SelectItem>
                <SelectItem value="lines">{t('bookingExport.shapeLines')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {shape === 'lines'
                ? t('bookingExport.shapeLinesHint')
                : t('bookingExport.shapeBookingsHint')}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('bookingExport.profile')}</Label>
            <Select value={profile} onValueChange={(v) => applyProfile(v as ExportProfile)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_PROFILES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {t(`bookingExport.profile_${p}`)}
                  </SelectItem>
                ))}
                {/* Dalux står synligt, men slået fra: kolonneskabelonen skal
                    komme fra kunden (krav B-04), ikke gættes af os. */}
                <SelectItem value="dalux" disabled>
                  {t('bookingExport.profile_dalux')}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t(`bookingExport.profileHint_${profile}`)}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-2">
              <Label className="text-label">{t('bookingExport.separator')}</Label>
              <Select value={separator} onValueChange={setSeparator}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=",">{t('bookingExport.sepComma')}</SelectItem>
                  <SelectItem value=";">{t('bookingExport.sepSemicolon')}</SelectItem>
                  <SelectItem value={'\t'}>{t('bookingExport.sepTab')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-label">{t('bookingExport.decimal')}</Label>
              <Select value={decimal} onValueChange={(v) => setDecimal(v as '.' | ',')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value=".">{t('bookingExport.decimalDot')}</SelectItem>
                  <SelectItem value=",">{t('bookingExport.decimalComma')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-label">{t('bookingExport.dateFormat')}</Label>
              <Select value={dateFormat} onValueChange={(v) => setDateFormat(v as 'iso' | 'da')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="iso">{t('bookingExport.dateIso')}</SelectItem>
                  <SelectItem value="da">{t('bookingExport.dateDa')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <FieldLabel htmlFor="exp-header" className="px-2.5 py-1.5 font-normal">
            <Checkbox
              id="exp-header"
              checked={header}
              onCheckedChange={(v) => setHeader(v === true)}
            />
            {t('bookingExport.header')}
          </FieldLabel>

          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('bookingExport.columns')}</Label>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-border p-2.5">
              {allColumns.map((c) => (
                <FieldLabel
                  key={c.key}
                  htmlFor={`exp-col-${c.key}`}
                  className="px-1 py-1 text-xs font-normal"
                >
                  <Checkbox
                    id={`exp-col-${c.key}`}
                    checked={!omitted.has(c.key)}
                    onCheckedChange={(v) =>
                      setOmitted((prev) => {
                        const next = new Set(prev)
                        if (v === true) next.delete(c.key)
                        else next.add(c.key)
                        return next
                      })
                    }
                  />
                  {t(c.labelKey)}
                </FieldLabel>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="exp-filename" className="text-label">
              {t('bookingExport.fileName')}
            </Label>
            <Input
              id="exp-filename"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || columns.length === 0} onClick={() => void run()}>
            <Download className="size-4" />
            {busy ? t('common.loading') : t('bookingExport.export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
