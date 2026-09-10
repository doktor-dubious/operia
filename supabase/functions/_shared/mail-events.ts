// Fælles: omsæt et leverings-UDFALD fra e-mail-udbyderen til en audit-hændelse.
//
// Både Resend og Brevo kvitterer kun "accepteret i køen" på selve send-kaldet;
// om postkassen findes afgøres senere af den modtagende server. Hårde bounces
// og spam-klager kommer derfor tilbage som webhook-events. De to udbydere
// signerer og navngiver deres events forskelligt (Svix-signatur + 'email.bounced'
// hos Resend, delt hemmelighed i URL'en + 'hard_bounce' hos Brevo), men det der
// skal SKE bagefter er identisk — og står derfor kun her:
//
//   • match udbyderens besked-id mod provider_id på asset_loan_notifications,
//     parcel_notifications, booking_notifications eller account_emails
//     (nulstillings-/invitationsmail)
//   • marker lånet ved bounce (kun hvis adressen stadig er den samme)
//   • skriv udfaldet til audit_log via log_notification_event, så det lyser i Logs
//
// Notifikationsrækkernes status RØRES bevidst ikke — dedup-indekset
// (status='sent') skal bestå, så cron ikke gen-sender til en død adresse.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { maskRecipient } from './notify.ts'

export type MailOutcome = {
  /** Udbyderens besked-id, som det blev gemt i provider_id ved afsendelsen. */
  providerId: string
  kind: 'bounce' | 'complaint'
  /** Læsbar årsag fra udbyderen (fx "550 mailbox unavailable"). */
  reason: string
  /** Udbyderens eget eventnavn — med i detail, så loggen viser hvor det kom fra. */
  event: string
}

export async function recordMailOutcome(
  admin: SupabaseClient,
  { providerId, kind, reason, event }: MailOutcome,
): Promise<'asset' | 'parcel' | 'booking' | 'account' | null> {
  const isBounce = kind === 'bounce'

  // Matchen sker på provider_id. Nyeste række vinder, hvis et id mod
  // forventning skulle gå igen.
  const { data: assetRow } = await admin
    .from('asset_loan_notifications')
    .select('company_id, loan_id, asset_id, recipient, channel, loan:asset_loans(to_name), asset:assets(name, asset_tag)')
    .eq('provider_id', providerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (assetRow) {
    const a = assetRow as unknown as {
      company_id: string
      loan_id: string
      asset_id: string | null
      recipient: string | null
      channel: string
      loan: { to_name: string | null } | null
      asset: { name: string | null; asset_tag: string | null } | null
    }
    // Marker lånet, så Låner-fanen kan vise en rød note — men KUN hvis lånets
    // aktuelle to_email stadig er den adresse der bouncede (ellers har manageren
    // allerede rettet den, og markeringen ville være forældet).
    if (isBounce && a.recipient) {
      await admin
        .from('asset_loans')
        .update({ bounced_at: new Date().toISOString(), bounce_reason: reason.slice(0, 300) })
        .eq('id', a.loan_id)
        .eq('to_email', a.recipient)
    }
    const { error } = await admin.rpc('log_notification_event', {
      p_company_id: a.company_id,
      p_action: isBounce ? 'asset.reminder_bounced' : 'asset.reminder_complained',
      p_entity_type: 'asset_loan',
      p_entity_id: a.loan_id,
      p_summary: `${a.asset?.name || a.asset?.asset_tag || '—'}`,
      p_detail: { channel: a.channel, recipient: maskRecipient(a.recipient), reason, event },
    })
    if (error) console.error('log_notification_event fejlede:', error.message)
    return 'asset'
  }

  const { data: parcelRow } = await admin
    .from('parcel_notifications')
    .select('company_id, parcel_id, recipient, channel')
    .eq('provider_id', providerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (parcelRow) {
    const { error } = await admin.rpc('log_notification_event', {
      p_company_id: parcelRow.company_id,
      p_action: isBounce ? 'parcel.notification_bounced' : 'parcel.notification_complained',
      p_entity_type: 'parcel',
      p_entity_id: parcelRow.parcel_id,
      p_summary: null,
      p_detail: { channel: parcelRow.channel, recipient: maskRecipient(parcelRow.recipient), reason, event },
    })
    if (error) console.error('log_notification_event fejlede:', error.message)
    return 'parcel'
  }

  // Booking-notifikationer. Samme form som pakkerne — beskedloggen kom til med
  // booking-notifikationerne, og uden denne gren ville deres bounces falde
  // gennem samme hul som konto-mailerne nedenfor.
  const { data: bookingRow } = await admin
    .from('booking_notifications')
    .select('company_id, booking_id, recipient, channel')
    .eq('provider_id', providerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (bookingRow) {
    const { error } = await admin.rpc('log_notification_event', {
      p_company_id: bookingRow.company_id,
      p_action: isBounce ? 'booking.notification_bounced' : 'booking.notification_complained',
      p_entity_type: 'booking',
      p_entity_id: bookingRow.booking_id,
      p_summary: null,
      p_detail: { channel: bookingRow.channel, recipient: maskRecipient(bookingRow.recipient), reason, event },
    })
    if (error) console.error('log_notification_event fejlede:', error.message)
    return 'booking'
  }

  // Konto-mails (nulstilling af adgangskode, invitation). De har ingen
  // beskedrække — kun match-indekset account_emails, skrevet ved afsendelsen.
  // Uden denne gren blev "nulstillingsmailen bouncede" kvitteret og smidt væk,
  // så en bruger der ikke fik sin mail hverken kunne bekræftes eller afvises.
  const { data: accountRow } = await admin
    .from('account_emails')
    .select('kind, recipient_masked, user_id, company_id')
    .eq('provider_id', providerId)
    .maybeSingle()

  if (accountRow) {
    const isReset = accountRow.kind === 'password_reset'
    // Handlingsnavnene rammer de generiske endelser i audit_level:
    // '*_bounced' → error, '*_complained' → warning.
    const action = isReset
      ? isBounce ? 'auth.password_reset_bounced' : 'auth.password_reset_complained'
      : isBounce ? 'user.invite_bounced' : 'user.invite_complained'
    const { error } = await admin.rpc('log_notification_event', {
      p_company_id: accountRow.company_id,
      p_action: action,
      p_entity_type: isReset ? 'auth' : 'app_user',
      p_entity_id: accountRow.user_id ?? providerId,
      // Modtageren er allerede maskeret i tabellen — summary er den samme form
      // som anmodningsrækken bærer, så de to kan stilles op ved siden af hinanden.
      p_summary: accountRow.recipient_masked,
      p_detail: { channel: 'email', recipient: accountRow.recipient_masked, reason, event },
    })
    if (error) console.error('log_notification_event fejlede:', error.message)
    return 'account'
  }

  // Ukendt besked-id (fx en mail sendt uden om de tre spor ovenfor).
  return null
}
