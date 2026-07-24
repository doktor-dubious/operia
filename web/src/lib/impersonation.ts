import { supabase } from '@/lib/supabase'

// Impersonering (kun platform-admins → almindelige brugere, til test). Flowet:
//  1) Fang admin'ens egen session (access+refresh) og læg den i sessionStorage.
//  2) Kald impersonate-user (service-role, genverificerer autorisation). Den
//     genererer OG indløser et magic-link server-side og returnerer målets
//     session-tokens — selve engangstokenet når aldrig browseren.
//  3) setSession → browserens session BLIVER målets. Hele appen (useSession,
//     useAccess, RLS) kører derefter som den bruger.
//  4) "Stop" sætter admin-sessionen tilbage med setSession — ingen ny login.
//
// Admin-tokenet ligger KUN i sessionStorage (fane-scopet, ryddes når fanen
// lukkes) — bevidst ikke localStorage, for at begrænse eksponeringen. Et separat
// localStorage-flag lader banneret opdage impersoneringen i ANDRE faner (supabase
// deler sessionen via localStorage, så alle faner bliver målbrugeren) og en
// efterladt impersonering, hvis fanen lukkes midt i det.

const STASH_KEY = 'operia.impersonation'
const FLAG_KEY = 'operia.impersonating'

export type ImpersonationStash = {
  adminAccessToken: string
  adminRefreshToken: string
  adminEmail: string | null
  targetName: string
  targetEmail: string
}

/** Fuld stash (admin-tokens + mål) — kun til stede i samme fane som starten. */
export function getImpersonation(): ImpersonationStash | null {
  try {
    const raw = sessionStorage.getItem(STASH_KEY)
    return raw ? (JSON.parse(raw) as ImpersonationStash) : null
  } catch {
    return null
  }
}

/** Er der en impersonering i gang (også i andre faner end den der startede)? */
export function isImpersonating(): boolean {
  return !!getImpersonation() || localStorage.getItem(FLAG_KEY) != null
}

/** Navnet på den impersonerede — stash i denne fane, ellers localStorage-flaget. */
export function getImpersonationLabel(): string {
  const stash = getImpersonation()
  return stash?.targetName || stash?.targetEmail || localStorage.getItem(FLAG_KEY) || ''
}

/**
 * Lyt efter impersonerings-ændringer fra ANDRE faner (storage-events), så fx
 * banneret også dukker op i faner, der allerede var åbne, da skiftet skete —
 * supabase-sessionen i localStorage er nemlig skiftet for dem alle.
 */
export function subscribeImpersonation(onChange: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === null || e.key === FLAG_KEY) onChange()
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}

// Læs fejlkoden ud af en FunctionsHttpError (svar-body'en).
async function readErrorCode(error: unknown): Promise<string> {
  const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } })?.context
  try {
    const body = await ctx?.json?.()
    if (body?.error) return body.error
  } catch {
    /* falder igennem til generisk kode */
  }
  return 'impersonate_failed'
}

/**
 * Start impersonering af `targetUserId`. Ved succes genindlæses appen som
 * målbrugeren. Kaster en Error med en fejlkode (matcher i18n-nøgler under
 * `impersonate.error`) hvis noget går galt — kalderen viser en toast.
 */
export async function startImpersonation(targetUserId: string, targetName: string): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession()
  const session = sessionData.session
  if (!session) throw new Error('no_session')

  const { data, error } = await supabase.functions.invoke('impersonate-user', {
    body: { userId: targetUserId },
  })
  if (error) throw new Error(await readErrorCode(error))
  const accessToken = data?.access_token as string | undefined
  const refreshToken = data?.refresh_token as string | undefined
  const targetEmail = (data?.email as string | undefined) ?? ''
  if (!accessToken || !refreshToken) throw new Error('impersonate_failed')

  const stash: ImpersonationStash = {
    adminAccessToken: session.access_token,
    adminRefreshToken: session.refresh_token,
    adminEmail: session.user.email ?? null,
    targetName,
    targetEmail,
  }
  // Gem admin-sessionen FØR vi skifter — ellers er den tabt.
  sessionStorage.setItem(STASH_KEY, JSON.stringify(stash))
  localStorage.setItem(FLAG_KEY, targetName || targetEmail)

  const { error: sessionErr } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })
  if (sessionErr) {
    sessionStorage.removeItem(STASH_KEY)
    localStorage.removeItem(FLAG_KEY)
    throw sessionErr
  }

  // Fuld genindlæsning, så al react-query-/company-provider-tilstand nulstilles
  // og appen bygges rent op som målbrugeren.
  window.location.assign('/')
}

/**
 * Stop impersonering. Med en intakt stash (samme fane) sættes admin-sessionen
 * tilbage uden ny login. Uden stash (fanen var lukket), eller hvis admin-
 * sessionen ikke kan genskabes (fx tilbagekaldt refresh-token), logges der HELT
 * ud — man må aldrig kunne hænge som målbrugeren uden banner.
 */
export async function stopImpersonation(): Promise<void> {
  const stash = getImpersonation()

  if (stash) {
    // Genskab FØRST — stash/flag ryddes kun, når vi ved hvor vi lander.
    const { error } = await supabase.auth.setSession({
      access_token: stash.adminAccessToken,
      refresh_token: stash.adminRefreshToken,
    })
    sessionStorage.removeItem(STASH_KEY)
    localStorage.removeItem(FLAG_KEY)
    if (!error) {
      window.location.assign('/operia/users')
      return
    }
  } else {
    localStorage.removeItem(FLAG_KEY)
  }

  await supabase.auth.signOut()
  window.location.assign('/login')
}
