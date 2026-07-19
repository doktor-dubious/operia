// Delt bruger-administrations-autorisation for invite-user og
// set-user-password. Browseren er utroværdig (se CLAUDE.md): begge funktioner
// genverificerer server-side med service-role-klienten, at kalderen må
// administrere brugere i målvirksomheden. Reglen bor ét sted, så invitation og
// adgangskode-nulstilling ikke kan glide fra hinanden.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

/** Er brugeren platform-admin (DCA-personale, super-tenant over alle kunder)? */
export async function isPlatformAdmin(
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
}

/**
 * Må kalderen administrere brugere i `companyId`? Platform-admin må overalt;
 * ellers kræves at kalderen er manager for netop den virksomhed.
 */
export async function callerCanManageCompany(
  admin: SupabaseClient,
  callerId: string,
  companyId: string,
): Promise<boolean> {
  if (await isPlatformAdmin(admin, callerId)) return true
  const { data: callerAppUser } = await admin
    .from('app_users')
    .select('company_id')
    .eq('user_id', callerId)
    .maybeSingle()
  if (callerAppUser?.company_id !== companyId) return false
  const { data: managerRole } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', callerId)
    .eq('role', 'manager')
    .maybeSingle()
  return !!managerRole
}
