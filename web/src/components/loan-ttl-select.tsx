import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Udløbsvælgeren for aktivudlån. Bruges to steder og skal se ens ud begge
// steder: Operia → Aktiver sætter platformens standard, og «Lån ud» starter på
// den standard og kan afvige pr. udlån. Værdien er timer, eller null = intet
// udløb.

// Prototypens muligheder for udlånsudløb (timer).
const TTL_OPTIONS = [12, 24, 48, 72, 168, 336] as const

const TTL_NONE = 'none'

export function LoanTtlSelect({
  value,
  onChange,
}: {
  value: number | null
  onChange: (value: number | null) => void
}) {
  const { t } = useTranslation()

  // Under en uge er dage-tallet en hjælp; derover er timer-tallet kun støj.
  const label = (hours: number) =>
    hours < 168
      ? t('assetsConfig.ttlHours', { hours, days: hours / 24 })
      : t('assetsConfig.ttlDays', { days: hours / 24 })

  return (
    <Select
      value={value === null ? TTL_NONE : String(value)}
      onValueChange={(v) => onChange(v === TTL_NONE ? null : Number(v))}
    >
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TTL_OPTIONS.map((hours) => (
          <SelectItem key={hours} value={String(hours)}>
            {label(hours)}
          </SelectItem>
        ))}
        <SelectItem value={TTL_NONE}>{t('assetsConfig.ttlNone')}</SelectItem>
      </SelectContent>
    </Select>
  )
}
