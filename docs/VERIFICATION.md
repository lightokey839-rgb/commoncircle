# CommonCircle verification ledger

Updated: 2026-11-11 (Africa/Lagos)

This ledger is evidence-first. `UNVERIFIED` and `BLOCKED` entries are not README
claims. No private keys, seed phrases, access tokens, or populated `.env` data
belong here.

## Spec and repository gates

| Check | Status | Evidence |
| --- | --- | --- |
| Read the authoritative v3 spec completely | PASS | `C:\Users\HomePC\Downloads\CommonCircle on NEAR Feature Spec (v3).md`, 322 lines, read on 2026-11-10; committed as `docs/COMMONCIRCLE_SPEC_v3.md` |
| v3 supersedes v2 | PASS | v3 line 3 explicitly supersedes v2; v3 is now the repository authority |
| Official hackathon rules page | PASS (rules read, no submission claim) | Read 2026-11-10: https://nearhackathon.com/ states build window 1 Nov 2026 00:00 UTC to 14 Nov 2026 23:59 UTC, public repository and public X demo are required, multi-track submission is allowed, and the prior criteria are technical implementation, design, impact, originality and sustainability |
| Tiered A/B/C gate timing | PASS (schedule recorded) | v3: Gate 0 Tue 10 Nov 23:59 UTC; Gate 1 Wed 11 Nov 23:59; Gate 2 Thu 12 Nov 23:59; Gate 3 Fri 13 Nov 23:59; Ship Sat 14 Nov 17:59 UTC |
| Baseline contains only disclosed LoanBook code | PASS | Pre-change `HEAD` was `940099e`; no CommonCircle/circle/vault/Rust artifacts in `git ls-tree -r HEAD` |
| Annotated baseline tag in original checkout | BLOCKED | Git rejected writing `.git/objects` in `C:\Users\HomePC\Documents\GitHub\Loanbook`; tag is pending there |
| Annotated baseline tag in writable working clone | PASS | `baseline-loanbook-port` is created at the pre-change commit in this clone |
| Secret material scan | PASS | `git ls-files` includes `.env.example` but no `.env`; scan for PEM private-key material returned 0 hits |
| Toolchain pins and lockfiles | BLOCKED | `.nvmrc`, `.bun-version`, `rust-toolchain.toml`, and `bun.lock` are present; no `Cargo.lock` exists because Cargo is unavailable. `package-lock.json` is now valid npm v3 data, but a clean install could not complete in this sandbox. |

## Testnet verification requested by Gate 0

| Check | Status | Transaction hash / command output |
| --- | --- | --- |
| `ft_metadata` on both USDC IDs and `storage_balance_bounds` | PASS (read-only RPC, see "USDC verification output" below) | Mainnet `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` and testnet `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` both return symbol `USDC`, name `USDC`, 6 decimals, storage bounds min = max = 1250000000000000000000 yoctoNEAR (0.00125 NEAR). The comparison against Circle's published list is still a manual step before any immutable init. |
| NEP-366 brand-new account joins and repays through a relayer | UNVERIFIED | Requires a funded testnet relayer/member workflow and a disposable account; no transaction was run |
| Sputnik factory by global contract hash and Transfer proposal | UNVERIFIED | v3 identifies the 6 NEAR standard-factory path and `sputnikv2.testnet` fallback but does not pin a global contract hash. No DAO account, proposal, gas measurement or transaction was run |
| NEAR Intents destination delivery, exact output, refund address | PASS (docs only) | Read 2026-11-10: https://docs.agentsonintents.com/integration/distribution-channels/1click-api/swap-types documents destination `recipient`, `EXACT_OUTPUT`, `refundTo`, and refund of short/excess deposits; https://docs.agentsonintents.com/integration/agent-api/funding documents deposit-address delivery and notes that the agent-deposit API refunds to the agent balance with no selectable refund address. No live swap was run |
| Event indexer reads a NEP-297 test event | UNVERIFIED | No test contract/indexer query was run |
| NEP-413 phone-browser sign-in with a mobile wallet | UNVERIFIED | Requires interactive phone wallet approval; no sign-in was run |

## Local Gate 0 checks

