import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// Warn-and-allow for URL-lignende stregkoder: en scanning af fx en
// leverandørs QR-label (en webadresse) kan være BEVIDST — labelen adopteres
// som aktivets identifikator — eller en fejlscanning af en tilfældig QR.
// Dialogen spørger i stedet for at afvise; manuel indtastning nøjes med en
// inline-advarsel (man taster ikke en URL ved et uheld).

export function BarcodeUrlDialog({
  code,
  onOpenChange,
  onAccept,
  bodyKey = 'assetsPage.barcodeUrlBody',
}: {
  // null = lukket. Koden vises i dialogen, så man kan se hvad der blev scannet.
  code: string | null
  onOpenChange: (open: boolean) => void
  onAccept: (code: string) => void
  // Brødteksten nævner hvad koden bruges til (aktiv/pakke) — resten er fælles.
  bodyKey?: string
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={code !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('assetsPage.barcodeUrlTitle')}</DialogTitle>
          <DialogDescription>{t(bodyKey)}</DialogDescription>
        </DialogHeader>
        <p className="break-all rounded-md border bg-background/50 p-3 font-mono text-xs">
          {code}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('assetsPage.barcodeUrlDiscard')}
          </Button>
          <Button
            onClick={() => {
              if (code) onAccept(code)
              onOpenChange(false)
            }}
          >
            {t('assetsPage.barcodeUrlUse')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
