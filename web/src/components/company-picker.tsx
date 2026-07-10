import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Virksomhedsvælger til platform-admins på tenant-data-sider. Tenant-brugere
// har companies = [] og ser den aldrig.
export function CompanyPicker({
  companies,
  value,
  onChange,
}: {
  companies: { id: string; name: string }[]
  value: string | null
  onChange: (id: string) => void
}) {
  if (companies.length === 0) return null
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {companies.map((company) => (
          <SelectItem key={company.id} value={company.id}>
            {company.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
