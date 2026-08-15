# Operia — retention schedule

Data category → where it lives → who sets the window → what happens when it expires.
This is Annex C.4 of the data processing agreement and the reference behind
**Konfigurér → Persondata → Opbevaring**.

**Last reviewed:** 2026-08-14 · **Owner:** DCA Logic privacy owner.
Mechanism: `20260814140000_retention_per_company.sql` (`run_retention_purge()`, daily 03:40 UTC)
and the `parcel-files-cleanup` edge function.

## How a window is resolved

```
customer's own value  (company_retention.<category>_days)
        ↓ if empty
platform default      (platform_settings.<category>_retention_days)
        ↓ if empty
kept until further notice
```

The customer is the controller, so the customer's value always wins. Both empty means nothing is
deleted — the default state, so activating retention is always a deliberate act.

Where each level is set: the customer's own under **Konfigurér → Persondata → Opbevaring**,
DCA's defaults under **Operia → Opbevaring**. A change to a platform default reaches every
customer who has not set that category themselves, at the next nightly run. Shortening a
window deletes everything already older on the next nightly run, and deletion is irreversible.

Every purge writes `retention.purged` (or `retention.anonymized`) to the audit log with the table,
the row count and the window used. Every change to a window writes `retention.company_changed`
with the before/after values.

## The eight categories

| Category | Covers | Expiry action | Notes |
|---|---|---|---|
| **parcels** | `parcels` + their `parcel_events` | Delete | **Only closed parcels** (delivered / rejected / returned / removed), measured from `delivered_at`, `removed_at` or last change. An open or disputed parcel is never deleted by a window. Deleting a parcel takes its event history with it — that is the *only* way events leave the system |
| **parcel_files** | Condition photos, handover signatures, parcel documents in the private buckets | Delete the object | Same "closed parcels only" rule. Orphaned files (parcel or company gone) are removed regardless of window |
| **notifications** | `parcel_notifications`, `asset_loan_notifications` | Delete | The recipient address is cleared much earlier — the moment the parcel closes or the asset is returned — so an expired window removes only the remaining metadata (channel, status, timestamp) |
| **audit** | `audit_log` rows for the company | Delete | The table is UPDATE/DELETE-blocked for everyone; the age purge is the only way rows can ever leave. This is therefore the only lever against the pre-2026-07-20 rows that still contain names and unmasked recipients. Platform-level rows (`company_id is null`) follow the platform window only |
| **imports** | `import_runs`, `inbound_files` | Delete | The CSV itself is deleted right after a successful import, and the whole `imports` bucket is purged after 30 days regardless |
| **asset_loans** | Returned asset loans | Delete | Borrower name, address, e-mail and phone are already cleared on return; the window removes the remaining history. Active loans are untouched |
| **employees** | Inactive employees | **Anonymize, never delete** | The row must survive — parcel history references it. Only employees with no open parcels; already-anonymized rows are skipped. Measured from `retired_at`, else last change |
| **routes** | Saved route plans (addresses + coordinates) | Delete | |

## Deliberately without a window

| What | Why |
|---|---|
| `parcel_events` on its own | It is the chain of custody. Its lifetime follows the parcel, and an erasure request is met by **anonymizing the person** the event references, not by rewriting history |
| Companies, locations, handling classes, carriers | Configuration, not personal data |
| The feedback inbox | DCA is controller there; screenshots are deleted with the feedback row and orphans swept daily |
| Backups | Expire with the platform's backup cycle. A deletion in the live system reaches backup when that backup expires — disclosed to controllers in DPA Bilag C.4 |
| Copies already sent to a customer's log drain | Outside DCA's reach by design, which is why `audit_log` is minimized at the point of writing |

## Suggested starting values

Not recommendations of law — the controller decides. These are defensible starting points for an
internal parcel operation, to be adjusted to the customer's own documentation needs:

| Category | Suggestion | Reasoning |
|---|---|---|
| parcels | 12–24 months | Long enough to settle a dispute about a delivery; well short of "forever" |
| parcel_files | 6–12 months | Photos and signatures are the heaviest personal data; they age out faster than the parcel record |
| notifications | 6–12 months | Operational troubleshooting only, and the address is already gone |
| audit | 12–24 months | NIS2 traceability vs. minimization. **Note:** a window here is what finally removes the legacy rows containing names |
| imports | 6–12 months | Import evidence for HR reconciliation |
| asset_loans | 12–24 months | Matches the parcel record |
| employees | 6–12 months after deactivation | The retirement sweep already anonymizes automatically once the last parcel closes; this catches employees who never had one |
| routes | 6–12 months | Planning data, rarely needed once driven |

## Open items

- [ ] Decide and set platform defaults (currently all empty = keep forever).
- [ ] Decide `audit` specifically — it is the only route to the legacy rows with names.
- [ ] Add the agreed values per customer as part of onboarding, and record them in the DPA annex.
