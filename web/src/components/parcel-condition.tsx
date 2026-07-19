import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { Field } from '@/components/detail-field'
import { supabase } from '@/lib/supabase'

// Tilstands-/dokumentationsfanen på pakkens detaljepanel: intake-tilstand
// (preset + note + evt. intake-foto) og dokumentationsloggen (parcel_documents)
// — fotos + noter tilføjet over tid, typisk fra håndterminalens Tilstand-flise.
// Bucket'en er privat, så billederne vises via signerede URL'er.

const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short' })

async function signUrls(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const valid = [...new Set(paths.filter(Boolean))]
  if (!valid.length) return out
  const { data } = await supabase.storage.from('parcel-photos').createSignedUrls(valid, 3600)
  data?.forEach((s) => {
    if (s.path && s.signedUrl) out[s.path] = s.signedUrl
  })
  return out
}

const SubLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</p>
)

export function ParcelConditionTab({
  parcelId,
  conditionPreset,
  conditionNote,
  conditionPhotoPath,
}: {
  parcelId: string
  conditionPreset: string | null
  conditionNote: string | null
  conditionPhotoPath: string | null
}) {
  const { t } = useTranslation()
  const { data, isPending } = useQuery({
    // conditionPhotoPath indgår i nøglen: queryFn signerer dens URL, så ændrer
    // intake-fotoet sig (uploadet fra en anden fane/håndterminalen) skal cachen
    // også skiftes — ellers viser panelet den gamle (eller manglende) URL.
    queryKey: ['parcel-documents', parcelId, conditionPhotoPath],
    queryFn: async () => {
      const { data: docs, error } = await supabase
        .from('parcel_documents')
        .select('id, storage_path, note, created_at')
        .eq('parcel_id', parcelId)
        .order('created_at', { ascending: false })
      if (error) throw error
      const urls = await signUrls([
        ...(conditionPhotoPath ? [conditionPhotoPath] : []),
        ...docs.map((d) => d.storage_path),
      ])
      return {
        intakeUrl: conditionPhotoPath ? (urls[conditionPhotoPath] ?? null) : null,
        docs: docs.map((d) => ({ ...d, url: urls[d.storage_path] ?? null })),
      }
    },
  })

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <Field label={t('parcelDetail.condition')}>
        <span className="text-[13px]">{conditionPreset || '—'}</span>
      </Field>
      {conditionNote && (
        <Field label={t('parcelDetail.conditionNote')}>
          <span className="whitespace-pre-wrap text-[13px]">{conditionNote}</span>
        </Field>
      )}

      {data?.intakeUrl && (
        <div className="flex flex-col gap-2">
          <SubLabel>{t('parcelDetail.intakePhoto')}</SubLabel>
          <a href={data.intakeUrl} target="_blank" rel="noreferrer" className="w-fit">
            <img
              src={data.intakeUrl}
              alt=""
              className="h-32 rounded-md border object-cover transition-opacity hover:opacity-90"
            />
          </a>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <SubLabel>{t('parcelDetail.documents')}</SubLabel>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : !data?.docs.length ? (
          <p className="text-xs text-muted-foreground">{t('parcelDetail.noDocuments')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {data.docs.map((d) => (
              <div key={d.id} className="flex gap-3 rounded-md border p-3">
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noreferrer" className="shrink-0">
                    <img
                      src={d.url}
                      alt=""
                      className="size-20 rounded-md border object-cover transition-opacity hover:opacity-90"
                    />
                  </a>
                ) : (
                  <div className="grid size-20 shrink-0 place-items-center rounded-md border text-2xl">
                    📷
                  </div>
                )}
                <div className="flex flex-col gap-1 pt-0.5">
                  <span className="text-xs text-muted-foreground">
                    {dateFormat.format(new Date(d.created_at))}
                  </span>
                  {d.note && <span className="whitespace-pre-wrap text-[13px]">{d.note}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
