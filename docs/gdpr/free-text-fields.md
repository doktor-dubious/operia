# Free-text fields — scrubbing decisions

Work item 9. Free text is where personal data hides from every automatic erasure path: a name
typed into a note has no foreign key, so anonymizing the *employee* never reaches it.

This is the complete decision list. **Recommended** is a proposal — the controller's own
retention needs may overrule it, and the column marked *decided* is what actually applies.

**Last reviewed:** 2026-08-14 · **Owner:** DCA Logic privacy owner ⟨*to be named*⟩.
Related: [`retention-schedule.md`](retention-schedule.md) · [`ropa.md`](ropa.md) §2 ·
[`dpa/bilag-da.md`](dpa/bilag-da.md) C.3 (which currently promises the "evidence" answer for the
handover fields) · [`../compliance-map.md`](../compliance-map.md).

---

## How a field gets on this list

All three must be true:

1. **A user types it freely** — not a picker, not an enum, not a generated value.
2. **It can plausibly contain a person's name or contact details.**
3. **It survives every existing erasure path** — employee anonymization, loan-return clearing,
   parcel-file deletion, row deletion.

Fail any one and there is nothing to decide. That is why this list has 13 entries and not the
~180 text columns in the schema.

## The three possible answers

| Answer | Means | Cost |
|---|---|---|
| **Scrub** | Cleared by an erasure path (anonymization, or a trigger at closure) | The text is gone; if it documented an exception, that documentation is gone too |
| **Time-limit** | No targeted scrubbing; the row dies with its retention window | Simple, but until the window expires the data is intact — and a window must actually be set |
| **Evidence** | Deliberately retained for the lifetime of the record, and documented as such | Defensible only where the field genuinely *is* the proof of something |

"Evidence" is a real answer under GDPR, but only when written down with its reasoning — which is
what this file is for.

---

## Tier 1 — names a third party by design

These are the handover fields. The person named is usually **not** an employee and has no row
anywhere in the system.

| # | Field | What it holds | Recommended | Reasoning | Decided |
|---|---|---|---|---|---|
| 1 | `parcels.delivered_to` | Name of whoever actually collected — often a proxy | **Evidence** | It is the proof the parcel reached a human. Scrubbing it while keeping the signature image beside it is incoherent: you would destroy the readable half of the evidence and keep the biometric-looking half | |
| 2 | `parcels.sender` | Sender; on a private shipment a named individual | **Time-limit** | Not evidence of custody — it is intake convenience and now feeds sender suggestions. The `parcels` retention window is the right instrument | |
| 3 | `parcels.receiver_override_reason` | Manager's reason for handing the parcel to someone other than the addressee | **Evidence** | The reason *is* the audit trail for the exception — the same decision already taken and documented for its copy in `audit_log` (2026-07-30) | |
| 4 | `parcels.removed_reason` | Manager's reason for voiding a registration | **Evidence** | Same as #3: a withdrawn registration is the hardest event in the flow and must stay explainable | |
| 5 | `parcels.delivered_note` | Free note at handover | **Scrub on anonymize** | Unlike #1 it is not the proof of anything; it is a convenience note that happens to be next to one | |

## Tier 2 — can name someone, weak as evidence

| # | Field | What it holds | Recommended | Reasoning | Decided |
|---|---|---|---|---|---|
| 6 | `parcels.condition_note` | Condition text at intake ("dented, courier confirmed") | **Scrub on anonymize** | The *photo* is the condition evidence; the note rarely carries the weight | |
| 7 | `asset_loans.note` | Free note on a loan | **Scrub on return** | The return trigger already clears name, address, e-mail, phone and `bounce_reason` — the note was simply overlooked | |
| 8 | `assets.retired_reason` | Why an asset was retired | **Time-limit** | Usually about the asset, occasionally about a person | |
| 9 | `routes.notes` | Free note on a route plan | **Time-limit** | Covered by the `routes` retention window | |
| 10 | `routes.description` | Route description | **Time-limit** | As #9 | |
| 11 | `storage_locations.notes` | Note on a storage location | **Time-limit** | Configuration data, but "Anna's office" is a real pattern | |
| 12 | `storage_locations.description` | Description of a location | **Time-limit** | As #11 | |
| 12a | `bookings.title` | Booking purpose ("Interview with …", "1:1 Anna/Bo") | **Time-limit** | Can name colleagues or external guests by design of use, though the field asks for a purpose. Searched by the SAR export (`bookings_mentioning`); dies with the booking under the `bookings` window. Deliberately never copied into `booking_events`/`audit_log`. **Leaves the system in booking notifications** (2026-09-08): the templates interpolate it, so it reaches the employee, the requester and — where the customer has set one — the fixed copy mailbox. The field hint on Konfigurér → Notifikationer says so, so choosing that mailbox is an informed decision | |
| 12b | `booking_resources.description` | Resource description | **Time-limit** | Configuration data, same "Anna's office" pattern as #11 | |
| 12c | `booking_participant_levels.name` | Participant level name ("Niveau 1", "Grundforløb") | **Time-limit** | Configuration data, maintained by the customer on Configure → Booking. Names a course tier, not a person; same class as #12b. Lives as long as the level does (deleting one is blocked while any booking references it) | |
| 12d | `bookings.cancellation_reason` | Why a booking was cancelled ("aflyst pga. Annas sygdom") | **Time-limit** | Required since 2026-09-09 (EVU A-07), written by a manager and can name someone other than the booking's employee — same class as `parcels.removed_reason`. Searched by the SAR export (`bookings_mentioning`), and deliberately **not** copied into `booking_events`/`audit_log`: that log is immutable and forwarded to customer log drains, so free text there could never be removed. Dies with the booking under the `bookings` window | |
| 12e | `booking_services.name` / `.description` | Add-on service catalogue ("Forplejning", "Overnatning") | **Time-limit** | Configuration data maintained by the customer, same class as #12b/#12c. Names a purchasable service, not a person; lives as long as the service does (deletion is blocked while any booking line references it) | |

