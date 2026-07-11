import { useCompany } from '@/components/company-provider'

// Bagudkompatibel facade for sider der er tenant-scopede: samme form som før,
// men valget kommer nu fra den globale CompanySwitcher i sidemenuen.
export function useCompanyContext() {
  const { activeCompanyId, companies, isTenantUser, isPending, setActiveCompanyId } = useCompany()
  return {
    companyId: activeCompanyId,
    companies: isTenantUser ? [] : companies,
    setCompanyId: setActiveCompanyId,
    isPending,
  }
}
