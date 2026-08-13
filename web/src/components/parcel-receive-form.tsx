import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Camera, Eraser, Layers, Printer, Sparkles, Wand2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { looksLikeUrl } from '@/lib/barcode-rules'
import { AiLabelScan, type AiLabelFields } from '@/components/ai-label-scan'
import { isCorrection, matchLabelFields, type MatchedEmployee } from '@/lib/ai-match'
import { useCompanyAiConfig } from '@/hooks/use-company-ai-config'
import { BarcodeUrlDialog } from '@/components/barcode-url-dialog'
import { useCompany } from '@/components/company-provider'
import { EmployeePicker, type PickedEmployee } from '@/components/employee-picker'
import { SenderCombobox } from '@/components/sender-combobox'
import { printLabel } from '@/components/label-designer'
import { PhotoCapture } from '@/components/photo-capture'
import { ScannerIndicator } from '@/components/scanner-indicator'
import type { ParcelStatus } from '@/components/parcel-status-badge'
import { normalizeScan, useBarcodeScanner } from '@/hooks/use-barcode-scanner'
import { useParcelLabelDesign } from '@/hooks/use-label-design'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { hasValidEmail, hasValidMsisdn } from '@/lib/notify-contact'
import { supabase } from '@/lib/supabase'

// Modtag pakke (spec Flow 1): stregkode → modtager-autocomplete (afdeling
// auto-udfyldes) → valgfri fragtfirma/håndtering/placering, tilstandsfoto
// (fil eller webcam) og note → gem. Uden modtager registreres pakken som
// 'unassigned' (håndhæves af DB-guarden).
//
// Genbruges på /parcels/receive (fuld side) og som popup på /parcels.

const NONE = '__none__'

// Felter AI-label-læsningen kan udfylde. Markeres i formularen med en lilla
// kant, indtil brugeren selv retter feltet — en AI-aflæsning er et forslag, og
// den der gemmer pakken skal kunne se hvad der ikke er tastet af et menneske.
type AiField = 'barcode' | 'receiver' | 'department' | 'sender' | 'carrier'

// Kant + svag glød i --ai-filled. Vinder over feltets egen border-klasse
// (samme specificitet, senere i klasselisten via cn), men ikke over
// focus-visible-ringen — det fokuserede felt ser stadig normalt ud.
const AI_FIELD_CLASS = 'border-ai-filled ring-2 ring-ai-filled/25'

// En pakke i batch-listen: koden + et valgfrit tilstandsfoto (fx hvis netop
// dén pakke er beskadiget — resten af batchen deler de øvrige felter).
type BatchItem = {
  code: string
  photo: Blob | null
}

export type ParcelSessionEntry = {
  id: string
  barcode: string
  receiver: string | null
  status: ParcelStatus
  // Nok til at printe pakkens label igen fra sessionslisten, uden at hente
  // pakken forfra.
  department: string | null
  carrier: string | null
}

// En afsluttet batch — nok til at printe batch-labelen (kun web) uden at hente
// batchen forfra.
export type BatchSessionEntry = {
  id: string
  batchCode: string
  receiver: string | null
  count: number
  department: string | null
}

function useMasterData(companyId: string | null) {
  return useQuery({
    queryKey: ['receive-master-data', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const [departments, carriers, handling, locations] = await Promise.all([
        supabase.from('departments').select('id, name').eq('company_id', companyId!).order('name'),
        supabase
          .from('carriers')
          .select('id, name')
          .eq('company_id', companyId!)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('handling_classes')
          .select('id, name')
          .eq('company_id', companyId!)
          .order('name'),
        supabase
          .from('storage_locations')
          .select('id, name')
          .eq('company_id', companyId!)
          .eq('is_active', true)
          .order('name'),
      ])
      const firstError = departments.error ?? carriers.error ?? handling.error ?? locations.error
      if (firstError) throw firstError
      return {
        departments: departments.data!,
        carriers: carriers.data!,
        handling: handling.data!,
        locations: locations.data!,
      }
    },
  })
}

// Afsender er fri tekst uden stamdata — forslagene er virksomhedens egne
// tidligere afsendere (hyppigst brugte først). Egen query, fordi listen
// genindlæses efter hver gemning med afsender: den må ikke trække de fire
// stamdata-opslag med sig hver gang.
function useSenderSuggestions(companyId: string | null) {
  return useQuery({
    queryKey: ['sender-suggestions', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      // Forslag er nice-to-have: fejler opslaget, virker formularen stadig
      // (feltet er bare uden autocomplete).
      const { data, error } = await supabase.rpc('parcel_sender_suggestions', {
        p_company_id: companyId!,
      })
      return error ? [] : (data ?? [])
    },
  })
}

// Upload tilstandsfoto og hægt stien på pakken — fælles for enkelt- og
// batch-tilstand, så sti-skema/bucket/kolonne kun findes ét sted (Android har
// sin egen spejling i Repository.uploadIntakePhoto). Kaster ved fejl; pakken
// er allerede gemt, så kalderen afgør om det er fatalt eller kun en advarsel.
async function uploadConditionPhoto(companyId: string, parcelId: string, photo: Blob) {
  const path = `${companyId}/${parcelId}.jpg`
  const { error: uploadError } = await supabase.storage
    .from('parcel-photos')
    .upload(path, photo, { contentType: 'image/jpeg', upsert: true })
  if (uploadError) throw uploadError
  const { error: updateError } = await supabase
    .from('parcels')
    .update({ condition_photo_path: path })
    .eq('id', parcelId)
  if (updateError) throw updateError
}

