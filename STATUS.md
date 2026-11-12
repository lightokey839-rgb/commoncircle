# CommonCircle status

## Gate schedule (builder decision, 2026-11-11): spec v4 table, UTC

Gate 1 contract freeze Wed 11 Nov 23:59 · Gate 2 Tier A proof **Thu 12 Nov
23:59** · Gate 3 pilot/user-test proof and feature freeze **Fri 13 Nov 23:59** ·
Ship Sat 14 Nov 17:59. This replaces amendment A11's Gate 2/3 times.

## Gate 2: COMPLETE (2026-11-12 ~23:20 UTC)

The builder's Meteor testnet wallet `254edye5v.testnet` did the member loop from the web app: join by invite, sign in, chat, USDC setup, ask, cancel, ask the lender, repay on time; the card turned Trusted. Every tx verified over FastNEAR (`docs/VERIFICATION.md`, "Gate 2: the builder's wallet test"). `npm run claims`: 32 rows, 0 FAIL, all three tracks PASS. The web polish P0 (branch `lane/web-polish`) was the build used for this test.

## Gate 2 progress (lead, 2026-11-11 ~22:30 UTC)

- **D-009 is deployed** (interface 1.1.1, code hash
  `J4X6efoAqFoKVYxaSNtpDYUTyKrKDzrqa2vPZxvMLxGr`, redeploy tx
  `HZMY2FpFjjAAzRJnc8we3tptUYJLH2FfVqYtWjbugUSB` at 16:51 UTC). The refund proof already reran on 1.1.1 in
  circle 3 "The Dogs (DEMO)" with `borrower3` (16:56 UTC). **F-01 is fixed on
  testnet**: every state-growing call kept at least the storage it added
  (`docs/VERIFICATION.md`, "Interface 1.1.1 on testnet").
- **README rewritten (F-02):** status box, keyless check
  (`node contracts/scripts/check-testnet.mjs`), "do X, see Y" with tx links,
  trust assumptions, pot-rotation comparison. Rows not yet proven say *not yet*.
- **Social Money DONE on testnet (2026-11-12):** DAO
  `dogs-dao.commoncircle-light.testnet` runs Sputnik by global hash
  `Ea8tHXFSQVszVwGASyzAfLq65DjcRDhkfab4FcPaRpgD`, has no keys, and is circle 3's
  admin and treasury. A member's Transfer-with-msg proposal, approved by both
  stewards, funded treasury loan 6, which was repaid on time to the DAO. A
  steward's own request was refused (E19); an approved loan for a member who had
  gone overdue was refused and refunded; the DAO cleared a late flag by vote.
  Sandbox `tests/sandbox_sputnik.rs` 2/2.
- **F-16 confirmed on real USDC:** 40 Tgas → the circle got 20.5 Tgas → `E60_LOW_GAS`, refunded.
- **Tier A evidence: `npm run claims` 25/25 PASS, all three tracks PASS.**
  Re-check online: `node contracts/scripts/build-evidence.mjs && npm run claims`.
- **Gate 2 contracts lane: complete.**
- **Gate 2 web lane (2026-11-12 ~12:00 UTC, finished by the lead):**
  - CommonCircle is the root app;
  - real MyNearWallet and Meteor connection, pinned from npm (the v10 action-format
    bug is fixed and tested);
  - F-06 DAO check;
  - treasury panel (ask, file proposal, steward approve);
  - Fund and Repay buttons;
  - F-09 notices and the "forgive" proposal;
  - 1.1.1 form rules;
  - F-04 fixed;
  - F-05 online claims in CI.

  CI run `43212325902`: all four jobs green, `npm test` 42/42, online claims 25/25.
