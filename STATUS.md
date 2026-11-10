# CommonCircle status

Updated: 2026-11-10 (Africa/Lagos)

## Gate 0

Status: IN PROGRESS / NOT CLAIMABLE

The working clone is based on LoanBook commit `940099e`. The original checkout
at `C:\Users\HomePC\Documents\GitHub\Loanbook` was read-only to Git's object
database in this session, so the annotated tag and Gate 0 changes are being
prepared in this writable clone until the original repository can accept refs.

The supplied v3 document has now been read completely and committed as
`docs/COMMONCIRCLE_SPEC_v3.md`; it supersedes v2 and defines Tier A/B/C gates.
Gate 0 is late relative to its Tue 10 Nov 23:59 UTC deadline, so the v3 rule is
to run its checks alongside Gate 1 and cut from the bottom rather than extend
the gate.

## Completed in this clone

- Gate 0 instructions appended to `AGENTS.md`.
- Contract/server/web/evidence layout created.
- Circle data model and parameterized time configuration scaffolded.
- One intentionally failing placeholder test added for each README checks-table
  row; no contract behavior is implemented.
- Evidence schema and claims table stub added.
- v3 spec copied into the repository and the model expanded for written-off
  loans, registered invites, deployment modes, duration floors, and DAO policy.
- All 17 v3 README-check rows have named red placeholder tests.
- Claims harness self-test passes for matching evidence and rejects a wrong
  expected transaction hash.
- Node and Rust toolchain metadata plus clean-clone CI added.

## Not verified yet

- NEAR testnet token metadata/storage bounds (the v3 IDs are now known, but RPC
  access failed in this environment).
- NEP-366 onboarding and repayment.
- Sputnik factory/DAO proposal funding flow.
- NEAR Intents delivery semantics.
- NEP-297 indexer read.
- NEP-413 phone-browser sign-in with a mobile wallet.

See `docs/VERIFICATION.md` for the evidence ledger. This file must be updated
before any README claim is promoted.
