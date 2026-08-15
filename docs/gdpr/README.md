# docs/gdpr — the formal compliance layer

Written for customers, auditors and Datatilsynet. These documents reference
[`../compliance-map.md`](../compliance-map.md) (the code-level engineering map) but never
require reading code.

| File | What it is | Status |
|---|---|---|
| [status.md](status.md) | **Start here** — everything outstanding, the 12 work items, and the decisions only DCA can make | **Living** — updated 2026-08-14 |
| [subprocessors.md](subprocessors.md) | Art. 28(2)/(4) register: every vendor, what it receives, where, transfer basis, which feature engages it. Annex B of the DPA | **Written 2026-08-14** — open items in §4 |
| [ropa.md](ropa.md) | Art. 30(2) record of processing activities. Annex A of the DPA | **Written 2026-08-14** — party details to fill in |
| [toms.md](toms.md) | Art. 32 technical and organisational measures. Annex C of the DPA | **Written 2026-08-14** |
| [dpa/](dpa/) | The data processing agreement: Datatilsynet's standard clauses as the body + our annexes A/B/C/D in [dpa/bilag-da.md](dpa/bilag-da.md) | **Drafted 2026-08-14** (`DCA-DPA-1.0`) — needs legal review, DCA's own company details, and an English courtesy copy |
| [retention-schedule.md](retention-schedule.md) | Eight categories → what they cover → who sets the window → what expiry does, plus the deliberate exclusions and suggested starting values | **Written 2026-08-14** — values still to be agreed per customer |
| [incident-response.md](incident-response.md) | Breach definition, severity ladder, roles, the three clocks, evidence, detection duty, post-mortem, drills | **Written 2026-08-14** — names and NIS2 scope to fill in (§12) |
| [breach-register.md](breach-register.md) | Art. 33(5) documentation of every breach, incl. non-notified ones; also detection reviews and drills | **Created 2026-08-14** — empty by design |
| [free-text-fields.md](free-text-fields.md) | Work item 9: the 13 free-text fields that need a scrub/time-limit/evidence decision, with recommendations, plus the two gaps fixed instead of decided | **Written 2026-08-14** — Decided column still empty |
| `data-subject-rights.md` | How each right is executed in Operia today (the Art. 15 export now exists — Konfigurér → Persondata), and what still needs a manual procedure | Planned (work item 8) |
| `tia/` | One short Transfer Impact Assessment per US vendor | Planned (work item 1) |
| `legal-basis-note.md` + notice templates | Legitimate-interest note and Art. 13 employee notice the customer can reuse | Planned |
| `offboarding.md` | Verified end-of-contract deletion/return runbook | Planned (work item 10) |

Work-item numbers refer to the plan in *Operia — GDPR Status Review* (2026-08-12), §8.

## Rules

- **Dated reviews.** Every file carries a "last reviewed" date and a named owner.
- **Same-commit discipline.** A change that adds a personal-data field, a purpose or a
  recipient updates `../compliance-map.md`, `ropa.md` and — if a vendor is involved —
  `subprocessors.md` in the same commit.
- **Cadence.** Quarterly review of the map and the register; ad-hoc on every new external
  service. Standing review question: *does this add a sub-processor or a personal-data field?*
- **Honesty over polish.** Gaps are stated, not smoothed over — these documents become
  contractual annexes.