// Virksomhedens kanal-/ankomstindstillinger + SMS-tilvalget — bruges til at
// advare ved modtagelsen, hvis den valgte modtager slet ikke kan få besked
// (ingen gyldig kontakt for de aktiverede kanaler). Kun en advarsel: pakken
// kan stadig registreres.
function useArrivalNotifyConfig(companyId: string | null) {
  return useQuery({
    queryKey: ['arrival-notify-config', companyId],
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [company, features] = await Promise.all([
        supabase
          .from('companies')
          .select('notify_email_enabled, notify_sms_enabled, parcel_arrival_enabled')
          .eq('id', companyId!)
          .single(),
        supabase
          .from('company_features')
          .select('feature_key, valid_until')
          .eq('company_id', companyId!)
          .eq('feature_key', 'sms_notifications'),
      ])
      if (company.error) throw company.error
      // Kast også ved feature-fejl: et slugt svar ville ellers blive tolket
      // som "intet SMS-tilvalg" og give en falsk (eller manglende) advarsel.
      if (features.error) throw features.error
      const today = new Date().toISOString().slice(0, 10)
      const hasSms = (features.data ?? []).some(
        (f) => f.valid_until == null || f.valid_until >= today,
      )
      return { company: company.data, hasSms }
    },
  })
}

