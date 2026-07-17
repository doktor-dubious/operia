import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScanBarcode, ScanLine } from 'lucide-react'
import { cn } from '@/lib/utils'

// Lille statusmarkør ved stregkodefeltet: viser "Klar til scanning" og blinker
// kort grønt "Stregkode scannet" hver gang `signal` ændrer sig. Timeren bor her,
// så forældrene bare tæller signal op ved hver scanning.
export function ScannerIndicator({ signal }: { signal: number }) {
  const { t } = useTranslation()
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (signal === 0) return
    setFlash(true)
    const id = setTimeout(() => setFlash(false), 1400)
    return () => clearTimeout(id)
  }, [signal])

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        flash ? 'text-status-good' : 'text-muted-foreground',
      )}
    >
      {flash ? <ScanBarcode className="size-3.5" /> : <ScanLine className="size-3.5" />}
      {flash ? t('scanner.scanned') : t('scanner.ready')}
    </span>
  )
}
