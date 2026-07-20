// Microsoft Entra ID (Active Directory) via Graph API.
//
// Kører udelukkende server-side: client secret må aldrig nå browseren, og
// Microsofts token-endpoint tillader heller ikke client_credentials fra en
// browser-origin. Både test-forbindelsen og synkroniseringen bruger denne fil.

export type EntraCreds = {
  tenantId: string
  clientId: string
  clientSecret: string
}

export type GraphUser = {
  id: string
  displayName?: string | null
  givenName?: string | null
  surname?: string | null
  mail?: string | null
  userPrincipalName?: string | null
  employeeId?: string | null
  department?: string | null
  jobTitle?: string | null
  mobilePhone?: string | null
  preferredLanguage?: string | null
  accountEnabled?: boolean | null
  mailNickname?: string | null
  [key: string]: unknown
}

export class EntraError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

const GRAPH = 'https://graph.microsoft.com/v1.0'

// Felter synkroniseringen læser. mailNickname tages med som mulig initial-kilde.
const SELECT = [
  'id', 'displayName', 'givenName', 'surname', 'mail', 'userPrincipalName',
  'employeeId', 'department', 'jobTitle', 'mobilePhone', 'preferredLanguage',
  'accountEnabled', 'mailNickname',
].join(',')

export async function getToken(creds: EntraCreds): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Microsofts fejlbeskrivelser er lange og indeholder trace-id'er; første
    // linje er den brugbare del til en fejlmeddelelse i UI'et.
    const detail = String(body.error_description ?? body.error ?? res.status).split('\n')[0]
    throw new EntraError(mapAuthError(String(body.error ?? ''), detail), detail)
  }
  return body.access_token as string
}

// Oversætter Microsofts fejlkoder til vores egne, så UI'et kan vise en
// handlingsanvisende tekst i stedet for rå AADSTS-koder.
function mapAuthError(error: string, detail: string): string {
  if (detail.includes('AADSTS7000215')) return 'invalid_secret'
  if (detail.includes('AADSTS700016') || detail.includes('AADSTS90002')) return 'unknown_app_or_tenant'
  if (detail.includes('AADSTS7000222')) return 'expired_secret'
  if (error === 'unauthorized_client') return 'unknown_app_or_tenant'
  return 'auth_failed'
}

async function graphGet<T>(token: string, url: string, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, ...headers } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const code = String((body as { error?: { code?: string } }).error?.code ?? res.status)
    const message = String((body as { error?: { message?: string } }).error?.message ?? 'Graph-kald fejlede')
    // Manglende administratorsamtykke er den klart hyppigste opsætningsfejl.
    throw new EntraError(code === 'Authorization_RequestDenied' ? 'missing_consent' : 'graph_failed', message)
  }
  return body as T
}

type Page<T> = { value: T[]; '@odata.nextLink'?: string }

async function graphAll<T>(token: string, firstUrl: string, headers?: Record<string, string>): Promise<T[]> {
  const out: T[] = []
  let url: string | undefined = firstUrl
  // Loft: en fejlkonfigureret forespørgsel må ikke kunne køre i det uendelige.
  for (let page = 0; url && page < 200; page++) {
    const body: Page<T> = await graphGet<Page<T>>(token, url, headers)
    out.push(...(body.value ?? []))
    url = body['@odata.nextLink']
  }
  return out
}

// Kun rigtige medarbejdere: gæster (#EXT#) og eksterne konti hører ikke til i
// modtagerdirektoriet. Uden dette filter havner fx kundens egen Entra-admin og
// alle delte postkasser som pakkemodtagere.
const MEMBERS_ONLY = "userType eq 'Member'"

// userType alene er ikke nok: en konto der er inviteret ind fra en anden tenant
// (eller tenant-ejerens egen private Microsoft-konto) står som Member, men har
// "#EXT#" i sit userPrincipalName. Det er eksterne identiteter, ikke ansatte —
// uden dette havner fx kundens Entra-administrator som pakkemodtager.
function isInternal(u: { userType?: string | null; userPrincipalName?: string | null }): boolean {
  if ((u.userType ?? 'Member') !== 'Member') return false
  return !(u.userPrincipalName ?? '').includes('#EXT#')
}

// Deaktiverede konti er standardmåden at offboarde på i Entra: kontoen slås fra
// længe før den slettes eller ryger ud af grupperne. En deaktiveret konto er en
// fratrådt medarbejder og skal UD af direktoriet (deaktivering/anonymisering ad
// den normale fratrædelsesvej) — ikke ind som aktiv pakkemodtager.
function isEnabled(u: { accountEnabled?: boolean | null }): boolean {
  return u.accountEnabled !== false
}

export async function fetchUsers(token: string, groupId?: string | null): Promise<GraphUser[]> {
  if (groupId) {
    // transitiveMembers, ikke members: en "Alle ansatte"-gruppe med indlejrede
    // afdelingsgrupper er standardmønsteret i Entra, og direkte medlemmer alene
    // ville behandle alle i undergrupperne som fratrådte. OData-cast med $select
    // kræver ConsistencyLevel: eventual + $count=true. Filtrering på userType
    // understøttes ikke her, så medlemmerne hentes og filtreres lokalt.
    const members = await graphAll<GraphUser & { userType?: string }>(
      token,
      `${GRAPH}/groups/${encodeURIComponent(groupId)}/transitiveMembers/microsoft.graph.user?$select=${SELECT},userType&$count=true&$top=999`,
      { ConsistencyLevel: 'eventual' },
    )
    return members.filter(isInternal).filter(isEnabled)
  }
  const users = await graphAll<GraphUser & { userType?: string }>(
    token,
    `${GRAPH}/users?$select=${SELECT},userType&$filter=${encodeURIComponent(MEMBERS_ONLY)}&$top=999`,
  )
  return users.filter(isInternal).filter(isEnabled)
}

export async function fetchGroups(token: string): Promise<{ id: string; displayName: string }[]> {
  return await graphAll<{ id: string; displayName: string }>(
    token,
    `${GRAPH}/groups?$select=id,displayName&$top=999`,
  )
}

// Initialer: Entra har ingen standardattribut. Kunden kan pege på en attribut
// (fx mailNickname eller en extension), ellers udledes de af navnet — første
// bogstav i hvert navneled, som "Jens Kurt Havgaard" → "JKH".
export function initialsFor(user: GraphUser, source?: string | null): string | null {
  if (source) {
    const raw = user[source]
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (text) return text
  }
  const name = (user.displayName ?? '').trim()
  if (!name) return null
  const parts = name.split(/\s+/).filter(Boolean)
  if (!parts.length) return null
  return parts.map((p) => [...p][0]!.toUpperCase()).join('')
}
