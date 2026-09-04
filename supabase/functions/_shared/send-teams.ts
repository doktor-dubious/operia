// Fælles: send en Microsoft Teams-besked til modtageren som 1:1-chat.
//
// STATUS: ikke bygget endnu. Kanalen er med i registret (channels.ts) med
// `available: false`, så resten af systemet — enum, dedup, skabeloner,
// logning — er færdigt, mens kanalen er skjult i UI'et og filtreret ud af alle
// kanalvalg (enabledChannels/selectedChannels). Afsenderen kan altså ikke nås
// fra dispatcheren; svaret 'teams_not_configured' er der kun som sikkerhedsnet
// (classifySendError oversætter det til en læsbar årsag i Logs). Når
// integrationen bygges: sæt available: true i channels.ts OG CHANNEL_AVAILABLE
// i web/src/lib/notify-contact.ts.
//
// `to` er medarbejderens Entra-objekt-id (employees.external_id), som
// AD-synkroniseringen allerede skriver — se recipientField i channels.ts.
// Netop derfor virker kanalen kun for kunder på AD-synkronisering; en kunde på
// CSV-import har ingen objekt-id'er og skal have kanalen slået fra.
//
// Sådan bygges den, og hvorfor ikke enklere:
//
//   • IKKE Incoming Webhooks / O365-connectors: de er på vej ud hos Microsoft
//     og sender til en KANAL, ikke til en person. Forkert form til formålet.
//   • IKKE Graph POST /chats/{id}/messages app-only: ChatMessage.Send som
//     applikationsrettighed er et beskyttet API der kræver særskilt godkendelse
//     fra Microsoft (og har forbrugsafregning). Ikke en vej at starte på.
//   • JA til Bot Framework proaktiv besked. Det kræver:
//       1. Vores egen multi-tenant Azure Bot-registrering (en ANDEN identitet
//          end kundens Entra-app — der er to sæt credentials i spil).
//       2. En Teams-apppakke (manifest + ikoner), enten sideloadet i kundens
//          app-katalog eller udgivet i Microsoft-butikken.
//       3. Installation for hver bruger via Graph
//          POST /users/{id}/teamwork/installedApps (rettigheden
//          TeamsAppInstallation.ReadWriteForUser.All, admin-godkendt). Uden det
//          kan man ikke skrive til en bruger der ikke selv har skrevet først.
//          Her hjælper det at kunder på AD-synkronisering allerede har en
//          app-registrering med administrator-samtykke (company_entra_config +
//          company_entra_secret) — det er en udvidelse af et eksisterende
//          samtykke frem for et nyt.
//       4. Derefter POST /v3/conversations med objekt-id'et som medlem, og
//          send aktiviteten på den returnerede samtale.
//
// GDPR: modsat Slack er Teams IKKE en ny databehandler — beskederne bliver i
// kundens egen tenant. Det er et reelt argument for at prioritere Teams først.

import type { SendContext, SendResult } from './channels.ts'

export function sendTeams(
  _to: string,
  _message: string,
  _ctx: SendContext,
): Promise<SendResult> {
  return Promise.resolve({ ok: false, error: 'teams_not_configured' })
}
