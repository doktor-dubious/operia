import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { generateStrongPassword } from '@/lib/password'

// Adgangskodefelt med vis/skjul-knap og en "generér stærk kode"-knap. Delt af
// invitationsdialogerne (Konfiguration → Brugere, Operia → Brugere) og
// Skift-adgangskode-dialogen, så mønstret kun findes ét sted — en ændring (fx
// minimumslængde, autocomplete-attributter) rammer alle tre på én gang.
export function GeneratablePasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoComplete = 'new-password',
}: {
  id: string
  label: ReactNode
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoComplete?: string
}) {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-label">
          {label}
        </Label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 text-xs"
          onClick={() => setShow((s) => !s)}
        >
          {show ? t('common.hide') : t('common.show')}
        </Button>
      </div>
      <Input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 w-fit gap-1.5 text-xs"
        onClick={() => {
          onChange(generateStrongPassword())
          setShow(true)
        }}
      >
        <KeyRound className="size-3.5" />
        {t('userDetail.generatePassword')}
      </Button>
    </div>
  )
}
