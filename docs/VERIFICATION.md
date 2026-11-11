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
| `ft_metadata` on both USDC IDs and `storage_balance_bounds` | BLOCKED | v3 pins mainnet `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` and testnet `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`. Read-only RPC attempts on 2026-11-10 failed with `The SSL connection could not be established` / curl could not connect, so symbol/decimals/storage bounds are not claimed. Circle's published list and SDK identify native USDC as 6 decimals: https://www.circle.com/multi-chain-usdc/near and https://docs-w3s-node-sdk.circle.com/variables/chains.NEAR_TESTNET.html |
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

## Evidence format

`evidence/evidence.json` uses the A9 schema. The document has
`schema_version: "A9"`, a `project`, a `generated_at` timestamp, and a `claims`
array. Each claim must include `id`, `track`, `feature`, `network`, `kind`
(`tx`, `view`, or `test`), `reference` (with a committed JSON `snapshot` or
`report` path), and the `expected` JSON subset. A track is not a README claim
until every row for that track passes.
