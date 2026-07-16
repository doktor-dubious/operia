import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Standardkonfigurationen gælder også UDEN en gemt række — det
// konfigurationssiden viser, er kontrakten importen håndhæver.
export const IMPORT_CONFIG_DEFAULTS = {
  has_header: true,
  has_footer: false,
  separator: ',',
  fields: [
    'employee_no',
    'name',
    'initials',
    'email',
    'phone',
    'department',
    'language',
    'nfc_card_id',
    'role',
  ] as string[],
}

export type ImportType = 'employees' | 'assets' | 'inventory'

// Virksomhedens importkonfiguration (Import → Konfiguration).
// null = ingen gemt række endnu → standarderne gælder (medarbejdere:
// IMPORT_CONFIG_DEFAULTS; aktiver/lager: modulets defaultFields).
export function useImportConfig(companyId: string | null, importType: ImportType = 'employees') {
  return useQuery({
    queryKey: ['import-config', companyId, importType],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('import_configs')
        .select('has_header, has_footer, separator, fields')
        .eq('company_id', companyId!)
        .eq('import_type', importType)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}
