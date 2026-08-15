import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { StickyNote } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { DocumentDeleteButton } from '@/components/document-delete-button'
import { useAccess } from '@/hooks/use-access'
import { supabase } from '@/lib/supabase'

// Dokumentation for et aktiv: fotos + noter tilføjet over tid (asset_documents)
// — aktivernes modstykke til parcel-condition.tsx. Bucket'en er privat, så
// billeder vises via signerede URL'er.
//
// Sletning er GDPR-vejen for noter/fotos med persondata og er platform-admin-
// only (RLS + grant i 20260801180000): managere må ikke kunne fjerne
// bevismateriale, så en sletteanmodning går via DCA — som hård sletning af
// medarbejdere.

const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short' })

export async function signAssetPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const valid = [...new Set(paths.filter(Boolean))]
  if (!valid.length) return out
  const { data } = await supabase.storage.from('asset-photos').createSignedUrls(valid, 3600)
  data?.forEach((s) => {
    if (s.path && s.signedUrl) out[s.path] = s.signedUrl
  })
  return out
}

// Nøglen starter med ['asset-documents', assetId], så flow-sidernes
// invalidering (invalidateAssetQueries) rammer alle visninger.
export function useAssetDocuments(assetId: string) {
  return useQuery({
    queryKey: ['asset-documents', assetId],
    queryFn: async () => {
      const { data: docs, error } = await supabase
        .from('asset_documents')
        .select('id, storage_path, note, created_at')
        .eq('asset_id', assetId)
        .order('created_at', { ascending: false })
      if (error) throw error
      const urls = await signAssetPhotoUrls(docs.map((d) => d.storage_path ?? '').filter(Boolean))
      return docs.map((d) => ({
        ...d,
        url: d.storage_path ? (urls[d.storage_path] ?? null) : null,
      }))
    },
  })
}

// Én række: miniature (klikbar) + tidspunkt og note. Uden foto vises ingen
// billedramme — en note er en note (samme ræsonnement som parcel-condition).
function DocumentEntry({
  url,
  note,
  label,
  action,
}: {
  url: string | null
  note: string | null
  label: string
  action?: ReactNode
}) {
  const [failed, setFailed] = useState(false)
  const showImage = !!url && !failed

  return (
    <div className="flex gap-3 rounded-md border p-3">
      {showImage && (
        <a href={url} target="_blank" rel="noreferrer" className="shrink-0">
          <img
            src={url}
            alt=""
            onError={() => setFailed(true)}
            className="size-20 rounded-md border object-cover transition-opacity hover:opacity-90"
          />
        </a>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {!showImage && <StickyNote className="size-3.5 shrink-0" />}
          {label}
        </span>
        {note && <span className="whitespace-pre-wrap text-[13px]">{note}</span>}
      </div>
      {action}
    </div>
  )
}

export function AssetDocumentList({ assetId }: { assetId: string }) {
  const { t } = useTranslation()
  const { data, isPending } = useAssetDocuments(assetId)
  const { data: access } = useAccess()

  if (isPending) return <Skeleton className="h-24 w-full" />
  if (!data?.length) {
    return <p className="text-xs text-muted-foreground">{t('assetFlow.noDocuments')}</p>
  }
  return (
    <div className="flex flex-col gap-3">
      {data.map((d) => (
        <DocumentEntry
          key={d.id}
          url={d.url}
          note={d.note}
          label={dateFormat.format(new Date(d.created_at))}
          action={
            access?.isPlatformAdmin ? (
              <DocumentDeleteButton table="asset_documents" bucket="asset-photos" docId={d.id} storagePath={d.storage_path} i18nPrefix="assetFlow" invalidateKey={['asset-documents', assetId]} />
            ) : undefined
          }
        />
      ))}
    </div>
  )
}

// Kompakt blok til aktiv-popup'en/søgekortet: rendrer INTET uden dokumentation.
export function AssetDocumentBlock({ assetId }: { assetId: string }) {
  const { t } = useTranslation()
  const { data } = useAssetDocuments(assetId)
  const { data: access } = useAccess()
  if (!data?.length) return null

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('assetFlow.documents')}
      </p>
      <div className="flex flex-col gap-2">
        {data.map((d) => (
          <DocumentEntry
            key={d.id}
            url={d.url}
            note={d.note}
            label={dateFormat.format(new Date(d.created_at))}
            action={
              access?.isPlatformAdmin ? (
                <DocumentDeleteButton table="asset_documents" bucket="asset-photos" docId={d.id} storagePath={d.storage_path} i18nPrefix="assetFlow" invalidateKey={['asset-documents', assetId]} />
              ) : undefined
            }
          />
        ))}
      </div>
    </div>
  )
}