| Check | Status | Evidence |
| --- | --- | --- |
| Claims harness reads A9 `evidence/evidence.json` | PASS | `node scripts/claims.mjs` prints a Markdown table, writes `EVIDENCE.md`, and updates the README marker table with no verified tracks; unsupported schema versions fail closed |
| Claims harness wrong-hash behavior | PASS | `npm run claims:test` accepted a matching snapshot and rejected a deliberately wrong expected transaction hash |
| Circle scaffold tests | BLOCKED | Rust/Cargo is not installed in the execution environment; tests are intentionally red placeholders for all 17 v3 README rows |
| `npm ci` clean install | BLOCKED | The invalid binary lock was replaced with a valid npm v3 lock whose root dependencies match `package.json`. `npm ci --ignore-scripts --offline` still cannot complete because the sandbox cache lacks `zustand-5.0.3.tgz`; registry-routed install hangs/fails on restricted cache access. |
| Existing LoanBook checks | BLOCKED | `npm test` cannot run because the incomplete local install has no `vitest` binary; the malformed `scripts/test-db.mjs` baseline file was removed as requested. |

## Gate 1 Phase 1A — toolchain and verification handoff

| Check | Status | Evidence |
| --- | --- | --- |
| Cargo, rustc, rustup, cargo-near available on Windows | BLOCKED | `Get-Command cargo,rustc,rustup,cargo-near` returned no matches on 2026-11-11; WSL is not installed. The existing Ubuntu CI job is the test runner until a Linux toolchain is available. |
| wasm32 target and cargo-near checked | BLOCKED | No local `rustup` or `cargo-near` command exists; no target query could run. |
| Near SDK pin | PASS (manifest only) | `contracts/circle/Cargo.toml` pins `near-sdk = 5.17.2`; compilation has not run locally. |
| Cargo.lock committed | BLOCKED | Cannot generate a trustworthy lockfile without Cargo; CI must generate/verify it in a Linux runner before contract code is pushed. |
| package-lock baseline comparison | PASS (baseline corruption confirmed) | `git ls-tree 940099e` and `git ls-tree origin/main` both point to blob `9f6cce0fc5c0aee2455048ed490a38ba46ec120a`; the baseline JSON parse fails with `Unexpected token 'Y'`. The lane has replaced it with valid npm v3 lock data. |
| test-db baseline comparison | PASS (baseline corruption confirmed) | `git ls-tree 940099e` and `git ls-tree origin/main` both point to blob `b6dda0986fbb4aae61f8b8e0a674f2b715a9a40d`; the file begins with non-text bytes and no alternate copy exists in Git. |
| npm lockfile regeneration | PASS (lock data) / BLOCKED (install) | The lockfile now parses as npm v3 and matches the package dependency sets. A registry-backed clean install remains blocked by the sandbox npm cache/network restrictions. |
| read-only USDC verification script | PASS (fail-closed behavior) | `node --check scripts/verify-usdc.mjs` passed. `npm run verify:usdc` with no RPC variables failed closed for both pinned IDs with `missing RPC URL for this network`; no metadata claim is made. |
| baseline tag target | PASS | `git rev-parse baseline-loanbook-port^{}` resolves to `940099e49466accf9110769056b0e50891e5f096` in this writable clone. |

## Gate 1 ops/web lane handoff

| Check | Status | Evidence |
| --- | --- | --- |
| Frozen circle interface available | PASS (handoff) | Contracts-lane `docs/CIRCLE_INTERFACE.md` 1.0.0 is frozen and was read from the sibling lane checkout; this web lane does not modify or duplicate that contracts-owned file. The source says the contract is not compiled or tested yet. |
| NEP-413 server scaffold | PASS (static) | `server/nep413.ts` implements the NEP-413 Borsh prefix/payload hash, Ed25519 verification, and a full-access-key RPC check; `server/auth.ts` consumes each nonce before awaiting verification. No mobile wallet sign-in was run. |
| Typed interface client and member screens | PASS (static) | `web/circle-client.ts`, `web/nep413.ts`, `web/app.ts`, `web/index.html`, and `web/styles.css` provide read-first views, invite joining, and my-positions UI. Contract calls remain unverified. |
| Web/server TypeScript typecheck | PASS (static) | TypeScript compiler completed with no errors for the new `web/*.ts` and `server/*.ts` files; it used the existing sibling checkout's compiler because this checkout's clean npm install is blocked. |
| Contract files untouched by lane/web | PASS | `git diff -- contracts` is empty after the lane changes. |
| Gate 1 Ubuntu CI workflow | PASS (definition) | `.github/workflows/commoncircle-gate1.yml` runs Rust build/test, requires a near-workspaces sandbox, runs npm tests/claims/USDC verification, scans full history with gitleaks, and uploads logs. It has not run in this sandbox. |
| Read-only testnet demo RPC | PASS (live view) | `https://test.rpc.fastnear.com` → `commoncircle-light.testnet`: `get_config` returned interface `1.0.0`, pinned testnet USDC, `vault.commoncircle-light.testnet`, `min_ft_on_transfer: "70"`, and `features.recovery: false`; `get_circle("1")` returned `null` on 2026-11-11. No transaction was sent. |

