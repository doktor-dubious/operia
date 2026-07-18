import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { ArchiveX, BellRing, Plus, Undo2 } from 'lucide-react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { AssetStatusBadge, statusLabelKey, type AssetStatus } from '@/components/asset-status-badge'
import { Badge } from '@/components/ui/badge'
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog'
import { CopyButton } from '@/components/copy-button'
import { DataTable, type ColumnDef } from '@/components/data-table'
import { DetailTabs } from '@/components/detail-tabs'
import { Field } from '@/components/detail-field'
import { LoanTtlSelect } from '@/components/loan-ttl-select'
import { useAccess } from '@/hooks/use-access'
import { useCompanyContext } from '@/hooks/use-company-context'
import { usePlatformSettings } from '@/hooks/use-platform-settings'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { isValidEmail } from '@/lib/validation'

// Aktivregisteret — ejes primært af importen (som medarbejdere ejes af Flow 0),
// men managers kan oprette et aktiv manuelt med "+ Ny". Detaljepanelet er
// skrivebeskyttet; ellers kun deaktivering (rækken består, lånehistorik bevares)
// og hård sletning for platform-admins (testdata-oprydning). Ingen anonymisering
// — aktiver bærer ingen persondata.
export const Route = createFileRoute('/_app/assets/')({
  component: AssetsPage,
})

const dateTimeFormat = new Intl.DateTimeFormat('da-DK', { dateStyle: 'short', timeStyle: 'short' })

const NONE = '__none__'

type Row = NonNullable<ReturnType<typeof useRows>['data']>[number]
type Picker = { id: string; name: string }

function useRows(companyId: string | null) {
  return useQuery({
    queryKey: ['assets', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select(
          'id, asset_tag, name, serial_no, barcode, status, condition, purchased_at, purchase_price, warranty_until, is_active, category_id, location_id, category:asset_categories (name), location:asset_locations (name)',
        )
        .eq('company_id', companyId!)
        .order('name')
      if (error) throw error
      return data
    },
  })
}

// Det åbne udlån for det valgte aktiv (hvis det er udlånt) — driver
// "Udlånt til"/"Udløber" i detaljepanelet. Unik-indekset asset_loans_open_uniq
// garanterer højst én række.
function useOpenLoan(assetId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['asset-open-loan', assetId],
    enabled: !!assetId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_loans')
        .select(
          'id, to_name, to_address, to_email, to_phone, note, expires_at, lent_at, bounced_at, bounce_reason',
        )
        .eq('asset_id', assetId!)
        .is('returned_at', null)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

// Åbne udlån (ikke returneret) for hele virksomheden — driver Overskredet-
// kolonnen: et aktiv er overskredet, hvis dets åbne udlån har et udløb i
// fortiden. Unik-indekset asset_loans_open_uniq giver højst ét pr. aktiv.
function useOpenLoans(companyId: string | null) {
  return useQuery({
    queryKey: ['asset-open-loans', companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_loans')
        .select('asset_id, expires_at')
        .eq('company_id', companyId!)
        .is('returned_at', null)
      if (error) throw error
      return data
    },
  })
}

// Aktive kategorier + placeringer til "+ Ny"-dialogens vælgere.
function usePickers(companyId: string | null) {
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
      return { categories: categories.data as Picker[], locations: locations.data as Picker[] }
    },
  })
}

