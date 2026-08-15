import { useState } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { supabase } from '@/lib/supabase'

// Fælles sletteknap for dokumentationsposter — pakker (parcel_documents /
// parcel-photos) og aktiver (asset_documents / asset-photos) deler flowet.
//
// Kun platform-admins (DCA): dokumentationen er bevismateriale, og kunden må
// ikke kunne fjerne beviser i en tvist. Databasen håndhæver det samme
// (delete-politikkerne fra 20260801180000/20260814190000), så knappens fravær
// i UI'et er bekvemmelighed, ikke sikkerhed.
//
// Rækken slettes FØR filen: RLS afgør retten, og delete-triggeren logger
// hændelsen ('document_deleted'). Fejler filfjernelsen bagefter, ER posten
// slettet — men sletningen VAR en GDPR-handling, så det meldes som fejl frem
// for succes, og filen skal væk ad anden vej (pakkefiler fanges af det natlige
// oprydningsjob; aktivfiler fjernes manuelt).
export function DocumentDeleteButton({
  table,
  bucket,
  docId,
  storagePath,
  i18nPrefix,
  invalidateKey,
}: {
  table: 'parcel_documents' | 'asset_documents'
  bucket: 'parcel-photos' | 'asset-photos'
  docId: string
  storagePath: string | null
  i18nPrefix: 'parcelDetail' | 'assetFlow'
  invalidateKey: QueryKey
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 self-start text-muted-foreground hover:text-destructive"
        title={t(`${i18nPrefix}.documentDelete`)}
        aria-label={t(`${i18nPrefix}.documentDelete`)}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5" />
      </Button>
      <ConfirmDeleteDialog
        open={open}
        onOpenChange={setOpen}
        title={t(`${i18nPrefix}.documentDeleteTitle`)}
        description={t(`${i18nPrefix}.documentDeleteWarning`)}
        acknowledgeText={t(`${i18nPrefix}.documentDeleteAcknowledge`)}
        confirmLabel={t(`${i18nPrefix}.documentDelete`)}
        onConfirm={async () => {
          // Tom svarliste = RLS afviste (ikke platform-admin) — ellers ville
          // UI'et melde "slettet" om en post der stadig findes.
          const { data: deleted, error } = await supabase
            .from(table)
            .delete()
            .eq('id', docId)
            .select('id')
          if (error) throw error
          if (!deleted?.length) throw new Error(t('common.noPermission'))
          if (storagePath) {
            // remove() fejler ikke på en sti uden fil — den returnerer bare en
            // tom liste — så begge udfald tjekkes.
            const { data: removed, error: fileError } = await supabase.storage
              .from(bucket)
              .remove([storagePath])
            if (fileError || !removed?.length) {
              console.error('Foto-fil kunne ikke fjernes:', fileError ?? 'ingen fil på stien')
              toast.error(t('common.documentFileDeleteFailed'))
              void queryClient.invalidateQueries({ queryKey: invalidateKey })
              return
            }
          }
          toast.success(t(`${i18nPrefix}.documentDeletedToast`))
          void queryClient.invalidateQueries({ queryKey: invalidateKey })
        }}
      />
    </>
  )
}
