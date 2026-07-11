import { Label } from '@/components/ui/label'
import { InfoTip } from '@/components/info-tip'

// Feltrække i detaljepaneler: label i --label-tokenfarven over kontrol;
// valgfrit info-ikon med tooltip-forklaring efter labelen.
export function Field({
  label,
  info,
  children,
}: {
  label: string
  info?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Label className="text-label">{label}</Label>
        {info && <InfoTip text={info} />}
      </div>
      {children}
    </div>
  )
}
