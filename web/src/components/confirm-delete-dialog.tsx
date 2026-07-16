import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { describeError } from '@/lib/errors'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

// Fælles beskyttet slette-/destruktiv-dialog: kræver både afkrydsning og
// indtastning af bekræftelsesord (samme styrke som tabellens bulk-slet).
// Al lukning går gennem ÉN vej, så ack/ord altid nulstilles.

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  acknowledgeText,
  confirmLabel,
  words = ['slet', 'delete'],
  wordPlaceholderKey = 'dataTable.deleteWord',
  typeToConfirmKey = 'dataTable.typeToConfirm',
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  acknowledgeText: string
  confirmLabel: string
  words?: string[]
  wordPlaceholderKey?: string
  typeToConfirmKey?: string
  onConfirm: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [ack, setAck] = useState(false)
  const [word, setWord] = useState('')
  const [busy, setBusy] = useState(false)

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setAck(false)
      setWord('')
    }
    onOpenChange(next)
  }

  const confirmed = ack && words.includes(word.trim().toLowerCase())

  const run = async () => {
    setBusy(true)
    try {
      await onConfirm()
      handleOpenChange(false)
    } catch (error) {
      console.error('Handlingen fejlede:', error)
      toast.error(describeError(error, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-destructive/40 p-3 text-sm">
          <Checkbox
            checked={ack}
            onCheckedChange={(checked) => setAck(checked === true)}
            className="mt-0.5"
          />
          <span>{acknowledgeText}</span>
        </label>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm-word">{t(typeToConfirmKey)}</Label>
          <Input
            id="confirm-word"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder={t(wordPlaceholderKey)}
            autoComplete="off"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" disabled={!confirmed || busy} onClick={run}>
            {busy ? t('common.loading') : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
