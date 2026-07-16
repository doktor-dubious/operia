import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
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
import { Skeleton } from '@/components/ui/skeleton'
import { Field } from '@/components/detail-field'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { supabase } from '@/lib/supabase'

// Operia → Aktiver: platformens standarder for Aktiver-produktet — standard-
// udløb for skab-udlån og standardkategorier (startsæt/forslag til nye
// kunder). Funktions-kontakterne fra prototypens Assets-side ligger under
// Produkter & funktioner; kundens egne kategorier/placeringer og CSV-import
// hører til det kommende Aktiver-modul. Placeringer er bevidst udeladt her —
// de er kundespecifikke.
export const Route = createFileRoute('/_app/operia/assets')({
  component: AssetsConfigPage,
})

// Prototypens muligheder for standardudløb (timer; null = intet udløb).
const TTL_OPTIONS = [12, 24, 48, 72, 168, 336] as const
const TTL_NONE = 'none'

function useDefaultCategories() {
  return useQuery({
    queryKey: ['platform-asset-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_asset_categories')
        .select('id, name, track')
        .order('name')
      if (error) throw error
      return data
    },
  })
}

function AssetsConfigPage() {
  const { t } = useTranslation()
  const { data: settings, isPending } = usePlatformSettings()
  const { data: categories } = useDefaultCategories()
  const queryClient = useQueryClient()
  const [ttl, setTtl] = useState<number | null>(72)
  const [saving, setSaving] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTrack, setNewTrack] = useState<'serial' | 'qty'>('serial')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (settings) setTtl(settings.locker_loan_ttl_hours)
  }, [settings])

  const dirty = !!settings && ttl !== settings.locker_loan_ttl_hours

  const ttlLabel = (hours: number) =>
    hours < 168
      ? t('assetsConfig.ttlHours', { hours, days: hours / 24 })
      : t('assetsConfig.ttlDays', { days: hours / 24 })

  const save = async () => {
    setSaving(true)
    const { data: saved, error } = await supabase
      .from('platform_settings')
      .update({ locker_loan_ttl_hours: ttl })
      .eq('id', true)
      .select('id')
    setSaving(false)
    if (error || !saved?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['platform-settings'] })
  }

  const cancel = () => {
    if (settings) setTtl(settings.locker_loan_ttl_hours)
  }

  const addCategory = async () => {
    if (!newName.trim()) return
    setBusy(true)
    const { data, error } = await supabase
      .from('platform_asset_categories')
      .insert({ name: newName.trim(), track: newTrack })
      .select('id')
    setBusy(false)
    if (error || !data?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    setAddOpen(false)
    setNewName('')
    setNewTrack('serial')
    toast.success(t('assetsConfig.categoryCreated'))
    queryClient.invalidateQueries({ queryKey: ['platform-asset-categories'] })
  }

  const removeCategory = async (id: string, name: string) => {
    const { data, error } = await supabase
      .from('platform_asset_categories')
      .delete()
      .eq('id', id)
      .select('id')
    if (error || !data?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('assetsConfig.categoryDeleted', { name }))
    queryClient.invalidateQueries({ queryKey: ['platform-asset-categories'] })
  }

  if (isPending) return <Skeleton className="h-40 w-full" />

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto w-full max-w-3xl py-6">
        <header className="mb-8">
          <h1 className="text-2xl font-medium text-foreground">{t('assetsConfig.title')}</h1>
          <p className="mt-1 text-sm text-foreground-light">{t('assetsConfig.subtitle')}</p>
        </header>

        <div className="flex flex-col gap-8">
          <Field label={t('assetsConfig.ttlLabel')} info={t('assetsConfig.ttlHint')}>
            <Select
              value={ttl === null ? TTL_NONE : String(ttl)}
              onValueChange={(v) => setTtl(v === TTL_NONE ? null : Number(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TTL_OPTIONS.map((hours) => (
                  <SelectItem key={hours} value={String(hours)}>
                    {ttlLabel(hours)}
                  </SelectItem>
                ))}
                <SelectItem value={TTL_NONE}>{t('assetsConfig.ttlNone')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <div className="flex max-w-2xl flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <Label className="text-label">{t('assetsConfig.categoriesTitle')}</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('assetsConfig.categoriesHint')}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                <Plus className="size-4" /> {t('assetsConfig.addCategory')}
              </Button>
            </div>
            {!categories?.length ? (
              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                {t('assetsConfig.noCategories')}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {categories.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div>
                      <p className="text-[13px] font-[450]">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.track === 'serial'
                          ? t('assetsConfig.trackSerial')
                          : t('assetsConfig.trackQty')}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      onClick={() => removeCategory(c.id, c.name)}
                    >
                      <Trash2 className="size-3.5" /> {t('shippingBilling.remove')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('assetsConfig.newCategoryTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-cat-name" className="text-label">
              {t('assetsConfig.categoryName')}
            </Label>
            <Input
              id="new-cat-name"
              value={newName}
              autoFocus
              placeholder={t('assetsConfig.categoryNamePlaceholder')}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label className="text-label">{t('assetsConfig.trackedAs')}</Label>
            <Select value={newTrack} onValueChange={(v) => setNewTrack(v as 'serial' | 'qty')}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="serial">{t('assetsConfig.trackSerial')}</SelectItem>
                <SelectItem value="qty">{t('assetsConfig.trackQty')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={busy || !newName.trim()} onClick={addCategory}>
              {busy ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mb-6 -ml-[16.5rem] -mr-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
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
