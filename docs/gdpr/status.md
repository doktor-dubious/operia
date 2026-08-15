# Operia — GDPR status

Everything outstanding, in one place. This is the tracking view of the plan in
*Operia — GDPR Status Review* (12 August 2026) §8, kept current as items land.

**Last updated:** 2026-08-14 · **Owner:** DCA Logic privacy owner ⟨*to be named*⟩.
Related: [`README.md`](README.md) (which documents exist) ·
[`toms.md`](toms.md) §12 (limitations as stated to customers) ·
[`../compliance-map.md`](../compliance-map.md) (where it lives in the code).

---

## 1. Where the project stands

The engineering is ahead of the paperwork, and the paperwork has now caught up
enough to sign a first customer — **provided the decisions in §3 are made first**.
No customer has been onboarded yet, which means no processing of real personal
data has taken place without a DPA, and nothing here is a live breach of duty.
It is a to-do list, not an incident list.

| Layer | State |
|---|---|
| Technical measures (Art. 32) | **Strong** — tenant isolation in the database, immutable audit, minimized logging, anonymization engine, per-company retention, EU hosting |
| Data subject rights | **Good** — erasure, rectification and access (Art. 15 export) are self-service; objection/opt-out is the remaining gap |
| Documentation (Art. 28/30) | **Written, unreviewed** — register, ROPA, TOMs, DPA annexes, retention schedule, incident procedure all exist; none legally reviewed, none signed |
| Third-country transfers | **Documented, partly unresolved** — bases identified per vendor; TIAs missing, vendor DPAs not filed, AI keys still on free tiers |
| Organisation | **Weakest link** — no named privacy owner, no detection alerting, no drill, no offboarding runbook |

---

## 2. The 12 work items

| # | Item | Status |
|---|---|---|
| 1 | Gemini free tier decision; DPF status of Anthropic, Google, Resend, Postmark | **Mostly done** — free tiers flagged in code + UI and documented as development-only; DPF verified from vendor primary sources. *Outstanding:* move the production AI key to a paid plan; confirm each vendor on the official DPF list; file vendor DPAs; write TIAs |
| 2 | Remove real labels from git | **Done** — `docs/labels/` untracked + gitignored 2026-08-14. *Accepted residual:* the (synthetic) images remain in git history |
| 3 | AI notice text, `ai.label_read` audit, Android cache deletion | **Done** — notice and audit already existed; handheld now deletes captures on read and sweeps at app start |
| 4 | subprocessors.md, ropa.md, toms.md + compliance map update | **Done** — plus map §12 impersonation, §13 maps, §14 privacy contacts, §15 retention, §16 SAR |
| 5 | Datatilsynet standard DPA + annexes | **Drafted** (`DCA-DPA-1.0`). *Outstanding:* legal review, DCA's own company details, the bracketed deadline numbers, English copy, and the standard clauses PDF paired with the annexes |
| 6 | incident-response.md + customer breach contacts | **Done** — procedure, breach register, and per-customer security contacts in the product. *Outstanding:* the names and the NIS2-scope answer in §12 of the procedure; alerting; first drill |
| 7 | Retention: per-company windows + settings UI | **Done** — eight categories on both levels (customer's own, and DCA's defaults under Operia → Opbevaring), enforced nightly; notification recipients cleared on close. *Outstanding:* agree actual values (everything still defaults to keep-until-further-notice), including the `audit` window that governs the legacy rows |
| 8 | SAR export | **Done** — keyed + free-text, on `/configure/personal-data`. *Outstanding:* package image files, render a readable document, raise or paginate the 500-row cap |
| 9 | Free-text scrubbing decisions per field | **Prepared 2026-08-14** — [`free-text-fields.md`](free-text-fields.md) inventories all 13 fields that need a decision (out of ~180 text columns) with a recommendation each, and two findings were fixed rather than decided: `parcel_documents` had no erasure path, and provider error strings echoed recipient addresses. *Outstanding:* the decisions themselves, then implementing whatever differs from the recommendation |
| 10 | Offboarding runbook + tenant data-return export | **Open** — cascades exist, the verified procedure and the export do not |
| 11 | MFA enrolment UI; Keystore-backed handheld session | **Open** — TOTP is enabled in configuration but no user can enrol; the handheld session token still sits in plain SharedPreferences |
| 12 | "Data & privacy" transparency screen; EU-only mode; compliance report export | **Partly** — `/configure/privacy` and `/configure/personal-data` are the seed. EU-only mode is blocked on e-mail (both providers are US). Compliance report export not started |

---

