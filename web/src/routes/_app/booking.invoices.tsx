import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, Ban, Check, Plus, RefreshCw, Send, Trash2, Undo2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { useAccess } from '@/hooks/use-access'
import { useAccountingProvider } from '@/hooks/use-accounting-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyButton } from '@/components/copy-button'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { Field } from '@/components/detail-field'
import { useCompanyContext } from '@/hooks/use-company-context'
import { formatMoney, useCompanyCurrency } from '@/lib/booking-services'
import { describeError } from '@/lib/errors'
import { readEdgeError } from '@/lib/edge'
import { invalidateBookingQueries } from '@/lib/booking'
import {
  DRAFT_LINE_SELECT,
  DRAFT_SELECT,
  draftSearchText,
  draftTotal,
  isDraftOpen,
  linesTotal,
  type DraftLine,
  type DraftRow,
  type DraftStatus,
} from '@/lib/invoice-drafts'
import { supabase } from '@/lib/supabase'

// Fakturakladder (EVU-krav C-01, C-03, C-06, C-07, C-08).
//
// Kladderne DANNES ikke her — de dannes fra bookinglisten, hvor udvalget er, og
// denne side er stedet, hvor de læses, godkendes og overføres. Det er samme
// arbejdsdeling som i resten af produktet: handlingen ligger hos det, den
// handler om.
//
// Overførslen er systemuafhængig. Indtil et regnskabssystem er valgt (C-02),
// er den "skriv fakturanummeret her" — og det er nok til at lukke kredsløbet:
// bookingerne bliver markeret faktureret og låst, og nummeret står på både
// kladden og bookingen.
type VatMismatch = { line: number; description: string; product: string; operia: string; economic: string }

export const Route = createFileRoute('/_app/booking/invoices')({
  component: InvoicesPage,
})

const STATUS_TONE: Record<DraftStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  approved: 'bg-status-good/15 text-status-good',
  transferred: 'bg-primary/15 text-primary',
  cancelled: 'bg-status-neutral-to-bad/15 text-status-neutral-to-bad',
}

function useDrafts(companyId: string | null) {
  return useQuery({
    queryKey: ['invoice-drafts', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoice_drafts')
        .select(DRAFT_SELECT)
        .eq('company_id', companyId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as DraftRow[]
    },
  })
}

function InvoicesPage() {
  const { t, i18n } = useTranslation()
  const { companyId } = useCompanyContext()
  const currency = useCompanyCurrency(companyId)
  const [activeId, setActiveId] = useState<string | null>(null)
  const { data, isPending } = useDrafts(companyId)

  if (!companyId) return <Skeleton className="h-40 w-full" />

  const columns: ColumnDef<DraftRow>[] = [
    {
      key: 'number',
      header: t('invoiceDrafts.number'),
      sortable: true,
      sortValue: (d) => d.number,
      render: (d) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono text-xs">{d.number}</span>
          {d.kind === 'credit' && (
            <Badge variant="secondary" className="bg-status-neutral-to-bad/15 text-status-neutral-to-bad">
              {t('invoiceDrafts.creditNote')}
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'period',
      header: t('invoiceDrafts.period'),
      sortable: true,
      sortValue: (d) => d.period_from ?? '',
      render: (d) =>
        d.period_from
          ? `${d.period_from}${d.period_to && d.period_to !== d.period_from ? ` – ${d.period_to}` : ''}`
          : '—',
    },
    {
      key: 'status',
      header: t('invoiceDrafts.statusLabel'),
      sortable: true,
      sortValue: (d) => d.status,
      render: (d) => (
        <span className="inline-flex items-center gap-1.5">
          <Badge className={STATUS_TONE[d.status]} variant="secondary">
            {t(`invoiceDrafts.status.${d.status}`)}
          </Badge>
          {d.stale_at && isDraftOpen(d.status) && (
            <AlertTriangle
              className="size-3.5 text-status-neutral-to-bad"
              aria-label={t('invoiceDrafts.staleTitle')}
            />
          )}
        </span>
      ),
      filter: {
        options: [...new Set((data ?? []).map((d) => d.status))].sort().map((v) => ({
          value: v,
          label: t(`invoiceDrafts.status.${v}`),
        })),
        valueOf: (d) => d.status,
      },
    },
    {
      key: 'invoice_no',
      header: t('invoiceDrafts.invoiceNo'),
      sortable: true,
      sortValue: (d) => d.invoice_no ?? '',
      render: (d) => d.invoice_no ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'total',
      header: t('invoiceDrafts.total'),
      sortable: true,
      sortValue: (d) => draftTotal(d),
      render: (d) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatMoney(draftTotal(d), d.currency || currency, i18n.language)}
        </span>
      ),
    },
  ]

  const activeRow = (data ?? []).find((d) => d.id === activeId) ?? null

  return (
    <div className="flex min-h-full flex-col gap-6">
      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <DataTable
          rows={data ?? []}
          columns={columns}
          entityLabel={t('invoiceDrafts.entity')}
          searchText={(d) => draftSearchText(d, t)}
          storageKey="invoice-drafts"
          onRowClick={(d) => setActiveId(d.id === activeId ? null : d.id)}
          activeRowId={activeId}
        />
      )}

      {activeRow && (
        <DraftDetailPane
          key={activeRow.id}
          draft={activeRow}
          companyId={companyId}
          onClose={() => setActiveId(null)}
        />
      )}
    </div>
  )
}

