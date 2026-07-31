import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAccess } from '@/hooks/use-access'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// Fjern en fejlregistreret pakke: pakken blev tastet ind ved en fejl og findes
// ikke fysisk, så den kan hverken udleveres eller sendes retur. Statussen bliver
// 'removed' (annulleret) — rækken slettes IKKE, for sporet skal kunne forklare
// hvad der skete. Handlingen logges som 'parcel.removed' på fejl-niveau.
//
// Rollegatet her er kun UX; håndhævelsen er RPC'en remove_parcel
// (SECURITY DEFINER, manager/parcel_manager), jf. CLAUDE.md.

export function useCanRemoveParcel() {
  const { data: access } = useAccess()
  return (
    !!access &&
    (access.isPlatformAdmin || access.isManager || access.roles.has('parcel_manager'))
  )
}

const RPC_ERROR_KEYS: Record<string, string> = {
  not_authorized: 'removeParcel.errNotAuthorized',
  reason_required: 'removeParcel.errReasonRequired',
  no_removable_parcels: 'removeParcel.errNotRemovable',
  parcel_not_found: 'removeParcel.errNotFound',
  mixed_companies: 'removeParcel.errNotFound',
}

function describeRemoveError(error: unknown, t: TFunction): string {
  const message = (error as { message?: string } | null)?.message?.trim() ?? ''
  const key = RPC_ERROR_KEYS[message]
  return key ? t(key) : describeError(error, t)
}

export function ParcelRemoveDialog({
  open,
  onOpenChange,
  parcel,
  onRemoved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  parcel: { id: string; barcode: string | null }
  onRemoved?: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setReason('')
  }, [open])

  const label = parcel.barcode ?? parcel.id.slice(0, 8)

  const remove = async () => {
    setBusy(true)
    try {
      const { error } = await supabase.rpc('remove_parcel', {
        p_parcel_ids: [parcel.id],
        p_reason: reason.trim(),
      })
      if (error) throw error
      queryClient.invalidateQueries({ queryKey: ['parcels'] })
      queryClient.invalidateQueries({ queryKey: ['parcel-status-counts'] })
      toast.success(t('removeParcel.doneToast', { barcode: label }))
      onOpenChange(false)
      onRemoved?.()
    } catch (error) {
      console.error('Fjernelse af pakke fejlede:', error)
      toast.error(describeRemoveError(error, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <TriangleAlert className="size-4" />
            {t('removeParcel.title')}
          </DialogTitle>
          <DialogDescription>{t('removeParcel.warning', { barcode: label })}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-muted-foreground">
            {t('removeParcel.consequences')}
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="remove-reason">{t('removeParcel.reason')}</Label>
            <Textarea
              id="remove-reason"
              value={reason}
              rows={2}
              disabled={busy}
              placeholder={t('removeParcel.reasonPlaceholder')}
              onChange={(e) => setReason(e.target.value)}
            />
            {!reason.trim() && (
              <p className="text-xs text-status-neutral-to-bad">
                {t('removeParcel.reasonRequired')}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={remove} disabled={busy || !reason.trim()}>
            {busy ? t('common.loading') : t('removeParcel.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
