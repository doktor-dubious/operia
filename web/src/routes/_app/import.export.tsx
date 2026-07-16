import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CsvExportPanel, type ExportLoad } from '@/components/import/csv-export-panel'
import { IMPORT_CONFIG_DEFAULTS } from '@/hooks/use-import-config'
import { fetchAllPages } from '@/lib/import-utils'
import { supabase } from '@/lib/supabase'

// Import/Eksport → Eksport for medarbejder-stamdata (Flow 0). Skriver de
// aktive medarbejdere i virksomhedens konfigurerede filformat; afdeling
// eksporteres med navn (ikke id), så en re-import matcher/opretter afdelinger.
export const Route = createFileRoute('/_app/import/export')({
  component: EmployeeExportPage,
})

// Feltnøgle → kolonne på employees (name = full_name; department = navn).
// Sidevis hentning (fetchAllPages) — ellers capper PostgREST tavst ved 1000
// rækker, og en "komplet" eksport ville mangle resten.
const loadEmployees: ExportLoad = async (companyId, _fields) => {
  const [emps, depts] = await Promise.all([
    fetchAllPages((from, to) =>
      supabase
        .from('employees')
        .select(
          'employee_no, full_name, initials, email, phone, language, nfc_card_id, role, department_id',
        )
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('employee_no')
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      supabase.from('departments').select('id, name').eq('company_id', companyId).order('id').range(from, to),
    ),
  ])

  const deptName = new Map(depts.map((d) => [d.id, d.name]))
  const records = emps.map((e) => ({
    employee_no: e.employee_no,
    name: e.full_name,
    initials: e.initials,
    email: e.email,
    phone: e.phone,
    language: e.language,
    nfc_card_id: e.nfc_card_id,
    role: e.role,
    department: e.department_id ? (deptName.get(e.department_id) ?? null) : null,
  }))
  return { headerFor: (field) => field, records }
}

function EmployeeExportPage() {
  const { t } = useTranslation()
  return (
    <CsvExportPanel
      importType="employees"
      runKind="employees_csv"
      defaultFields={IMPORT_CONFIG_DEFAULTS.fields}
      fileBase={t('exportPage.employeesFileBase')}
      title={t('exportPage.employeesTitle')}
      subtitle={t('exportPage.employeesSubtitle')}
      fieldLabel={(field) => t(`importConfig.field_${field}`)}
      load={loadEmployees}
    />
  )
}
