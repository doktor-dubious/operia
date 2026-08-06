// AI-label-scanning på modtag-formularen: fotografér/upload pakkelabelen og
// lad kundens valgte AI-model (Konfigurér → Integrationer) udfylde felterne.
// Selve AI-kaldet sker i edge-funktionen ai-read-label — API-nøglerne findes
// kun på serveren, og serveren genchecker platformens udvalg og kundens valg.
// Knappen vises kun når AI er sat op med en vision-model (spejler
// Repository.aiLabelAvailable på håndterminalen).
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PhotoCapture } from '@/components/photo-capture'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { AI_MODELS } from '@/lib/ai'
import { supabase } from '@/lib/supabase'

/** Felterne ai-read-label kan udtrække — spejler LABEL_SCHEMA i funktionen. */
export type AiLabelFields = {
  receiver_name: string | null
  receiver_address: string | null
  receiver_phone: string | null
  sender_name: string | null
  sender_address: string | null
  sender_phone: string | null
  carrier: string | null
  service: string | null
  tracking_number: string | null
  reference: string | null
  weight_kg: number | null
  label_date: string | null
}

// Årsager fra ai-read-label vi kan oversætte til en handlingsanvisende besked.
// Skal følge funktionens ProviderError-årsager og dens 4xx-fejlkoder — en årsag
// der mangler her ender som den intetsigende generiske besked.
const KNOWN_REASONS = new Set([
  'integration_disabled',
  'not_configured',
  'not_allowed',
  'model_no_vision',
  'provider_key_missing',
  'provider_auth',
  'rate_limited',
  'refused',
  'provider_rejected',
  'provider_down',
  'truncated',
  'image_too_large',
  'unsupported_media_type',
  'provider_error',
  'empty_response',
  'network',
  'forbidden',
  'unauthorized',
])

/** Fejlkoden i en non-2xx-krop (fx 413 image_too_large), hvis den kan læses. */
async function reasonFromHttpError(e: unknown): Promise<string> {
  // Kaldet nåede aldrig serveren (netværk, proxy, afbrudt upload). Uden svar er
  // der ingen årsag at læse — så sig det, frem for at kalde det en AI-fejl.
  if ((e as Error)?.name === 'FunctionsFetchError') return 'network'
  const res = (e as { context?: Response }).context
  if (!(res instanceof Response)) return ''
  try {
    const body = await res.clone().json()
    return typeof body?.error === 'string' ? body.error : ''
  } catch {
    return ''
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// Nedskalering før upload. Et uploadet telefonfoto er typisk 3–12 MB, hvor
// funktionens loft er ~6 MB (8 mio. base64-tegn) — og de ekstra megabytes køber
// ikke bedre OCR.
//
// Målt 2026-08-06 (3 PostNord-labels gennem ai-read-labels prompt+skema, hvor
// labelen fylder hele billedet — tallene er altså opløsningen af SELVE labelen,
// ikke af fotoet):
//   1000 px q70 (51 KB): alle felter korrekte
//    800 px q70 (38 KB): alle felter korrekte
//    600 px q65 (22 KB): sporingsnummerets sidste ciffer falder væk
//    500 px q60 (16 KB): sporingsnummer + adresse forvanskes
// Gulvet ligger altså mellem 800 og 600 px for label-arealet, og det er
// sporingsnummeret der ryger først — netop det felt track & trace hænger på.
//
// Derfor 1600 og ikke lavere: på et foto hvor labelen fylder ~1/3 af billedet
// giver 1600 px kun ~530 px label, hvilket er under det målte gulv. Marginen
// her dækker almindelig framing. Samme værdi som håndterminalens readScaledJpeg
// (PhotoHelpers.kt), så de to klienter opfører sig ens.
const MAX_DIM = 1600
const JPEG_QUALITY = 0.8
/** Små billeder sendes uændret — genkomprimering ville kun tabe detaljer. */
const KEEP_AS_IS_BYTES = 300_000

/**
 * Skalerer til ≤ MAX_DIM og genkomprimerer som JPEG. Kan billedet ikke dekodes
 * (fx HEIC fra en iPhone), sendes originalen videre, så serveren kan svare med
 * en præcis årsag frem for at vi fejler tavst her.
 */
async function downscale(blob: Blob): Promise<{ data: Blob; mediaType: string }> {
  const asIs = { data: blob, mediaType: blob.type || 'image/jpeg' }
  if (blob.size <= KEEP_AS_IS_BYTES) return asIs
  let bitmap: ImageBitmap
  try {
    // from-image: respekter EXIF-rotation, så et stående telefonfoto ikke havner
    // på siden hos modellen.
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    return asIs
  }
  try {
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return asIs
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    )
    // Genkomprimeringen kan i sjældne tilfælde give et større billede (fx en
    // kraftigt komprimeret original i fuld opløsning) — behold da originalen.
    if (!out || out.size >= blob.size) return asIs
    return { data: out, mediaType: 'image/jpeg' }
  } finally {
    bitmap.close()
  }
}

export function AiLabelScan({
  companyId,
  onFields,
}: {
  companyId: string
  onFields: (fields: AiLabelFields) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { data: platform } = usePlatformSettings()
  const [open, setOpen] = useState(false)
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [reading, setReading] = useState(false)

  const { data: cfg } = useQuery({
    queryKey: ['company-ai', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_ai_config')
        .select('provider, model')
        .eq('company_id', companyId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  // Samme kæde som serveren: hovedafbryder → udvalg → kundens valg → vision.
  // Serveren genchecker alligevel; dette styrer kun om knappen vises.
  const model = AI_MODELS.find((m) => m.key === cfg?.model)
  const available =
    !!platform?.ai_enabled &&
    !!cfg?.provider &&
    !!model &&
    model.vision &&
    model.provider === cfg.provider &&
    (platform.ai_providers ?? []).includes(cfg.provider) &&
    (platform.ai_models ?? []).includes(model.key)

  if (!available) return null

  const read = async () => {
    if (!photo) return
    setReading(true)
    try {
      const scaled = await downscale(photo)
      const image = await toBase64(scaled.data)
      const { data, error } = await supabase.functions.invoke('ai-read-label', {
        // companyId bruges kun af serveren når kalderen er platform-admin (og
        // dermed ikke har en egen virksomhed); for kunde-brugere ignoreres den.
        body: { image, mediaType: scaled.mediaType, companyId },
      })
      if (error) throw error
      if (!data?.ok) {
        const reason: string = data?.reason ?? ''
        toast.error(
          KNOWN_REASONS.has(reason)
            ? t(`companyAi.scanFailed_${reason}`)
            : t('companyAi.scanFailed_generic'),
        )
        return
      }
      await onFields(data.fields as AiLabelFields)
      setOpen(false)
      setPhoto(null)
    } catch (e) {
      console.error('AI-label-læsning fejlede:', e)
      const reason = await reasonFromHttpError(e)
      toast.error(
        KNOWN_REASONS.has(reason)
          ? t(`companyAi.scanFailed_${reason}`)
          : t('companyAi.scanFailed_generic'),
      )
    } finally {
      setReading(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() => setOpen(true)}
      >
        <Sparkles className="size-3.5" />
        {t('receive.aiScanButton')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (reading) return
          setOpen(o)
          if (!o) setPhoto(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('receive.aiScanTitle')}</DialogTitle>
            <DialogDescription>{t('receive.aiScanBody')}</DialogDescription>
          </DialogHeader>
          <PhotoCapture photo={photo} onPhoto={setPhoto} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={reading}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void read()} disabled={!photo || reading}>
              {reading ? t('receive.aiScanReading') : t('receive.aiScanRead')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
