# CommonCircle verification ledger

Updated: 2026-11-10 (Africa/Lagos)

This ledger is evidence-first. `UNVERIFIED` and `BLOCKED` entries are not README
claims. No private keys, seed phrases, access tokens, or populated `.env` data
belong here.

## Spec and repository gates

| Check | Status | Evidence |
| --- | --- | --- |
| Read the supplied spec completely | PASS | `C:\Users\HomePC\Downloads\COMMONCIRCLE_SPEC.md`, 208 lines, read on 2026-11-10 |
| Requested v3 spec exists at `docs/COMMONCIRCLE_SPEC_v3.md` | BLOCKED | File was not present in the checkout or available Documents/Downloads search; supplied file is v2 and does not contain the requested tiered A/B/C gate timings |
| Baseline contains only disclosed LoanBook code | PASS | Pre-change `HEAD` was `940099e`; no CommonCircle/circle/vault/Rust artifacts in `git ls-tree -r HEAD` |
| Annotated baseline tag in original checkout | BLOCKED | Git rejected writing `.git/objects` in `C:\Users\HomePC\Documents\GitHub\Loanbook`; tag is pending there |
| Annotated baseline tag in writable working clone | PASS | `baseline-loanbook-port` is created at the pre-change commit in this clone |

## Testnet verification requested by Gate 0

| Check | Status | Transaction hash / command output |
| --- | --- | --- |
| `ft_metadata` on both USDC IDs and `storage_balance_bounds` | BLOCKED | Attempted read-only RPC calls on 2026-11-10 against Circle native testnet USDC `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` and the likely bridged test token `usdce.ft.ref-labs.testnet`; all four calls failed with `The SSL connection could not be established`. The supplied v2 spec does not identify the two IDs, so these are not promoted to PASS. Public references identify native USDC as 6 decimals: Circle page and Circle SDK source. |
| NEP-366 brand-new account joins and repays through a relayer | UNVERIFIED | Requires a funded testnet relayer/member workflow and a disposable account; no transaction was run |
| Sputnik factory by global contract hash and Transfer proposal | UNVERIFIED | Requires the v3 factory/hash parameters and a signing DAO account; no transaction was run |
| NEAR Intents destination delivery, exact output, refund address | PASS (docs only) | Read 2026-11-10: [Swap Types](https://docs.agentsonintents.com/integration/distribution-channels/1click-api/swap-types) documents `EXACT_OUTPUT`, `recipient`, `refundTo`, and refund of short/excess deposits; [Funding an Agent](https://docs.agentsonintents.com/integration/agent-api/funding) documents deposit-address delivery and notes that agent deposits refund to the agent balance with no selectable refund address. No live swap was run. |
| Event indexer reads a NEP-297 test event | UNVERIFIED | No test contract/indexer query was run |
| NEP-413 phone-browser sign-in with a mobile wallet | UNVERIFIED | Requires interactive phone wallet approval; no sign-in was run |

## Local Gate 0 checks

| Check | Status | Evidence |
| --- | --- | --- |
| Claims stub reads `evidence/evidence.json` | PASS | `node scripts/claims.mjs` prints the empty-claims result |
| Circle scaffold tests | BLOCKED | Rust/Cargo is not installed in the execution environment; tests are intentionally red placeholders for all 13 README rows |
| Claims stub | PASS | `node scripts/claims.mjs` output: `No claims recorded.` |
| `npm ci` clean install | FAIL | `npm ci` rejected the committed `package-lock.json` because it is not valid JSON/lockfile data; npm cache-routed lockfile regeneration was attempted but could not complete due registry/cache host restrictions |
| Existing LoanBook checks | FAIL | `npm test`/`npm run check`/`npm run test:contracts` could not run without dependencies; `npm run test:db` additionally fails because pre-existing `scripts/test-db.mjs` contains non-text bytes beginning `59 AA E7 8A 78 2D AE E9...` |

## Evidence format

`evidence/evidence.json` uses a minimal schema until the missing v3 schema is
supplied. A claim must include an `id`, `track`, `feature`, `claim`, `status`,
and an `evidence` array containing only reproducible commands, transaction
hashes, URLs, or committed artifacts. Allowed statuses are `PASS`, `FAIL`,
`UNVERIFIED`, and `BLOCKED`.
