import { createContext, useContext, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccess } from '@/hooks/use-access'
import { useSession } from '@/hooks/use-session'
import { supabase } from '@/lib/supabase'

// Global virksomhedskontekst (aktiv tenant):
//  - tenant-brugere: egen virksomhed, fast.
//  - platform-admins: vælger via CompanySwitcher i sidemenuen; valget og de
//    senest brugte huskes i localStorage.
// Alle tenant-scopede sider læser samme kontekst via useCompanyContext().

export type Company = { id: string; name: string }

type CompanyContextValue = {
  companies: Company[] // alfabetisk; tom liste indtil hentet
  activeCompanyId: string | null
  activeCompany: Company | null
  recentCompanies: Company[] // senest brugte først (uden den aktive)
  isTenantUser: boolean // fast virksomhed — ingen vælger
  isPending: boolean
  setActiveCompanyId: (id: string) => void
}

const SELECTED_KEY = 'operia-company'
const RECENT_KEY = 'operia-company-recent'
const RECENT_MAX = 5

const CompanyContext = createContext<CompanyContextValue | null>(null)

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession()
  const { data: access } = useAccess()
  const [selectedId, setSelectedId] = useState<string | null>(
    () => localStorage.getItem(SELECTED_KEY),
  )
  const [recentIds, setRecentIds] = useState<string[]>(loadRecent)

  const { data, isPending } = useQuery({
    queryKey: ['company-context', session?.user.id, access?.isPlatformAdmin],
    enabled: !!session && access !== undefined,
    queryFn: async () => {
      if (access!.isPlatformAdmin) {
        const { data, error } = await supabase.from('companies').select('id, name').order('name')
        if (error) throw error
        return { companies: data as Company[], own: null as string | null }
      }
      const { data: link, error } = await supabase
        .from('app_users')
        .select('company_id, company:companies (id, name)')
        .eq('user_id', session!.user.id)
        .maybeSingle()
      if (error) throw error
      const company = link?.company as Company | null
      return { companies: company ? [company] : [], own: link?.company_id ?? null }
    },
  })

  const companies = data?.companies ?? []
  const isTenantUser = !!data?.own
  const activeCompanyId =
    data?.own ??
    (selectedId && companies.some((c) => c.id === selectedId) ? selectedId : null) ??
    companies[0]?.id ??
    null
  const activeCompany = companies.find((c) => c.id === activeCompanyId) ?? null
  const recentCompanies = recentIds
    .filter((id) => id !== activeCompanyId)
    .map((id) => companies.find((c) => c.id === id))
    .filter((c): c is Company => !!c)

  const setActiveCompanyId = (id: string) => {
    setSelectedId(id)
    localStorage.setItem(SELECTED_KEY, id)
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_MAX)
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      return next
    })
  }

  return (
    <CompanyContext.Provider
      value={{
        companies,
        activeCompanyId,
        activeCompany,
        recentCompanies,
        isTenantUser,
        isPending,
        setActiveCompanyId,
      }}
    >
      {children}
    </CompanyContext.Provider>
  )
}

export function useCompany() {
  const ctx = useContext(CompanyContext)
  if (!ctx) throw new Error('useCompany skal bruges inden i <CompanyProvider>')
  return ctx
}
