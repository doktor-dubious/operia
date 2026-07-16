import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Navigation, Plus, X } from 'lucide-react'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { CopyButton } from '@/components/copy-button'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { DetailTabs } from '@/components/detail-tabs'
import { Field } from '@/components/detail-field'
import { RouteMap, type MapWaypoint } from '@/components/route-map'
import { useCompanyContext } from '@/hooks/use-company-context'
import { cn } from '@/lib/utils'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// Ruter (ruteplanlægnings-produktet) — tenant-ejet stamdata, samme master/detail-
// mønster som skabe (DataTable + faneopdelt detaljepanel + gem/annullér-bjælke).
// Kort + "Beregn rute" kommer i et senere trin; her er datamodellen + felterne.
export const Route = createFileRoute('/_app/products/routes')({
  component: RoutesPage,
})

type TransportType = 'car' | 'bike' | 'walk'

// Beregnet rute: GeoJSON-linjekoordinater ([lng, lat]) + markør-waypoints.
type RouteGeometry = {
  coordinates: [number, number][]
  waypoints: (MapWaypoint & { label?: string })[]
}

type RouteRow = NonNullable<ReturnType<typeof useRows>['data']>[number]

type RouteForm = {
  name: string
  description: string
  notes: string
  fromAddress: string
  toAddress: string
  stops: string[]
  roundTrip: boolean
  optimizeStops: boolean
  transportType: TransportType
  numCars: number
  drivers: string[]
  geometry: RouteGeometry | null
  distanceM: number | null
  durationS: number | null
}

function formatDistance(m: number | null): string | null {
  if (m == null) return null
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}

function formatDuration(s: number | null): string | null {
  if (s == null) return null
  const min = Math.round(s / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const rem = min % 60
  return rem ? `${h} h ${rem} min` : `${h} h`
}

// Fælles udseende for de fritekst-tekstfelter (beskrivelse + noter).
const TEXTAREA_CLASS = 'resize-none space-y-6 min-h-30 px-4 py-2.5'

const TRANSPORT_OPTIONS: { value: TransportType; labelKey: string }[] = [
  { value: 'car', labelKey: 'routesPage.transportCar' },
  { value: 'bike', labelKey: 'routesPage.transportBike' },
  { value: 'walk', labelKey: 'routesPage.transportWalk' },
]

// jsonb-kolonner er løst typet (Json); læs dem defensivt.
const readStops = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .map((s) => (typeof s === 'string' ? s : ((s as { address?: string })?.address ?? '')))
        .filter(Boolean)
    : []

const readDrivers = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((d) => (d == null ? '' : String(d))) : []

const normalizeDrivers = (drivers: string[], count: number): string[] =>
  Array.from({ length: count }, (_, i) => drivers[i] ?? '')

const EMPTY_FORM: RouteForm = {
  name: '',
  description: '',
  notes: '',
  fromAddress: '',
  toAddress: '',
  stops: [],
  roundTrip: false,
  optimizeStops: false,
  transportType: 'car',
  numCars: 1,
  drivers: [''],
  geometry: null,
  distanceM: null,
  durationS: null,
}

function rowToForm(r: RouteRow): RouteForm {
  return {
    name: r.name,
    description: r.description ?? '',
    notes: r.notes ?? '',
    fromAddress: r.from_address ?? '',
    toAddress: r.to_address ?? '',
    stops: readStops(r.stops),
    roundTrip: r.round_trip,
    optimizeStops: r.optimize_stops,
    transportType: r.transport_type as TransportType,
    numCars: r.num_cars,
    drivers: normalizeDrivers(readDrivers(r.drivers), r.num_cars),
    geometry: (r.geometry as RouteGeometry | null) ?? null,
    distanceM: r.distance_m,
    durationS: r.duration_s,
  }
}

function formToPayload(f: RouteForm) {
  return {
    name: f.name.trim(),
    description: f.description.trim() || null,
    notes: f.notes.trim() || null,
    from_address: f.fromAddress.trim() || null,
    to_address: f.toAddress.trim() || null,
    stops: f.stops.map((s) => s.trim()).filter(Boolean).map((address) => ({ address })),
    round_trip: f.roundTrip,
    optimize_stops: f.optimizeStops,
    transport_type: f.transportType,
    num_cars: f.numCars,
    drivers: f.drivers.slice(0, f.numCars),
    geometry: f.geometry,
    distance_m: f.distanceM,
    duration_s: f.durationS,
  }
}

function useRows(companyId: string | null) {
  return useQuery({
    queryKey: ['routes', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('routes')
        .select(
          'id, name, description, notes, from_address, to_address, stops, round_trip, optimize_stops, transport_type, num_cars, drivers, geometry, distance_m, duration_s, is_active',
        )
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data
    },
  })
}

// --- Genbrugelige feltkomponenter (bruges i både "+ Ny"-dialog og detaljepanel) ---

function TransportRadio({
  value,
  onChange,
}: {
  value: TransportType
  onChange: (v: TransportType) => void
}) {
  const { t } = useTranslation()
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as TransportType)}
      className="max-w-md gap-2"
    >
      {TRANSPORT_OPTIONS.map((o) => (
        <label
          key={o.value}
          htmlFor={`transport-${o.value}`}
          className="flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-[13px] transition-colors has-[:checked]:border-primary has-[:checked]:bg-accent/40"
        >
          <RadioGroupItem value={o.value} id={`transport-${o.value}`} />
          {t(o.labelKey)}
        </label>
      ))}
    </RadioGroup>
  )
}

function StopsEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const add = () => {
    const s = draft.trim()
    if (!s) return
    onChange([...value, s])
    setDraft('')
  }
  return (
    <div className="flex max-w-xl flex-col gap-2">
      {value.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={s}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('routesPage.stopPlaceholder')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={add}>
          <Plus className="size-4" /> {t('routesPage.addStop')}
        </Button>
      </div>
    </div>
  )
}

function DriversEditor({
  numCars,
  drivers,
  onChange,
}: {
  numCars: number
  drivers: string[]
  onChange: (next: { numCars: number; drivers: string[] }) => void
}) {
  const { t } = useTranslation()
  const setNum = (raw: number) => {
    const n = Math.max(1, Math.min(99, Number.isFinite(raw) ? raw : 1))
    onChange({ numCars: n, drivers: normalizeDrivers(drivers, n) })
  }
  const setDriver = (i: number, name: string) => {
    const next = normalizeDrivers(drivers, numCars)
    next[i] = name
    onChange({ numCars, drivers: next })
  }
  return (
    <div className="flex max-w-md flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label className="text-label">{t('routesPage.numCars')}</Label>
        <Input
          type="number"
          min={1}
          value={numCars}
          className="w-28"
          onChange={(e) => setNum(parseInt(e.target.value, 10))}
        />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: numCars }, (_, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-xs text-muted-foreground">
              {t('routesPage.driver', { n: i + 1 })}
            </span>
            <Input
              value={drivers[i] ?? ''}
              placeholder={t('routesPage.driverPlaceholder')}
              onChange={(e) => setDriver(i, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

type CalcInputs = {
  from: string
  to: string
  stops: string[]
  transportType: TransportType
  roundTrip: boolean
  optimizeStops: boolean
}

function RouteMapPanel({
  inputs,
  geometry,
  distanceM,
  durationS,
  onCalculated,
  className,
}: {
  inputs: CalcInputs
  geometry: RouteGeometry | null
  distanceM: number | null
  durationS: number | null
  onCalculated: (r: { geometry: RouteGeometry; distanceM: number | null; durationS: number | null }) => void
  className?: string
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const canCalc = inputs.from.trim() !== '' && inputs.to.trim() !== ''

  const calc = async () => {
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('route-calc', {
      body: {
        from: inputs.from,
        to: inputs.to,
        stops: inputs.stops,
        transportType: inputs.transportType,
        roundTrip: inputs.roundTrip,
        optimizeStops: inputs.optimizeStops,
      },
    })
    setBusy(false)
    const res = data as
      | {
          error?: string
          address?: string
          geometry?: { coordinates: [number, number][] }
          waypoints?: RouteGeometry['waypoints']
          distance_m?: number | null
          duration_s?: number | null
        }
      | null
    if (error || !res || res.error || !res.geometry) {
      const code = res?.error
      toast.error(
        code === 'geocode_failed'
          ? t('routesPage.calcGeocodeError', { address: res?.address ?? '' })
          : code === 'provider_not_supported'
            ? t('routesPage.calcProviderError')
            : code === 'missing_key'
              ? t('routesPage.calcMissingKey')
              : t('routesPage.calcError'),
      )
      return
    }
    onCalculated({
      geometry: { coordinates: res.geometry.coordinates, waypoints: res.waypoints ?? [] },
      distanceM: res.distance_m ?? null,
      durationS: res.duration_s ?? null,
    })
  }

  const line = geometry?.coordinates?.map(([lng, lat]) => [lat, lng] as [number, number])
  const waypoints = geometry?.waypoints?.map((w) => ({ lat: w.lat, lng: w.lng, kind: w.kind }))
  const dist = formatDistance(distanceM)
  const dur = formatDuration(durationS)

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <RouteMap line={line} waypoints={waypoints} className="min-h-64 flex-1" />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={busy || !canCalc}
          onClick={calc}
        >
          <Navigation className="size-4" />
          {busy ? t('routesPage.calculating') : t('routesPage.calculate')}
        </Button>
        {dist && dur && (
          <span className="text-xs text-muted-foreground">
            {dist} · {dur}
          </span>
        )}
        {!canCalc && (
          <span className="text-xs text-muted-foreground">{t('routesPage.calcNeedsFromTo')}</span>
        )}
      </div>
    </div>
  )
}

// --- Detaljepanel ---

function RouteDetailPane({
  row,
  onClose,
  onDirtyChange,
  onDeleted,
  refresh,
}: {
  row: RouteRow
  onClose: () => void
  onDirtyChange: (dirty: boolean) => void
  onDeleted: () => void
  refresh: () => void
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('details')
  const [form, setForm] = useState<RouteForm>(() => rowToForm(row))
  // Sammenlignings-grundlag for ugemt-vagt. Holdes som state (ikke udledt fra
  // row) fordi geometry er jsonb: Postgres omordner nøgler ved gem, så en
  // JSON.stringify mod den genindlæste række aldrig ville matche igen. Ved gem
  // sætter vi baseline = det gemte form, så bjælken lukker straks.
  const [baseline, setBaseline] = useState<RouteForm>(() => rowToForm(row))
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  // Feltspecifik navnefejl (unikt navn), vist inline på detalje-fanen.
  const [nameError, setNameError] = useState<string | null>(null)

  const setActive = async (is_active: boolean) => {
    setSaving(true)
    const { data, error } = await supabase
      .from('routes')
      .update({ is_active })
      .eq('id', row.id)
      .select('id')
    setSaving(false)
    if (error || !data?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    refresh()
  }

  const remove = async () => {
    const { data, error } = await supabase.from('routes').delete().eq('id', row.id).select('id')
    if (error) throw error
    if (!data?.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste sletning')
    }
    toast.success(t('routeDetail.deletedToast', { name: row.name }))
    onDeleted()
    refresh()
  }

  const set = (patch: Partial<RouteForm>) => setForm((f) => ({ ...f, ...patch }))
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline)

  // Rapportér dirty op til siden (ugemt-vagt); ryd ved unmount.
  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  const saveAll = async () => {
    if (!form.name.trim()) {
      setNameError(t('errors.requiredField'))
      setTab('details')
      return
    }
    setNameError(null)
    setSaving(true)
    const payload = formToPayload(form)
    const { data, error } = await supabase.from('routes').update(payload).eq('id', row.id).select('id')
    setSaving(false)
    if (error) {
      console.error('Kunne ikke gemme rute:', error)
      // 23505 = unique_violation på (company_id, name) — markér navnefeltet.
      if (error.code === '23505') {
        setNameError(t('common.nameTaken'))
        setTab('details')
        toast.error(t('common.nameTaken'))
      } else {
        toast.error(describeError(error, t))
      }
      return
    }
    if (!data?.length) {
      toast.error(t('common.noPermission'))
      return
    }
    // Afspejl normaliserede værdier og nulstil baseline, så ugemt-bjælken
    // lukker straks — uafhængigt af at jsonb-round-trippet omordner nøgler.
    const nextForm: RouteForm = {
      ...form,
      name: payload.name,
      description: payload.description ?? '',
      notes: payload.notes ?? '',
      fromAddress: payload.from_address ?? '',
      toAddress: payload.to_address ?? '',
      stops: payload.stops.map((s) => s.address),
      drivers: normalizeDrivers(payload.drivers, payload.num_cars),
    }
    setForm(nextForm)
    setBaseline(nextForm)
    toast.success(t('settings.saved'))
    refresh()
  }

  const cancel = () => setForm(baseline)

  const tabs = [
    { key: 'details', label: t('detail.tabDetails') },
    { key: 'map', label: t('routesPage.tabMap') },
    { key: 'addresses', label: t('routesPage.tabAddresses') },
    { key: 'data', label: t('routesPage.tabData') },
    { key: 'actions', label: t('detail.tabActions') },
  ]

  return (
    <>
      <DetailTabs tabs={tabs} active={tab} onChange={setTab} onClose={onClose}>
        {tab === 'details' && (
          <div className="flex flex-col gap-5">
            <Field label="ID">
              <div className="relative">
                <Input value={row.id} disabled className="pr-10 font-mono text-xs" />
                <div className="absolute right-1 top-1/2 -translate-y-1/2">
                  <CopyButton value={row.id} label={t('detail.copyId')} />
                </div>
              </div>
            </Field>
            <Field label={t('routesPage.name')}>
              <Input
                value={form.name}
                aria-invalid={!!nameError}
                onChange={(e) => {
                  set({ name: e.target.value })
                  if (nameError) setNameError(null)
                }}
              />
              {nameError && <p className="mt-1.5 text-xs text-destructive">{nameError}</p>}
            </Field>
            <Field label={t('routesPage.description')}>
              <Textarea
                value={form.description}
                className={TEXTAREA_CLASS}
                onChange={(e) => set({ description: e.target.value })}
              />
            </Field>
            <Field label={t('routesPage.notes')}>
              <Textarea
                value={form.notes}
                className={TEXTAREA_CLASS}
                onChange={(e) => set({ notes: e.target.value })}
              />
            </Field>
          </div>
        )}
        {tab === 'map' && (
          <RouteMapPanel
            className="h-[30rem] max-w-2xl"
            inputs={{
              from: form.fromAddress,
              to: form.toAddress,
              stops: form.stops,
              transportType: form.transportType,
              roundTrip: form.roundTrip,
              optimizeStops: form.optimizeStops,
            }}
            geometry={form.geometry}
            distanceM={form.distanceM}
            durationS={form.durationS}
            onCalculated={(r) =>
              set({ geometry: r.geometry, distanceM: r.distanceM, durationS: r.durationS })
            }
          />
        )}
        {tab === 'addresses' && (
          <div className="flex flex-col gap-5">
            <Field label={t('routesPage.from')}>
              <Input
                value={form.fromAddress}
                placeholder={t('routesPage.addressPlaceholder')}
                onChange={(e) => set({ fromAddress: e.target.value })}
              />
            </Field>
            <Field label={t('routesPage.to')}>
              <Input
                value={form.toAddress}
                placeholder={t('routesPage.addressPlaceholder')}
                onChange={(e) => set({ toAddress: e.target.value })}
              />
            </Field>
            <div className="flex flex-col gap-2">
              <Label className="text-label">{t('routesPage.stops')}</Label>
              <StopsEditor value={form.stops} onChange={(stops) => set({ stops })} />
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
              <Checkbox
                checked={form.roundTrip}
                onCheckedChange={(v) => set({ roundTrip: v === true })}
              />
              {t('routesPage.roundTrip')}
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
              <Checkbox
                className="mt-0.5"
                checked={form.optimizeStops}
                onCheckedChange={(v) => set({ optimizeStops: v === true })}
              />
              <span>
                {t('routesPage.optimize')}{' '}
                <span className="text-xs text-muted-foreground">— {t('routesPage.optimizeHint')}</span>
              </span>
            </label>
          </div>
        )}
        {tab === 'data' && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label className="text-label">{t('routesPage.transport')}</Label>
              <TransportRadio
                value={form.transportType}
                onChange={(transportType) => set({ transportType })}
              />
            </div>
            <DriversEditor
              numCars={form.numCars}
              drivers={form.drivers}
              onChange={({ numCars, drivers }) => set({ numCars, drivers })}
            />
          </div>
        )}
        {tab === 'actions' && (
          <div className="flex max-w-2xl flex-col gap-4">
            <div className="flex items-center justify-between rounded-md border p-4">
              <div>
                <p className="text-[13px] font-[450]">
                  {row.is_active ? t('routeDetail.deactivate') : t('routeDetail.activate')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('routeDetail.deactivateDescription')}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => setActive(!row.is_active)}
              >
                {row.is_active ? t('routeDetail.deactivate') : t('routeDetail.activate')}
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
              <div>
                <p className="text-[13px] font-[450] text-destructive">
                  {t('routeDetail.delete')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('routeDetail.deleteDescription')}
                </p>
              </div>
              <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
                {t('routeDetail.delete')}
              </Button>
            </div>
          </div>
        )}
      </DetailTabs>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mx-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={saveAll} disabled={saving}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('routeDetail.deleteTitle', { name: row.name })}
        description={t('routeDetail.deleteWarning')}
        acknowledgeText={t('routeDetail.deleteAcknowledge')}
        confirmLabel={t('routeDetail.delete')}
        onConfirm={remove}
      />
    </>
  )
}

// --- "+ Ny"-dialog ---

function NewRouteDialog({
  open,
  onOpenChange,
  companyId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string | null
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<RouteForm>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  // Feltspecifik valideringsfejl for navnet (påkrævet + unikt). Vises inline i
  // dialogen, så brugeren ser problemet på selve feltet — ikke kun som en toast.
  const [nameError, setNameError] = useState<string | null>(null)

  const set = (patch: Partial<RouteForm>) => setForm((f) => ({ ...f, ...patch }))

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setForm(EMPTY_FORM)
      setNameError(null)
    }
    onOpenChange(next)
  }

  const create = async () => {
    if (!companyId) return
    // Klient-validering før vi kalder databasen: markér manglende påkrævede felter
    // direkte på dialogen i stedet for en generisk fejl bagefter.
    if (!form.name.trim()) {
      setNameError(t('errors.requiredField'))
      return
    }
    setNameError(null)
    setBusy(true)
    const { error } = await supabase.from('routes').insert({ company_id: companyId, ...formToPayload(form) })
    setBusy(false)
    if (error) {
      console.error('Kunne ikke oprette rute:', error)
      // 23505 = unique_violation på (company_id, name) — markér navnefeltet præcist.
      if (error.code === '23505') {
        setNameError(t('common.nameTaken'))
        toast.error(t('common.nameTaken'))
      } else {
        toast.error(describeError(error, t))
      }
      return
    }
    toast.success(t('routeDetail.createdToast', { name: form.name.trim() }))
    onCreated()
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('routeDetail.newTitle')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-6 md:flex-row">
          <div className="flex flex-1 flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-route-name" className="text-label">
                {t('routesPage.name')} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="new-route-name"
                value={form.name}
                autoFocus
                aria-invalid={!!nameError}
                onChange={(e) => {
                  set({ name: e.target.value })
                  if (nameError) setNameError(null)
                }}
              />
              {nameError && <p className="mt-1.5 text-xs text-destructive">{nameError}</p>}
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-label">{t('routesPage.from')}</Label>
              <Input
                value={form.fromAddress}
                placeholder={t('routesPage.addressPlaceholder')}
                onChange={(e) => set({ fromAddress: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-label">{t('routesPage.to')}</Label>
              <Input
                value={form.toAddress}
                placeholder={t('routesPage.addressPlaceholder')}
                onChange={(e) => set({ toAddress: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-label">{t('routesPage.stops')}</Label>
              <StopsEditor value={form.stops} onChange={(stops) => set({ stops })} />
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
              <Checkbox
                checked={form.roundTrip}
                onCheckedChange={(v) => set({ roundTrip: v === true })}
              />
              {t('routesPage.roundTrip')}
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
              <Checkbox
                className="mt-0.5"
                checked={form.optimizeStops}
                onCheckedChange={(v) => set({ optimizeStops: v === true })}
              />
              <span>
                {t('routesPage.optimize')}{' '}
                <span className="text-xs text-muted-foreground">— {t('routesPage.optimizeHint')}</span>
              </span>
            </label>
            <div className="flex flex-col gap-2">
              <Label className="text-label">{t('routesPage.transport')}</Label>
              <TransportRadio
                value={form.transportType}
                onChange={(transportType) => set({ transportType })}
              />
            </div>
          </div>

          <div className="flex flex-col md:w-1/2 md:border-l md:border-border md:pl-6">
            <RouteMapPanel
              className="h-full"
              inputs={{
                from: form.fromAddress,
                to: form.toAddress,
                stops: form.stops,
                transportType: form.transportType,
                roundTrip: form.roundTrip,
                optimizeStops: form.optimizeStops,
              }}
              geometry={form.geometry}
              distanceM={form.distanceM}
              durationS={form.durationS}
              onCalculated={(r) =>
                set({ geometry: r.geometry, distanceM: r.distanceM, durationS: r.durationS })
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || !companyId} onClick={create}>
            {busy ? t('common.loading') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- Side ---

function RoutesPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data, isPending } = useRows(companyId)
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [paneDirty, setPaneDirty] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  const guarded = (action: () => void) => {
    if (paneDirty) setPendingAction(() => action)
    else action()
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['routes'] })

  const deleteRows = async (ids: string[]) => {
    const { data: deleted, error } = await supabase.from('routes').delete().in('id', ids).select('id')
    if (error) throw error
    if ((deleted?.length ?? 0) !== ids.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste (delvist) sletning')
    }
    if (activeId && ids.includes(activeId)) setActiveId(null)
    await refresh()
  }

  if (isPending || !companyId) return <Skeleton className="h-40 w-full" />

  const transportLabel = (v: string) =>
    t(`routesPage.transport${v.charAt(0).toUpperCase()}${v.slice(1)}`)

  const columns: ColumnDef<RouteRow>[] = [
    { key: 'name', header: t('routesPage.name'), sortable: true, sortValue: (r) => r.name },
    {
      key: 'from',
      header: t('routesPage.from'),
      sortable: true,
      sortValue: (r) => r.from_address,
      render: (r) => <span className="block max-w-48 truncate">{r.from_address ?? '—'}</span>,
    },
    {
      key: 'to',
      header: t('routesPage.to'),
      sortable: true,
      sortValue: (r) => r.to_address,
      render: (r) => <span className="block max-w-48 truncate">{r.to_address ?? '—'}</span>,
    },
    {
      key: 'stops',
      header: t('routesPage.stops'),
      sortable: true,
      sortValue: (r) => readStops(r.stops).length,
      render: (r) => readStops(r.stops).length,
    },
    {
      key: 'distance',
      header: t('routesPage.distance'),
      sortable: true,
      sortValue: (r) => r.distance_m,
      render: (r) => formatDistance(r.distance_m) ?? '—',
    },
    {
      key: 'duration',
      header: t('routesPage.duration'),
      sortable: true,
      sortValue: (r) => r.duration_s,
      render: (r) => formatDuration(r.duration_s) ?? '—',
    },
    {
      key: 'transport',
      header: t('routesPage.transport'),
      sortable: true,
      sortValue: (r) => r.transport_type,
      render: (r) => transportLabel(r.transport_type),
    },
    {
      key: 'is_active',
      header: t('routesPage.active'),
      sortable: true,
      sortValue: (r) => (r.is_active ? 1 : 0),
      render: (r) => (r.is_active ? t('common.yes') : t('common.no')),
    },
  ]

  const activeRow = data?.find((row) => row.id === activeId) ?? null

  return (
    <div className="flex min-h-full flex-col gap-6">
      <DataTable
        rows={data ?? []}
        columns={columns}
        entityLabel={t('nav.routes').toLowerCase()}
        searchText={(row) =>
          [row.name, row.from_address, row.to_address, transportLabel(row.transport_type), ...readStops(row.stops)]
            .filter(Boolean)
            .join(' ')
        }
        storageKey="routes"
        toolbar={
          <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" /> {t('common.new')}
          </Button>
        }
        onRowClick={(row) => guarded(() => setActiveId(row.id === activeId ? null : row.id))}
        activeRowId={activeId}
        onDelete={deleteRows}
      />
      {activeRow && (
        <RouteDetailPane
          key={activeRow.id}
          row={activeRow}
          onClose={() => guarded(() => setActiveId(null))}
          onDirtyChange={setPaneDirty}
          onDeleted={() => setActiveId(null)}
          refresh={refresh}
        />
      )}
      <NewRouteDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        companyId={companyId}
        onCreated={refresh}
      />
      <Dialog open={pendingAction !== null} onOpenChange={(open) => !open && setPendingAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('unsaved.title')}</DialogTitle>
            <DialogDescription>{t('unsaved.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                pendingAction?.()
                setPendingAction(null)
              }}
            >
              {t('unsaved.discard')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