function DraftDetailPane({
  draft,
  companyId,
  onClose,
}: {
  draft: DraftRow
  companyId: string
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const currency = useCompanyCurrency(companyId)
  const [tab, setTab] = useState('lines')
  const [busy, setBusy] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [creditOpen, setCreditOpen] = useState(false)
  // Godkendelse, overførsel og kreditnota kræver økonomirollen (F-01/C-08);
  // booking_manager ser knapperne deaktiveret med en forklaring, ikke slet ikke
  // — så det er tydeligt, at trinnet findes og hvem der ejer det.
  const { data: access } = useAccess()
  // Regnskabsintegrationen (C-02): når e-conomic er koblet på og verificeret,
  // får "Overfør" en søster — kladden sendes derover, og fakturanummeret
  // kommer tilbage, når bogholderen har bogført (eller straks, ved auto-bogføring).
  const economicReady = useAccountingProvider(companyId)?.key === 'economic'
  const [economicBusy, setEconomicBusy] = useState(false)
  // Sidste fejl fra e-conomic-kaldet bliver STÅENDE under knappen: en toast
  // forsvinder, og den, der skal fejlsøge, skal kunne læse beskeden i ro.
  const [economicError, setEconomicError] = useState<string | null>(null)
  // Momsafvigelser fundet FØR overførslen: linjens momskode i Operia mod den,
  // produktets salgskonto i e-conomic giver. Vises med "Overfør alligevel".
  const [vatMismatch, setVatMismatch] = useState<VatMismatch[] | null>(null)
  // silent: hentningen ved åbning — ingen toast for "ikke bogført endnu", og
  // en fejl står kun under knappen, så en åbning aldrig råber.
  const economic = async (action: 'transfer' | 'sync', ignoreVat = false, silent = false) => {
    setEconomicBusy(true)
    setEconomicError(null)
    setVatMismatch(null)
    const { data: res, error } = await supabase.functions.invoke('economic-transfer', {
      body: { companyId, action, draftId: draft.id, ignoreVat },
    })
    setEconomicBusy(false)
    const fail = (msg: string) => {
      setEconomicError(msg)
      if (!silent) toast.error(msg)
    }
    if (error) {
      // Ikke-2xx: læs funktionens egen fejlkode ud af svaret — "non-2xx" siger intet.
      const codes = Object.fromEntries(
        ['not_configured', 'not_verified', 'token_missing', 'draft_not_approved', 'draft_stale', 'booking_not_completed',
         'customer_missing', 'product_missing', 'no_lines', 'not_transferred_to_economic', 'forbidden', 'draft_not_found', 'unauthorized']
          .map((k) => [k, t(`invoiceDrafts.economicError.${k}`)]),
      )
      const status = (error as { context?: { status?: number } }).context?.status
      const fallback = status === 404 ? t('invoiceDrafts.economicError.not_deployed') : describeError(error, t)
      fail(await readEdgeError(error, fallback, codes))
      return
    }
    if (res?.error) {
      fail(t(`invoiceDrafts.economicError.${res.error}`, String(res.error)) + (res.source ? ` (${res.source})` : ''))
      return
    }
    if (res?.reason === 'vat_mismatch') {
      setVatMismatch(res.mismatches as VatMismatch[])
      return
    }
    if (!res?.ok) {
      const reason = t(`companyAccounting.test_${res?.reason}`, String(res?.reason))
      fail(res?.detail ? `${reason} — e-conomic: ${res.detail}` : reason)
      return
    }
    if (action === 'transfer') {
      toast.success(res.booked
        ? t('invoiceDrafts.economicBooked', { no: res.invoiceNo })
        : t('invoiceDrafts.economicTransferred', { no: res.draftNo }))
    } else if (res.booked) {
      toast.success(t('invoiceDrafts.economicBooked', { no: res.invoiceNo }))
    } else if (!silent) {
      toast.success(t('invoiceDrafts.economicNotBookedYet'))
    }
    if (res.booked || !silent) refresh()
  }
  const canInvoice =
    !!access && (access.isPlatformAdmin || access.isManager || access.roles.has('finance_manager'))
  // Hent ved åbning: en overført e-conomic-kladde uden fakturanummer spørger
  // selv, når en økonomibruger åbner den — én gang pr. kladde pr. besøg, så
  // "Hent fakturanummer" er sjældent nødvendigt at trykke på. Cron-jobbet
  // 'operia-economic-sync' gør det samme hver time uden nogen bruger.
  const autoSynced = useRef(new Set<string>())
  useEffect(() => {
    if (!economicReady || !canInvoice) return
    if (draft.status !== 'transferred' || draft.external_system !== 'economic' || draft.invoice_no) return
    if (autoSynced.current.has(draft.id)) return
    autoSynced.current.add(draft.id)
    void economic('sync', false, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id, draft.status, draft.external_system, draft.invoice_no, economicReady, canInvoice])
  const [newDesc, setNewDesc] = useState('')
  const [newQty, setNewQty] = useState('1')
  const [newPrice, setNewPrice] = useState('')

  const { data: lines } = useQuery({
    queryKey: ['invoice-draft-lines', draft.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoice_draft_lines')
        .select(DRAFT_LINE_SELECT)
        .eq('draft_id', draft.id)
        .order('sort_order')
        .order('created_at')
      if (error) throw error
      return (data ?? []) as unknown as DraftLine[]
    },
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['invoice-drafts', companyId] })
    void queryClient.invalidateQueries({ queryKey: ['invoice-draft-lines', draft.id] })
    invalidateBookingQueries(queryClient)
  }

  const call = async (fn: string, args: Record<string, unknown>, okKey: string) => {
    setBusy(true)
    const { error } = await supabase.rpc(fn as 'approve_invoice_draft', args as never)
    setBusy(false)
    if (error) {
      toast.error(describeError(error, t))
      return false
    }
    toast.success(t(okKey))
    refresh()
    return true
  }

  const open = isDraftOpen(draft.status)
  const rows = lines ?? []
  const total = linesTotal(rows)

  const tabs = [
    { key: 'lines', label: t('invoiceDrafts.tabLines') },
    { key: 'details', label: t('detail.tabDetails') },
    { key: 'actions', label: t('detail.tabActions') },
  ]

  return (
    <>
      <DetailTabs tabs={tabs} active={tab} onChange={setTab} onClose={onClose}>
        {tab === 'lines' && (
          <div className="flex flex-col gap-4">
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-[13px]">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-[450]">
                      {t('invoiceDrafts.lineDescription')}
                    </th>
                    <th className="px-3 py-2 text-right font-[450]">
                      {t('invoiceDrafts.lineQuantity')}
                    </th>
                    <th className="px-3 py-2 text-left font-[450]">{t('invoiceDrafts.lineUnit')}</th>
                    <th className="px-3 py-2 text-left font-[450]">{t('invoiceDrafts.lineVat')}</th>
                    <th className="px-3 py-2 text-right font-[450]">
                      {t('invoiceDrafts.linePrice')}
                    </th>
                    <th className="px-3 py-2 text-right font-[450]">
                      {t('invoiceDrafts.lineAmount')}
                    </th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id} className="border-b last:border-b-0">
                      <td className="px-3 py-2">
                        <span className="block">{l.description}</span>
                        <span className="text-xs text-muted-foreground">
                          {t(`invoiceDrafts.source.${l.source}`)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(l.quantity)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {l.unit ? t(`invoiceDrafts.unit.${l.unit}`, l.unit) : '—'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{l.vat_code ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(Number(l.unit_price), draft.currency, i18n.language)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(Number(l.amount), draft.currency, i18n.language)}
                      </td>
                      <td className="px-2 py-2">
                        {open && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            aria-label={t('common.delete')}
                            disabled={busy}
                            onClick={() =>
                              void call(
                                'remove_invoice_draft_line',
                                { p_line_id: l.id },
                                'invoiceDrafts.lineRemoved',
                              )
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-muted/30 font-[450]">
                    <td className="px-3 py-2" colSpan={4}>
                      {t('invoiceDrafts.total')}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoney(total, draft.currency, i18n.language)}
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>

            {open && (
              <div className="flex flex-wrap items-end gap-3 rounded-md border p-3">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label className="text-label">{t('invoiceDrafts.lineDescription')}</Label>
                  <Input
                    value={newDesc}
                    maxLength={300}
                    placeholder={t('invoiceDrafts.manualPlaceholder')}
                    onChange={(e) => setNewDesc(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-label">{t('invoiceDrafts.lineQuantity')}</Label>
                  <Input
                    className="w-24"
                    inputMode="decimal"
                    value={newQty}
                    onChange={(e) => setNewQty(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-label">{t('invoiceDrafts.linePrice')}</Label>
                  <Input
                    className="w-32"
                    inputMode="decimal"
                    value={newPrice}
                    placeholder="0,00"
                    onChange={(e) => setNewPrice(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={busy || !newDesc.trim()}
                  onClick={async () => {
                    const q = Number(newQty.replace(',', '.'))
                    const p = Number(newPrice.replace(',', '.'))
                    if (!Number.isFinite(q) || !Number.isFinite(p)) {
                      toast.error(t('invoiceDrafts.errNumbers'))
                      return
                    }
                    const ok = await call(
                      'add_invoice_draft_line',
                      {
                        p_draft_id: draft.id,
                        p_description: newDesc.trim(),
                        p_quantity: q,
                        p_unit_price: p,
                      },
                      'invoiceDrafts.lineAdded',
                    )
                    if (ok) {
                      setNewDesc('')
                      setNewQty('1')
                      setNewPrice('')
                    }
                  }}
                >
                  <Plus className="size-4" /> {t('common.add')}
                </Button>
              </div>
            )}
          </div>
        )}

        {tab === 'details' && (
          <div className="flex max-w-2xl flex-col gap-5">
            <Field label={t('invoiceDrafts.number')}>
              <div className="relative">
                <Input value={draft.number} disabled className="pr-10 font-mono text-xs" />
                <div className="absolute right-1 top-1/2 -translate-y-1/2">
                  <CopyButton value={draft.number} label={t('detail.copyId')} />
                </div>
              </div>
            </Field>
            <Field label={t('invoiceDrafts.statusLabel')}>
              <Input value={t(`invoiceDrafts.status.${draft.status}`)} disabled />
            </Field>
            <Field label={t('invoiceDrafts.period')}>
              <Input
                value={
                  draft.period_from
                    ? `${draft.period_from} – ${draft.period_to ?? draft.period_from}`
                    : '—'
                }
                disabled
              />
            </Field>
            <Field label={t('invoiceDrafts.invoiceNo')}>
              <Input value={draft.invoice_no ?? '—'} disabled />
            </Field>
            <Field label={t('invoiceDrafts.system')}>
              <Input
                value={
                  draft.external_system
                    ? t(`invoiceDrafts.systemName.${draft.external_system}`, draft.external_system)
                    : '—'
                }
                disabled
              />
            </Field>
            {draft.note && (
              <Field label={t('invoiceDrafts.note')}>
                <Input value={draft.note} disabled />
              </Field>
            )}
          </div>
        )}

        {tab === 'actions' && (
          <div className="flex max-w-2xl flex-col gap-4">
            {draft.status === 'transferred' ? (
              <>
                <p className="rounded-md border p-4 text-xs text-muted-foreground">
                  {draft.external_system === 'economic' && !draft.invoice_no
                    ? t('invoiceDrafts.lockedEconomicDraft', { no: draft.external_id })
                    : t('invoiceDrafts.lockedTransferred', { number: draft.invoice_no })}
                </p>
                {draft.external_system === 'economic' && !draft.invoice_no && (
                  <div className="flex items-center justify-between rounded-md border p-4">
                    <div>
                      <p className="text-[13px] font-[450]">{t('invoiceDrafts.economicSync')}</p>
                      <p className="text-xs text-muted-foreground">{t('invoiceDrafts.economicSyncHint')}</p>
                    </div>
                    <Button size="sm" variant="outline" disabled={economicBusy || !canInvoice} onClick={() => void economic('sync')}>
                      <RefreshCw className="size-4" /> {t('invoiceDrafts.economicSync')}
                    </Button>
                  </div>
                )}
                {economicError && (
                  <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                    {economicError}
                  </p>
                )}
                {draft.kind === 'invoice' && (
                  <div className="flex items-center justify-between rounded-md border p-4">
                    <div>
                      <p className="text-[13px] font-[450]">{t('invoiceDrafts.credit')}</p>
                      <p className="text-xs text-muted-foreground">
                        {draft.credited_by_draft_id
                          ? t('invoiceDrafts.creditedAlready')
                          : canInvoice
                            ? t('invoiceDrafts.creditHint')
                            : t('invoiceDrafts.needsFinance')}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !canInvoice || !!draft.credited_by_draft_id}
                      onClick={() => setCreditOpen(true)}
                    >
                      <Undo2 className="size-4" /> {t('invoiceDrafts.credit')}
                    </Button>
                  </div>
                )}
              </>
            ) : draft.status === 'cancelled' ? (
              <p className="rounded-md border p-4 text-xs text-muted-foreground">
                {t('invoiceDrafts.lockedCancelled')}
              </p>
            ) : (
              <>
                {draft.stale_at && (
                  // Grundlaget er ændret efter dannelsen (A-03). Kladden viser
                  // stadig de gamle beløb, og det er derfor det ENESTE, der kan
                  // gøres med den, indtil den er dannet igen.
                  <div className="flex items-center justify-between gap-4 rounded-md border border-status-neutral-to-bad/50 bg-status-neutral-to-bad/10 p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-neutral-to-bad" />
                      <div>
                        <p className="text-[13px] font-[450]">{t('invoiceDrafts.staleTitle')}</p>
                        <p className="text-xs text-muted-foreground">
                          {t(`invoiceDrafts.staleReason.${draft.stale_reason ?? 'booking_updated'}`)}{' '}
                          {t('invoiceDrafts.staleHint')}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void call(
                          'regenerate_invoice_draft',
                          { p_draft_id: draft.id },
                          'invoiceDrafts.regeneratedToast',
                        )
                      }
                    >
                      <RefreshCw className="size-4" /> {t('invoiceDrafts.regenerate')}
                    </Button>
                  </div>
                )}
                <div className="flex items-center justify-between rounded-md border p-4">
                  <div>
                    <p className="text-[13px] font-[450]">
                      {draft.status === 'approved'
                        ? t('invoiceDrafts.clearApproval')
                        : t('invoiceDrafts.approve')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {canInvoice ? t('invoiceDrafts.approveHint') : t('invoiceDrafts.needsFinance')}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !!draft.stale_at || !canInvoice}
                    onClick={() =>
                      void call(
                        'approve_invoice_draft',
                        { p_draft_id: draft.id, p_approve: draft.status !== 'approved' },
                        'invoiceDrafts.approvedToast',
                      )
                    }
                  >
                    <Check className="size-4" />
                    {draft.status === 'approved'
                      ? t('invoiceDrafts.clearApproval')
                      : t('invoiceDrafts.approve')}
                  </Button>
                </div>

                <div className="flex items-center justify-between rounded-md border p-4">
                  <div>
                    <p className="text-[13px] font-[450]">{t('invoiceDrafts.transfer')}</p>
                    <p className="text-xs text-muted-foreground">
                      {canInvoice ? t('invoiceDrafts.transferHint') : t('invoiceDrafts.needsFinance')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {economicReady && (
                      <Button
                        size="sm"
                        disabled={busy || economicBusy || !!draft.stale_at || !canInvoice || draft.status !== 'approved'}
                        title={draft.status !== 'approved' ? t('invoiceDrafts.economicNeedsApproval') : undefined}
                        onClick={() => void economic('transfer')}
                      >
                        <Send className="size-4" /> {economicBusy ? t('common.loading') : t('invoiceDrafts.economicTransfer')}
                      </Button>
                    )}
                    <Button size="sm" variant={economicReady ? 'outline' : 'default'} disabled={busy || !!draft.stale_at || !canInvoice} onClick={() => setTransferOpen(true)}>
                      <Send className="size-4" /> {economicReady ? t('invoiceDrafts.transferManual') : t('invoiceDrafts.transfer')}
                    </Button>
                  </div>
                </div>
                {economicError && (
                  <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                    {economicError}
                  </p>
                )}
                {vatMismatch && (
                  <div className="flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs">
                    <p className="font-[450]">{t('invoiceDrafts.vatMismatchTitle', { count: vatMismatch.length })}</p>
                    <ul className="list-disc pl-4">
                      {vatMismatch.map((m) => (
                        <li key={m.line}>
                          {t('invoiceDrafts.vatMismatchLine', {
                            line: m.line, description: m.description, product: m.product,
                            operia: m.operia, economic: m.economic || t('economicMapping.vatNone'),
                          })}
                        </li>
                      ))}
                    </ul>
                    <p className="text-muted-foreground">{t('invoiceDrafts.vatMismatchHint')}</p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={economicBusy} onClick={() => void economic('transfer', true)}>
                        {t('invoiceDrafts.transferAnyway')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setVatMismatch(null)}>{t('common.cancel')}</Button>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
                  <div>
                    <p className="text-[13px] font-[450] text-destructive">
                      {t('invoiceDrafts.cancel')}
                    </p>
                    <p className="text-xs text-muted-foreground">{t('invoiceDrafts.cancelHint')}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      void call(
                        'cancel_invoice_draft',
                        { p_draft_id: draft.id },
                        'invoiceDrafts.cancelledToast',
                      )
                    }
                  >
                    <Ban className="size-4" /> {t('invoiceDrafts.cancel')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DetailTabs>

      <CreditNoteDialog
        open={creditOpen}
        onOpenChange={setCreditOpen}
        draft={draft}
        lines={lines ?? []}
        currency={currency}
        onDone={() => {
          setCreditOpen(false)
          refresh()
        }}
      />

      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        draft={draft}
        onTransfer={async (no, system) =>
          call(
            'transfer_invoice_draft',
            { p_draft_id: draft.id, p_invoice_no: no, p_system: system },
            'invoiceDrafts.transferredToast',
          )
        }
      />
    </>
  )
}

function TransferDialog({
  open,
  onOpenChange,
  draft,
  onTransfer,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  draft: DraftRow
  onTransfer: (invoiceNo: string, system: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [no, setNo] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('invoiceDrafts.transferTitle', { number: draft.number })}</DialogTitle>
          <DialogDescription>{t('invoiceDrafts.transferDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="inv-no" className="text-label">
            {t('invoiceDrafts.invoiceNo')}
          </Label>
          <Input
            id="inv-no"
            value={no}
            maxLength={60}
            onChange={(e) => setNo(e.target.value)}
            placeholder={t('invoiceDrafts.invoiceNoPlaceholder')}
          />
          <p className="text-xs text-muted-foreground">{t('invoiceDrafts.transferWarning')}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={busy || !no.trim()}
            onClick={async () => {
              setBusy(true)
              const ok = await onTransfer(no.trim(), 'manual')
              setBusy(false)
              if (ok) {
                setNo('')
                onOpenChange(false)
              }
            }}
          >
            <Send className="size-4" /> {t('invoiceDrafts.transfer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Kreditnota (C-09): hele fakturaen eller et udvalg af linjer med antal.
// Kladden, der dannes, følger samme godkendelse og overførsel som en faktura.
function CreditNoteDialog({
  open,
  onOpenChange,
  draft,
  lines,
  currency,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  draft: DraftRow
  lines: DraftLine[]
  currency: string
  onDone: () => void
}) {
  const { t, i18n } = useTranslation()
  const [partial, setPartial] = useState(false)
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const toggle = (id: string, qty: number) =>
    setPicked((p) => {
      const next = { ...p }
      if (id in next) delete next[id]
      else next[id] = String(qty)
      return next
    })

  const run = async () => {
    setBusy(true)
    const payload = partial
      ? Object.entries(picked).map(([line_id, q]) => ({ line_id, quantity: Number(q.trim().replace(',', '.')) }))
      : null
    if (partial && (!payload || payload.length === 0)) {
      setBusy(false)
      toast.error(t('invoiceDrafts.creditPickSomething'))
      return
    }
    // NaN bliver til JSON null, og null ville basen læse som "hele linjen".
    // En tastefejl må ikke kreditere mere end der blev tastet.
    if (payload?.some((l) => !Number.isFinite(l.quantity) || l.quantity <= 0)) {
      setBusy(false)
      toast.error(t('invoiceDrafts.errNumbers'))
      return
    }
    const { data, error } = await supabase.rpc('create_credit_note', {
      p_draft_id: draft.id,
      p_lines: payload ?? undefined,
    })
    setBusy(false)
    if (error) {
      toast.error(describeError(error, t))
      return
    }
    toast.success(t('invoiceDrafts.creditCreated', { number: (data as { number?: string })?.number ?? '' }))
    onDone()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('invoiceDrafts.creditTitle', { number: draft.number })}</DialogTitle>
          <DialogDescription>{t('invoiceDrafts.creditSubtitle')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <label className="flex items-start gap-3 text-[13px]">
            <Checkbox className="mt-0.5" checked={!partial} onCheckedChange={() => setPartial(false)} />
            <span>
              {t('invoiceDrafts.creditFull')}
              <span className="block text-xs text-muted-foreground">{t('invoiceDrafts.creditFullHint')}</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-[13px]">
            <Checkbox className="mt-0.5" checked={partial} onCheckedChange={() => setPartial(true)} />
            <span>
              {t('invoiceDrafts.creditPartial')}
              <span className="block text-xs text-muted-foreground">{t('invoiceDrafts.creditPartialHint')}</span>
            </span>
          </label>
          {partial && (
            <div className="flex flex-col divide-y rounded-md border">
              {lines.map((l) => (
                <div key={l.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <Checkbox checked={l.id in picked} onCheckedChange={() => toggle(l.id, Number(l.quantity))} />
                  <span className="flex-1 truncate">{l.description}</span>
                  <span className="text-muted-foreground">
                    {t('invoiceDrafts.creditOf', { max: l.quantity })}
                  </span>
                  <Input
                    className="w-20"
                    inputMode="decimal"
                    disabled={!(l.id in picked)}
                    value={picked[l.id] ?? ''}
                    onChange={(e) => setPicked((p) => ({ ...p, [l.id]: e.target.value }))}
                  />
                  <span className="w-24 text-right tabular-nums">
                    {formatMoney(Number(l.unit_price), currency, i18n.language)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy} onClick={() => void run()}>
            <Undo2 className="size-4" /> {busy ? t('common.loading') : t('invoiceDrafts.creditCreate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
