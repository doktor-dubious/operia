import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/ui/checkbox'
import { ROLE_GROUPS, type AppRole } from '@/lib/roles'
import { cn } from '@/lib/utils'

// Grupperet rolle-tjekliste — deles af Adgang-fanen og invitationsdialogen på
// begge brugersider (Operia → Brugere og Konfiguration → Brugere).
// `compact` (dialogen) udelader beskrivelser og pakker tættere.
export function RoleChecklist({
  roles,
  onToggle,
  compact,
}: {
  roles: Set<AppRole>
  onToggle: (role: AppRole, on: boolean) => void
  compact?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className={cn('flex flex-col', compact ? 'gap-3' : 'gap-5')}>
      {ROLE_GROUPS.map((group) => (
        <div key={group.labelKey} className="flex flex-col gap-1.5">
          <p className="text-[11px] font-[500] uppercase tracking-wider text-muted-foreground">
            {t(group.labelKey)}
          </p>
          <div className={cn('grid', compact ? 'gap-1.5 sm:grid-cols-2' : 'gap-3 xl:grid-cols-2')}>
            {group.roles.map((r) => (
              <label
                key={r.value}
                className={cn(
                  'flex cursor-pointer gap-3 rounded-md border',
                  compact ? 'items-center px-3 py-2' : 'items-start p-4',
                )}
              >
                <Checkbox
                  className={compact ? undefined : 'mt-0.5'}
                  checked={roles.has(r.value)}
                  onCheckedChange={(v) => onToggle(r.value, v === true)}
                />
                {compact ? (
                  <span className="text-[13px] font-[450]">{t(r.labelKey)}</span>
                ) : (
                  <div>
                    <p className="text-[13px] font-[450]">{t(r.labelKey)}</p>
                    <p className="text-xs text-muted-foreground">{t(r.descKey)}</p>
                    {r.hintKey && (
                      <p className="mt-1 text-[11px] text-muted-foreground/70">{t(r.hintKey)}</p>
                    )}
                  </div>
                )}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
