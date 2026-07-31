import { supabase } from '@/lib/supabase'

// Fjerner alt i virksomhedens mappe i den OFFENTLIGE 'company-logos'-bucket
// (Home-/Handheld-designets billeder m.m.), når kunden slettes — ellers bliver
// filerne liggende offentligt tilgængelige efter at kunden er væk (GDPR).
//
// Afløser cleanupLogos, som lå i company-config-fields.tsx og også blev kaldt
// ved hvert logo-gem: Logo- og Udseende-siderne er fjernet (2026-07-28), så der
// er ikke længere en "behold den aktuelle fil"-situation — kun oprydning ved
// sletning af kunden.
export async function cleanupCompanyFiles(companyId: string) {
  const { data: files } = await supabase.storage.from('company-logos').list(companyId)
  if (!files?.length) return
  await supabase.storage.from('company-logos').remove(files.map((f) => `${companyId}/${f.name}`))
}

// Fjerner udskiftede/fjernede designbilleder efter hvert gem (cleanupLogos'
// gamle rolle): bucket'en er offentlig, så et erstattet billede må ikke blive
// liggende tilgængeligt på sin gamle URL (GDPR). Kun editorens egne filer
// røres (namePrefix), så home-/handheld-designet og gamle logofiler ikke
// sletter hinandens; alt det netop gemte design stadig refererer, beholdes
// (stien indgår i den serialiserede JSON via sin offentlige URL).
export async function cleanupDesignImages(
  folder: string, // company_id (kundedesign) eller editorens mappe (platform-standard)
  namePrefix: string, // fx 'home-design-' — tom streng i platform-mappen (kun egne filer dér)
  saved: unknown, // det netop gemte design (tiles + design)
) {
  const refs = JSON.stringify(saved)
  const { data: files } = await supabase.storage.from('company-logos').list(folder)
  const stale = (files ?? [])
    .filter((f) => f.name.startsWith(namePrefix))
    .map((f) => `${folder}/${f.name}`)
    .filter((path) => !refs.includes(path))
  if (stale.length) await supabase.storage.from('company-logos').remove(stale)
}