### Required push handoff

From the writable clone, after reviewing the commits and once the original
checkout is writable, push the tag before any Gate 1 branch commits:

```powershell
git push origin baseline-loanbook-port
git push origin codex/loanbook-release-candidate
```

The current `origin` is a local path to the LoanBook checkout, not a public
remote. Do not run these commands until the intended public remote is configured
and the original checkout accepts Git writes.

## USDC verification output (2026-11-11, contracts lane)

Method: JSON-RPC `query` / `call_function`, `finality: final`, `args_base64: e30=`
(`{}`), sent from the in-app browser of the contracts-lane session to the
amendment A6 FastNEAR endpoints. No keys or accounts were used. The `icon`
data URI is truncated here.

| Network | RPC | Method | Block height | Block hash | Result |
| --- | --- | --- | --- | --- | --- |
| mainnet | https://free.rpc.fastnear.com | `ft_metadata` | 223996062 | `85k4CViTdAZXgq4Pj88RtN7pX3z5BaPyY3DpMEqj5qaD` | `{"spec":"ft-1.0.0","name":"USDC","symbol":"USDC","icon":"data:image/svg+xml,...","reference":null,"reference_hash":null,"decimals":6}` |
| mainnet | https://free.rpc.fastnear.com | `storage_balance_bounds` | 223996063 | `GY6ZLM9pNkPZmSkGQisqXVKLEJnWbMJFMarAMqDAM2w6` | `{"min":"1250000000000000000000","max":"1250000000000000000000"}` |
| testnet | https://test.rpc.fastnear.com | `ft_metadata` | 277145790 | `72CD1XC16fLWGHm9oaKXpHWkVd6Wzp9fQvm42SSfGQ39` | `{"spec":"ft-1.0.0","name":"USDC","symbol":"USDC","icon":"data:image/svg+xml,...","reference":null,"reference_hash":null,"decimals":6}` |
| testnet | https://test.rpc.fastnear.com | `storage_balance_bounds` | 277145791 | `CXeM3eZ36JmnQom2v7SQMNgaFBAm4jzn92pNMJZxhNMU` | `{"min":"1250000000000000000000","max":"1250000000000000000000"}` |

Anyone can re-run this with `npm run verify:usdc` from the repository root after
setting `NEAR_MAINNET_RPC_URL` and `NEAR_TESTNET_RPC_URL` to the URLs above.
Per A5, mainnet init pins the Circle ID only with this output present; it is
now present.

## Toolchain pins (contracts lane, 2026-11-11)

| Item | Pin | Evidence |
| --- | --- | --- |
| Rust | 1.99.1 (`rust-toolchain.toml`) | GitHub releases API for rust-lang/rust, latest tag 1.99.1 (2026-10-16) |
| near-sdk / near-contract-standards | =5.30.1 | crates.io API: latest non-prerelease, rust_version 1.95 |
| near-workspaces | =0.24.0 | crates.io API: latest, rust_version 1.95 |
| cargo-near | 0.23.0 | crates.io API: latest, rust_version 1.95 |

The Gate 0 pin of Rust 1.86 / near-sdk 5.17.2 is replaced: current near-sdk,
near-workspaces and cargo-near all require Rust >= 1.95. Nothing has compiled
yet; `Cargo.lock` will be committed from the first successful build.

## Gate 1 phase 1B — F0 core loop (contracts lane)

Runner: GitHub Actions `ubuntu-latest`, private repo
`lightokey839-rgb/commoncircle`, workflow `CommonCircle Gate 1`, job
"Rust build, unit tests, and near-workspaces sandbox".
Run `42979826071` on commit `579575d` (branch `lane/contracts`), 2026-11-11.
Toolchain: Rust 1.99.1, near-sdk 5.30.1, near-workspaces 0.24.0, cargo-near
0.23.0 (prebuilt release). Re-run: `contracts/scripts/test.sh` on Linux/WSL.

