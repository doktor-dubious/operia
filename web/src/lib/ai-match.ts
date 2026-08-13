// Fortolkningslaget over AI-label-aflæsningen (fase 1, deterministisk).
//
// Selve matchningen sker i databasen (RPC ai_match_label_fields, migration
// 20260807132720): dansk foldning — "AAse Østergård", "Åse Ostergård" og "Åse
// Østergård" er samme navn — plus fuzzy-lighed for ægte stavefejl. Reglerne
// ligger dér og ikke her, så webben og håndterminalen opfører sig ens.
//
// Klienten skal kun kende to ting: `auto` betyder ét entydigt match som må
// udfyldes direkte, og alt andet er FORSLAG et menneske vælger imellem.
import { supabase } from '@/lib/supabase'

export type MatchedEmployee = {
  id: string
  full_name: string
  initials: string | null
  email: string | null
  phone: string | null
  department_id: string | null
  department_name: string | null
  score: number
}

export type MatchedCarrier = { id: string; name: string; score: number }
export type MatchedSender = { name: string; score: number }

type Field<T> = { raw: string; auto: boolean; candidates: T[] }

export type LabelMatch = {
  receiver?: Field<MatchedEmployee>
  carrier?: Field<MatchedCarrier>
  sender?: Field<MatchedSender>
}

/**
 * Matcher de AI-aflæste navne mod virksomhedens egne data.
 *
 * Fejler opslaget (netværk, RLS, forældet skema), returneres null — IKKE et
 * tomt resultat: for kalderen betyder et tomt resultat "intet match, udfyld
 * ikke", mens en fejl betyder "fald tilbage til de gamle eksakte regler".
 * Blandes de to sammen, slår en forbigående fejl al auto-udfyldning fra og
 * melder falsk "findes ikke i medarbejderkartoteket".
 */
export async function matchLabelFields(
  companyId: string,
  fields: { receiver?: string | null; carrier?: string | null; sender?: string | null },
): Promise<LabelMatch | null> {
  try {
    const { data, error } = await supabase.rpc('ai_match_label_fields', {
      p_company_id: companyId,
      p_receiver: fields.receiver?.trim() || undefined,
      p_carrier: fields.carrier?.trim() || undefined,
      p_sender: fields.sender?.trim() || undefined,
    })
    if (error) throw error
    return (data ?? {}) as LabelMatch
  } catch (e) {
    console.error('Label-matchning fejlede:', e)
    return null
  }
}

/** Er den anvendte værdi reelt en RETTELSE af det labelen sagde? */
export function isCorrection(raw: string | null | undefined, applied: string): boolean {
  if (!raw) return false
  return raw.trim().toLocaleLowerCase('da') !== applied.trim().toLocaleLowerCase('da')
}
