import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BarcodeConflictDialog, useAssetBarcodeConflict } from '@/components/asset-barcode-conflict'
import { BarcodeUrlDialog } from '@/components/barcode-url-dialog'
import { ScannerIndicator } from '@/components/scanner-indicator'
import { normalizeScan, useBarcodeScanner } from '@/hooks/use-barcode-scanner'
import { assetRpcErrorKey } from '@/lib/asset-lookup'
import { barcodeProblem, barcodeProblemKey, looksLikeUrl } from '@/lib/barcode-rules'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// Opret-aktiv-formularen. Bor her frem for i assets.index, fordi den bruges to
// steder: dialogen på Aktiver-siden og den selvstændige side /assets/new.
//
// Aktiv-nr. tastes ikke — serveren tildeler det (next_asset_no) efter kundens
// valgte nummerserie, og feltet vises kun skrivebeskyttet. Ved ét aktiv hentes
// nummeret når formularen åbnes, så brugeren ser præcis det nummer der gemmes.
// En fortløbende serie kan derfor få huller, hvis formularen fortrydes — det er
// med vilje (samme afvejning som "Generér stregkode" på Modtag pakke): et
// synligt, endeligt nummer er vigtigere end en hulløs række.
//
// Antal > 1 opretter flere aktiver med samme navn/kategori/placering via
// create_assets_batch. Serienr. og stregkode er pr. enhed og kan ikke deles i en
// batch: stregkoden sættes bagefter, aktiv for aktiv, i listen over de oprettede
// aktiver — samme mønster som tilstandsfotos pr. pakke i batch-modtagelsen.

export const NONE = '__none__'
export const MAX_BATCH_COUNT = 200

export type AssetPicker = { id: string; name: string }

type CreatedAsset = { id: string; asset_tag: string }

export function useAssetPickers(companyId: string | null) {
  return useQuery({
    queryKey: ['asset-pickers', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const [categories, locations] = await Promise.all([
        supabase
          .from('asset_categories')
          .select('id, name')
          .eq('company_id', companyId!)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('asset_locations')
          .select('id, name')
          .eq('company_id', companyId!)
          .eq('is_active', true)
          .order('name'),
      ])
      const err = categories.error ?? locations.error
      if (err) throw err
      return {
        categories: categories.data as AssetPicker[],
        locations: locations.data as AssetPicker[],
      }
    },
  })
}

