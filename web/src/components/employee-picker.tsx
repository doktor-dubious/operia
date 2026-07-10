import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'

// Modtager-autocomplete til intake (spec Flow 1): søger på navn/initialer
// inden for virksomheden; valgt medarbejder auto-udfylder afdeling.
// Intet match er tilladt — pakken registreres så som 'unassigned'.

export type PickedEmployee = {
  id: string
  full_name: string
  initials: string | null
  department_id: string | null
  department_name: string | null
}

export function EmployeePicker({
  companyId,
  value,
  onChange,
}: {
  companyId: string
  value: PickedEmployee | null
  onChange: (employee: PickedEmployee | null) => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PickedEmployee[]>([])
  const [open, setOpen] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const search = (text: string) => {
    setQuery(text)
    onChange(null)
    if (debounce.current) clearTimeout(debounce.current)
    if (text.trim().length < 1) {
      setResults([])
      setOpen(false)
      return
    }
    debounce.current = setTimeout(async () => {
      const term = text.trim()
      const { data, error } = await supabase
        .from('employees')
        .select('id, full_name, initials, department_id, department:departments (name)')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .or(`full_name.ilike.%${term}%,initials.ilike.%${term}%`)
        .order('full_name')
        .limit(8)
      if (error) {
        console.error('Modtagersøgning fejlede:', error)
        return
      }
      setResults(
        data.map((e) => ({
          id: e.id,
          full_name: e.full_name,
          initials: e.initials,
          department_id: e.department_id,
          department_name: e.department?.name ?? null,
        })),
      )
      setOpen(true)
    }, 200)
  }

  const pick = (employee: PickedEmployee) => {
    onChange(employee)
    setQuery(employee.full_name)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <Input
        value={value ? value.full_name : query}
        onChange={(e) => search(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={t('receive.receiverPlaceholder')}
        autoComplete="off"
      />
      {open && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              {t('receive.noReceiverMatch')}
            </li>
          ) : (
            results.map((employee) => (
              <li key={employee.id}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-baseline justify-between gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-accent"
                  onClick={() => pick(employee)}
                >
                  <span>
                    {employee.full_name}
                    {employee.initials && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {employee.initials}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {employee.department_name ?? ''}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      {!value && query.trim() && !open && (
        <p className="mt-1 text-xs text-status-neutral-to-bad">{t('receive.unassignedHint')}</p>
      )}
    </div>
  )
}
