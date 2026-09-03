import i18n from '@/i18n'
import { FLAT_BUNDLES } from '@/lib/app-texts'
import { supabase } from '@/lib/supabase'

// Opslagslaget for grænsefladetekster: henter overstyringerne og lægger dem
// oven på i18next' ressourcer ved kørsel. Locale-filerne redigeres ALDRIG.
//
// Tre lag, svageste først:
//   1. locale-bundtet (da.json / en.json)
//   2. platformens standard (company_id is null)
//   3. kundens egen overstyring (company_id = virksomheden)

export type OverrideRow = {
  company_id: string | null
  lang: string
  text_key: string
  value: string
}

export type TextLayers = {
  platformLayer: Record<string, string>
  companyLayer: Record<string, string>
  merged: Record<string, string>
}

function toLayers(rows: OverrideRow[]): TextLayers {
  const platformLayer: Record<string, string> = {}
  const companyLayer: Record<string, string> = {}
  for (const row of rows) {
    if (row.company_id === null) platformLayer[row.text_key] = row.value
    else companyLayer[row.text_key] = row.value
  }
  return { platformLayer, companyLayer, merged: { ...platformLayer, ...companyLayer } }
}

// RLS begrænser i forvejen synligheden; filtret her sparer bare rækker.
function overrideQuery(companyId: string | null) {
  const base = supabase
    .from('app_text_override')
    .select('company_id, lang, text_key, value')
    .eq('platform', 'web')
  return companyId
    ? base.or(`company_id.is.null,company_id.eq.${companyId}`)
    : base.is('company_id', null)
}

/** Begge lag for ÉT sprog — det app-skallen har brug for. */
export async function fetchTextOverrides(companyId: string | null, lang: string) {
  const { data, error } = await overrideQuery(companyId).eq('lang', lang)
  if (error) throw error
  return toLayers((data ?? []) as OverrideRow[])
}

/**
 * Begge lag for ALLE sprog, grupperet pr. sprog. Tekster-siden skal bruge det:
 * dialogen redigerer hvert aktivt sprog samtidig, og både standarden
 * (platformlaget) og overstyringen er sprogafhængige — slår man dem op på det
 * valgte sprog alene, viser fx den engelske blok den danske standard.
 */
export async function fetchAllTextOverrides(companyId: string | null) {
  const { data, error } = await overrideQuery(companyId)
  if (error) throw error
  const byLang: Record<string, OverrideRow[]> = {}
  for (const row of (data ?? []) as OverrideRow[]) (byLang[row.lang] ??= []).push(row)
  return Object.fromEntries(
    Object.entries(byLang).map(([lang, rows]) => [lang, toLayers(rows)]),
  ) as Record<string, TextLayers>
}

// Nøgler vi sidst lagde oven på i18next, pr. sprog. Nødvendigt for at kunne
// NULSTILLE: addResourceBundle kan kun flette ind, ikke fjerne — så en nøgle
// der ikke længere er overstyret skal aktivt skrives tilbage til sin standard.
const appliedKeys: Record<string, Set<string>> = {}

function unflatten(flat: Record<string, string>) {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.')
    let node = out
    for (const part of parts.slice(0, -1)) {
      if (typeof node[part] !== 'object' || node[part] === null) node[part] = {}
      node = node[part] as Record<string, unknown>
    }
    node[parts[parts.length - 1]] = value
  }
  return out
}

/** Lægger (eller fjerner) overstyringerne for ét sprog i i18next. */
export function applyTextOverrides(lang: string, overrides: Record<string, string>) {
  const previous = appliedKeys[lang] ?? new Set<string>()
  const bundle: Record<string, string> = {}

  // Nøgler der ikke længere er overstyret sættes tilbage til locale-standarden.
  for (const key of previous) {
    if (key in overrides) continue
    const fallback = FLAT_BUNDLES[lang]?.[key]
    if (fallback !== undefined) bundle[key] = fallback
  }
  for (const [key, value] of Object.entries(overrides)) bundle[key] = value

  appliedKeys[lang] = new Set(Object.keys(overrides))
  if (Object.keys(bundle).length === 0) return

  // deep = true, overwrite = true: flet ind i det eksisterende bundt.
  i18n.addResourceBundle(lang, 'translation', unflatten(bundle), true, true)
  // Tving en gen-rendering af alle komponenter der bruger useTranslation.
  i18n.emit('languageChanged', i18n.language)
}