export function PickerSelect({
  value,
  onChange,
  items,
}: {
  value: string
  onChange: (v: string) => void
  items: AssetPicker[]
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>—</SelectItem>
        {items.map((it) => (
          <SelectItem key={it.id} value={it.id}>
            {it.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function NewAssetForm({
  companyId,
  categories,
  locations,
  scanEnabled,
  onCreated,
  onFinish,
  onShowAsset,
  finishLabel,
}: {
  companyId: string | null
  categories: AssetPicker[]
  locations: AssetPicker[]
  // Scanningen slås fra, når formularen ligger skjult bag en lukket dialog.
  scanEnabled: boolean
  // Der blev oprettet noget — værten opdaterer sine lister.
  onCreated: () => void
  // Brugeren er færdig: dialogen lukker, siden nulstiller til en tom formular.
  // Ved ét aktiv sker det straks efter oprettelsen; ved en batch først når
  // stregkoderne er sat og brugeren trykker Færdig.
  onFinish: () => void
  // "Gå til aktivet" fra stregkode-konfliktdialogen.
  onShowAsset: (assetId: string) => void
  finishLabel: string
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [serialNo, setSerialNo] = useState('')
  const [barcode, setBarcode] = useState('')
  const [categoryId, setCategoryId] = useState(NONE)
  const [locationId, setLocationId] = useState(NONE)
  const [count, setCount] = useState('1')
  const [busy, setBusy] = useState(false)

  // Sat når en batch er oprettet: så viser formularen listen over de oprettede
  // aktiver i stedet for felterne, så stregkoderne kan sættes enkeltvis.
  const [created, setCreated] = useState<CreatedAsset[] | null>(null)

  // Det tildelte Aktiv-nr. (kun ved ét aktiv). Null = ikke hentet endnu.
  const [assetNo, setAssetNo] = useState<string | null>(null)
  const [assetNoBusy, setAssetNoBusy] = useState(false)

  // Oversætteren holdes i en ref og uden for afhængighederne: `t` skifter
  // identitet ved sprogskift, og et hentekald pr. sprogskift ville brænde et
  // nummer i den fortløbende serie hver gang.
  const tRef = useRef(t)
  tRef.current = t

  // Generationstæller: skifter virksomheden (CompanySwitcher) mens et kald er
  // undervejs, må det gamle svar hverken vises eller kunne gemmes — nummeret
  // hører til den forrige virksomheds serie.
  const fetchGen = useRef(0)

  const fetchAssetNo = useCallback(async () => {
    const gen = ++fetchGen.current
    setAssetNo(null)
    if (!companyId) return
    setAssetNoBusy(true)
    const { data, error } = await supabase.rpc('next_asset_no', { p_company_id: companyId })
    if (gen !== fetchGen.current) return // overhalet af et nyere kald
    setAssetNoBusy(false)
    if (error || !data) {
      console.error('Kunne ikke hente aktiv-nr.:', error)
      setAssetNo(null)
      const key = error ? assetRpcErrorKey(error) : null
      toast.error(
        key
          ? tRef.current(key)
          : error
            ? describeError(error, tRef.current)
            : tRef.current('assetsPage.tagUnavailable'),
      )
      return
    }
    setAssetNo(data)
  }, [companyId])

  useEffect(() => {
    void fetchAssetNo()
  }, [fetchAssetNo])

  const countNum = Number(count)
  const countValid =
    count.trim() !== '' &&
    Number.isInteger(countNum) &&
    countNum >= 1 &&
    countNum <= MAX_BATCH_COUNT
  const batch = countValid && countNum > 1

  // Hardware-scanner: en scanning lander i stregkodefeltet (normaliseret),
  // uanset hvilket felt fokus står i. Slået fra i batch-tilstand — dér har
  // formularen intet stregkodefelt, og scanningerne hører til bagefter i listen.
  const barcodeRef = useRef<HTMLInputElement>(null)
  const [scanSignal, setScanSignal] = useState(0)
  const [pendingUrlCode, setPendingUrlCode] = useState<string | null>(null)
  useBarcodeScanner({
    enabled: scanEnabled && !batch && !created,
    targetRef: barcodeRef,
    // Formularen har præcis én scan-destination — en scanning skal i
    // stregkodefeltet, uanset om markøren stod i Navn/Serienr.
    captureInForeignInputs: true,
    onScan: (code) => {
      setScanSignal((n) => n + 1)
      if (looksLikeUrl(code)) {
        setPendingUrlCode(code)
        return
      }
      setBarcode(code)
    },
  })
  const barcodeIssue = barcodeProblem(normalizeScan(barcode))

  // Live-tjek som i detaljepanelet: konflikt → popup + spærret Gem.
  const { conflict: barcodeConflict, code: normalizedBarcode } = useAssetBarcodeConflict(
    batch ? null : companyId,
    barcode,
  )
  const [conflictOpen, setConflictOpen] = useState(false)
  const warnedForCode = useRef<string | null>(null)
  useEffect(() => {
    if (barcodeConflict && warnedForCode.current !== normalizedBarcode) {
      warnedForCode.current = normalizedBarcode
      setConflictOpen(true)
    }
  }, [barcodeConflict, normalizedBarcode])

  const trimmed = name.trim()

  const createOne = async () => {
    if (!companyId || !assetNo) return false
    const { error } = await supabase.from('assets').insert({
      company_id: companyId,
      // Nummeret er hentet fra serveren, ikke tastet — det sendes med, så
      // aktivet får præcis det nummer brugeren fik vist.
      asset_tag: assetNo,
      name: trimmed,
      serial_no: serialNo.trim() || null,
      barcode: normalizeScan(barcode) || null,
      category_id: categoryId === NONE ? null : categoryId,
      location_id: locationId === NONE ? null : locationId,
    })
    if (error) {
      console.error('Kunne ikke oprette aktiv:', error)
      // 23505 = unik-constraint. Aktivet har to (aktiv-nr. og stregkode), så
      // constraint-navnet afgør hvilket felt brugeren skal rette.
      if (error.code === '23505') {
        if (error.message.includes('barcode')) {
          toast.error(t('assetsPage.barcodeTaken'))
          return false
        }
        // Kapløb om nummeret (to formularer åbne på én gang): hent et nyt, så
        // brugeren kan gemme igen uden at starte forfra.
        toast.error(t('assetsPage.tagTakenRetry'))
        void fetchAssetNo()
        return false
      }
      toast.error(describeError(error, t))
      return false
    }
    toast.success(t('assetsPage.createdToast', { name: trimmed }))
    return true
  }

  const createMany = async () => {
    if (!companyId) return false
    const { data, error } = await supabase.rpc('create_assets_batch', {
      p_company_id: companyId,
      p_count: countNum,
      p_name: trimmed,
      p_category_id: categoryId === NONE ? undefined : categoryId,
      p_location_id: locationId === NONE ? undefined : locationId,
    })
    if (error) {
      console.error('Kunne ikke oprette aktiver:', error)
      const key = assetRpcErrorKey(error)
      // countInvalid interpolerer {{max}} — uden værdien ville pladsholderen
      // stå råt i toasten.
      toast.error(key ? t(key, { max: MAX_BATCH_COUNT }) : describeError(error, t))
      return false
    }
    const rows = (data ?? []) as CreatedAsset[]
    toast.success(t('assetsPage.batchCreatedToast', { count: rows.length, name: trimmed }))
    setCreated(rows)
    return true
  }

  const submit = async () => {
    if (!companyId || !trimmed || !countValid) return
    setBusy(true)
    const ok = batch ? await createMany() : await createOne()
    setBusy(false)
    if (!ok) return
    queryClient.invalidateQueries({ queryKey: ['assets'] })
    onCreated()
    // Ét aktiv er færdigt med det samme; en batch bliver stående, så
    // stregkoderne kan sættes på de enkelte aktiver.
    if (!batch) onFinish()
  }

  if (created) {
    return (
      <CreatedAssetsPanel
        assets={created}
        scanEnabled={scanEnabled}
        onChanged={() => {
          queryClient.invalidateQueries({ queryKey: ['assets'] })
          onCreated()
        }}
        onFinish={onFinish}
        finishLabel={finishLabel}
      />
    )
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-asset-tag" className="text-label">
          {t('assetsPage.tag')}
        </Label>
        {batch ? (
          <div className="rounded-md border border-border bg-panel px-3 py-2 text-xs text-muted-foreground">
            {t('assetsPage.tagBatchHint', { count: countNum })}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Input
                id="new-asset-tag"
                value={assetNo ?? ''}
                readOnly
                disabled
                className="font-mono"
                placeholder={assetNoBusy ? t('common.loading') : '—'}
              />
              {!assetNo && !assetNoBusy && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t('assetsPage.tagRetry')}
                  onClick={() => void fetchAssetNo()}
                >
                  <RefreshCw className="size-4" />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t('assetsPage.tagAssignedHint')}</p>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="new-asset-name" className="text-label">
          {t('assetsPage.name')}
        </Label>
        <Input
          id="new-asset-name"
          value={name}
          autoFocus
          placeholder={t('assetsPage.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="new-asset-count" className="text-label">
          {t('assetsPage.count')}
        </Label>
        <Input
          id="new-asset-count"
          value={count}
          type="number"
          min={1}
          max={MAX_BATCH_COUNT}
          className="max-w-32 font-mono"
          aria-invalid={!countValid}
          onChange={(e) => setCount(e.target.value)}
        />
        {countValid ? (
          <p className="text-xs text-muted-foreground">{t('assetsPage.countHint')}</p>
        ) : (
          <p className="text-xs text-destructive">
            {t('assetsPage.countInvalid', { max: MAX_BATCH_COUNT })}
          </p>
        )}
      </div>

      {/* Serienr. og stregkode er pr. enhed — de giver kun mening for ét aktiv.
          I batch-tilstand sættes stregkoden bagefter, aktiv for aktiv. */}
      {!batch && (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-asset-serial" className="text-label">
              {t('assetsPage.serialNo')}
            </Label>
            <Input
              id="new-asset-serial"
              value={serialNo}
              className="font-mono"
              onChange={(e) => setSerialNo(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="new-asset-barcode" className="text-label">
                {t('assetsPage.barcode')}
              </Label>
              <ScannerIndicator signal={scanSignal} />
            </div>
            <Input
              id="new-asset-barcode"
              ref={barcodeRef}
              value={barcode}
              className="font-mono"
              aria-invalid={!!barcodeConflict}
              placeholder={t('assetsPage.barcodePlaceholder')}
              onChange={(e) => setBarcode(e.target.value)}
            />
            {barcodeConflict && (
              <p className="text-xs text-destructive">
                {t('assetsPage.barcodeConflictHint', { name: barcodeConflict.name })}
              </p>
            )}
            {barcodeIssue && (
              <p className="text-xs text-destructive">{t(barcodeProblemKey[barcodeIssue])}</p>
            )}
            {!barcodeIssue && !barcodeConflict && looksLikeUrl(barcode) && (
              <p className="text-xs text-status-neutral-to-bad">
                {t('assetsPage.barcodeUrlInlineHint')}
              </p>
            )}
          </div>
        </>
      )}

      {batch && (
        <p className="text-xs text-muted-foreground">{t('assetsPage.batchFieldsHint')}</p>
      )}

      <div className="flex flex-col gap-2">
        <Label className="text-label">{t('assetsPage.category')}</Label>
        <PickerSelect value={categoryId} onChange={setCategoryId} items={categories} />
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-label">{t('assetsPage.location')}</Label>
        <PickerSelect value={locationId} onChange={setLocationId} items={locations} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onFinish}>
          {finishLabel}
        </Button>
        <Button
          disabled={
            busy ||
            !trimmed ||
            !companyId ||
            !countValid ||
            (!batch && !assetNo) ||
            (!batch && (!!barcodeConflict || !!barcodeIssue))
          }
          onClick={submit}
        >
          {busy
            ? t('common.loading')
            : batch
              ? t('assetsPage.createCount', { count: countNum })
              : t('common.save')}
        </Button>
      </div>

      <BarcodeConflictDialog
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        code={normalizedBarcode}
        conflict={barcodeConflict}
        onGoToAsset={onShowAsset}
      />
      <BarcodeUrlDialog
        code={pendingUrlCode}
        onOpenChange={(o) => !o && setPendingUrlCode(null)}
        onAccept={setBarcode}
      />
    </>
  )
}

// Listen over netop oprettede aktiver: én linje pr. aktiv med Aktiv-nr. og et
// stregkodefelt. Stregkoden gemmes linje for linje (Enter eller fokus ud), så
// en fejl på ét aktiv ikke blokerer resten.
//
// Scanneren fylder listen oppefra: en scanning lander i den linje der har fokus
// — eller, hvis ingen har det, i den første linje uden stregkode. Så kan en
// håndterer scanne labels i træk uden at klikke sig frem.
// Stregkode-konflikter fanges af databasens unik-indeks (som også er det der
// tillader en genbrugt label på et udfaset aktiv) — derfor intet live-opslag her.
function CreatedAssetsPanel({
  assets,
  scanEnabled,
  onChanged,
  onFinish,
  finishLabel,
}: {
  assets: CreatedAsset[]
  scanEnabled: boolean
  onChanged: () => void
  onFinish: () => void
  finishLabel: string
}) {
  const { t } = useTranslation()
  // Stregkode pr. aktiv-id: hvad feltet viser, og hvad der er gemt.
  const [codes, setCodes] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [scanSignal, setScanSignal] = useState(0)
  const [pendingUrl, setPendingUrl] = useState<{ id: string; code: string } | null>(null)

  // Effekterne nedenfor læser den aktuelle tilstand uden at skulle gentilmelde
  // scanneren ved hvert tastetryk.
  const stateRef = useRef({ codes, saved, focusedId })
  stateRef.current = { codes, saved, focusedId }

  const save = useCallback(
    async (assetId: string, raw: string) => {
      const code = normalizeScan(raw)
      // Uændret siden sidste gemning — spring turen over.
      if ((stateRef.current.saved[assetId] ?? '') === code) return
      const issue = code ? barcodeProblem(code) : null
      if (issue) {
        setErrors((e) => ({ ...e, [assetId]: t(barcodeProblemKey[issue]) }))
        return
      }
      setSavingId(assetId)
      const { data, error } = await supabase
        .from('assets')
        .update({ barcode: code || null })
        .eq('id', assetId)
        .select('id')
      setSavingId(null)
      if (error) {
        console.error('Kunne ikke sætte stregkode:', error)
        setErrors((e) => ({
          ...e,
          [assetId]:
            error.code === '23505' ? t('assetsPage.barcodeTaken') : describeError(error, t),
        }))
        return
      }
      if (!data?.length) {
        setErrors((e) => ({ ...e, [assetId]: t('common.noPermission') }))
        return
      }
      setErrors((e) => {
        const next = { ...e }
        delete next[assetId]
        return next
      })
      setSaved((s) => ({ ...s, [assetId]: code }))
      onChanged()
    },
    [onChanged, t],
  )

  useBarcodeScanner({
    enabled: scanEnabled,
    captureInForeignInputs: true,
    onScan: (code) => {
      const { codes: cur, saved: done, focusedId: focus } = stateRef.current
      // Målet: linjen med fokus, ellers den første uden en gemt stregkode.
      const target =
        (focus && assets.some((a) => a.id === focus) ? focus : null) ??
        assets.find((a) => !(done[a.id] ?? cur[a.id]))?.id
      if (!target) {
        toast.info(t('assetsPage.batchAllScanned'))
        return
      }
      setScanSignal((n) => n + 1)
      if (looksLikeUrl(code)) {
        setPendingUrl({ id: target, code })
        return
      }
      setCodes((c) => ({ ...c, [target]: code }))
      void save(target, code)
    },
  })

  const remaining = assets.filter((a) => !saved[a.id]).length

  return (
    <>
      <div className="flex items-center justify-between">
        <Label className="text-label">
          {t('assetsPage.batchCreatedTitle', { count: assets.length })}
        </Label>
        <ScannerIndicator signal={scanSignal} />
      </div>
      <p className="text-xs text-muted-foreground">{t('assetsPage.batchBarcodeHint')}</p>

      <ul className="max-h-72 divide-y divide-border overflow-auto rounded-md border border-border">
        {assets.map((asset) => (
          <li key={asset.id} className="flex flex-col gap-1 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="w-32 shrink-0 truncate font-mono text-xs" title={asset.asset_tag}>
                {asset.asset_tag}
              </span>
              <Input
                value={codes[asset.id] ?? ''}
                className="h-8 flex-1 font-mono text-xs"
                aria-label={t('assetsPage.barcodeFor', { tag: asset.asset_tag })}
                aria-invalid={!!errors[asset.id]}
                placeholder={t('assetsPage.barcodePlaceholder')}
                disabled={savingId === asset.id}
                onFocus={() => setFocusedId(asset.id)}
                onBlur={(e) => {
                  setFocusedId((id) => (id === asset.id ? null : id))
                  void save(asset.id, e.target.value)
                }}
                onChange={(e) => setCodes((c) => ({ ...c, [asset.id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void save(asset.id, codes[asset.id] ?? '')
                  }
                }}
              />
              {saved[asset.id] ? (
                <Check className="size-4 shrink-0 text-status-good" aria-hidden />
              ) : (
                <span className="size-4 shrink-0" />
              )}
            </div>
            {errors[asset.id] && (
              <p className="pl-[8.5rem] text-xs text-destructive">{errors[asset.id]}</p>
            )}
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-muted-foreground">
          {t('assetsPage.batchRemaining', { count: remaining })}
        </p>
        <Button onClick={onFinish}>{finishLabel}</Button>
      </div>

      <BarcodeUrlDialog
        code={pendingUrl?.code ?? null}
        onOpenChange={(o) => !o && setPendingUrl(null)}
        onAccept={(code) => {
          if (!pendingUrl) return
          setCodes((c) => ({ ...c, [pendingUrl.id]: code }))
          void save(pendingUrl.id, code)
        }}
      />
    </>
  )
}
