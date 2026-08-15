// Databeskyttelse pr. virksomhed: kontakter + registrering af
// databehandleraftalen. Bruges to steder med samme komponent —
// Konfigurér → Databeskyttelse (kunden selv) og Operia → Kunder →
// Databeskyttelse (`admin`, DCA).
//
// Hvorfor felterne findes (docs/gdpr/):
//   * Databeskyttelseskontakt — modtager varsel om nye underdatabehandlere
//     (art. 28(2), 30 dages frist, se docs/gdpr/subprocessors.md §3).
//   * Sikkerhedskontakt — modtager underretning om brud på
//     persondatasikkerheden (art. 33(2); DCA lover 24 timer).
//   * Databehandleraftale — dokumentationen for at aftalen var på plads FØR
//     behandlingen begyndte (art. 28(3)).
//
// Ejerskab: kontakterne er kundens egne og redigeres af en manager;
// aftale-registreringen er DCA's kontraktdokumentation og er derfor read-only
// uden `admin` — databasen håndhæver det samme (protect_company_dca_columns),
// så en read-only visning her er bekvemmelighed, ikke sikkerhed.
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Info, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { describeError } from '@/lib/errors'
import { isValidEmail } from '@/lib/validation'
import { supabase } from '@/lib/supabase'

type Form = {
  privacyName: string
  privacyEmail: string
  privacyPhone: string
  securityName: string
  securityEmail: string
  securityPhone: string
  dpaVersion: string
  dpaSignedAt: string
  dpaSignedBy: string
}

const EMPTY: Form = {
  privacyName: '',
  privacyEmail: '',
  privacyPhone: '',
  securityName: '',
  securityEmail: '',
  securityPhone: '',
  dpaVersion: '',
  dpaSignedAt: '',
  dpaSignedBy: '',
}

const COLUMNS =
  'privacy_contact_name, privacy_contact_email, privacy_contact_phone, security_contact_name, security_contact_email, security_contact_phone, dpa_version, dpa_signed_at, dpa_signed_by'

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-label">{label}</Label>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

