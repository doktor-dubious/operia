import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Building2,
  ClipboardList,
  Download,
  History,
  Loader2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { buildReport, type ReportKind } from '@/lib/reports/report-builders'
import { renderCsv, renderDocx, renderPdf } from '@/lib/reports/report-render'
import { cn } from '@/lib/utils'

// Rapporter: vælg rapporttype + periode (eller stregkode for pakkehistorik)
// og hent rapporten som PDF eller Word. Indholdet bygges klientside
// (report-builders) og renderes identisk i begge formater (report-render).
export const Route = createFileRoute('/_app/reports')({
  component: ReportsPage,
})

type Format = 'pdf' | 'csv' | 'docx'

const FORMATS: { format: Format; label: string }[] = [
  { format: 'pdf', label: 'PDF' },
  { format: 'csv', label: 'CSV' },
  { format: 'docx', label: 'Word' },
]

const REPORT_TYPES: { kind: ReportKind; icon: LucideIcon; needsPeriod: boolean }[] = [
  { kind: 'summary', icon: ClipboardList, needsPeriod: true },
  { kind: 'exceptions', icon: AlertTriangle, needsPeriod: false },
  { kind: 'departments', icon: Building2, needsPeriod: true },
  { kind: 'custody', icon: History, needsPeriod: false },
]

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function ReportsPage() {
  const { t, i18n } = useTranslation()
  const [kind, setKind] = useState<ReportKind>('summary')
  const [rangeDays, setRangeDays] = useState(30)
  const [barcode, setBarcode] = useState('')
  const [busy, setBusy] = useState<ReportKind | null>(null)

  const selected = REPORT_TYPES.find((r) => r.kind === kind)!

  const generate = async (k: ReportKind, format: Format) => {
    // Vælg kortet, så de relevante indstillinger (periode/stregkode) vises.
    setKind(k)
    // Pakkehistorik kræver en stregkode — bed om den frem for at fejle bagefter.
    if (k === 'custody' && !barcode.trim()) {
      toast.error(t('reports.errNeedBarcode'))
      return
    }
    setBusy(k)
    try {
      const report = await buildReport(k, {
        rangeDays,
        barcode,
        t,
        lang: i18n.language,
      })
      const filename = `operia-${t(`reports.slug.${k}`)}-${dayKey(new Date())}`
      if (format === 'pdf') await renderPdf(report, filename)
      else if (format === 'csv') await renderCsv(report, filename)
      else await renderDocx(report, filename)
      toast.success(t('reports.done'))
    } catch (err) {
      if (err instanceof Error && err.message === 'parcel_not_found') {
        toast.error(t('reports.errNotFound', { barcode: barcode.trim() }))
      } else {
        toast.error(t('reports.errGeneric'))
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">{t('reports.subtitle')}</p>

      {/* Rapporttyper */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {REPORT_TYPES.map(({ kind: k, icon: Icon }) => (
          <div
            key={k}
            role="button"
            tabIndex={0}
            onClick={() => setKind(k)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setKind(k)
              }
            }}
            aria-pressed={kind === k}
            className={cn(
              'cursor-pointer rounded-lg text-left outline-none transition-shadow',
              'focus-visible:ring-2 focus-visible:ring-ring',
              kind === k ? 'ring-2 ring-[var(--chart-1)]' : 'hover:ring-1 hover:ring-border',
            )}
          >
            <Card className="h-full bg-panel">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <Icon
                      className="size-4 shrink-0"
                      style={{ color: kind === k ? 'var(--chart-1)' : 'var(--muted-foreground)' }}
                    />
                    {t(`reports.types.${k}.title`)}
                  </CardTitle>
                  {/* Hent-menu i øverste højre hjørne: PDF / CSV / Word */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                        disabled={busy !== null}
                        aria-label={t('reports.download')}
                        title={t('reports.download')}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {busy === k ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Download className="size-4" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      {FORMATS.map(({ format, label }) => (
                        <DropdownMenuItem
                          key={format}
                          className="cursor-pointer"
                          onClick={() => generate(k, format)}
                        >
                          {label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t(`reports.types.${k}.desc`)}
                </p>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      {/* Indstillinger + hent */}
      <Card className="bg-panel">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-medium">{t('reports.optionsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              {selected.needsPeriod && (
                <div className="flex flex-col gap-2">
                  <Label className="text-xs text-muted-foreground">{t('reports.period')}</Label>
                  <Select value={String(rangeDays)} onValueChange={(v) => setRangeDays(Number(v))}>
                    <SelectTrigger size="sm" className="w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[7, 14, 30, 90].map((days) => (
                        <SelectItem key={days} value={String(days)}>
                          {t('stats.lastDays', { count: days })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {kind === 'custody' && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="report-barcode" className="text-xs text-muted-foreground">
                    {t('reports.custodyBarcode')}
                  </Label>
                  <Input
                    id="report-barcode"
                    className="w-[280px] font-mono"
                    placeholder={t('reports.custodyPlaceholder')}
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                  />
                </div>
              )}
              {kind === 'exceptions' && (
                <p className="text-xs text-muted-foreground sm:pb-2">{t('reports.snapshotNote')}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