| Check | Status | Evidence |
| --- | --- | --- |
| Circle + mock-ft wasm build | PASS | `cargo near build non-reproducible-wasm --no-abi`; cargo-near: "near-sdk targets protocol version 85; rustc 1.99.1 accepted". sha256 `commoncircle_circle.wasm` = `d456c906661ba8d7302cd84827b0ee26feade8861e3a190e42d13b98281087af` (357775 bytes), `commoncircle_mock_ft.wasm` = `9cf8241a111fa701ec2368b2dd28112b69a0bdbdaa371161a04bd0ba2dc60148`. Non-reproducible build: NOT the freeze hash. |
| Unit tests (`cargo test --workspace --lib`) | PASS 40/40 | Includes `gas_at_minimum_is_accepted` / `low_gas_fails_early` (boundary at `MIN_GAS_FT_ON_TRANSFER` = 70 Tgas), `failed_forward_reverts_to_open_and_returns_everything`, `failed_repay_forward_returns_everything_and_stays_funded`, `double_fund_while_in_flight_is_refunded`. Earlier run `42975019261` failed 39/40 at 55 Tgas (GasExceeded); fixed in `579575d`. |
| Sandbox starts | PASS 1/1 | `sandbox_starts_and_creates_an_account` |
| F0 sandbox scenarios, circle USDC balance asserted zero after each | PASS 10/10 | `tests/sandbox_f0.rs`: `f0_fund_then_full_repay_on_time`, `f0_partial_repay_then_overpay_returns_excess`, `f0_wrong_amount_is_refunded`, `f0_lapsed_window_cancels_and_refunds`, `f0_double_fund_is_refunded` (concurrent lender + vault race: exactly one funds), `f0_low_gas_fails_early_and_is_refunded` (60 Tgas attached), `f0_revoked_passport_mid_loan_stays_payable`, `f0_non_member_borrower_is_rejected`, `a3_repay_forward_fails_when_lender_unregistered`, `a3_repay_with_wrong_token_wrong_state_or_wrong_caller_is_refunded` (also: private callback rejects outside callers) |
| README check rows (F0) | PASS 4/4 | `create_a_loan_naming_a_non_member`, `fund_a_loan_from_an_account_that_is_not_the_named_lender`, `send_a_different_token_to_the_contract`, `fund_to_an_unregistered_borrower` |
| README check rows (later gates) | RED as expected | 13 rows still `todo!` in that run |
| Full-history secret scan | PASS | gitleaks job green on runs `42972697704` and `42979826071` (pattern scan; manual review in this session found only variable names and instructions) |
| Gate 1 stop rule (F0 refund proofs) | CLEARED in sandbox | Testnet refund proof is still required before the Open Innovation row is claimed (v3 F0: "Proven on testnet before it is claimed") |

### Gate 1 phases 1C and 1D (run `42980986379`, commit `14b3b46`)

| Check | Status | Evidence |
| --- | --- | --- |
| Unit tests | PASS 40/40 | same suite as above |
| F0 sandbox + storage refund | PASS 11/11 | adds `storage_deposit_excess_is_refunded` (1 NEAR attached to `create_circle`, < 0.05 NEAR kept) |
| README rows, contract side | PASS 9/9 | adds `repay_n_qualifying_loans_on_time` (pilot N=1: tier flips to Trusted, `tier_changed` event, card media changes), `let_a_loan_pass_its_due_date` (overdue, perks paused, card shows "PERKS PAUSED", late repayment restores perks, late count stays), `try_nft_transfer_on_a_passport` (`nft_transfer`, `nft_transfer_call`, `nft_approve` fail with E40; owner unchanged), `redeem_an_invite_twice_or_with_the_wrong_account_for_a_named_invite` (E32 then E30; open invite replay E30), `treasury_loan_for_a_steward_or_with_fewer_than_two_stewards` (1 steward E19, steward borrower E19, other passportless lender E11, 2 stewards + Trusted non-steward: DAO-stand-in account funds, `funded_via: Treasury`; founder loses admin after `attach_dao`) |
| README rows, other lanes / later gates | RED (8) | relayer, NEP-366 join, chat gate (server), DAO proposal (Gate 2, real Sputnik), agent draft, vault `execute_repay`, access-key list, claims wrong-hash (covered by `npm run claims:test`, not cargo) |
| Card art samples | PASS (generated) | `docs/card-art/token_uri_member.txt` and `token_uri_trusted.txt` (exact `nft_token().metadata.media` from the sandbox run), decoded as `passport_member.svg` / `passport_trusted.svg`. Rendering in two wallets or explorers is NOT verified yet (needs a testnet deploy). |
| `contracts/Cargo.lock` | PASS | taken from the CI artifact of this run (near-sdk 5.30.1) |
| Non-reproducible circle wasm sha256 | recorded | `e47d84e1bf86c96666745741c3e2ba1c2ce4afbb70bfad89194ca4bce01e273e` (changed from the 1B run because of `.detach()`). Freeze hash comes from the reproducible build. |

