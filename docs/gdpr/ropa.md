# Operia — record of processing activities (processor)

GDPR **Art. 30(2)** record, kept by DCA Logic as processor. One section per processing activity
carried out on behalf of customers, plus the activities where DCA Logic is itself controller
(§13–§15). Annex A of every data processing agreement is generated from §1–§12.

**Last reviewed:** 2026-08-14 · **Owner:** DCA Logic privacy owner.
Companion documents: [subprocessors.md](subprocessors.md) (recipients),
[toms.md](toms.md) (security measures), `../compliance-map.md` (where it is in the code).

---

## 0. Parties

| | |
|---|---|
| **Processor** | DCA Logic — *legal name, CVR, address and contact to be filled in* |
| **Processor's representative / privacy owner** | *to be named* — no Art. 37 DPO required at current scale (no large-scale systematic monitoring as a core activity); revisit as the customer base grows |
| **Controllers** | Each customer company using Operia. The current list is the `companies` table; the contract file holds the signed DPAs |
| **Categories of data subjects (all activities)** | Employees of the customer (parcel receivers, parcel handlers, managers), external senders and couriers named on parcels, third parties named in free text (proxy collectors), asset borrowers |
| **Special categories (Art. 9)** | **None processed.** Biometric verification is device-local and produces no biometric data in Operia (see toms.md §3) |
| **Transfers outside EU/EEA** | Only as listed in [subprocessors.md](subprocessors.md); the platform itself is in `eu-north-1` |