export function ParcelReceiveForm({
  companyId,
  onReceived,
  onBatchFinished,
}: {
  companyId: string
  // Kaldes efter en vellykket registrering. Formularen nulstiller sig selv
  // bagefter, så siden kan modtage næste pakke; en popup kan lukke sig her.
  onReceived?: (entry: ParcelSessionEntry) => void
  // Kaldes når en batch afsluttes (batch-tilstand). Bærer nok til at printe
  // batch-labelen. Er den ikke sat, skjules batch-tilstanden (fx i popup'en).
  onBatchFinished?: (entry: BatchSessionEntry) => void
}) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { activeCompany } = useCompany()
  const { data: master } = useMasterData(companyId)
  const { data: senders } = useSenderSuggestions(companyId)
  const { data: platform } = usePlatformSettings()
  const { data: notifyCfg } = useArrivalNotifyConfig(companyId)
  // match_enabled: skal AI-aflæsningen fortolkes mod virksomhedens egne data?
  const { data: aiCfg } = useCompanyAiConfig(companyId)
  // Pakkelabelen (virksomhedens udgave, ellers platformens) — til print-knappen.
  const { data: labelDesign } = useParcelLabelDesign(companyId)

  const [barcode, setBarcode] = useState('')
  const [duplicate, setDuplicate] = useState(false)
  // Tælles op ved hver hardware-scanning, så ScannerIndicator kan blinke.
  const [scanSignal, setScanSignal] = useState(0)
  const [receiver, setReceiver] = useState<PickedEmployee | null>(null)
  const [sender, setSender] = useState('')
  const [departmentId, setDepartmentId] = useState<string>(NONE)
  const [carrierId, setCarrierId] = useState<string>(NONE)
  const [handlingId, setHandlingId] = useState<string>(NONE)
  const [locationId, setLocationId] = useState<string>(NONE)
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [confirmUnassignedOpen, setConfirmUnassignedOpen] = useState(false)
  // Batch-tilstand: samme modtager for hele batchen, scan lægger sig i en liste,
  // og "afslut batch" opretter batchen + alle pakker på én gang → én notifikation.
  // Hver pakke i batchen kan få sit eget tilstandsfoto (fx en beskadiget pakke).
  const batchAvailable = !!onBatchFinished
  const [batchMode, setBatchMode] = useState(false)
  const [batchItems, setBatchItems] = useState<BatchItem[]>([])
  // Koder i batch-listen der allerede stod som åbne pakker i databasen, og som
  // brugeren bekræftede alligevel — markeres i listen som påmindelse.
  const [batchDupes, setBatchDupes] = useState<Set<string>>(new Set())
  // Scan-værn (samme warn-and-allow som aktiver/enkelt-tilstand): URL-lignende
  // koder bekræftes før brug, og en kode der allerede står som åben pakke
  // bekræftes efter tilføjelsen. Køer, ikke enkeltfelter — en hardware-scanner
  // kan nå at fyre igen, mens en dialog står åben, og så må den første kode
  // ikke overskrives og forsvinde.
  const [pendingUrls, setPendingUrls] = useState<string[]>([])
  const [pendingDups, setPendingDups] = useState<string[]>([])
  // Remount-nøgle: EmployeePicker har intern skrivetilstand, som skal nulstilles
  // sammen med formularen — ellers står et forældet navn tilbage i feltet.
  const [formKey, setFormKey] = useState(0)
  // Felter udfyldt af den seneste AI-label-læsning (se AI_FIELD_CLASS).
  const [aiFilled, setAiFilled] = useState<Set<AiField>>(new Set())
  // Hvad labelen SAGDE, når fortolkningslaget rettede det til noget andet.
  // Vises under feltet: en rettelse skal kunne ses og forkastes, ikke ske i
  // det skjulte.
  const [aiRaw, setAiRaw] = useState<Partial<Record<AiField, string>>>({})
  // Modtager-kandidater når navnet ikke kunne matches entydigt — vist som
  // forslag under vælgeren. Et gæt her ville ramme den forkerte person.
  const [receiverCandidates, setReceiverCandidates] = useState<MatchedEmployee[]>([])
  // Labelens modtagernavn, sat som starttekst i vælgeren ved uklart match.
  const [receiverQuery, setReceiverQuery] = useState('')
  // Nært beslægtet, tidligere brugt afsender — tilbydes, snappes aldrig.
  const [senderSuggestion, setSenderSuggestion] = useState<string | null>(null)
  const barcodeRef = useRef<HTMLInputElement>(null)

  // Klasser til et felt, hvis AI'en udfyldte det.
  const aiMark = (field: AiField) => (aiFilled.has(field) ? AI_FIELD_CLASS : undefined)

  // Brugeren har rørt feltet — så er værdien ikke længere AI'ens, og hverken
  // markering, label-tekst eller forslag hører til feltet mere.
  const clearAiMark = (field: AiField) => {
    setAiFilled((s) => {
      if (!s.has(field)) return s
      const next = new Set(s)
      next.delete(field)
      return next
    })
    setAiRaw((r) => (field in r ? { ...r, [field]: undefined } : r))
    if (field === 'receiver') setReceiverCandidates([])
    if (field === 'sender') setSenderSuggestion(null)
  }

  // Punkt 3 i notifikationskravet: kan den valgte modtager slet ikke nås på
  // nogen af de aktiverede kanaler, meldes det ved modtagelsen — samme
  // effektive regler (override ?? platform, SMS kræver tilvalget) som
  // dispatch-parcel-notifications. Mangler konfigurationen (endnu ikke hentet),
  // vises ingen advarsel frem for en falsk.
  const receiverUnreachable = (() => {
    if (!receiver || !platform || !notifyCfg) return false
    if (!platform.parcel_notifications_enabled) return false
    const co = notifyCfg.company
    if (!(co.parcel_arrival_enabled ?? platform.parcel_arrival_enabled)) return false
    const emailOn = co.notify_email_enabled ?? platform.notify_email_enabled
    const smsOn = (co.notify_sms_enabled ?? platform.notify_sms_enabled) && notifyCfg.hasSms
    if (!emailOn && !smsOn) return false
    return !(
      (emailOn && hasValidEmail(receiver.email)) ||
      (smsOn && hasValidMsisdn(receiver.phone))
    )
  })()

  // Modtagervalg auto-udfylder afdeling (spec Flow 1)
  const pickReceiver = (employee: PickedEmployee | null) => {
    setReceiver(employee)
    if (employee?.department_id) setDepartmentId(employee.department_id)
  }

  // Modtagervalg fra brugeren selv (AI-læsningen kalder pickReceiver direkte):
  // fjerner AI-markeringen på både modtager og den afdeling, valget følger med.
  const pickReceiverManually = (employee: PickedEmployee | null) => {
    pickReceiver(employee)
    clearAiMark('receiver')
    if (employee?.department_id) clearAiMark('department')
  }

  // Udfyld formularen fra AI-læste label-felter (AiLabelScan).
  //
  // Navnene fra labelen fortolkes mod virksomhedens egne data i RPC'en
  // ai_match_label_fields (dansk foldning + fuzzy-lighed), så "AAse
  // Østergård"/"Åse Ostergård"/"Åse Østegård" alle finder Åse Østergård, og
  // "PostNorb" finder PostNord. Serveren afgør hvad der er ET ENTYDIGT match
  // (auto) og hvad der kun er forslag: et gæt blandt flere kandidater ville
  // sende både pakken og ankomstbeskeden til den forkerte person.
  //
  // Kan kunden ikke lide fortolkningen, slås den fra pr. virksomhed
  // (match_enabled) — så gælder den gamle regel: kun eksakte/entydige match.
  const applyAiFields = async (f: AiLabelFields) => {
    // Felterne denne læsning sætter. Erstatter markeringen fra en tidligere
    // læsning: står et felt tilbage fra sidste gang, uden at denne læsning
    // satte det, er markeringen ikke længere sand.
    const marks = new Set<AiField>()
    const raw: Partial<Record<AiField, string>> = {}
    // Tælles undervejs: beskeden til sidst skal afspejle, hvad der FAKTISK
    // blev sat i formularen — også et transportør-match alene. Ellers meldes
    // "intet aflæst", mens fx transportør-feltet netop har skiftet værdi.
    let applied = false

    const matching = aiCfg?.match_enabled !== false
    const matchResult = matching
      ? await matchLabelFields(companyId, {
          receiver: f.receiver_name,
          carrier: f.carrier,
          sender: f.sender_name,
        })
      : {}
    // null = selve opslaget fejlede (ikke "intet match") → de gamle eksakte
    // regler tager over, så en forbigående RPC-fejl ikke slår al udfyldning
    // fra og melder falsk "modtageren findes ikke".
    const match = matchResult ?? {}
    const useMatch = matching && matchResult !== null

    // ---- afsender: aldrig automatisk rettet ---------------------------------
    // Afsender er fri tekst uden stamdata. At "rette" en ny afsender til en
    // gammel ville stille slå to virksomheder sammen i statistikken — så
    // labelens tekst vinder, og et nært forslag tilbydes i stedet.
    //
    // Ryd ALTID det gamle forslag først: en ny læsning uden læsbar afsender må
    // ikke efterlade forrige labels forslag-knap, klar til at stemple den
    // forkerte afsender på denne pakke.
    setSenderSuggestion(null)
    const senderName = f.sender_name?.trim()
    if (senderName) {
      setSender(senderName)
      marks.add('sender')
      applied = true
      setSenderSuggestion(match.sender?.candidates?.[0]?.name ?? null)
    }

    // ---- fragtfirma ---------------------------------------------------------
    const carrierName = f.carrier?.trim()
    if (carrierName && master) {
      const matched = match.carrier?.auto ? match.carrier.candidates[0] : null
      // Uden fortolkningslag (fravalgt eller fejlet): den gamle delstreng-
      // regel, så adfærden er uændret for kunder der har slået matchning fra.
      const fallback = useMatch
        ? null
        : master.carriers.find(
            (c) =>
              c.name.toLowerCase().includes(carrierName.toLowerCase()) ||
              carrierName.toLowerCase().includes(c.name.toLowerCase()),
          )
      const pick = matched ?? fallback
      if (pick) {
        setCarrierId(pick.id)
        marks.add('carrier')
        if (isCorrection(carrierName, pick.name)) raw.carrier = carrierName
        applied = true
      }
    }

    // ---- stregkode: ALDRIG fuzzy ------------------------------------------
    // Sporingsnummeret er pakkens identitet; et "rettet" ciffer gør pakken
    // uopsporlig. Kun den strukturelle oprydning normalizeScan står for.
    const code = normalizeScan(f.tracking_number ?? '')
    if (code) {
      setBarcode(code)
      void checkDuplicate(code)
      marks.add('barcode')
      applied = true
    }

    // ---- modtager -----------------------------------------------------------
    let receiverUnmatched: string | null = null
    let receiverAmbiguous: string | null = null
    const receiverName = f.receiver_name?.trim()
    setReceiverCandidates([])
    setReceiverQuery('')
    if (receiverName) {
      let picked: PickedEmployee | null = null
      if (useMatch) {
        const r = match.receiver
        if (r?.auto && r.candidates[0]) {
          const c = r.candidates[0]
          picked = {
            id: c.id,
            full_name: c.full_name,
            initials: c.initials,
            email: c.email,
            phone: c.phone,
            department_id: c.department_id,
            department_name: c.department_name,
          }
        } else if (r?.candidates?.length) {
          // Flere mulige — labelens navn bliver stående i feltet, og
          // kandidaterne vises som forslag under det.
          setReceiverCandidates(r.candidates)
          setReceiverQuery(receiverName)
          receiverAmbiguous = receiverName
        } else {
          setReceiverQuery(receiverName)
          receiverUnmatched = receiverName
        }
      } else {
        // Uden fortolkningslag: eksakt/entydigt delstrengs-opslag som før.
        const { data } = await supabase
          .from('employees')
          .select(
            'id, full_name, initials, email, phone, department_id, department:departments (name)',
          )
          .eq('company_id', companyId)
          .eq('is_active', true)
          // LIKE-jokertegn i OCR-støj (%, _) skal matche som tegn, ikke jokere —
          // et "entydigt" jokermatch kunne ellers vælge en forkert modtager.
          .ilike('full_name', `%${receiverName.replace(/[\\%_]/g, '\\$&')}%`)
          .limit(2)
        if (data?.length === 1) {
          const e = data[0]
          picked = {
            id: e.id,
            full_name: e.full_name,
            initials: e.initials,
            email: e.email,
            phone: e.phone,
            department_id: e.department_id,
            department_name: e.department?.name ?? null,
          }
        } else {
          setReceiverQuery(receiverName)
          receiverUnmatched = receiverName
        }
      }
      if (picked) {
        pickReceiver(picked)
        marks.add('receiver')
        if (isCorrection(receiverName, picked.full_name)) raw.receiver = receiverName
        // pickReceiver auto-udfylder afdelingen fra medarbejderen — så er også
        // dét felt udfyldt af aflæsningen og ikke af brugeren.
        if (picked.department_id) marks.add('department')
        applied = true
      } else {
        // Labelen NÆVNER en modtager, men den kunne ikke afgøres entydigt: en
        // tidligere valgt modtager må ikke blive stående i feltet. Den ville
        // både skjule kandidat-forslagene (de vises kun uden valgt modtager)
        // og — værre — sende pakken og ankomstbeskeden til den forkerte, hvis
        // der gemmes i tillid til toasten.
        setReceiver(null)
      }
    }

    setAiFilled(marks)
    setAiRaw(raw)
    // Vælgeren har intern skrivetilstand: den skal remountes for at vise
    // labelens navn (eller blive tømt), når aflæsningen ændrer den.
    setFormKey((k) => k + 1)

    if (receiverAmbiguous) {
      toast.info(t('receive.aiReceiverAmbiguous', { name: receiverAmbiguous }))
    } else if (receiverUnmatched) {
      toast.info(t('receive.aiReceiverUnmatched', { name: receiverUnmatched }))
    } else if (!applied) {
      toast.info(t('receive.aiNoFields'))
    } else {
      toast.success(t('receive.aiApplied'))
    }
  }

  // Står koden allerede som en åben pakke? (duplikat-scan er uafklaret i spec —
  // vi advarer, men blokerer ikke)
  const isOpenDuplicate = async (code: string) => {
    const { data } = await supabase
      .from('parcels')
      .select('id')
      .eq('company_id', companyId)
      .eq('barcode', code)
      // 'removed' er også slut-status: en fjernet fejlregistrering skal netop
      // kunne genregistreres uden dublet-advarsel.
      .not('status', 'in', '("delivered","returned","rejected","removed")')
      .limit(1)
    return !!data?.length
  }

  // Advarsel ved gen-scan af åben pakke.
  const checkDuplicate = async (code: string) => {
    const q = normalizeScan(code)
    setDuplicate(q ? await isOpenDuplicate(q) : false)
  }

  // Læg en kode i batch-listen (dedup inden for listen) og hold fokus i
  // scan-feltet, klar til næste scan.
  const commitBatchItem = (code: string) => {
    setBatchItems((list) =>
      list.some((item) => item.code === code) ? list : [{ code, photo: null }, ...list],
    )
    barcodeRef.current?.focus()
  }

  // Koden lander i batchen MED DET SAMME — tilføjelsen må ikke vente på
  // netværket: scanneren skal se rækken straks, og "afslut batch" må ikke
  // kunne overhale en kode, hvis dublet-opslag stadig er undervejs (så ville
  // den stille forsvinde). Opslaget kører i baggrunden; står koden allerede
  // som åben pakke, bekræftes den bagefter (behold/fjern) i en dialog.
  const enqueueBatchCode = (code: string) => {
    commitBatchItem(code)
    void isOpenDuplicate(code).then((dup) => {
      if (dup) setPendingDups((q) => (q.includes(code) ? q : [...q, code]))
    })
  }

  // Batch-tilstand: feltet ryddes med det samme; URL-lignende koder bekræftes
  // før de tilføjes, alt andet tilføjes straks.
  const addBatchItem = (raw: string) => {
    const code = normalizeScan(raw)
    if (!code) return
    setBarcode('')
    if (looksLikeUrl(code)) {
      setPendingUrls((q) => (q.includes(code) ? q : [...q, code]))
      return
    }
    enqueueBatchCode(code)
  }

  // URL-dialogens "brug alligevel": i batch-tilstand tilføjes koden som en
  // almindelig scanning; i enkelt-tilstand lander den i stregkodefeltet.
  const acceptUrlCode = (code: string) => {
    if (batchMode) {
      enqueueBatchCode(code)
      return
    }
    setBarcode(code)
    clearAiMark('barcode')
    void checkDuplicate(code)
  }

  // Første dublet-kode der stadig står i batchen. En kode der nåede at blive
  // fjernet eller gemt, inden opslaget kom tilbage, skal ikke bekræftes.
  const activeDup = pendingDups.find((c) => batchItems.some((i) => i.code === c)) ?? null

  const resolveDup = (code: string, keep: boolean) => {
    if (keep) setBatchDupes((s) => new Set(s).add(code))
    else setBatchItems((list) => list.filter((i) => i.code !== code))
    setPendingDups((q) => q.filter((c) => c !== code))
  }

  // Hardware-scanner (keyboard-wedge): en scanning hvor som helst på siden
  // udfylder stregkoden og tjekker for dublet — også uden at feltet er i fokus.
  // I batch-tilstand lægges scanningen i stedet direkte i batch-listen.
  // URL-lignende QR-koder (fx et link på en leverandørlabel) bekræftes først —
  // samme warn-and-allow som på aktiver.
  useBarcodeScanner({
    targetRef: barcodeRef,
    onScan: (code) => {
      setScanSignal((n) => n + 1)
      if (batchMode) {
        addBatchItem(code)
        return
      }
      if (looksLikeUrl(code)) {
        setPendingUrls((q) => (q.includes(code) ? q : [...q, code]))
        return
      }
      setBarcode(code)
      clearAiMark('barcode')
      checkDuplicate(code)
    },
  })

  // Ulæselig stregkode på pakken: generér en Operia-kode (fortløbende pr.
  // virksomhed, serverside — klienten kan ikke selv finde på et nummer), som
  // så printes på en ny label og klistres på pakken.
  const generateBarcode = async () => {
    setGenerating(true)
    try {
      const { data, error } = await supabase.rpc('next_parcel_barcode', {
        p_company_id: companyId,
      })
      if (error) throw error
      setBarcode(data)
      clearAiMark('barcode')
      setDuplicate(false)
      barcodeRef.current?.focus()
    } catch (error) {
      console.error('Kunne ikke generere stregkode:', error)
      toast.error(describeError(error, t))
    } finally {
      setGenerating(false)
    }
  }

  // Print en ny pakkelabel med det, der står i formularen lige nu. Bruges når
  // pakkens egen stregkode/QR-kode ikke kan læses — også før pakken gemmes, så
  // den kan mærkes med det samme.
  const printCurrentLabel = () => {
    const code = normalizeScan(barcode)
    if (!labelDesign || !code) return
    printLabel(labelDesign, i18n.language, activeCompany?.name, {
      code,
      reference: code,
      recipientName: receiver?.full_name ?? null,
      department: master?.departments.find((d) => d.id === departmentId)?.name ?? null,
      carrier: master?.carriers.find((c) => c.id === carrierId)?.name ?? null,
      date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short' }).format(new Date()),
    })
  }

  const reset = () => {
    setBarcode('')
    setDuplicate(false)
    setReceiver(null)
    setSender('')
    setDepartmentId(NONE)
    setCarrierId(NONE)
    setHandlingId(NONE)
    setLocationId(NONE)
    setNote('')
    setPhoto(null)
    setAiFilled(new Set())
    setAiRaw({})
    setReceiverCandidates([])
    setReceiverQuery('')
    setSenderSuggestion(null)
    setFormKey((k) => k + 1)
    barcodeRef.current?.focus()
  }

  // "Start forfra" — fx når AI'en læste den forkerte label, eller pakken viser
  // sig at høre til en anden modtager. reset() alene rydder kun selve
  // formularen: batch-listen og de ventende bekræftelser skal med, ellers står
  // scannede koder tilbage og bliver gemt sammen med næste pakke.
  const clearForm = () => {
    setBatchItems([])
    setBatchDupes(new Set())
    setPendingUrls([])
    setPendingDups([])
    reset()
  }

  // Er der overhovedet noget at rydde? Knappen må ikke invitere til et klik,
  // der intet gør. (Håndtering/placering tæller med — de er sat af brugeren,
  // selv om AI-læsningen ikke rører dem.)
  const hasInput =
    !!barcode.trim() ||
    !!receiver ||
    !!sender.trim() ||
    departmentId !== NONE ||
    carrierId !== NONE ||
    handlingId !== NONE ||
    locationId !== NONE ||
    !!note.trim() ||
    !!photo ||
    batchItems.length > 0

  // Uden matchet modtager bliver pakken 'unassigned' (DB-guarden). Det er en
  // gyldig, bevidst tilstand (spec Flow 1), men må ikke ske ved et uheld — så
  // gemning uden modtager kræver en eksplicit bekræftelse.
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (batchMode) {
      void finishBatch()
      return
    }
    if (!receiver) {
      setConfirmUnassignedOpen(true)
      return
    }
    void doSubmit()
  }

  // Afslut batch: opret batchen (server genererer batch_code, status 'finished')
  // og indsæt alle scannede pakker med batch_id på én gang. Én afsluttet batch ⇒
  // dispatcheren sender netop én ankomst-notifikation.
  const finishBatch = async () => {
    if (!receiver || batchItems.length === 0) return
    setSaving(true)
    try {
      const { data: batch, error: batchError } = await supabase
        .from('parcel_batches')
        .insert({
          company_id: companyId,
          receiver_employee_id: receiver.id,
          department_id: departmentId === NONE ? null : departmentId,
          status: 'finished',
        })
        .select('id, batch_code')
        .single()
      if (batchError) throw batchError

      const rows = batchItems.map((item) => ({
        company_id: companyId,
        barcode: item.code,
        receiver_employee_id: receiver.id,
        sender: sender.trim() || null,
        department_id: departmentId === NONE ? null : departmentId,
        carrier_id: carrierId === NONE ? null : carrierId,
        handling_class_id: handlingId === NONE ? null : handlingId,
        storage_location_id: locationId === NONE ? null : locationId,
        condition_note: note.trim() || null,
        batch_id: batch.id,
      }))
      const { data: inserted, error: parcelsError } = await supabase
        .from('parcels')
        .insert(rows)
        .select('id, barcode')
      if (parcelsError) throw parcelsError

      // Tilstandsfotos pr. pakke (fx en beskadiget pakke i batchen): upload
      // efter oprettelsen og hægt stien på pakken — samme sti/format som
      // enkelt-tilstand. Fejler et foto, er batchen stadig gemt: advar i
      // stedet for at rulle tilbage.
      const withPhoto = batchItems.filter((item) => item.photo)
      if (withPhoto.length > 0) {
        const idByCode = new Map((inserted ?? []).map((p) => [p.barcode, p.id]))
        const results = await Promise.all(
          withPhoto.map((item) => {
            const parcelId = idByCode.get(item.code)
            if (!parcelId) return false
            return uploadConditionPhoto(companyId, parcelId, item.photo!).then(
              () => true,
              () => false,
            )
          }),
        )
        if (results.some((ok) => !ok)) toast.warning(t('receive.batchPhotoFailed'))
      }

      queryClient.invalidateQueries({ queryKey: ['parcels'] })
      queryClient.invalidateQueries({ queryKey: ['parcel-status-counts'] })
      // En ny afsender skal med i dropdown'en allerede ved næste pakke.
      if (sender.trim()) queryClient.invalidateQueries({ queryKey: ['sender-suggestions'] })
      toast.success(t('receive.batchSaved', { count: rows.length, code: batch.batch_code }))
      onBatchFinished?.({
        id: batch.id,
        // Guard'en tildeler altid en kode ved INSERT; ?? '' er kun for typen.
        batchCode: batch.batch_code ?? '',
        receiver: receiver.full_name,
        count: rows.length,
        department: master?.departments.find((d) => d.id === departmentId)?.name ?? null,
      })
      setBatchItems([])
      setBatchDupes(new Set())
      setPendingDups([])
      reset()
    } catch (error) {
      console.error('Batch fejlede:', error)
      toast.error(describeError(error, t))
    } finally {
      setSaving(false)
    }
  }

  const doSubmit = async () => {
    setConfirmUnassignedOpen(false)
    setSaving(true)
    try {
      const { data: parcel, error } = await supabase
        .from('parcels')
        .insert({
          company_id: companyId,
          barcode: normalizeScan(barcode) || null,
          receiver_employee_id: receiver?.id ?? null,
          sender: sender.trim() || null,
          department_id: departmentId === NONE ? null : departmentId,
          carrier_id: carrierId === NONE ? null : carrierId,
          handling_class_id: handlingId === NONE ? null : handlingId,
          storage_location_id: locationId === NONE ? null : locationId,
          condition_note: note.trim() || null,
        })
        .select('id, status, barcode')
        .single()
      if (error) throw error

      if (photo) await uploadConditionPhoto(companyId, parcel.id, photo)

      queryClient.invalidateQueries({ queryKey: ['parcels'] })
      queryClient.invalidateQueries({ queryKey: ['parcel-status-counts'] })
      // En ny afsender skal med i dropdown'en allerede ved næste pakke.
      if (sender.trim()) queryClient.invalidateQueries({ queryKey: ['sender-suggestions'] })
      // Serveren genererer en intern stregkode (OPR-…) hvis der ikke blev
      // scannet én — vis DEN, så pakken kan mærkes/printes.
      toast.success(t('receive.saved', { barcode: parcel.barcode ?? parcel.id.slice(0, 8) }))
      onReceived?.({
        id: parcel.id,
        barcode: parcel.barcode ?? '—',
        receiver: receiver?.full_name ?? null,
        status: parcel.status,
        department: master?.departments.find((d) => d.id === departmentId)?.name ?? null,
        carrier: master?.carriers.find((c) => c.id === carrierId)?.name ?? null,
      })
      reset()
    } catch (error) {
      console.error('Modtagelse fejlede:', error)
      toast.error(describeError(error, t))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {batchAvailable && (
        <label className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm">
          <Checkbox
            checked={batchMode}
            onCheckedChange={(v) => {
              const on = v === true
              setBatchMode(on)
              if (!on) {
                setBatchItems([])
                setBatchDupes(new Set())
                setPendingDups([])
              }
              barcodeRef.current?.focus()
            }}
          />
          <Layers className="size-4 text-muted-foreground" />
          <span className="font-medium">{t('receive.batchMode')}</span>
          <span className="text-xs text-muted-foreground">{t('receive.batchModeHint')}</span>
        </label>
      )}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="barcode">{t('receive.barcode')}</Label>
          <ScannerIndicator signal={scanSignal} />
        </div>
        <Input
          id="barcode"
          ref={barcodeRef}
          value={barcode}
          autoFocus
          autoComplete="off"
          placeholder={t('receive.barcodePlaceholder')}
          className={aiMark('barcode')}
          onChange={(e) => {
            setBarcode(e.target.value)
            clearAiMark('barcode')
          }}
          onBlur={() => checkDuplicate(barcode)}
          onKeyDown={(e) => {
            // Scannere sender Enter — det må ikke gemme en halv formular.
            // I batch-tilstand lægger Enter koden i batch-listen.
            if (e.key === 'Enter') {
              e.preventDefault()
              if (batchMode) addBatchItem(barcode)
              else checkDuplicate(barcode)
            }
          }}
        />
        {duplicate && !batchMode && (
          <p className="text-xs text-status-neutral-to-bad">{t('receive.duplicateWarning')}</p>
        )}
        {!batchMode && looksLikeUrl(normalizeScan(barcode)) && (
          <p className="text-xs text-muted-foreground">{t('assetsPage.barcodeUrlInlineHint')}</p>
        )}
        {!batchMode && (
          /* Ulæselig stregkode/QR-kode: generér en ny kode og print en label. */
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={generating}
              onClick={() => void generateBarcode()}
            >
              <Wand2 className="size-3.5" />
              {generating ? t('common.loading') : t('receive.generateBarcode')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!labelDesign || !normalizeScan(barcode)}
              onClick={printCurrentLabel}
            >
              <Printer className="size-3.5" />
              {t('receive.printLabel')}
            </Button>
            <AiLabelScan companyId={companyId} onFields={applyAiFields} />
            <span className="text-xs text-muted-foreground">{t('receive.unreadableHint')}</span>
          </div>
        )}
      </div>

      {/* Forklaring på de lilla kanter — ellers er markeringen bare en farve.
          Uden for batch-blokken ovenfor, så den ikke forsvinder hvis der
          skiftes til batch-tilstand med markerede felter stående. */}
      {aiFilled.size > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-ai-filled">
          <Sparkles className="size-3.5 shrink-0" />
          {t('receive.aiFilledHint')}
        </p>
      )}

      {batchMode && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>{t('receive.batchItems', { count: batchItems.length })}</Label>
            {batchItems.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setBatchItems([])
                  setBatchDupes(new Set())
                  setPendingDups([])
                }}
              >
                {t('receive.batchClear')}
              </Button>
            )}
          </div>
          {batchItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('receive.batchEmpty')}</p>
          ) : (
            <ul className="max-h-40 divide-y divide-border overflow-auto rounded-md border">
              {batchItems.map((item) => (
                <li key={item.code} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{item.code}</span>
                  {batchDupes.has(item.code) && (
                    <span className="shrink-0 text-xs text-status-neutral-to-bad">
                      {t('receive.batchDuplicate')}
                    </span>
                  )}
                  <BatchPhotoCell
                    code={item.code}
                    photo={item.photo}
                    onPhoto={(photo) =>
                      setBatchItems((list) =>
                        list.map((i) => (i.code === item.code ? { ...i, photo } : i)),
                      )
                    }
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    aria-label={t('receive.batchRemove')}
                    onClick={() =>
                      setBatchItems((list) => list.filter((i) => i.code !== item.code))
                    }
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label>{t('receive.receiver')}</Label>
        <EmployeePicker
          key={formKey}
          companyId={companyId}
          value={receiver}
          onChange={pickReceiverManually}
          className={aiMark('receiver')}
          initialQuery={receiverQuery}
        />
        <AiRawHint raw={aiRaw.receiver} />
        {/* Uklart match: labelens navn står i feltet, og de mulige
            medarbejdere tilbydes her. Systemet vælger ikke selv — en forkert
            modtager sender både pakken og ankomstbeskeden til den forkerte. */}
        {!receiver && receiverCandidates.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{t('receive.aiDidYouMean')}</span>
            {receiverCandidates.map((c) => (
              <Button
                key={c.id}
                type="button"
                size="sm"
                variant="outline"
                className="h-7 border-ai-filled/60 text-xs"
                onClick={() => {
                  pickReceiver({
                    id: c.id,
                    full_name: c.full_name,
                    initials: c.initials,
                    email: c.email,
                    phone: c.phone,
                    department_id: c.department_id,
                    department_name: c.department_name,
                  })
                  setReceiverCandidates([])
                }}
              >
                {c.full_name}
                {c.department_name && (
                  <span className="text-muted-foreground">{c.department_name}</span>
                )}
              </Button>
            ))}
          </div>
        )}
        {receiverUnreachable && (
          <p className="text-xs text-status-neutral-to-bad">
            {t('receive.noContactWarning')}
          </p>
        )}
        {batchMode && !receiver && (
          <p className="text-xs text-muted-foreground">{t('receive.batchReceiverRequired')}</p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>{t('receive.department')}</Label>
          <Select
            value={departmentId}
            onValueChange={(v) => {
              setDepartmentId(v)
              clearAiMark('department')
            }}
          >
            <SelectTrigger className={cn('w-full', aiMark('department'))}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {master?.departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="sender">{t('receive.sender')}</Label>
          {/* Dropdown over virksomhedens tidligere afsendere + fri indtastning
              — nye navne gemmes med pakken og optræder i listen fremover. */}
          <SenderCombobox
            id="sender"
            value={sender}
            onChange={(v) => {
              setSender(v)
              clearAiMark('sender')
            }}
            suggestions={senders ?? []}
            className={aiMark('sender')}
          />
          {/* Afsender rettes aldrig automatisk — en ny afsender må ikke stille
              smelte sammen med en gammel. Nært beslægtet navn tilbydes her. */}
          {senderSuggestion && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 w-fit border-ai-filled/60 text-xs"
              onClick={() => {
                setSender(senderSuggestion)
                setSenderSuggestion(null)
              }}
            >
              {t('receive.aiUseSender', { name: senderSuggestion })}
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t('receive.carrier')}</Label>
          <Select
            value={carrierId}
            onValueChange={(v) => {
              setCarrierId(v)
              clearAiMark('carrier')
            }}
          >
            <SelectTrigger className={cn('w-full', aiMark('carrier'))}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {master?.carriers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AiRawHint raw={aiRaw.carrier} />
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t('receive.handling')}</Label>
          <Select value={handlingId} onValueChange={setHandlingId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {master?.handling.map((h) => (
                <SelectItem key={h.id} value={h.id}>
                  {h.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t('receive.location')}</Label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {master?.locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {!batchMode && (
        <div className="flex flex-col gap-2">
          <Label>{t('receive.photo')}</Label>
          <PhotoCapture photo={photo} onPhoto={setPhoto} />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="note">{t('receive.note')}</Label>
        <Textarea
          id="note"
          value={note}
          placeholder={t('receive.notePlaceholder')}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          disabled={saving || !hasInput}
          onClick={clearForm}
        >
          <Eraser className="size-3.5" />
          {t('receive.clearForm')}
        </Button>
        {batchMode ? (
          <Button type="submit" disabled={saving || !receiver || batchItems.length === 0}>
            {saving ? t('common.loading') : t('receive.finishBatch', { count: batchItems.length })}
          </Button>
        ) : (
          <Button type="submit" disabled={saving || (!barcode.trim() && !receiver)}>
            {saving ? t('common.loading') : t('nav.receive')}
          </Button>
        )}
      </div>
    </form>

    <Dialog
      open={confirmUnassignedOpen}
      onOpenChange={(o) => !saving && setConfirmUnassignedOpen(o)}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('receive.unassignedTitle')}</DialogTitle>
          <DialogDescription>{t('receive.unassignedBody')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setConfirmUnassignedOpen(false)}
            disabled={saving}
          >
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void doSubmit()} disabled={saving}>
            {saving ? t('common.loading') : t('receive.unassignedConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Warn-and-allow for URL-lignende scanninger (fx en QR-kode med et link):
        bekræftes før koden bruges — i batch-listen eller stregkodefeltet.
        Kø: dialogen viser første ventende kode, næste følger efter. */}
    <BarcodeUrlDialog
      code={pendingUrls[0] ?? null}
      bodyKey="receive.barcodeUrlBody"
      onOpenChange={(open) => !open && setPendingUrls((q) => q.slice(1))}
      onAccept={acceptUrlCode}
    />

    {/* Batch-tilstand: koden står allerede som åben pakke i databasen. Den ER
        tilføjet (synkront — en scanning må aldrig vente på netværket), så
        dialogen spørger om den skal fjernes igen. Luk/Behold = behold og
        markér som dublet i listen. */}
    <Dialog open={activeDup !== null} onOpenChange={(o) => !o && activeDup && resolveDup(activeDup, true)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('receive.batchDupTitle')}</DialogTitle>
          <DialogDescription>{t('receive.batchDupBody')}</DialogDescription>
        </DialogHeader>
        <p className="break-all rounded-md border bg-background/50 p-3 font-mono text-xs">
          {activeDup}
        </p>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => activeDup && resolveDup(activeDup, false)}
          >
            {t('receive.batchDupRemove')}
          </Button>
          <Button onClick={() => activeDup && resolveDup(activeDup, true)}>
            {t('receive.batchDupKeep')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}

// Hvad der stod på labelen, når fortolkningslaget rettede det til noget andet.
// En rettelse må aldrig være usynlig: den der gemmer pakken skal kunne se, at
// "PostNorb" blev til PostNord, og forkaste det hvis labelen havde ret.
function AiRawHint({ raw }: { raw?: string }) {
  const { t } = useTranslation()
  if (!raw) return null
  return (
    <p className="text-xs text-muted-foreground">{t('receive.aiRawLabel', { text: raw })}</p>
  )
}

// Foto-knap for én pakke i batch-listen: kamera-ikon uden foto, mini-
// forhåndsvisning når der er ét. Åbner en dialog med den delte PhotoCapture
// (fil eller webcam) for netop dén pakke.
function BatchPhotoCell({
  code,
  photo,
  onPhoto,
}: {
  code: string
  photo: Blob | null
  onPhoto: (photo: Blob | null) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!photo) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(photo)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
        aria-label={t('receive.batchPhotoAdd')}
        title={t('receive.batchPhotoAdd')}
        onClick={() => setOpen(true)}
      >
        {previewUrl ? (
          <img src={previewUrl} alt="" className="size-5 rounded-sm border object-cover" />
        ) : (
          <Camera className="size-3.5" />
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('receive.batchPhotoTitle')}</DialogTitle>
            <DialogDescription className="font-mono text-xs">{code}</DialogDescription>
          </DialogHeader>
          <PhotoCapture photo={photo} onPhoto={onPhoto} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
