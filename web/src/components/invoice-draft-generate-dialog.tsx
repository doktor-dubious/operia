import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FileText } from 'lucide-react'
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
import { describeError } from '@/lib/errors'
import { skipReasonKey, type GenerateResult } from '@/lib/invoice-drafts'
import { invalidateBookingQueries } from '@/lib/booking'
import { supabase } from '@/lib/supabase'

// Dan fakturakladde ud fra et udvalg af bookinger (EVU-krav C-01, C-03).
//
// Dialogen har to tilstande: FØR er den en bekræftelse, EFTER er den en kvittering.
// Kvitteringen er det, der betyder noget: den viser præcis hvilke bookinger der
// IKKE kom med og hvorfor. En generering, der bare sagde "kladde dannet", ville
// gøre det nemt at overse en booking — og netop det forbyder krav C-04.

export function InvoiceDraftGenerateDialog({
  open,
  onOpenChange,
  companyId,
  bookingIds,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  bookingIds: string[]
  onDone?: (draftId: string) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<GenerateResult | null>(null)

  const close = (v: boolean) => {
    if (busy) return
    if (!v) {
      setResult(null)
      setNote('')
    }
    onOpenChange(v)
  }

  const run = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('generate_invoice_draft', {
      p_company_id: companyId,
      p_booking_ids: bookingIds,
      p_note: note.trim() || undefined,
    })
    setBusy(false)
    if (error) {
      toast.error(describeError(error, t))
      return
    }
    const res = data as unknown as GenerateResult
    setResult(res)
    void queryClient.invalidateQueries({ queryKey: ['invoice-drafts', companyId] })
    invalidateBookingQueries(queryClient)
    if (res.draft_id) {
      toast.success(t('invoiceDrafts.createdToast', { number: res.number, lines: res.lines }))
      onDone?.(res.draft_id)
    } else {
      toast.warning(t('invoiceDrafts.nothingToInvoice'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('invoiceDrafts.generateTitle')}</DialogTitle>
          <DialogDescription>
            {result
              ? result.draft_id
                ? t('invoiceDrafts.generateDone')
                : t('invoiceDrafts.generateNone')
              : t('invoiceDrafts.generateSubtitle', { count: bookingIds.length })}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-3 text-[13px]">
            {result.draft_id ? (
              <p>
                {t('invoiceDrafts.resultCreated', {
                  number: result.number,
                  bookings: result.included.length,
                  lines: result.lines,
                })}
              </p>
            ) : (
              <p className="text-muted-foreground">{t('invoiceDrafts.resultNone')}</p>
            )}
            {result.skipped.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-md border border-status-neutral-to-bad/40 p-3">
                <p className="font-[450]">
                  {t('invoiceDrafts.resultSkipped', { count: result.skipped.length })}
                </p>
                <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                  {result.skipped.map((s) => (
                    <li key={s.booking_id}>
                      <span className="font-mono">{s.booking_id.slice(0, 8)}…</span>{' '}
                      {t(skipReasonKey(s.reason), s.reason)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="draft-note" className="text-label">
              {t('invoiceDrafts.note')}
            </Label>
            <Input
              id="draft-note"
              value={note}
              maxLength={1000}
              placeholder={t('invoiceDrafts.notePlaceholder')}
              onChange={(e) => setNote(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('invoiceDrafts.generateHint')}</p>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => close(false)}>{t('common.close')}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => close(false)} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void run()} disabled={busy || bookingIds.length === 0}>
                <FileText className="size-4" />
                {busy ? t('common.loading') : t('invoiceDrafts.generate')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
