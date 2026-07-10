import { Label } from '@/components/ui/label'

// Feltrække i detaljepaneler: label i --label-tokenfarven over kontrol.
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <Label className="text-label">{label}</Label>
      {children}
    </div>
  )
}