## 3. Decisions only DCA can make

These block other work and cannot be resolved from the code.

1. **Name the privacy owner**, technical lead and deputy — every document in this
   folder has a placeholder for it, and the incident procedure has no first step
   without it.
2. **DCA Logic's legal identity** — company name, CVR, address, signatory — for the
   DPA annexes and the ROPA.
3. **The paid AI plan.** Which vendor is production (recommendation: Mistral, EU,
   with a DPA and zero data retention), and when the key moves off the free tier.
   Until then no customer may point at AI label reading with real labels.
4. **Retention values** — at minimum the `audit` window, because it is the only
   mechanism that can ever remove the pre-2026-07-20 rows containing names, invitee
   e-mails and unmasked recipients. Suggested starting points are in
   [`retention-schedule.md`](retention-schedule.md).
5. **The bracketed numbers in the DPA** — SAR assistance days, data-return window,
   deletion window, inspection notice period.
6. **Free-text fields (item 9)** — 13 fields, one decision each (scrub / time-limit /
   evidence). Recommendations are in [`free-text-fields.md`](free-text-fields.md); the DPA
   currently promises "evidence" for the handover fields, so changing your mind on those
   later means changing the annex.
7. **NIS2 scope** — is DCA Logic itself in scope, and which CSIRT applies?
8. **The AWS region** of `ftp.predictioninstitute.com` / `operia.predictioninstitute.com`.
   If it is not an EU region, the sub-processor register and DPA Bilag C.5 are wrong
   and the host must move.

---

## 4. Outstanding by theme

### Legal and contractual

- [ ] Legal review of the DPA annexes before the first signature (§2 item 5)
- [ ] Vendor DPAs executed and filed: Supabase, Resend, Postmark, GatewayAPI, Mistral,
      Anthropic, Google, HeiGIT
- [ ] One Transfer Impact Assessment per US vendor → `tia/`
- [ ] Official DPF-list verification with certification IDs → `subprocessors.md` §4
- [ ] `legal-basis-note.md` (legitimate interest in the employment context) and an
      Art. 13 employee notice template customers can reuse
- [ ] `data-subject-rights.md` — how each right is executed, and what is still manual
- [ ] English courtesy copy of the annexes

### Product

- [ ] Per-employee notification opt-out — the Art. 21 objection right has no surface
- [ ] SAR export: package the image files, produce a readable document, handle >500 rows
- [ ] Tenant data-return export (Art. 28(3)(g))
- [ ] Free-text scrubbing, once item 9 is decided — the field list and recommendations are ready in [`free-text-fields.md`](free-text-fields.md)
- [ ] "Data & privacy" transparency screen for the customer (sub-processors, retention
      in force, links to the DPA) — largely assembly of what now exists
- [ ] Compliance report export (retention settings, users and roles, audit statistics,
      sub-processors) for the customer's auditor
- [ ] EU-only mode — blocked on finding an EU e-mail provider

### Security (Art. 32 / NIS2)

- [ ] MFA enrolment UI; confirm hosted MFA state in the Dashboard
- [ ] Keystore-backed session storage on the handheld
- [ ] Confirm the hosted password policy and passkey activation in the Dashboard
- [ ] Error-level audit alerting to a DCA channel (the taxonomy and the delivery
      mechanism both already exist)
- [ ] Confirm who receives Supabase platform alerts

### Organisational

- [ ] Name the privacy owner and deputies; date the reviews
- [ ] Weekly log review actually running, recorded in [`breach-register.md`](breach-register.md)
- [ ] First tabletop exercise
- [ ] `offboarding.md` — verified end-of-contract deletion and return runbook
- [ ] Quarterly review cadence for this folder and the compliance map

---

## 5. Accepted residual risks

Documented deliberately, so they read as decisions rather than oversights.

| Risk | Why it is accepted |
|---|---|
| Synthetic label images remain in git history | The images are test data, the repository is private, and a history rewrite would invalidate every clone. A real label would change this answer |
| `parcel_events` is never purged by a window | It is the chain of custody; it dies with the parcel. Erasure is met by anonymizing the person |
| Exception reasons are copied verbatim into the audit log | For an exception, the reason *is* the audit trail. Every other event type stays minimized |
| Anonymization clears `external_id` | A returning person becomes a new employee; re-identification after erasure would defeat the erasure |
| Log-drain copies are beyond erasure | Which is exactly why `audit_log` is minimized at the point of writing |
| No consent machinery | The basis is the controller's legitimate interest in the employment context; consent would be invalid there and would wrongly imply revocable custody records |