### Gate 1 phase 1E — freeze build (run `42983781151`, commit `913998e`)

| Check | Status | Evidence |
| --- | --- | --- |
| Reproducible circle wasm (Docker) | PASS | `cargo near build reproducible-wasm`, image `sourcescan/cargo-near:0.23.0-rust-1.99.1@sha256:8013f039e8005627f10ae66b5519d1a6eeeed7d7aef4b5067d5e9a86c4302fcc`, git clean at HEAD `913998e`. sha256 `6f1f054ab5e20317a6875a34748d3de3b6177434d86b885a4fc2f70042e4a858` (362127 bytes); NEAR code hash (base58 of sha256) `8Umgymq4CW3h9HWYehaCh1LKvFk3254FRjDAFBetm7Sf`. Artifact `commoncircle-reproducible-wasm`. |
| Same commit: unit, F0 sandbox, contract README rows | PASS | all jobs green on run `42983781151` (tests built from the same source with the non-reproducible build) |
| F0 sandbox against the reproducible wasm itself | PASS (run `42984600861`) | see "Deploy artifact" below |
| Testnet deploy, code hash on chain = `8Umgymq4...` | NOT RUN | no testnet account on this machine; `contracts/scripts/deploy-testnet.sh` is ready for the builder to run |
| evidence.json rows | none added | Gate 1: no track claims; Tier A rows are added in Gate 2 from testnet hashes |

### Deploy artifact (run `42984600861`, commit `0c4b4f4`)

cargo-near embeds the git commit in the wasm (NEP-330 build info), so every
commit gives a new reproducible hash even when the contract is unchanged. The
freeze is therefore identified by the **contract source tree**, and the deploy
artifact is the reproducible wasm that the same CI job built **and** tested.

| Check | Status | Evidence |
| --- | --- | --- |
| Contract source unchanged since `913998e` | PASS | `git rev-parse <commit>:contracts/circle/src` = `227e4b9dc155fc7a93dffc7df4f9e90e0e538d55` at both `913998e` and `0c4b4f4`; `git diff --stat` over `contracts/circle`, `contracts/Cargo.*`, `rust-toolchain.toml` is empty |
| Reproducible wasm (deploy artifact) | PASS | sha256 `2ad7e0945070654fa46a88277527efcbd299632b47adebe05935f62d5aee0e37`; code hash `3tF3gbHWdjhoSfMe2KDHrP7TSCEPAXNZh8dm9q97JrB8`; artifact `commoncircle-reproducible-wasm` of run `42984600861` |
| F0 sandbox on that exact wasm | PASS 11/11 | `reproducible-sandbox-f0.log` in the same artifact |
| Contract README rows on that exact wasm | PASS 9/9 (8 later-gate rows red) | `reproducible-readme-checks.log` |

Testnet and mainnet deploy this file (sha256 `2ad7e094…0e37`). The on-chain code
hash must equal `3tF3gbHWdjhoSfMe2KDHrP7TSCEPAXNZh8dm9q97JrB8`. The `913998e`
hash recorded above is superseded as the deploy artifact (same source).

### Gate 1 phase 1E — testnet deploy (2026-11-11, run by the builder)

Command: `contracts/scripts/deploy-testnet.sh` with
`CIRCLE_ACCOUNT_ID=commoncircle-light.testnet`, the deploy artifact above,
`EXPECTED_SHA256=2ad7e094…0e37`, `EXPECTED_CODE_HASH=3tF3gb…JrB8`. Script output
ended `VERIFY OK`. Each row was re-checked independently by the contracts lane
over FastNEAR testnet RPC (`tx` with `wait_until: FINAL`, `view_account`,
`view_access_key_list`).

