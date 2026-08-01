import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAccess } from '@/hooks/use-access'
import { RETIRE_REASONS, retireReasonLabelKey, type RetireReason } from '@/lib/asset-board'
import { assetRpcErrorKey, invalidateAssetQueries, type AssetHit } from '@/lib/asset-lookup'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// Service- og udfasningsdialogerne for aktivflowet. Handlingerne går gennem
// SECURITY DEFINER-RPC'er, der gentjekker rettigheder server-side og skriver
// hændelsen i den immutable historik — dialogerne her er kun UX.

// Flow-handlinger (tjek ud/ind, flyt, service): manager + asset-rollerne.
export function useCanOperateAssets(): boolean {
  const { data: access } = useAccess()
  if (!access) return false
  return (
    access.isPlatformAdmin ||
    access.isManager ||
    access.roles.has('asset_manager') ||
    access.roles.has('asset_handler')
  )
}

// Register-niveau (udfas/genindsæt): manager/asset_manager — spejler
// can_write_assets i databasen.
export function useCanManageAssets(): boolean {
  const { data: access } = useAccess()
  if (!access) return false
  return access.isPlatformAdmin || access.isManager || access.roles.has('asset_manager')
}

function rpcErrorToast(
  error: { message?: string },
  t: (key: string) => string,
  describe: () => string,
) {
  const key = assetRpcErrorKey(error)
  toast.error(key ? t(key) : describe())
}

export function AssetServiceDialog({
  open,
  onOpenChange,
  asset,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: Pick<AssetHit, 'id' | 'name'>
  onDone?: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [vendor, setVendor] = useState('')
  const [expectedBack, setExpectedBack] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setVendor('')
      setExpectedBack('')
      setNote('')
    }
    onOpenChange(next)
  }

  const send = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('send_asset_to_service', {
      p_asset_id: asset.id,
      p_vendor: vendor.trim() || undefined,
      p_expected_back: expectedBack || undefined,
      p_note: note.trim() || undefined,
    })
    setBusy(false)
    if (error) {
      console.error('Send til service fejlede:', error)
      rpcErrorToast(error, t, () => describeError(error, t))
      return
    }
    toast.success(t('assetFlow.serviceSentToast', { name: asset.name }))
    invalidateAssetQueries(queryClient)
    handleOpenChange(false)
    onDone?.()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('assetFlow.serviceTitle', { name: asset.name })}</DialogTitle>
          <DialogDescription>{t('assetFlow.serviceDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="service-vendor" className="text-label">
            {t('assetFlow.serviceVendor')}
          </Label>
          <Input
            id="service-vendor"
            value={vendor}
            autoFocus
            placeholder={t('assetFlow.serviceVendorPlaceholder')}
            onChange={(e) => setVendor(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="service-back" className="text-label">
            {t('assetFlow.serviceExpectedBack')}
          </Label>
          <Input
            id="service-back"
            type="date"
            value={expectedBack}
            onChange={(e) => setExpectedBack(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="service-note" className="text-label">
            {t('assetFlow.note')}
          </Label>
          <Textarea
            id="service-note"
            value={note}
            rows={2}
            placeholder={t('assetFlow.notePlaceholder')}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy} onClick={send}>
            {busy ? t('common.loading') : t('assetFlow.serviceSend')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AssetRetireDialog({
  open,
  onOpenChange,
  asset,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: Pick<AssetHit, 'id' | 'name'>
  onDone?: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState<RetireReason | ''>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setReason('')
      setNote('')
    }
    onOpenChange(next)
  }

  const retire = async () => {
    if (!reason) return
    setBusy(true)
    const { error } = await supabase.rpc('retire_asset', {
      p_asset_id: asset.id,
      p_reason: reason,
      p_note: note.trim() || undefined,
    })
    setBusy(false)
    if (error) {
      console.error('Udfasning fejlede:', error)
      rpcErrorToast(error, t, () => describeError(error, t))
      return
    }
    toast.success(t('assetFlow.retiredToast', { name: asset.name }))
    invalidateAssetQueries(queryClient)
    handleOpenChange(false)
    onDone?.()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('assetFlow.retireTitle', { name: asset.name })}</DialogTitle>
          <DialogDescription>{t('assetFlow.retireDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('assetFlow.retireReason')} *</Label>
          <Select value={reason} onValueChange={(v) => setReason(v as RetireReason)}>
            <SelectTrigger>
              <SelectValue placeholder={t('assetFlow.retireReasonPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {RETIRE_REASONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {t(retireReasonLabelKey[r])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="retire-note" className="text-label">
            {t('assetFlow.note')}
          </Label>
          <Textarea
            id="retire-note"
            value={note}
            rows={2}
            placeholder={t('assetFlow.notePlaceholder')}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" disabled={busy || !reason} onClick={retire}>
            {busy ? t('common.loading') : t('assetFlow.retire')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Afskriv: aktivet var ude (tildelt/udlånt/til service), modtageren leverer
// ikke tilbage, og kravet opgives. Manager-niveau; et åbent udlån lukkes
// (låneren anonymiseres — kravet er opgivet), og sidst kendte holder bevares.
export function AssetWriteOffDialog({
  open,
  onOpenChange,
  asset,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: Pick<AssetHit, 'id' | 'name'>
  onDone?: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next) setNote('')
    onOpenChange(next)
  }

  const writeOff = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('write_off_asset', {
      p_asset_id: asset.id,
      p_note: note.trim() || undefined,
    })
    setBusy(false)
    if (error) {
      console.error('Afskrivning fejlede:', error)
      rpcErrorToast(error, t, () => describeError(error, t))
      return
    }
    toast.success(t('assetFlow.writtenOffToast', { name: asset.name }))
    invalidateAssetQueries(queryClient)
    handleOpenChange(false)
    onDone?.()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('assetFlow.writeOffTitle', { name: asset.name })}</DialogTitle>
          <DialogDescription>{t('assetFlow.writeOffDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="writeoff-note" className="text-label">
            {t('assetFlow.note')}
          </Label>
          <Textarea
            id="writeoff-note"
            value={note}
            rows={2}
            placeholder={t('assetFlow.writeOffNotePlaceholder')}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={writeOff}>
            {busy ? t('common.loading') : t('assetFlow.writeOff')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Genindsæt et udfaset/afskrevet aktiv (→ in_stock) — lille bekræftelsesdialog.
export function AssetReinstateDialog({
  open,
  onOpenChange,
  asset,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: Pick<AssetHit, 'id' | 'name'>
  onDone?: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)

  const reinstate = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('reinstate_asset', { p_asset_id: asset.id })
    setBusy(false)
    if (error) {
      console.error('Genindsættelse fejlede:', error)
      rpcErrorToast(error, t, () => describeError(error, t))
      return
    }
    toast.success(t('assetFlow.reinstatedToast', { name: asset.name }))
    invalidateAssetQueries(queryClient)
    onOpenChange(false)
    onDone?.()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('assetFlow.reinstateTitle', { name: asset.name })}</DialogTitle>
          <DialogDescription>{t('assetFlow.reinstateDescription')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy} onClick={reinstate}>
            {busy ? t('common.loading') : t('assetFlow.reinstate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