- **Not yet done or verified:**
  - a real wallet signing from the web app (needs the builder's testnet wallet);
  - hosted demo: GitHub Pages needs the repo public (ship day);
  - NEP-413 sign-in needs `server/auth.ts` running;
  - the chat transport is local-only.

## Red team after Gate 1 (2026-11-11 ~18:45 UTC): one Critical bug found, fixed (deployed later, see above)

Report: `docs/REDTEAM_GATE1.md`. The contract on testnet (1.0.0 and 1.1.0) did
not charge the full storage deposit (F-01). The fix, plus two hardening
changes, is interface 1.1.1 (D-009): sha256 `fd7d7390…526b`, code hash
`J4X6efoAqFoKVYxaSNtpDYUTyKrKDzrqa2vPZxvMLxGr`.
Other open findings: no wallet in the web app, claims harness has no online
mode, one failing relayer test.

## Gate 1 result (contract freeze), closed by the lead 2026-11-11 ~17:00 UTC

Against the v4 Gate 1 row ("Must be true"):

| v4 Gate 1 item | Result | Where |
| --- | --- | --- |
| F0 and F1 core (gates, tiers, invites, art) in sandbox tests | MET | CI run `43042449897`: unit 49/49, sandbox 13/13, contract README rows 9/9, also on the reproducible wasm |
| Treasury-lender and vault-funding hooks in | MET | `treasury_loan_for_a_steward_or_with_fewer_than_two_stewards`, `vault_naming_the_lender_can_fund`, `docs/MSG_SCHEMA.md` |
| On testnet with the wasm hash recorded | MET | `commoncircle-light.testnet`, code hash `CCYR2EZ87by5MX65Ci1V49EVqhF93p8ymwFa6LeH9whm` (interface 1.1.0) = tested reproducible artifact |
| F0 refund proof on testnet (v4: "proven on testnet before it is claimed") | MET, twice | 1.0.0 and 1.1.0 runs, real Circle testnet USDC; hashes in `docs/VERIFICATION.md` |
| Card art renders in two wallets (v4 "By Gate 1") | MET | MyNearWallet ("The Dogs (DEMO)", 1.1.0) and Meteor (circle 1, 1.1.0), both uncropped |
| Mainnet deploy at the 50 USDC cap | NOT MET (decision) | builder budget about USD 4 vs about USD 27 needed; pilot becomes a labelled testnet user test; Real-World Money dropped |
| Relayer live | NOT MET | ops/web lane, F4 (phase 1F) not started; moves to Gate 2 |
| Pilot circle created and invites sent | NOT MET as specified | replaced by the testnet user test (Gate 3); "The Dogs (DEMO)" circle 2 exists on testnet |
| Cut F1 recovery | DONE | methods exist and always fail; `features.recovery = false` |

Contract changes after the original freeze build, inside the Gate 1 window:
D-007 (square card) and D-008 (per-circle themes), interface 1.1.0, additive.
From now on any change under `contracts/circle/src` needs a new
`SPEC_DEVIATIONS.md` entry, a full CI re-run and a new reproducible hash.

Still **NOT CLAIMABLE**: `evidence/evidence.json` has no rows yet; Tier A rows
(Open Innovation, NFTs That Do Something, Social Money) are added at Gate 2
from the testnet hashes above plus the DAO treasury loan.

Next (Gate 2, Thu 12 Nov 23:59 UTC): Sputnik DAO by global hash on testnet,
`attach_dao`, a passed proposal funding a treasury loan (contracts lane);
web sign-in, chat gate, request-to-fund flow, card, theme picker, signature
fix and relayer (ops/web lane); Tier A evidence rows and `npm run claims` green.

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
- Interface 1.1.0 (square cards, per-circle themes: D-007, D-008) is the new
  deploy artifact: run `43042449897`, sha256 `a6657716…e174`, code hash
  `CCYR2EZ87by5MX65Ci1V49EVqhF93p8ymwFa6LeH9whm`, tests green on that exact file.
  Testnet now runs 1.1.0 (redeployed in place; circle 1 intact). F0 refund proof
  passed again on 1.1.0 in the themed circle "The Dogs (DEMO)", and the card
  renders in MyNearWallet.
- The exposed testnet key of `commoncircle-light-borrower2.testnet` was rotated
  and deleted (see the incident in `docs/VERIFICATION.md`).
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

---

# History (superseded; kept for the record)

Everything below this line describes Gate 0 and the start of Gate 1, before the
Rust toolchain existed. It is **not** the current state. Every "BLOCKED" below
was cleared later on 2026-11-11 (see the sections above and
`docs/VERIFICATION.md`).

Updated: 2026-11-11 (Africa/Lagos)

## (history) Gate 0

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

## (history) Completed in this clone

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

## (history) Not verified yet

- NEAR testnet token metadata/storage bounds (the v3 IDs are now known, but RPC
  access failed in this environment).
- NEP-366 onboarding and repayment.
- Sputnik factory/DAO proposal funding flow.
- NEAR Intents delivery semantics.
- NEP-297 indexer read.
- NEP-413 phone-browser sign-in with a mobile wallet.

See `docs/VERIFICATION.md` for the evidence ledger. This file must be updated
before any README claim is promoted.

## (history) Next three Gate 1 tasks

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

## (history) Gate 1 Phase 1A stop

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