| Step | Status | Transaction / view |
| --- | --- | --- |
| Create `commoncircle-light.testnet` (faucet) | PASS, SuccessValue | `7AdiA1LQfgiWe3nrdYDvCRrvtBKeZrZkV1bxfVwWTNb2` (block `ATdWfFau96M3WRJT222ujSsXmkXK9BEAuaCy4Ad8jc7X`) |
| Create and reserve vault `vault.commoncircle-light.testnet` (0.1 NEAR) | PASS, SuccessValue | `3v854pjEVxukAs6mHxntooqSnf8zfdQmiXZGhqpCRySm` (block `ENEwkbvonuiVUEMbgSsQwUTssexX7diPMye9yhZxAdrT`) |
| Deploy code `3tF3gb…JrB8` + `new` (testnet floors 0, cap 50 USDC, pinned USDC and vault) | PASS, SuccessValue | `9mj8gUg4GHTETjR8b6Wuoe3BffbDJK41rkAmT9bT8dQJ` (block `C8DWJU4EFuka7dFUnn8HeDRa8vDfnTDhWcuvsZZJM2DK`), 28.3 Tgas |
| Register circle with testnet USDC (0.00125 NEAR) | PASS, SuccessValue | `7hArgw6tYgp9fhzfd4dDGJhcqD9MrdB8QGsarP97tAcY` (block `BBxc5SjBjtuXaCN8iSKQmGjrf4mVmdBBQpRNjPTSTR9g`) |
| On-chain code hash = tested artifact | PASS | `view_account` at block 277213578: `code_hash 3tF3gbHWdjhoSfMe2KDHrP7TSCEPAXNZh8dm9q97JrB8`, storage_usage 362583 |
| `get_config` matches init | PASS | interface 1.0.0, usdc `3e2210e1…b8af`, vault `vault.commoncircle-light.testnet`, cap `50000000`, floors 0, min gas 70, recommended 150, recovery false |
| Circle USDC balance at rest | PASS | `ft_balance_of(commoncircle-light.testnet)` = `"0"` |
| Access keys on the contract account | 1 FullAccess key (expected on testnet) | Key deletion is a mainnet / Gate 4 step, not done here |

