# Operia — incident response and breach notification

What DCA Logic does when something goes wrong with personal data or the security of the service.
This procedure discharges GDPR Art. 33(2) (processor → controller) and Art. 33(5) (documentation),
and carries the NIS2 timeline for the cases where it applies.

**Last reviewed:** 2026-08-14 · **Owner:** DCA Logic privacy owner ⟨*name to be filled in*⟩.
Referenced by [`dpa/bilag-da.md`](dpa/bilag-da.md) D.2 (the 24-hour commitment) and
[`toms.md`](toms.md) §10.

> **Read this before you need it.** Under a live incident nobody reads a document for the first
> time. The one-page version is §1 and §2; the rest is detail.

---

## 1. First 60 minutes — the short version

1. **Write down the time** you became aware, and what made you aware. That timestamp starts
   every clock in this document.
2. **Contain, don't clean.** Stop the bleeding (revoke a key, disable an account, take a
   function offline). Do **not** delete logs, rotate away evidence, or "tidy up" — see §6.
3. **Declare.** Tell the privacy owner. One person owns the incident from here (§4).
4. **Classify** (§3). If personal data may have been exposed, altered or lost, it is a
   *personal data breach* and §5's clocks are running.
5. **Open an entry** in [`breach-register.md`](breach-register.md) — even if it later turns out
   to be nothing. Art. 33(5) requires the ones you *didn't* report to be documented too.
6. **Notify affected customers within 24 hours** (§5). Do not wait for a complete picture; send
   what you know and supplement.

---

## 2. What counts as an incident

