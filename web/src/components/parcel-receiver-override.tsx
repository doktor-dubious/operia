import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { ShieldAlert } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { EmployeePicker, type PickedEmployee } from '@/components/employee-picker'
import { useAccess } from '@/hooks/use-access'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

// Manager-override af modtageren: pakken udleveres til en ANDEN end den
// tilsigtede modtager — typisk fordi personen har forladt virksomheden, og
// pakken ellers ville stå i receptionen for evigt (og blokere GDPR-
// anonymiseringen af den fratrådte).
//
// To ting adskiller den fra almindelig proxy-udlevering:
//   • den kræver en begrundelse og gælder også hvor håndteringsklassen
//     forbyder proxy — det er netop en overstyring af reglen,
//   • den skriver sin egen linje i pakkens spor ('receiver_overridden') og
//     dermed i revisionsloggen ('parcel.receiver_overridden', niveau warning).
// Den tilsigtede modtager på pakken røres ikke: begge navne skal kunne vises.
//
// Rollegatet her er kun UX. Håndhævelsen er server-side i RPC'en
// override_parcel_receiver (SECURITY DEFINER), jf. CLAUDE.md.

export type OverrideState = {
  active: boolean
  employee: PickedEmployee | null
  reason: string
}

export const EMPTY_OVERRIDE: OverrideState = { active: false, employee: null, reason: '' }

export function useCanOverrideReceiver() {
  const { data: access } = useAccess()
  return (
    !!access &&
    (access.isPlatformAdmin || access.isManager || access.roles.has('parcel_manager'))
  )
}

// Klar til at sende? Begrundelsen er påkrævet (RPC'en afviser den ellers).
export function overrideIncomplete(state: OverrideState) {
  return state.active && !state.reason.trim()
}

export async function overrideReceiver(args: {
  parcelIds: string[]
  deliveredTo: string
  reason: string
  employeeId?: string | null
  note?: string | null
  signaturePath?: string | null
}): Promise<number> {
  const { data, error } = await supabase.rpc('override_parcel_receiver', {
    p_parcel_ids: args.parcelIds,
    p_delivered_to: args.deliveredTo.trim(),
    p_reason: args.reason.trim(),
    p_delivered_employee_id: args.employeeId ?? undefined,
    p_note: args.note?.trim() || undefined,
    p_signature_path: args.signaturePath ?? undefined,
  })
  if (error) throw error
  return data ?? 0
}

// RPC'ens raise-beskeder er stabile nøgler, ikke tekst til brugeren — oversæt.
const RPC_ERROR_KEYS: Record<string, string> = {
  not_authorized: 'override.errNotAuthorized',
  reason_required: 'override.errReasonRequired',
  delivered_to_required: 'override.errDeliveredToRequired',
  no_deliverable_parcels: 'override.errNoDeliverable',
  employee_not_in_company: 'override.errEmployee',
  parcel_not_found: 'override.errNotFound',
  mixed_companies: 'override.errNotFound',
}

export function describeOverrideError(error: unknown, t: TFunction): string {
  const message = (error as { message?: string } | null)?.message?.trim() ?? ''
  const key = RPC_ERROR_KEYS[message]
  return key ? t(key) : describeError(error, t)
}

export function ReceiverOverrideFields({
  companyId,
  intendedReceiver,
  value,
  onChange,
  // Kaldes når en medarbejder vælges, så forælderen kan udfylde "udleveret til"
  // med navnet — de to felter skal ikke skrives to gange.
  onEmployeePicked,
  disabled,
}: {
  companyId: string
  intendedReceiver: string | null
  value: OverrideState
  onChange: (next: OverrideState) => void
  onEmployeePicked?: (employee: PickedEmployee | null) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3 rounded-md border border-status-neutral/40 p-4">
      <div className="flex items-start gap-2">
        <Checkbox
          id="override-active"
          className="mt-0.5"
          checked={value.active}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange(checked === true ? { ...value, active: true } : EMPTY_OVERRIDE)
          }
        />
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="override-active" className="flex items-center gap-1.5">
            <ShieldAlert className="size-3.5 text-status-neutral" />
            {t('override.enable')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {intendedReceiver
              ? t('override.enableHint', { name: intendedReceiver })
              : t('override.enableHintNoReceiver')}
          </p>
        </div>
      </div>

      {value.active && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <div className="flex flex-col gap-2">
            <Label>{t('override.actualReceiver')}</Label>
            <EmployeePicker
              companyId={companyId}
              value={value.employee}
              onChange={(employee) => {
                onChange({ ...value, employee })
                onEmployeePicked?.(employee)
              }}
            />
            <p className="text-xs text-muted-foreground">{t('override.actualReceiverHint')}</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="override-reason">{t('override.reason')}</Label>
            <Textarea
              id="override-reason"
              value={value.reason}
              rows={2}
              disabled={disabled}
              placeholder={t('override.reasonPlaceholder')}
              onChange={(e) => onChange({ ...value, reason: e.target.value })}
            />
            {!value.reason.trim() && (
              <p className="text-xs text-status-neutral-to-bad">{t('override.reasonRequired')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
