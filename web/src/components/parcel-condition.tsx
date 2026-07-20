import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { Field } from '@/components/detail-field'
import { supabase } from '@/lib/supabase'

// Tilstand/dokumentation for en pakke: intake-tilstand (preset + note + evt.
// intake-foto) og dokumentationsloggen (parcel_documents) — fotos + noter
// tilføjet over tid fra håndterminalens Tilstand-flise eller webbens
// /parcels/condition. Bucket'en er privat, så billeder vises via signerede URL'er.

const dateFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short' })

export async function signParcelPhotoUrls(paths: string[]): Promise<Record<string, string>> {
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

// Én kilde til pakkens dokumentation: dokumentposterne + signerede URL'er
// (inkl. intake-fotoet, hvis der er ét). Nøglen starter med
// ['parcel-documents', parcelId], så /parcels/condition's invalidering rammer
// alle visninger.
export function useParcelCondition(parcelId: string, conditionPhotoPath: string | null) {
  return useQuery({
    queryKey: ['parcel-documents', parcelId, conditionPhotoPath],
    queryFn: async () => {
      const { data: docs, error } = await supabase
        .from('parcel_documents')
        .select('id, storage_path, note, created_at')
        .eq('parcel_id', parcelId)
        .order('created_at', { ascending: false })
      if (error) throw error
      const urls = await signParcelPhotoUrls([
        ...(conditionPhotoPath ? [conditionPhotoPath] : []),
        ...docs.map((d) => d.storage_path),
      ])
      return {
        intakeUrl: conditionPhotoPath ? (urls[conditionPhotoPath] ?? null) : null,
        docs: docs.map((d) => ({ ...d, url: urls[d.storage_path] ?? null })),
      }
    },
  })
}

// Én række: miniature (klikbar til fuld størrelse) + tidspunkt/etiket og note.
function ConditionEntry({
  url,
  note,
  label,
}: {
  url: string | null
  note: string | null
  label: string
}) {
  return (
    <div className="flex gap-3 rounded-md border p-3">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="shrink-0">
          <img
            src={url}
            alt=""
            className="size-20 rounded-md border object-cover transition-opacity hover:opacity-90"
          />
        </a>
      ) : (
        <div className="grid size-20 shrink-0 place-items-center rounded-md border text-2xl">📝</div>
      )}
      <div className="flex min-w-0 flex-col gap-1 pt-0.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        {note && <span className="whitespace-pre-wrap text-[13px]">{note}</span>}
      </div>
    </div>
  )
}

// Dokumentationsloggen alene — brugt af detaljepanelets Tilstand-fane og
// /parcels/condition's sidepanel.
export function ParcelDocumentList({ parcelId }: { parcelId: string }) {
  const { t } = useTranslation()
  const { data, isPending } = useParcelCondition(parcelId, null)

  if (isPending) return <Skeleton className="h-24 w-full" />
  if (!data?.docs.length) {
    return <p className="text-xs text-muted-foreground">{t('parcelDetail.noDocuments')}</p>
  }
  return (
    <div className="flex flex-col gap-3">
      {data.docs.map((d) => (
        <ConditionEntry
          key={d.id}
          url={d.url}
          note={d.note}
          label={dateFormat.format(new Date(d.created_at))}
        />
      ))}
    </div>
  )
}

// Kompakt tilstandsblok til pakke-popup'en: intake-note/-foto først, derefter
// dokumentationsposterne. Rendrer INTET hvis pakken ingen dokumentation har, så
// popup'en ikke får en tom sektion.
export function ParcelConditionBlock({
  parcelId,
  conditionNote,
  conditionPhotoPath,
}: {
  parcelId: string
  conditionNote: string | null
  conditionPhotoPath: string | null
}) {
  const { t } = useTranslation()
  const { data } = useParcelCondition(parcelId, conditionPhotoPath)
  const hasIntake = !!(conditionNote || data?.intakeUrl)
  const docs = data?.docs ?? []
  if (!hasIntake && docs.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <SubLabel>{t('parcelDetail.documents')}</SubLabel>
      <div className="flex flex-col gap-2">
        {hasIntake && (
          <ConditionEntry
            url={data?.intakeUrl ?? null}
            note={conditionNote}
            label={t('parcelDetail.intakePhoto')}
          />
        )}
        {docs.map((d) => (
          <ConditionEntry
            key={d.id}
            url={d.url}
            note={d.note}
            label={dateFormat.format(new Date(d.created_at))}
          />
        ))}
      </div>
    </div>
  )
}

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
  const { data } = useParcelCondition(parcelId, conditionPhotoPath)

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
        <ParcelDocumentList parcelId={parcelId} />
      </div>
    </div>
  )
}