| Type | Examples in Operia |
|---|---|
| **Personal data breach** (Art. 4(12)) — accidental or unlawful destruction, loss, alteration, unauthorised disclosure of, or access to personal data | Tenant isolation failure (one customer's data visible to another), leaked service-role key, stolen handheld with an active session, HR CSV delivered to the wrong company's folder, notification sent to the wrong recipient, an employee export mailed externally, ransomware on the database |
| **Security incident, no personal data** | Denial of service, a vulnerability found in a dependency, a failed intrusion attempt, gateway compromise with nothing but public data |
| **Availability incident** | Supabase outage, expired certificate, failed deploy — becomes a *breach* if data was lost, not merely unreachable |
| **Sub-processor incident** | A vendor in [`subprocessors.md`](subprocessors.md) reports a breach affecting our data |

A **near miss** (an alert that turned out to be benign, a bug found before exploitation) is not a
breach but is worth a register line — patterns show up over time.

## 3. Severity ladder

| Level | Definition | Response |
|---|---|---|
| **S1 — Critical** | Confirmed unauthorised access to, or loss of, personal data for one or more customers. Tenant isolation failure. Credential compromise with production reach. | Immediate containment; customer notification within 24 h; privacy owner leads; post-mortem mandatory |
| **S2 — High** | Probable but unconfirmed exposure; a single data subject's data disclosed to the wrong recipient; sub-processor reports a breach touching our data | Same clocks as S1 until ruled out — you may downgrade *after* investigation, never before |
| **S3 — Medium** | Security weakness with no evidence of exposure (vulnerable dependency, misconfiguration found internally, permission too wide) | Fix on a stated deadline; register entry; notify customers only if the DPA or their contract requires it |
| **S4 — Low** | Near miss, benign alert, availability blip with no data effect | Register entry; no notification |

**When in doubt, treat it as one level higher.** Downgrading after investigation is cheap;
a late notification is not.

## 4. Roles

At current scale one person holds several of these — say so explicitly rather than pretending
there's a team.

| Role | Responsibility | Who |
|---|---|---|
| **Incident lead** | Owns the incident end to end, decides severity, decides when it is closed | Privacy owner ⟨*name*⟩ |
| **Technical lead** | Containment, forensics, fix, recovery | ⟨*name*⟩ |
| **Communications** | Customer notifications, the register, authority contact | Incident lead unless delegated |
| **Deputy** | Takes over when the lead is unavailable — a holiday must not stop the 24-hour clock | ⟨*name*⟩ |

## 5. The clocks

Three deadlines run from different starting points. Getting these confused is the classic failure.

```
   You become aware
         │
         ├──  24 h  ──▶  DCA notifies the affected CUSTOMER (contractual, DPA Bilag D.2)
         │                └── their 72 h to Datatilsynet starts HERE, from our message
         │
         ├──  24 h  ──▶  NIS2 early warning to the CSIRT      (only if in scope, §5.3)
         ├──  72 h  ──▶  NIS2 incident notification
         └──  1 md  ──▶  NIS2 final report
```

### 5.1 To the customer (always)

DCA is a **processor**. The law says "without undue delay"; the DPA promises **within 24 hours**
of becoming aware. Send to the customer's registered **security contact**
(`companies.security_contact_email`, maintained by the customer under Konfigurér →
Databeskyttelse); if none is registered, use the company's general contact *and* note in the
register that the contact was missing.

The first message does not need to be complete. It must contain what is known:

> **Subject: Security notification — Operia — [customer name] — [date]**
>
> 1. **What happened**, in plain language, and when we became aware.
> 2. **What data is involved** — categories of personal data and categories of data subjects, and
>    the approximate number if known.
> 3. **Likely consequences** for the data subjects.
> 4. **What we have done** — containment already applied.
> 5. **What we recommend you do**, including that your own 72-hour deadline towards Datatilsynet
>    runs from this message.
> 6. **Contact** for follow-up, and when the next update will come.

Supplement as facts arrive. Never wait for a complete picture to send the first message.

### 5.2 To Datatilsynet

**The controller notifies, not DCA** — the customer files, within 72 hours. DCA assists with the
technical description. DCA notifies Datatilsynet directly only for breaches of data where **DCA
itself is the controller** (§ROPA 13–15: platform-admin accounts, the feedback inbox, support
data).

### 5.3 NIS2

If DCA Logic falls in scope as a managed service provider — verify against the size thresholds
rather than assuming — a significant incident carries an early warning within 24 hours, a full
notification within 72 hours, and a final report within one month, to the national CSIRT. Many
customers *are* in scope regardless of DCA's own status, and their obligations reach DCA through
the contract. **Open item: confirm DCA's own NIS2 status and record the answer here.**

## 6. Evidence

Containment and evidence pull in opposite directions; the rule is *contain, then preserve*.

- **Do not delete audit rows.** You can't anyway — `audit_log` and `parcel_events` are
  UPDATE/DELETE-blocked. That immutability is exactly why they are the primary evidence.
- **Export the relevant window** of `audit_log` before it can age out of a retention purge, and
  attach it to the incident file.
- **Preserve** edge-function logs (short-lived — pull them early), Supabase dashboard logs,
  gateway container logs, and any customer report verbatim.
- **Rotate credentials after capturing** what the old ones did, not before.
- Record the **timeline** as you go: time, actor, action. Reconstructing it afterwards is how
  incidents get misreported.

## 7. Detection — who notices

An incident procedure with no detection duty is a document, not a capability. Current reality,
stated plainly:

| Signal | Status |
|---|---|
| `audit_log` records everything, immutably, with severity levels (`audit_level()`) | **Built** |
| Log drains stream events to a customer's SIEM | **Built** (per customer, opt-in) |
| Error-level events (spoof rejections, impersonations, mass anonymization, parcel removals, AI rejections) are visible on Operia → Logs | **Built** — but nobody is alerted |
| Supabase platform alerts | Available on the project; recipients must be confirmed |
| Customer reports | The most likely first signal today |

**The duty, until alerting exists:** the privacy owner reviews Operia → Logs filtered to
error and warning level **weekly**, and after every deploy that touches auth, RLS or storage
policies. Reviews are noted in [`breach-register.md`](breach-register.md) even when nothing is
found — an unbroken review record is itself the evidence.

**Recommended next step (not yet built):** dispatch error-level `audit_log` events to a DCA
channel (e-mail or webhook) the same way log drains already dispatch to customers — the taxonomy
and the delivery mechanism both exist, so this is a small job, not a new system.

## 8. Recovery

- Data loss → [`../disaster-recovery.md`](../disaster-recovery.md). Git is the source of truth
  for schema, functions and configuration; the gaps (secrets, storage objects, dashboard-only
  settings) are listed there and are the real recovery risk.
- After recovery, verify **tenant isolation** explicitly before reopening access — a restore is
  exactly when RLS policies get lost.
- Confirm the retention purges resumed and that nothing was resurrected that had been erased.

## 9. Post-mortem

Mandatory for S1 and S2, within **10 working days** of closure. Blameless, written, and filed
next to the register entry:

1. Timeline — detection to closure.
2. Root cause, and why existing controls didn't prevent it.
3. What was affected, and how that was established.
4. What was done, and what was communicated to whom, when.
5. Actions with owners and dates — and a line in the register when each is done.
6. Whether this changes `toms.md`, `subprocessors.md` or the compliance map.

## 10. Testing the procedure

A tabletop exercise **once a year**, and after any material change to the architecture:
pick a scenario from §2, walk it through with the clock running, and record the date and the
learnings in the register. An untested procedure is an assumption.

**Scenario suggestions:** (a) a manager reports seeing another company's parcels;
(b) the service-role key appears in a public paste; (c) Resend reports a breach affecting
delivery logs; (d) a handheld is stolen from a reception desk with an active session.

## 11. Contacts

| Who | Contact |
|---|---|
| DCA incident lead | ⟨*name, e-mail, phone*⟩ |
| DCA deputy | ⟨*name, e-mail, phone*⟩ |
| Customer security contacts | In-product per customer (`companies.security_contact_*`) |
| Datatilsynet | dt@datatilsynet.dk · +45 33 19 32 00 · breach form at datatilsynet.dk |
| National CSIRT (NIS2) | ⟨*confirm the right sector CSIRT and record it here*⟩ |
| Supabase support | Project `rjlxmdfmktucunxehtqz` — dashboard support channel |
| Sub-processor contacts | Per vendor in [`subprocessors.md`](subprocessors.md) |

## 12. Open items

- [ ] Name the privacy owner, technical lead and deputy (§4, §11).
- [ ] Confirm whether DCA Logic is itself in NIS2 scope, and which CSIRT applies (§5.3).
- [ ] Confirm who receives Supabase platform alerts (§7).
- [ ] Build error-level alerting to a DCA channel (§7).
- [ ] Run the first tabletop exercise and record it (§10).