// «Lån ud»: udløb (starter på platformens standard), modtagerens navn og
// kontaktvej. Serveren (lend_asset) er den der håndhæver reglerne — felterne
// her spejler dem, så brugeren ikke skal møde en rå databasefejl.
function LendOutDialog({
  open,
  onOpenChange,
  asset,
  defaultTtlHours,
  onLent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: Row
  defaultTtlHours: number | null
  onLent: () => void
}) {
  const { t } = useTranslation()
  const [ttl, setTtl] = useState<number | null>(defaultTtlHours)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // Platformens standard kan nå frem efter mount — så længe dialogen er
  // lukket følger udløbet den, i stedet for at hænge på den værdi der tilfældigvis
  // gjaldt ved mount.
  useEffect(() => {
    if (!open) setTtl(defaultTtlHours)
  }, [open, defaultTtlHours])

  const trimmedName = name.trim()
  const trimmedEmail = email.trim()
  // En udfyldt e-mail skal være velformet — ellers er kontaktvejen der på
  // papiret, men beskeden lander aldrig.
  const emailInvalid = !!trimmedEmail && !isValidEmail(trimmedEmail)
  // «One of Email or SMS is required» — en ugyldig e-mail tæller ikke med.
  const hasContact = (!!trimmedEmail && !emailInvalid) || !!phone.trim()
  const canSubmit = !!trimmedName && hasContact && !emailInvalid && !busy

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setName('')
      setAddress('')
      setEmail('')
      setPhone('')
      setNote('')
    }
    onOpenChange(next)
  }

  const lend = async () => {
    if (!canSubmit) return
    setBusy(true)
    const { error } = await supabase.rpc('lend_asset', {
      p_asset_id: asset.id,
      p_to_name: trimmedName,
      p_to_address: address.trim() || undefined,
      p_to_email: trimmedEmail || undefined,
      p_to_phone: phone.trim() || undefined,
      p_ttl_hours: ttl ?? undefined,
      p_note: note.trim() || undefined,
    })
    setBusy(false)
    if (error) {
      console.error('Udlån fejlede:', error)
      // Kapløb: nogen nåede at låne aktivet ud imens. Forklar det, og hent
      // den nye status frem for at efterlade knappen i en umulig tilstand.
      if (error.message.includes('asset_not_in_stock')) {
        toast.error(t('assetsPage.notInStock'))
        onLent()
        handleOpenChange(false)
        return
      }
      // Bagstopper: knappen er spærret for ugyldige adresser, så dette er
      // serveren der fanger noget klienten slap forbi.
      if (error.message.includes('bad_email')) {
        toast.error(t('assetsPage.lendEmailInvalid'))
        return
      }
      toast.error(describeError(error, t))
      return
    }
    toast.success(t('assetsPage.lentToast', { name: asset.name, to: trimmedName }))
    onLent()
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('assetsPage.lendOutTitle', { name: asset.name })}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('assetsPage.lendExpiry')}</Label>
          <LoanTtlSelect value={ttl} onChange={setTtl} />
          <p className="text-xs text-muted-foreground">{t('assetsPage.lendExpiryHint')}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="lend-name" className="text-label">
            {t('assetsPage.lendToName')} *
          </Label>
          <Input
            id="lend-name"
            value={name}
            autoFocus
            placeholder={t('assetsPage.lendToNamePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="lend-address" className="text-label">
            {t('assetsPage.lendToAddress')}
          </Label>
          <Textarea
            id="lend-address"
            value={address}
            rows={3}
            placeholder={t('assetsPage.lendToAddressPlaceholder')}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="lend-email" className="text-label">
              {t('assetsPage.lendToEmail')}
            </Label>
            <Input
              id="lend-email"
              type="email"
              value={email}
              aria-invalid={emailInvalid}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="lend-sms" className="text-label">
              {t('assetsPage.lendToSms')}
            </Label>
            <Input
              id="lend-sms"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
        <p className={cn('text-xs', emailInvalid ? 'text-destructive' : 'text-muted-foreground')}>
          {emailInvalid ? t('assetsPage.lendEmailInvalid') : t('assetsPage.lendContactHint')}
        </p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="lend-note" className="text-label">
            {t('assetsPage.lendNotes')}
          </Label>
          <Textarea
            id="lend-note"
            value={note}
            rows={3}
            placeholder={t('assetsPage.lendNotesPlaceholder')}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!canSubmit} onClick={lend}>
            {busy ? t('common.loading') : t('assetsPage.lendOut')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type Loan = NonNullable<ReturnType<typeof useOpenLoan>['data']>

// ISO → 'YYYY-MM-DDTHH:mm' i lokal tid, som <input type="datetime-local"> vil have
// det. Tom streng = intet udløb.
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// «Låner»-fanen: lånerens kontaktoplysninger + udløb. Felterne er KONTROLLEREDE
// (staten ligger i AssetDetailPane), så den delte «Gem ændringer»-bjælke nederst
// gemmer dem sammen med aktivfelterne. Her bor kun handlingen «Send påmindelse nu».
function LenderTab({
  loan,
  assetName,
  name,
  setName,
  address,
  setAddress,
  email,
  setEmail,
  phone,
  setPhone,
  note,
  setNote,
  expires,
  setExpires,
  emailInvalid,
  paneDirty,
  onLoanChanged,
}: {
  loan: Loan
  assetName: string
  name: string
  setName: (v: string) => void
  address: string
  setAddress: (v: string) => void
  email: string
  setEmail: (v: string) => void
  phone: string
  setPhone: (v: string) => void
  note: string
  setNote: (v: string) => void
  expires: string
  setExpires: (v: string) => void
  emailInvalid: boolean
  paneDirty: boolean
  onLoanChanged: () => void
}) {
  const { t } = useTranslation()
  const [reminderOpen, setReminderOpen] = useState(false)
  const [reminderBusy, setReminderBusy] = useState(false)

  // «Send påmindelse nu» bygger på det GEMTE lån (serveren læser fra DB): kræver
  // en brugbar gemt kontaktvej, og er slået fra mens der er ugemte ændringer.
  const canRemind = (!!loan.to_email && isValidEmail(loan.to_email)) || !!loan.to_phone
  // Bounce-markering: sat af resend-webhook for lånets gemte to_email. Vises kun
  // så længe adressen i feltet stadig ER den der bouncede.
  const emailBounced = !!loan.bounced_at && !!loan.to_email && email.trim() === loan.to_email

  const sendReminder = async () => {
    if (reminderBusy) return
    setReminderBusy(true)
    const { data: res, error } = await supabase.functions.invoke('send-asset-reminder', {
      body: { loan_id: loan.id },
    })
    setReminderBusy(false)
    setReminderOpen(false)
    if (error) {
      toast.error(describeError(error, t))
      return
    }
    if (res?.ok) {
      toast.success(t('assetsPage.reminderSentToast', { name: loan.to_name }))
      onLoanChanged()
    } else if (res?.code === 'no_channel') {
      toast.error(t('assetsPage.reminderNoChannel'))
    } else {
      toast.error(t('assetsPage.reminderFailedToast'))
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('assetsPage.lendToName')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('assetsPage.loanExpires')} info={t('assetsPage.loanExpiryEditHint')}>
          <Input
            type="datetime-local"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
          />
        </Field>
      </div>
      <Field label={t('assetsPage.lendToAddress')}>
        <Textarea value={address} rows={2} onChange={(e) => setAddress(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('assetsPage.lendToEmail')}>
          <Input
            type="email"
            value={email}
            aria-invalid={emailInvalid || emailBounced}
            onChange={(e) => setEmail(e.target.value)}
          />
          {emailBounced && (
            <p className="text-xs text-destructive" title={loan.bounce_reason ?? undefined}>
              {t('assetsPage.emailBounced')}
            </p>
          )}
        </Field>
        <Field label={t('assetsPage.lendToSms')}>
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
      </div>
      <p className={cn('text-xs', emailInvalid ? 'text-destructive' : 'text-muted-foreground')}>
        {emailInvalid ? t('assetsPage.lendEmailInvalid') : t('assetsPage.lendContactHint')}
      </p>
      <Field label={t('assetsPage.lendNotes')}>
        <Textarea value={note} rows={3} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Field label={t('assetsPage.loanLentAt')}>
        <Input value={dateTimeFormat.format(new Date(loan.lent_at))} disabled />
      </Field>
      <div className="flex items-center gap-3 border-t border-border pt-4">
        {canRemind ? (
          <Button
            size="sm"
            variant="outline"
            disabled={paneDirty || reminderBusy}
            title={paneDirty ? t('assetsPage.saveBeforeReminder') : undefined}
            onClick={() => setReminderOpen(true)}
          >
            <BellRing className="size-4" /> {t('assetsPage.sendReminder')}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">{t('assetsPage.reminderNeedsContact')}</p>
        )}
      </div>

      <Dialog open={reminderOpen} onOpenChange={setReminderOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('assetsPage.sendReminderTitle', { name: loan.to_name })}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('assetsPage.sendReminderBody', { asset: assetName })}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReminderOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={reminderBusy} onClick={sendReminder}>
              {reminderBusy ? t('common.loading') : t('assetsPage.sendReminderConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Status kan ændres manuelt — undtagen 'on_loan', som styres af udlåns-maskinen
// (lend_asset/return_asset). Et udlånt aktiv vises skrivebeskyttet med et hint.
const EDITABLE_STATUSES: AssetStatus[] = ['in_stock', 'assigned', 'service', 'retired']

function AssetDetailPane({
  row,
  categories,
  locations,
  onClose,
  onDeactivate,
  onDelete,
  onLendOut,
  onReturn,
  onLoanChanged,
  onDirtyChange,
  returnBusy,
}: {
  row: Row
  categories: Picker[]
  locations: Picker[]
  onClose: () => void
  onDeactivate: () => void
  onDelete?: () => void // kun platform-admins (testdata-oprydning)
  onLendOut: () => void
  onReturn: () => void
  onLoanChanged: () => void
  onDirtyChange: (dirty: boolean) => void
  returnBusy: boolean
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('details')
  const onLoan = row.status === 'on_loan'
  const { data: loan } = useOpenLoan(row.id, onLoan)

  // Redigerbare felter (alt undtagen ID), spejlet fra rækken. Panelet
  // genmonteres ved aktivskift (key), så staten reseedes automatisk.
  const [assetTag, setAssetTag] = useState(row.asset_tag ?? '')
  const [serialNo, setSerialNo] = useState(row.serial_no ?? '')
  const [name, setName] = useState(row.name)
  const [barcode, setBarcode] = useState(row.barcode ?? '')
  const [categoryId, setCategoryId] = useState(row.category_id ?? NONE)
  const [locationId, setLocationId] = useState(row.location_id ?? NONE)
  const [status, setStatus] = useState<AssetStatus>(row.status)
  const [condition, setCondition] = useState(row.condition ?? '')
  const [purchasedAt, setPurchasedAt] = useState(row.purchased_at ?? '')
  const [purchasePrice, setPurchasePrice] = useState(
    row.purchase_price == null ? '' : String(row.purchase_price),
  )
  const [warrantyUntil, setWarrantyUntil] = useState(row.warranty_until ?? '')
  const [isActive, setIsActive] = useState(row.is_active)
  // Låne-felterne (Låner-fanen) bor her, så den delte «Gem ændringer»-bjælke
  // gemmer dem sammen med aktivfelterne. Lånet loades asynkront (useOpenLoan) og
  // seedes derfor via en effekt når det ankommer — ikke via useState-startværdi.
  const [loanName, setLoanName] = useState('')
  const [loanAddress, setLoanAddress] = useState('')
  const [loanEmail, setLoanEmail] = useState('')
  const [loanPhone, setLoanPhone] = useState('')
  const [loanNote, setLoanNote] = useState('')
  const [loanExpires, setLoanExpires] = useState('')
  const seededLoanId = useRef<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (loan && seededLoanId.current !== loan.id) {
      seededLoanId.current = loan.id
      setLoanName(loan.to_name)
      setLoanAddress(loan.to_address ?? '')
      setLoanEmail(loan.to_email ?? '')
      setLoanPhone(loan.to_phone ?? '')
      setLoanNote(loan.note ?? '')
      setLoanExpires(toLocalInput(loan.expires_at))
    }
  }, [loan])

  const trimmedName = name.trim()
  const priceStr = row.purchase_price == null ? '' : String(row.purchase_price)

  // Sammenlign de TRIMMEDE værdier — saveAll gemmer trimmet, så efter en gemning
  // (og refetch) matcher det serverværdien. Ellers ville et efterstillet mellemrum
  // efterlade «Gem ændringer»-bjælken hængende, selv efter en vellykket gemning.
  const assetDirty =
    assetTag.trim() !== (row.asset_tag ?? '') ||
    serialNo.trim() !== (row.serial_no ?? '') ||
    trimmedName !== row.name ||
    barcode.trim() !== (row.barcode ?? '') ||
    categoryId !== (row.category_id ?? NONE) ||
    locationId !== (row.location_id ?? NONE) ||
    status !== row.status ||
    condition.trim() !== (row.condition ?? '') ||
    purchasedAt !== (row.purchased_at ?? '') ||
    purchasePrice !== priceStr ||
    warrantyUntil !== (row.warranty_until ?? '') ||
    isActive !== row.is_active

  // Låne-felternes dirty/validering (Låner-fanen), så bjælken dækker begge dele.
  const loanSeeded = !!loan && seededLoanId.current === loan.id
  const loanTrimmedEmail = loanEmail.trim()
  // Som aktivfelterne: sammenlign trimmet mod serverværdien (update_asset_loan
  // trimmer), så bjælken ikke hænger efter en gemning med efterstillet mellemrum.
  const loanDirty =
    loanSeeded &&
    !!loan &&
    (loanName.trim() !== loan.to_name ||
      loanAddress.trim() !== (loan.to_address ?? '') ||
      loanTrimmedEmail !== (loan.to_email ?? '') ||
      loanPhone.trim() !== (loan.to_phone ?? '') ||
      loanNote.trim() !== (loan.note ?? '') ||
      loanExpires !== toLocalInput(loan.expires_at))
  const loanEmailInvalid = !!loanTrimmedEmail && !isValidEmail(loanTrimmedEmail)
  const loanHasContact = (!!loanTrimmedEmail && !loanEmailInvalid) || !!loanPhone.trim()
  const loanValid = !loanDirty || (!!loanName.trim() && !loanEmailInvalid && loanHasContact)

  const dirty = assetDirty || loanDirty
  const canSave = !saving && !!trimmedName && loanValid

  // Meld dirty-tilstanden op, så et rækkeskift kan advare om ugemte ændringer.
  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty])

  // Den nuværende kategori/placering kan være deaktiveret og dermed mangle i
  // vælgerne (kun aktive) — flet den ind, så værdien altid kan vises/vælges.
  const categoryOptions =
    row.category_id && !categories.some((c) => c.id === row.category_id)
      ? [{ id: row.category_id, name: row.category?.name ?? '—' }, ...categories]
      : categories
  const locationOptions =
    row.location_id && !locations.some((l) => l.id === row.location_id)
      ? [{ id: row.location_id, name: row.location?.name ?? '—' }, ...locations]
      : locations

  const cancel = () => {
    setAssetTag(row.asset_tag ?? '')
    setSerialNo(row.serial_no ?? '')
    setName(row.name)
    setBarcode(row.barcode ?? '')
    setCategoryId(row.category_id ?? NONE)
    setLocationId(row.location_id ?? NONE)
    setStatus(row.status)
    setCondition(row.condition ?? '')
    setPurchasedAt(row.purchased_at ?? '')
    setPurchasePrice(priceStr)
    setWarrantyUntil(row.warranty_until ?? '')
    setIsActive(row.is_active)
    if (loan) {
      setLoanName(loan.to_name)
      setLoanAddress(loan.to_address ?? '')
      setLoanEmail(loan.to_email ?? '')
      setLoanPhone(loan.to_phone ?? '')
      setLoanNote(loan.note ?? '')
      setLoanExpires(toLocalInput(loan.expires_at))
    }
  }

  const saveAll = async () => {
    if (!canSave) return
    const price = purchasePrice.trim() === '' ? null : Number(purchasePrice)
    if (price != null && !Number.isFinite(price)) {
      toast.error(t('assetsPage.priceInvalid'))
      return
    }
    setSaving(true)
    // 1) Aktivfelterne (assets-tabellen, manager-RLS).
    if (assetDirty) {
      const { data: updated, error } = await supabase
        .from('assets')
        .update({
          asset_tag: assetTag.trim() || null,
          serial_no: serialNo.trim() || null,
          name: trimmedName,
          barcode: barcode.trim() || null,
          category_id: categoryId === NONE ? null : categoryId,
          location_id: locationId === NONE ? null : locationId,
          status,
          condition: condition.trim() || null,
          purchased_at: purchasedAt || null,
          purchase_price: price,
          warranty_until: warrantyUntil || null,
          is_active: isActive,
        })
        .eq('id', row.id)
        .select('id')
      if (error) {
        setSaving(false)
        console.error('Kunne ikke gemme aktiv:', error)
        // 23505 = unik-constraint (aktiv-nr. eller stregkode).
        if (error.code === '23505') {
          toast.error(
            error.message.includes('barcode')
              ? t('assetsPage.barcodeTaken')
              : t('assetsPage.tagTaken'),
          )
          return
        }
        toast.error(describeError(error, t))
        return
      }
      if (!updated?.length) {
        setSaving(false)
        toast.error(t('common.noPermission'))
        return
      }
    }
    // 2) Lånefelterne (Låner-fanen) via update_asset_loan (SECURITY DEFINER).
    if (loanDirty && loan) {
      const { error } = await supabase.rpc('update_asset_loan', {
        p_loan_id: loan.id,
        p_to_name: loanName.trim(),
        p_to_address: loanAddress.trim() || undefined,
        p_to_email: loanTrimmedEmail || undefined,
        p_to_phone: loanPhone.trim() || undefined,
        p_note: loanNote.trim() || undefined,
        p_expires_at: loanExpires ? new Date(loanExpires).toISOString() : undefined,
      })
      if (error) {
        setSaving(false)
        console.error('Kunne ikke gemme udlån:', error)
        toast.error(describeError(error, t))
        return
      }
    }
    setSaving(false)
    toast.success(t('settings.saved'))
    onLoanChanged()
  }

  const tabs = [
    { key: 'details', label: t('detail.tabDetails') },
    ...(onLoan ? [{ key: 'lender', label: t('assetsPage.tabLender') }] : []),
    { key: 'data', label: t('detail.tabData') },
    { key: 'actions', label: t('detail.tabActions') },
  ]

  return (
    <>
      <DetailTabs tabs={tabs} active={tab} onChange={setTab} onClose={onClose}>
      {tab === 'details' && (
        <div className="flex flex-col gap-5">
          <Field label="ID">
            <div className="relative max-w-2xl">
              <Input value={row.id} disabled className="pr-10 font-mono text-xs" />
              <div className="absolute right-1 top-1/2 -translate-y-1/2">
                <CopyButton value={row.id} label={t('detail.copyId')} />
              </div>
            </div>
          </Field>
          <div className="grid max-w-2xl grid-cols-2 gap-4">
            <Field label={t('assetsPage.tag')}>
              <Input
                value={assetTag}
                className="font-mono"
                onChange={(e) => setAssetTag(e.target.value)}
              />
            </Field>
            <Field label={t('assetsPage.serialNo')}>
              <Input
                value={serialNo}
                className="font-mono"
                onChange={(e) => setSerialNo(e.target.value)}
              />
            </Field>
          </div>
          <Field label={t('assetsPage.name')}>
            <Input
              value={name}
              className="max-w-2xl"
              aria-invalid={!trimmedName}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={t('assetsPage.barcode')}>
            <Input
              value={barcode}
              className="max-w-2xl font-mono"
              onChange={(e) => setBarcode(e.target.value)}
            />
          </Field>
          <div className="grid max-w-2xl grid-cols-2 gap-4">
            <Field label={t('assetsPage.category')}>
              <PickerSelect value={categoryId} onChange={setCategoryId} items={categoryOptions} />
            </Field>
            <Field label={t('assetsPage.location')}>
              <PickerSelect value={locationId} onChange={setLocationId} items={locationOptions} />
            </Field>
          </div>
          <div className="grid max-w-2xl grid-cols-2 gap-4">
            <Field
              label={t('assetsPage.status')}
              info={onLoan ? t('assetsPage.statusLockedOnLoan') : undefined}
            >
              {onLoan ? (
                <Input value={t(statusLabelKey[row.status])} disabled />
              ) : (
                <Select value={status} onValueChange={(v) => setStatus(v as AssetStatus)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EDITABLE_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(statusLabelKey[s])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field label={t('assetsPage.condition')}>
              <Input value={condition} onChange={(e) => setCondition(e.target.value)} />
            </Field>
          </div>
        </div>
      )}
      {tab === 'lender' &&
        onLoan &&
        (loanSeeded && loan ? (
          <LenderTab
            loan={loan}
            assetName={row.name}
            name={loanName}
            setName={setLoanName}
            address={loanAddress}
            setAddress={setLoanAddress}
            email={loanEmail}
            setEmail={setLoanEmail}
            phone={loanPhone}
            setPhone={setLoanPhone}
            note={loanNote}
            setNote={setLoanNote}
            expires={loanExpires}
            setExpires={setLoanExpires}
            emailInvalid={loanEmailInvalid}
            paneDirty={dirty}
            onLoanChanged={onLoanChanged}
          />
        ) : (
          <Skeleton className="h-64 w-full max-w-2xl" />
        ))}
      {tab === 'data' && (
        <div className="flex flex-col gap-5">
          <Field label={t('assetsPage.purchasedAt')}>
            <Input
              type="date"
              className="max-w-2xl"
              value={purchasedAt}
              onChange={(e) => setPurchasedAt(e.target.value)}
            />
          </Field>
          <Field label={t('assetsPage.purchasePrice')}>
            <Input
              type="number"
              step="0.01"
              className="max-w-2xl"
              value={purchasePrice}
              onChange={(e) => setPurchasePrice(e.target.value)}
            />
          </Field>
          <Field label={t('assetsPage.warrantyUntil')}>
            <Input
              type="date"
              className="max-w-2xl"
              value={warrantyUntil}
              onChange={(e) => setWarrantyUntil(e.target.value)}
            />
          </Field>
          <Field label={t('assetsPage.active')}>
            <Select value={isActive ? 'yes' : 'no'} onValueChange={(v) => setIsActive(v === 'yes')}>
              <SelectTrigger className="max-w-2xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">{t('common.yes')}</SelectItem>
                <SelectItem value="no">{t('common.no')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}
      {tab === 'actions' && (
        <div className="flex max-w-2xl flex-col gap-4">
          {/* Kun et aktiv på lager kan lånes ud — er det ude, tilbyder vi
              returen i stedet, så aktivet kan komme tilbage på lager. */}
          {row.status === 'on_loan' ? (
            <div className="flex items-center justify-between rounded-md border p-4">
              <div>
                <p className="text-[13px] font-[450]">{t('assetsPage.return')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('assetsPage.returnDescription')}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={returnBusy} onClick={onReturn}>
                <Undo2 className="size-4" /> {t('assetsPage.return')}
              </Button>
            </div>
          ) : (
            row.status === 'in_stock' && (
              <div className="flex items-center justify-between rounded-md border p-4">
                <div>
                  <p className="text-[13px] font-[450]">{t('assetsPage.lendOut')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('assetsPage.lendOutDescription')}
                  </p>
                </div>
                <Button size="sm" variant="outline" disabled={!row.is_active} onClick={onLendOut}>
                  {t('assetsPage.lendOut')}
                </Button>
              </div>
            )
          )}
          <div className="flex items-center justify-between rounded-md border p-4">
            <div>
              <p className="text-[13px] font-[450]">{t('assetsPage.deactivate')}</p>
              <p className="text-xs text-muted-foreground">
                {t('assetsPage.deactivateDescription')}
              </p>
            </div>
            <Button size="sm" variant="outline" disabled={!row.is_active} onClick={onDeactivate}>
              {t('assetsPage.deactivate')}
            </Button>
          </div>
          {onDelete && (
            <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
              <div>
                <p className="text-[13px] font-[450] text-destructive">
                  {t('assetsPage.delete')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('assetsPage.deleteDescription')}
                </p>
              </div>
              <Button size="sm" variant="destructive" onClick={onDelete}>
                {t('assetsPage.delete')}
              </Button>
            </div>
          )}
        </div>
      )}
      </DetailTabs>

      {dirty && (
        <div className="sticky bottom-0 z-10 -mx-6 mt-auto flex justify-end gap-3 border-t border-border bg-background px-6 py-3">
          <Button variant="outline" size="sm" onClick={cancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={saveAll} disabled={!canSave}>
            {saving ? t('common.loading') : t('common.saveChanges')}
          </Button>
        </div>
      )}
    </>
  )
}

// Optional-vælger (kategori/placering) med et "—"-punkt for "ingen".
function PickerSelect({
  value,
  onChange,
  items,
}: {
  value: string
  onChange: (v: string) => void
  items: Picker[]
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

function NewAssetDialog({
  open,
  onOpenChange,
  companyId,
  categories,
  locations,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string | null
  categories: Picker[]
  locations: Picker[]
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [assetTag, setAssetTag] = useState('')
  const [serialNo, setSerialNo] = useState('')
  const [barcode, setBarcode] = useState('')
  const [categoryId, setCategoryId] = useState(NONE)
  const [locationId, setLocationId] = useState(NONE)
  const [busy, setBusy] = useState(false)

  const trimmed = name.trim()

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setName('')
      setAssetTag('')
      setSerialNo('')
      setBarcode('')
      setCategoryId(NONE)
      setLocationId(NONE)
    }
    onOpenChange(next)
  }

  const create = async () => {
    if (!companyId || !trimmed) return
    setBusy(true)
    const { error } = await supabase.from('assets').insert({
      company_id: companyId,
      name: trimmed,
      asset_tag: assetTag.trim() || null,
      serial_no: serialNo.trim() || null,
      barcode: barcode.trim() || null,
      category_id: categoryId === NONE ? null : categoryId,
      location_id: locationId === NONE ? null : locationId,
    })
    setBusy(false)
    if (error) {
      console.error('Kunne ikke oprette aktiv:', error)
      // 23505 = unik-constraint. Aktivet har to (aktiv-nr. og stregkode), så
      // constraint-navnet afgør hvilket felt brugeren skal rette.
      if (error.code === '23505') {
        toast.error(
          error.message.includes('barcode') ? t('assetsPage.barcodeTaken') : t('assetsPage.tagTaken'),
        )
        return
      }
      toast.error(describeError(error, t))
      return
    }
    toast.success(t('assetsPage.createdToast', { name: trimmed }))
    onCreated()
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('assetsPage.newTitle')}</DialogTitle>
        </DialogHeader>
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
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-asset-tag" className="text-label">
              {t('assetsPage.tag')}
            </Label>
            <Input
              id="new-asset-tag"
              value={assetTag}
              className="font-mono"
              placeholder={t('assetsPage.tagPlaceholder')}
              onChange={(e) => setAssetTag(e.target.value)}
            />
          </div>
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
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-asset-barcode" className="text-label">
            {t('assetsPage.barcode')}
          </Label>
          <Input
            id="new-asset-barcode"
            value={barcode}
            className="font-mono"
            placeholder={t('assetsPage.barcodePlaceholder')}
            onChange={(e) => setBarcode(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('assetsPage.category')}</Label>
          <PickerSelect value={categoryId} onChange={setCategoryId} items={categories} />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-label">{t('assetsPage.location')}</Label>
          <PickerSelect value={locationId} onChange={setLocationId} items={locations} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || !trimmed || !companyId} onClick={create}>
            {busy ? t('common.loading') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AssetsPage() {
  const { t } = useTranslation()
  const { companyId } = useCompanyContext()
  const { data, isPending } = useRows(companyId)
  const { data: openLoans } = useOpenLoans(companyId)
  const { data: pickers } = usePickers(companyId)
  const { data: access } = useAccess()
  const { data: settings } = usePlatformSettings()
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [lendOpen, setLendOpen] = useState(false)
  const [returnBusy, setReturnBusy] = useState(false)
  // Ugemte ændringer i panelet: et rækkeskift/luk gates, så redigering ikke
  // tabes tavst (samme mønster som medarbejdersiden).
  const [paneDirty, setPaneDirty] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)

  const guarded = (action: () => void) => {
    if (paneDirty) setPendingAction(() => action)
    else action()
  }

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['assets'] })
    queryClient.invalidateQueries({ queryKey: ['asset-open-loan'] })
    queryClient.invalidateQueries({ queryKey: ['asset-open-loans'] })
  }

  const deactivate = async (ids: string[], clear: () => void) => {
    const { data: updated, error } = await supabase
      .from('assets')
      .update({ is_active: false })
      .in('id', ids)
      .select('id')
    if (error) {
      console.error('Deaktivering fejlede:', error)
      toast.error(describeError(error, t))
      return
    }
    if ((updated?.length ?? 0) !== ids.length) {
      toast.error(t('common.noPermission'))
      return
    }
    toast.success(t('assetsPage.deactivatedToast', { count: ids.length }))
    clear()
    refresh()
  }

  const returnAsset = async (row: Row) => {
    // Samme optaget-lås som sidens øvrige handlinger — et dobbeltklik ville
    // ellers affyre return_asset to gange (succes + no_open_loan-fejl).
    if (returnBusy) return
    setReturnBusy(true)
    try {
      const { error } = await supabase.rpc('return_asset', { p_asset_id: row.id })
      if (error) {
        console.error('Retur fejlede:', error)
        // Kapløb: en anden nåede at registrere returen — vores visning er
        // forældet, så hent den frem for at lade brugeren stirre på en død knap.
        if (error.message.includes('no_open_loan')) {
          toast.error(t('assetsPage.noOpenLoan'))
          refresh()
          return
        }
        toast.error(describeError(error, t))
        return
      }
      toast.success(t('assetsPage.returnedToast', { name: row.name }))
      refresh()
    } finally {
      setReturnBusy(false)
    }
  }

  // Hård sletning kun for platform-admins (oprydning i testdata)
  const deleteRows = async (ids: string[]) => {
    const { data: deleted, error } = await supabase
      .from('assets')
      .delete()
      .in('id', ids)
      .select('id')
    if (error) throw error
    if ((deleted?.length ?? 0) !== ids.length) {
      toast.error(t('common.noPermission'))
      throw new Error('RLS afviste (delvist) sletning')
    }
    await refresh()
  }

  if (isPending || !companyId) return <Skeleton className="h-40 w-full" />

  // Overskredet = åbent udlån med et udløb i fortiden. Beregnes ud fra
  // openLoans-kortet, så kolonnen ikke kræver en join i aktiv-forespørgslen.
  const nowMs = Date.now()
  const overdueIds = new Set(
    (openLoans ?? [])
      .filter((l) => l.expires_at && new Date(l.expires_at).getTime() < nowMs)
      .map((l) => l.asset_id),
  )

  const columns: ColumnDef<Row>[] = [
    {
      key: 'asset_tag',
      header: t('assetsPage.tag'),
      sortable: true,
      sortValue: (r) => r.asset_tag,
      render: (r) => <span className="font-mono text-xs">{r.asset_tag ?? '—'}</span>,
    },
    { key: 'name', header: t('assetsPage.name'), sortable: true, sortValue: (r) => r.name },
    {
      key: 'category',
      header: t('assetsPage.category'),
      sortable: true,
      sortValue: (r) => r.category?.name ?? null,
      render: (r) => r.category?.name ?? '—',
    },
    {
      key: 'location',
      header: t('assetsPage.location'),
      sortable: true,
      sortValue: (r) => r.location?.name ?? null,
      render: (r) => r.location?.name ?? '—',
    },
    {
      // Selve stregkoden hører ikke hjemme i tabellen — den er lang, ulæselig
      // for et menneske og siger intet ved et overblik. Om den findes er til
      // gengæld det man scanner tabellen for.
      key: 'barcode',
      header: t('assetsPage.hasBarcode'),
      sortable: true,
      sortValue: (r) => (r.barcode ? 1 : 0),
      render: (r) => (r.barcode ? t('common.yes') : t('common.no')),
    },
    {
      key: 'status',
      header: t('assetsPage.status'),
      sortable: true,
      // Sortér på den viste tekst — rå enum-nøgler ville give en rækkefølge
      // ingen kan se logikken i.
      sortValue: (r) => t(statusLabelKey[r.status]),
      render: (r) => <AssetStatusBadge status={r.status} />,
    },
    {
      // Overskredet udlån: rød fare-badge. Tom celle for aktiver der ikke er
      // overskredet, så kun det der kræver handling springer i øjnene.
      key: 'overdue',
      header: t('assetsPage.overdue'),
      sortable: true,
      sortValue: (r) => (overdueIds.has(r.id) ? 1 : 0),
      render: (r) =>
        overdueIds.has(r.id) ? (
          <Badge variant="destructive" className="rounded-[4px]">
            {t('assetsPage.overdue')}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'is_active',
      header: t('assetsPage.active'),
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
        entityLabel={t('nav.assets').toLowerCase()}
        // Stregkoden vises ikke, men skal kunne søges: at scanne en kode ind i
        // søgefeltet er hele pointen med at have den.
        searchText={(row) =>
          [
            row.asset_tag,
            row.name,
            row.serial_no,
            row.barcode,
            row.category?.name,
            row.location?.name,
          ]
            .filter(Boolean)
            .join(' ')
        }
        storageKey="assets"
        toolbar={
          <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" /> {t('common.new')}
          </Button>
        }
        onRowClick={(row) => guarded(() => setActiveId((prev) => (prev === row.id ? null : row.id)))}
        activeRowId={activeId}
        onDelete={access?.isPlatformAdmin ? deleteRows : undefined}
        selectionActions={({ ids, clear }) => (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title={t('assetsPage.deactivate')}
            aria-label={t('assetsPage.deactivate')}
            onClick={() => deactivate(ids, clear)}
          >
            <ArchiveX className="size-4" />
          </Button>
        )}
      />
      {activeRow && (
        <AssetDetailPane
          // Skift af aktiv skal genmontere panelet (nulstil fane m.m.). Nøglen
          // præfikses så den ikke kolliderer med LendOutDialogs søskendenøgle
          // nedenfor — to søskende med samme key forvirrer Reacts reconciler,
          // så genmonteringen udeblev og panelet hang på det forrige aktivs data.
          key={`detail-${activeRow.id}`}
          row={activeRow}
          categories={pickers?.categories ?? []}
          locations={pickers?.locations ?? []}
          onClose={() => guarded(() => setActiveId(null))}
          onDeactivate={() => deactivate([activeRow.id], () => {})}
          onDelete={access?.isPlatformAdmin ? () => setDeleteOpen(true) : undefined}
          onLendOut={() => setLendOpen(true)}
          onReturn={() => returnAsset(activeRow)}
          onLoanChanged={refresh}
          onDirtyChange={setPaneDirty}
          returnBusy={returnBusy}
        />
      )}
      {activeRow && (
        <LendOutDialog
          key={`lend-${activeRow.id}`}
          open={lendOpen}
          onOpenChange={setLendOpen}
          asset={activeRow}
          defaultTtlHours={settings?.locker_loan_ttl_hours ?? null}
          onLent={refresh}
        />
      )}
      {activeRow && (
        <ConfirmDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t('assetsPage.deleteTitle', { name: activeRow.name })}
          description={t('assetsPage.deleteWarning')}
          acknowledgeText={t('assetsPage.deleteAcknowledge')}
          confirmLabel={t('assetsPage.delete')}
          onConfirm={async () => {
            await deleteRows([activeRow.id])
            toast.success(t('assetsPage.deletedToast', { name: activeRow.name }))
            setActiveId(null)
          }}
        />
      )}
      <NewAssetDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        companyId={companyId}
        categories={pickers?.categories ?? []}
        locations={pickers?.locations ?? []}
        onCreated={refresh}
      />
      {/* Advarsel ved rækkeskift/luk med ugemte ændringer. */}
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