## Tier 3 — addresses rather than names

| # | Field | Recommended | Reasoning | Decided |
|---|---|---|---|---|
| 13 | `routes.from_address` / `routes.to_address` | **Time-limit** | Home addresses are personal data, but they are the *function* of a route plan; the `routes` window is the proportionate control | |

## Also worth a decision, though not free text

| Field | Note |
|---|---|
| `import_runs.created_by_email` | An employee's own address, kept as the import audit trail. Governed by the `imports` retention window and untouched by anonymization. **Recommended: time-limit** — it documents who ran an import |
| `import_runs.file_name`, `inbound_files.file_name` | Customer-chosen filenames can contain a name (`medarbejdere-anna.csv`). Same window as above; **no separate action recommended** |

---

## Already handled — for completeness

So the next reviewer does not re-open settled ground:

| Field(s) | Path |
|---|---|
| `employees.*` (name, e-mail, phone, NFC id, employee no., external id) | `anonymize_employee_internal()` |
| `asset_loans.to_name/to_address/to_email/to_phone`, `asset_loan_notifications.recipient`, `asset_loans.bounce_reason` | Cleared on return (`20260720130100`) |
| `parcel_notifications.recipient` | Cleared when the parcel closes (`20260814140000`) |
| `app_users.full_name/email` | Removed with the auth user |
| `feedback.message/subject` + screenshot | Deletable; DCA is controller |
| `asset_documents.note` + photo | Platform-admin deletion (`20260801180000`) |
| `parcel_documents.note` + file | Platform-admin deletion (`20260814190000` — **this was missing until the review that produced this file**) |

## Fixed rather than decided (2026-08-14)

Three findings from the field-by-field sweep were plain gaps, not judgement calls:

1. **`parcel_documents` had no erasure path.** Its asset twin got one in `20260801180000`; the
   parcel side never did, so the *photo* could be deleted by a platform admin but the note beside
   it could not — by anyone. Fixed in `20260814190000` with the same model: platform-admin-only
   deletion, UPDATE still revoked (erasure is deletion, never rewriting), and the deletion written
   to the parcel's immutable history as `document_deleted`.
2. **Provider error strings echoed recipients.** `parcel_notifications.error`,
   `asset_loan_notifications.error` and `log_drains.last_error` store the raw vendor response, and
   a rejection routinely quotes the address that failed (`550 5.1.1 <anna@firma.dk> unknown`).
   The recipient column itself is masked in the audit log and cleared at closure — so letting the
   same address survive in the error text is a back door. `sanitizeProviderError()` in
   `supabase/functions/_shared/notify.ts` now masks e-mail addresses and 8+ digit numbers **at the
   point of storage** (not in the response to the manager who typed the address), and the
   migration nulled any pre-existing rows that matched. Status codes, timeouts and vendor error
   codes are deliberately left readable — they are what you debug on.
3. **Deleting evidence was logged as a routine success.** Testing the new deletion path showed
   `parcel.document_deleted` — and `asset.document_deleted`, since 2026-08-01 — classified as
   `success` in the audit taxonomy. The rule `like '%.deleted'` needs a literal dot immediately
   before "deleted", and both actions end in `_deleted`. The function already carried escaped
   twins for `_failed`, `_bounced`, `_overridden` and `_complained`; `_deleted` was missing.
   Fixed in `20260814200000` — deletion of evidence now surfaces at **warning** level, which is
   what the weekly review in [`incident-response.md`](incident-response.md) §7 filters on.

## Open

- [ ] Fill in the **Decided** column and date it.
- [ ] Implement whatever differs from the recommendation.
- [ ] For every "Evidence" row, make sure the reasoning above is reflected in
      [`retention-schedule.md`](retention-schedule.md) and DPA Bilag C.3, so the customer's DPO
      reads the same answer we do.