export function CompanyPrivacyFields({
  companyId,
  admin = false,
}: {
  companyId: string
  admin?: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<Form>(EMPTY)
  const [saving, setSaving] = useState(false)

  const { data: row, isPending } = useQuery({
    queryKey: ['company-privacy', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select(COLUMNS)
        .eq('id', companyId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const initial: Form = row
    ? {
        privacyName: row.privacy_contact_name ?? '',
        privacyEmail: row.privacy_contact_email ?? '',
        privacyPhone: row.privacy_contact_phone ?? '',
        securityName: row.security_contact_name ?? '',
        securityEmail: row.security_contact_email ?? '',
        securityPhone: row.security_contact_phone ?? '',
        dpaVersion: row.dpa_version ?? '',
        // <input type="date"> vil have YYYY-MM-DD; timestamptz'ens dato-del.
        dpaSignedAt: row.dpa_signed_at?.slice(0, 10) ?? '',
        dpaSignedBy: row.dpa_signed_by ?? '',
      }
    : EMPTY

  useEffect(() => {
    setForm(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row])

  const dirty = JSON.stringify(form) !== JSON.stringify(initial)

  const save = async () => {
    const privacyEmail = form.privacyEmail.trim()
    const securityEmail = form.securityEmail.trim()
    if ((privacyEmail && !isValidEmail(privacyEmail)) || (securityEmail && !isValidEmail(securityEmail))) {
      toast.error(t('companyPrivacy.emailInvalid'))
      return
    }
    // Spejler companies_dpa_record_complete: en dato uden version og
    // underskriver kan ikke bruges som dokumentation. Fanges her, så beskeden
    // er læselig frem for en constraint-fejl.
    const dpaSignedAt = form.dpaSignedAt.trim()
    const dpaVersion = form.dpaVersion.trim()
    const dpaSignedBy = form.dpaSignedBy.trim()
    if (admin && dpaSignedAt && (!dpaVersion || !dpaSignedBy)) {
      toast.error(t('companyPrivacy.dpaIncomplete'))
      return
    }

    setSaving(true)
    const { data, error } = await supabase
      .from('companies')
      .update({
        privacy_contact_name: form.privacyName.trim() || null,
        privacy_contact_email: privacyEmail || null,
        privacy_contact_phone: form.privacyPhone.trim() || null,
        security_contact_name: form.securityName.trim() || null,
        security_contact_email: securityEmail || null,
        security_contact_phone: form.securityPhone.trim() || null,
        // Aftale-kolonnerne sendes kun med som platform-admin: databasens
        // trigger afviser hele opdateringen hvis en manager rører dem, også
        // når værdien er uændret-men-medsendt. Og kun når feltet faktisk er
        // ændret: datofeltet kan kun bære en dato, så en uændret-men-medsendt
        // dpa_signed_at ville afkorte det gemte tidsstempel til midnat ved
        // enhver anden redigering.
        ...(admin && dpaVersion !== initial.dpaVersion ? { dpa_version: dpaVersion || null } : {}),
        ...(admin && dpaSignedAt !== initial.dpaSignedAt ? { dpa_signed_at: dpaSignedAt || null } : {}),
        ...(admin && dpaSignedBy !== initial.dpaSignedBy ? { dpa_signed_by: dpaSignedBy || null } : {}),
      })
      .eq('id', companyId)
      .select('id')
    setSaving(false)
    // Tom svarliste = RLS afviste rækken (ingen fejl, men heller ingen ændring).
    if (error || !data?.length) {
      toast.error(error ? describeError(error, t) : t('common.noPermission'))
      return
    }
    toast.success(t('settings.saved'))
    queryClient.invalidateQueries({ queryKey: ['company-privacy', companyId] })
  }

  if (isPending) return <Skeleton className="h-64 w-full" />

  const noSecurityContact = !initial.securityEmail
  const noDpa = !initial.dpaSignedAt

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="text-sm text-foreground-light">{t('companyPrivacy.intro')}</p>

      <div className="flex flex-col gap-4 rounded-md border p-4">
        <div>
          <Label className="text-label">{t('companyPrivacy.privacyContact')}</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('companyPrivacy.privacyContactHint')}
          </p>
        </div>
        <TextField
          label={t('companyPrivacy.contactName')}
          value={form.privacyName}
          onChange={(v) => setForm((f) => ({ ...f, privacyName: v }))}
        />
        <TextField
          label={t('companyPrivacy.contactEmail')}
          type="email"
          placeholder="databeskyttelse@firma.dk"
          value={form.privacyEmail}
          onChange={(v) => setForm((f) => ({ ...f, privacyEmail: v }))}
        />
        <TextField
          label={t('companyPrivacy.contactPhone')}
          value={form.privacyPhone}
          onChange={(v) => setForm((f) => ({ ...f, privacyPhone: v }))}
        />
      </div>

      <div className="flex flex-col gap-4 rounded-md border p-4">
        <div>
          <Label className="text-label">{t('companyPrivacy.securityContact')}</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('companyPrivacy.securityContactHint')}
          </p>
        </div>
        <TextField
          label={t('companyPrivacy.contactName')}
          value={form.securityName}
          onChange={(v) => setForm((f) => ({ ...f, securityName: v }))}
        />
        <TextField
          label={t('companyPrivacy.contactEmail')}
          type="email"
          placeholder="sikkerhed@firma.dk"
          value={form.securityEmail}
          onChange={(v) => setForm((f) => ({ ...f, securityEmail: v }))}
        />
        <TextField
          label={t('companyPrivacy.contactPhoneAlways')}
          value={form.securityPhone}
          onChange={(v) => setForm((f) => ({ ...f, securityPhone: v }))}
        />
        {noSecurityContact && (
          <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-foreground-light">
            <ShieldAlert className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
            <span>{t('companyPrivacy.noSecurityContactWarning')}</span>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-4 rounded-md border p-4">
        <div>
          <Label className="text-label">{t('companyPrivacy.dpa')}</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            {admin ? t('companyPrivacy.dpaHintAdmin') : t('companyPrivacy.dpaHint')}
          </p>
        </div>
        {noDpa && !admin ? (
          <p className="flex gap-2 rounded-md bg-muted/60 p-3 text-xs text-foreground-light">
            <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" />
            <span>{t('companyPrivacy.dpaNone')}</span>
          </p>
        ) : (
          <>
            <TextField
              label={t('companyPrivacy.dpaVersion')}
              value={form.dpaVersion}
              placeholder="DCA-DPA-1.0"
              disabled={!admin}
              onChange={(v) => setForm((f) => ({ ...f, dpaVersion: v }))}
            />
            <TextField
              label={t('companyPrivacy.dpaSignedAt')}
              type="date"
              value={form.dpaSignedAt}
              disabled={!admin}
              onChange={(v) => setForm((f) => ({ ...f, dpaSignedAt: v }))}
            />
            <TextField
              label={t('companyPrivacy.dpaSignedBy')}
              value={form.dpaSignedBy}
              disabled={!admin}
              onChange={(v) => setForm((f) => ({ ...f, dpaSignedBy: v }))}
            />
          </>
        )}
        {admin && noDpa && (
          <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-foreground-light">
            <ShieldAlert className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
            <span>{t('companyPrivacy.noDpaWarning')}</span>
          </p>
        )}
      </div>

      {dirty && (
        <div className="flex justify-end gap-3">
          <Button variant="outline" size="sm" onClick={() => setForm(initial)} disabled={saving}>
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
