# CommonCircle status

## Gate schedule (builder decision, 2026-11-11): spec v4 table, UTC

Gate 1 contract freeze Wed 11 Nov 23:59 · Gate 2 Tier A proof **Thu 12 Nov
23:59** · Gate 3 pilot/user-test proof and feature freeze **Fri 13 Nov 23:59** ·
Ship Sat 14 Nov 17:59. This replaces amendment A11's Gate 2/3 times.

## Gate 1 — contracts (lead), updated 2026-11-11 ~09:15 UTC

Status: CONTRACT FROZEN / ON TESTNET / F0 REFUND PROOF PASSED ON TESTNET / NOT YET CLAIMED (Tier A rows go into evidence.json at Gate 2)

- Branch `lane/contracts` (integration; includes `lane/web` up to `b6449bb`),
  pushed only to the PRIVATE repo `lightokey839-rgb/commoncircle` (A10).
  Baseline tag `baseline-loanbook-port` (`940099e`) pushed first.
- CI (GitHub Actions, Ubuntu) is the Rust runner: Rust 1.99.1, near-sdk 5.30.1,
  near-workspaces 0.24.0, cargo-near 0.23.0. Local WSL is optional.
- Green in CI: unit 40/40, F0 sandbox 11/11 (refund proofs; circle holds zero
  USDC after every scenario), all 9 contract README rows, gitleaks full
  history, npm/claims, USDC metadata on both networks.
- Frozen source tree `227e4b9d` (since `913998e`). Deploy artifact: reproducible
  wasm from run `42984600861`, sha256 `2ad7e094…0e37`, code hash
  `3tF3gbHWdjhoSfMe2KDHrP7TSCEPAXNZh8dm9q97JrB8`, refund proofs passed on that
  exact file (details in `docs/VERIFICATION.md`).
- Recovery (F1) is cut for Gate 1: methods exist and always fail
  (`features.recovery = false`).

- Testnet: `commoncircle-light.testnet`, code hash `3tF3gb…JrB8` on chain
  (= tested artifact), vault pinned to `vault.commoncircle-light.testnet`,
  registered with testnet USDC, holds 0 USDC. Tx hashes in `docs/VERIFICATION.md`.

- Testnet refund proof: PASSED (`docs/VERIFICATION.md`, "F0 refund proof on
  testnet"): failed forward refunded the lender in full, then fund, repay and a
  Member → Trusted tier flip, circle USDC 0 throughout.

Builder actions needed:
1. Card art: open passport `1:commoncircle-light-borrower.testnet` in two
   explorers or wallets and say whether the image renders.
3. Mainnet deploy kit (1G) is the ops/web lane; if mainnet is not deployed by
   Thu 12 Nov 11:59 UTC, the pilot becomes a labelled testnet user test.

Pilot decision (2026-11-11): the builder's budget (about USD 4) cannot cover a
mainnet deploy (contract storage alone is about 3.6 NEAR) plus participant USDC.
The pilot is planned as a labelled TESTNET user test and the Real-World Money
row is dropped, unless mainnet funding appears before Thu 12 Nov 11:59 UTC.

Open items: card art in two wallets/explorers. Callback gas: measured in the
sandbox and on testnet, well inside budget.

Updated: 2026-11-11 (Africa/Lagos)

## Gate 0

Status: ARTIFACTS COMPLETE / BLOCKED ITEMS REMAIN / NOT CLAIMABLE

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

## Next three Gate 1 tasks

1. Resolve environment/repository blockers: writable original checkout,
   committed `Cargo.lock`, valid Node/Bun dependency installation, and a
   reachable NEAR RPC path; then run the v3 USDC metadata/storage checks.
2. Implement and sandbox-test F0 callbacks/refunds with pinned USDC, exact
   principal, named lender/vault/treasury authorization, private callbacks, and
   zero circle-token balance at rest.
3. Implement F1 core gates in the contract freeze window: registered single-use
   invites, passport mint/access checks, non-transferability, Trusted-tier
   qualification, and on-chain card-art views; record wasm hash and testnet
   evidence before moving to F2.

## Gate 1 Phase 1A stop

Status: BLOCKED — contract implementation intentionally not started.

The attached Gate 1 request requires a compiler before contract code is written.
This Windows environment has Node/npm but no Cargo, rustup, wasm32 target,
cargo-near, WSL distribution, or Docker. The pre-existing package-lock and
`scripts/test-db.mjs` are corrupt in the baseline and `origin/main`; registry
access was also unavailable for lockfile regeneration. A read-only
`scripts/verify-usdc.mjs` handoff was added, but no RPC output exists yet.

Before Phase 1B, install/use a Linux Rust runner (WSL2, Docker, or CI), generate
and commit `Cargo.lock`, repair/regenerate `package-lock.json`, and provide a
reachable testnet RPC URL in a local gitignored `.env`. Do not add contract
behavior until `cargo test --no-run` succeeds.