Still to do on testnet: a real fund → repay loan and a failed-forward refund
proof with transaction hashes (v3 F0: "Proven on testnet before it is
claimed"), and the card art viewed in two wallets or explorers.

### Callback gas (run on commit `1a0c3c4`, test-only change)

`gas_measurements_fit_reserved_budgets` (sandbox) PASS; artifact
`gas_measurements.json`. Gas burnt by each receipt:

| Receipt | Gas burnt | Budget |
| --- | --- | --- |
| `ft_on_transfer` (fund) | 2.86 Tgas (2857640338538) | 30 Tgas own |
| `ft_on_transfer` (repay) | 2.69 Tgas (2692011778277) | 30 Tgas own |
| `on_fund_forwarded` success | 1.97 Tgas (1974356193295) | 25 Tgas reserved |
| `on_fund_forwarded` failed forward | 1.87 Tgas (1871991141513) | 25 Tgas reserved |
| `on_repay_forwarded` partial | 1.90 Tgas (1901690797942) | 25 Tgas reserved |
| `on_repay_forwarded` full, with tier flip | 2.48 Tgas (2477151790457) | 25 Tgas reserved |

Sandbox suite on that run: unit 40/40, F0 sandbox 12/12, contract README rows
9/9. Gas is from the sandbox runtime; the testnet proof run will add on-chain
figures.

## Gate 1 — F0 refund proof on testnet (2026-11-11, run by the builder)

Command: `contracts/scripts/testnet-proof.sh setup` then `run`, contract
`commoncircle-light.testnet` (code hash `3tF3gb…JrB8`), real Circle testnet USDC
from faucet.circle.com (20 USDC to the lender). Output ended `PROOF OK`. The
contracts lane re-checked every transaction over FastNEAR (`tx`,
`wait_until: FINAL`): all `SuccessValue`.

| Step | Transaction | Result |
| --- | --- | --- |
| Create lender / borrower accounts (faucet) | `76XbRwp3SRHWt4aMQTMrW1Afowg5MyW5FnD8fzBZ9spb`, `JChKK37VozGgdawJ6EtiSk9BUuJ6UVLrqFCs9QP933Z2` | SuccessValue |
| Register lender with USDC (borrower left unregistered) | `rPqNXf4HMVN2YgTTayys6ZaezQRMdjwSGtbKALV6caf` | SuccessValue |
| Lender creates DEMO circle 1 (60 s days, N=1) | `6PwNu7dfT4ZujncoiTzZseGhSTjhageK9XJaDEAb3eU3` | `circle_created`, founder passport minted |
| Named invite registered / redeemed by the borrower | `GkWBK471ew1gQGXTNRHyYvJzWBTteUsPpcWhAhCD5kuu` / `9qq8KVMmwLU8eHqVpgHje1EuHFxvwwWuM58jJagm8qi` | `invite_registered`, `nft_mint`, `invite_redeemed` (ed25519 signature verified on chain) |
| Borrower creates loan 1 (1 USDC, 1 day) | `2ihs24UettsERCFG2nBZqqZwnu6iAkp3rMg54kAXN5Eb` | `loan_created` |
| **Refund proof:** fund while borrower is unregistered | `gxciUUtWipGGiwa1pHyxLKM5Ynj9Cg1AFbpqwKoJT7g` | inner `ft_transfer` to borrower failed (receipt failure in the USDC contract), `loan_funding_failed`, nep141 `ft_transfer` circle → lender 1000000 memo `refund`. Lender 20000000 before and after; circle USDC 0; loan Open |
| Borrower registers with USDC | `2RpSNHBMbAXxpN1cjskeNeiRtRFGD9KzRm7EAeQfYUfd` | SuccessValue |
| Lender funds | `DRrESKc8apQbETKAyb7SirGGSdthR4q5Ej7bTvvY7sTP` | `loan_funded`, borrower +1000000, circle USDC 0 |
| Borrower repays in full | `GPaN26CgZqDGSQqTF2TnmYyGmEmdR3qGMsYmSbw548Nn` | `loan_repaid` on_time true, qualifying true; `tier_changed` Member → Trusted |
| Views after | `get_loan(1)`: Repaid, on time; `passport_for`: Trusted, on_time_count 1; circle USDC 0; lender 20000000 | PASS |

On-chain gas (testnet receipts): `ft_on_transfer` 2.90 Tgas (fund), 2.74 Tgas
(repay); `on_fund_forwarded` 2.02 Tgas (ok), 1.92 Tgas (failed forward);
`on_repay_forwarded` with tier flip 2.53 Tgas. All far inside the 25 Tgas
callback reserve and 30 Tgas own budget.

Card art on chain: `nft_token("1:commoncircle-light-borrower.testnet")` at
block 277222326 saved as `docs/card-art/testnet_token_trusted.json` (media is
the on-chain SVG data URI; decoded `testnet_passport_trusted.svg`). Rendering (checked by the builder, 2026-11-11, screenshots in chat):

| Viewer | Result |
| --- | --- |
| Meteor Wallet (web, testnet), `wallet.meteorwallet.app/wallet/nfts/collection/commoncircle-light.testnet/token/1:commoncircle-light-borrower.testnet` | PASS with a defect: the on-chain SVG renders (green card, two gold rings, TRUSTED, description "Tier: Trusted. Status: active."), but Meteor crops it to a square, cutting the left and right edges of the 400x300 card ("MONCIRCLE #1", "TIME 1 / LATE 0", "ACT") |
| MyNearWallet (testnet, "limited mode" since 1 Nov) | FAIL: Collectibles tab empty for the borrower account, although Kitwallet `likelyNFTs` lists `commoncircle-light.testnet` and `nft_tokens_for_owner` returns the token. Wallet-side |
| NearBlocks testnet token page | not yet checked (bot check blocks the automated browser) |

## Evidence format

`evidence/evidence.json` uses the A9 schema. The document has
`schema_version: "A9"`, a `project`, a `generated_at` timestamp, and a `claims`
array. Each claim must include `id`, `track`, `feature`, `network`, `kind`
(`tx`, `view`, or `test`), `reference` (with a committed JSON `snapshot` or
`report` path), and the `expected` JSON subset. A track is not a README claim
until every row for that track passes.