**Retention convention used below.** "Contract term" = until the customer's contract ends, then
per [offboarding](#16-offboarding-and-return-of-data). Where a configurable window exists, the
current default is stated honestly — several default to *keep forever* today and are listed as
gaps in `../compliance-map.md`.

---

## 1. Parcel intake and chain of custody

| | |
|---|---|
| **Purpose** | Register an incoming parcel, tie it to its receiver, and keep an auditable record of every custody change until it is delivered, rejected, returned or voided |
| **Data subjects** | Receiver (employee), sender (person or company), the handling employees |
| **Personal data** | Receiver identity (name, initials, department, employee no.), sender free text, barcode/tracking no., storage location, timestamps, actor user id per event, condition photos (may show persons), condition notes |
| **Recipients** | Internal only. Sub-processors: Supabase (hosting) |
| **Transfers** | None beyond hosting (EU) |
| **Retention** | Per-company window (category `parcels`), applied **only to closed parcels**; deleting a parcel takes its events with it. `parcel_events` has no window of its own — it is the chain of custody, and erasure is met by anonymizing the referenced person. Condition photos and signatures: category `parcel_files`, orphans always removed. All windows default to *keep until further notice* until the controller sets one — see [retention-schedule.md](retention-schedule.md) |
| **Security** | RLS per `company_id`; append-only event log; private storage bucket (toms.md §2, §4) |

## 2. Handover / handout

| | |
|---|---|
| **Purpose** | Prove that a parcel was handed to the right person, or record refusal |
| **Data subjects** | Receiver, proxy collector (third party), handling employee |
| **Personal data** | Signature image (handwriting), NFC/MIFARE card id, `delivered_to` free-text name, `delivered_note`, rejection flag and reason, `receiver_override_reason` when a manager records a deviation |
| **Recipients** | Internal only |
| **Transfers** | None |
| **Retention** | Signatures follow the parcel-file retention rule (§1). **Free-text collector names are not scrubbed by any anonymization path today** — open decision, see `../compliance-map.md` |
| **Security** | Private `signatures` bucket, delete restricted to platform admins (evidence integrity); override and removal are audited events |

## 3. Parcel notifications and reminders

| | |
|---|---|
| **Purpose** | Tell the receiver a parcel has arrived; remind about uncollected parcels and overdue asset loans |
| **Data subjects** | Receiver, asset borrower |
| **Personal data** | E-mail address / mobile number, receiver name, parcel reference, message body, delivery status |
| **Recipients** | **Resend** (email, US), **GatewayAPI** (SMS, DK) |
| **Transfers** | US — Resend, DPF + SCCs |
| **Retention** | The recipient address is **cleared when the parcel closes** (as the asset-loan twin already did on return); the remaining metadata falls under the `notifications` retention category |
| **Security** | Recipients are **masked** in the audit log; provider keys are edge-function secrets only |
| **Legal basis (controller's)** | Legitimate interest in the employment context — see `legal-basis-note.md` (planned) |

## 4. Employee directory maintenance

| | |
|---|---|
| **Purpose** | Keep the receiver directory current so parcels can be addressed to a real person |
| **Data subjects** | All employees of the customer |
| **Personal data** | Name, initials, employee number, e-mail, phone, department, NFC card id, external id, active/retired state |
| **Recipients** | Internal only |
| **Transfers** | None |
| **Retention** | Contract term. Employees are **deactivated, never deleted** (parcel history references them) and **anonymized** on request, automatically when a retired employee's last parcel closes, and — where the controller sets the `employees` window — automatically after that period for inactive employees with no open parcels |
| **Security** | Erasure runs through one server-side function (`anonymize_employee_internal`), never a client column list |

## 5. Employee directory import (Flow 0)

| | |
|---|---|
| **Purpose** | Ingest the customer's HR extract (CSV) over SFTP, e-mail or manual upload; upsert on employee number; deactivate employees missing from the file |
| **Data subjects** | All employees of the customer |
| **Personal data** | As §4, as delivered in the CSV |
| **Recipients** | **Postmark** (e-mail route, US); the SFTP gateway (DCA's own AWS box, stateless); Supabase Storage (`imports` bucket) |
| **Transfers** | US — Postmark, DPF |
| **Retention** | Source CSV deleted from storage **after a successful import**; kept on failure for inspection; `imports` bucket purged after **30 days**; `import_runs` and `inbound_files` follow `import_retention_days` (default: keep forever) |
| **Security** | SPF/DKIM/DMARC checks + per-company sender allowlist; bcrypt SFTP credentials; per-tenant chroot; every login/upload audited with IP |

## 6. Directory sync from Microsoft Entra ID

| | |
|---|---|
| **Purpose** | Alternative to §5: read the employee directory from the customer's own Microsoft tenant |
| **Personal data** | As §4 |
| **Recipients** | Microsoft (the **customer's** processor, not DCA's) |
| **Transfers** | Governed by the customer's own Microsoft agreement |
| **Retention / security** | As §4; client credentials stored as edge secrets, never in the browser |

## 7. AI label reading

| | |
|---|---|
| **Purpose** | Read the printed parcel label so the handler does not have to type receiver, sender and carrier fields |
| **Data subjects** | Receiver, sender, anyone named on the label |
| **Personal data** | **The full label photo** — names, addresses, phone numbers — sent as base64; the extracted field values |
| **Recipients** | The vendor the customer selects: **Mistral** (FR), **Anthropic** (US) or **Google** (US) |
| **Transfers** | US for Anthropic (SCCs) and Google (DPF/SCCs); none for Mistral |
| **Retention** | **Nothing is stored server-side** — not the photo, not the response. Approved values persist only as ordinary parcel fields. The handheld deletes the captured photo from the device cache as soon as it has been read (and sweeps leftovers at app start). Vendor-side retention follows the vendor's terms |
| **Evidence** | Every read — success, rejection and error — writes an `ai.label_read` audit row: company, user, vendor, model, outcome, timing. Never the content read |
| **Opt-in** | Three levels: platform master switch (default **off**) → customer selects provider/model → customer accepts the disclosure text naming vendor, country and what is sent (`accept_ai_disclosure`). The disclosure acceptance is the controller's documented Art. 28 instruction and is dropped automatically if the provider changes |

## 8. Route planning

| | |
|---|---|
| **Purpose** | Plan an internal or external delivery route |
| **Data subjects** | Employees and recipients at the addresses on the route |
| **Personal data** | Addresses, geocoded coordinates; with Google as provider, also the browser's IP to Google's Maps JS API |
| **Recipients** | **OpenRouteService / HeiGIT** (DE, default) or **Google** (US) |
| **Transfers** | US when Google is the configured provider |
| **Retention** | Per-company `routes` window (default: keep until further notice) |

## 9. Asset management and loans

| | |
|---|---|
| **Purpose** | Track company assets: check-out/in, loans, moves, service, documentation |
| **Data subjects** | Employees, external borrowers |
| **Personal data** | Borrower name, address, e-mail, phone (a standalone contact copy on `asset_loans`), loan/return timestamps, free-text notes and photos in `asset_documents` |
| **Recipients** | Internal; reminder e-mail/SMS via §3's providers |
| **Transfers** | As §3 |
| **Retention** | Borrower contact details **and notification recipients are cleared automatically when the asset is returned**; returned loans are removed after the per-company `asset_loans` window. `asset_events` is append-only (id references only); documents and photos are deletable by platform admins |

## 10. Authentication and access management

| | |
|---|---|
| **Purpose** | Give the right people access and keep everyone else out |
| **Data subjects** | Users with a login (managers, handlers, platform admins) |
| **Personal data** | E-mail, password hash (Supabase Auth), roles, sign-in timestamps, WebAuthn public key, IP in login audit events |
| **Recipients** | Supabase (Auth); Resend for invitation and reset e-mail |
| **Transfers** | US — Resend |
| **Retention** | Contract term; login events follow `audit_retention_days` |
| **Note** | **No biometric data.** Passkeys store a public key; the handheld stores a boolean. The device decides what the biometric check is and never tells Operia which finger matched |

## 11. Audit logging and log forwarding

| | |
|---|---|
| **Purpose** | Accountability (Art. 5(2)) and NIS2 traceability; optional forwarding to the customer's SIEM |
| **Data subjects** | Every user who acts in the system; data subjects referenced by id/employee number |
| **Personal data** | Actor user id, employee numbers, masked recipients, IP/protocol on gateway events, and — deliberately — the manager's free-text reason on `receiver_overridden` / `removed` events, which may name a person |
| **Recipients** | The customer's own log drain destination, if configured |
| **Transfers** | Wherever the customer points the drain — the customer instructs it as controller |
| **Retention** | Per-company `audit` window, platform default for platform-level rows; **both default to keep forever**. The table is UPDATE/DELETE-blocked, so the age purge is the only removal path. **Rows written before 2026-07-20 still contain names, invitee e-mails and unmasked recipients** — setting this window is the only way to remove them |

## 12. Backup and disaster recovery

| | |
|---|---|
| **Purpose** | Restore service and data after failure |
| **Personal data** | A point-in-time copy of everything in §1–§11 |
| **Recipients** | Supabase / AWS (EU) |
| **Retention** | Per the Supabase plan's backup schedule; erasure requests are honoured in the live system and reach backups by expiry, which is disclosed to controllers |
| **Procedure** | `../disaster-recovery.md` |

---

## 13. DCA Logic as controller — customer user accounts and support

| | |
|---|---|
| **Purpose** | Administer the service: create customers, invite and support their users; keep the contract and notification contacts required by the DPA |
| **Personal data** | Name, e-mail, role of customer contacts and users; support correspondence; the customer's data protection and security contacts (`companies.privacy_contact_*` / `security_contact_*`) and the signatory of the DPA (`dpa_signed_by`) |
| **Legal basis** | Legitimate interest / performance of contract |
| **Retention** | Contract term + the period needed for legal claims |

## 14. DCA Logic as controller — feedback inbox

| | |
|---|---|
| **Purpose** | Collect in-app product feedback |
| **Personal data** | Submitting user, message text, optional screenshot (may show tenant data) |
| **Recipients** | Platform admins only |
| **Retention** | Until handled; screenshots deletable, and orphaned screenshots swept daily |

## 15. DCA Logic as controller — platform administration and impersonation

| | |
|---|---|
| **Purpose** | Operate and support the platform; reproduce a customer-reported problem by signing in as a specific user |
| **Personal data** | Platform-admin identity, the impersonated user's id and **masked** e-mail, timestamps |
| **Safeguards** | Impersonation is server-verified (caller must be platform admin, target must not be), the magic-link token is redeemed inside the edge function and never reaches the browser, the user's verification/last-login state is restored afterwards, the session is visibly bannered, and the action is audit-logged fail-closed |
| **Retention** | Audit events per §11 |

## 16. Offboarding and return of data

Art. 28(3)(g) requires deletion or return at the end of the contract. Cascades and logo cleanup
exist in code, but the **verified end-to-end runbook (database, storage buckets, auth users,
log-drain configuration, backup expiry) and the "return the data first" export are not yet
written** — planned as `offboarding.md`. Until then, offboarding is a manual procedure carried
out by a platform admin and must be recorded in writing per customer.

---

## Maintenance rule

Any migration or feature that adds a personal-data field, a new recipient, or a new purpose
updates this file **in the same commit**, together with `../compliance-map.md` and, if a vendor
is involved, [subprocessors.md](subprocessors.md).
