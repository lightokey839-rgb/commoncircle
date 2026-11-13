> **HISTORICAL — LoanBook (Arc/EVM), October 2026.** This file describes the earlier LoanBook app this repository started from (tag `baseline-loanbook-port`). It is kept for the record and is **not** about CommonCircle on NEAR. Current documents: `README.md`, `STATUS.md`, `docs/VERIFICATION.md`, `docs/SHIP_CHECKLIST.md`, `docs/DEMO_SCRIPT.md`.

# Test results — 29 October 2026

| Check | Result | Evidence / limit |
|---|---|---|
| TypeScript | PASS | npm run typecheck, including final code |
| Lint | PASS | oxlint --type-aware for src and TypeScript scripts; .mjs tooling excluded |
| Frontend/auth unit tests | PASS: 14 | Real cryptographic signatures with mocked Supabase responses; SIWE nonce/format, identity mismatch, rejected signatures, wallet switch, expired session, exact loan terms and invites |
| Original fresh-install SQL | PASS: 58 | Disposable local PostgreSQL, original harness |
| Additive upgrade SQL / RLS | PASS: 18 | Alice owner/borrower, Bob invited lender, Charlie outsider; persistent shared chat, unauthorized reads/writes, request precision, interest deduplication, lender selection, immutable binding, trusted status transitions |
| Solidity | PASS: 31 | Foundry 1.7.1, Solidity 0.8.28; includes 256 fuzz cases in one test, lifecycle, events, unauthorized actions, missing allowance/balance, funding reentrancy |
| Production build | PASS | Vite 6.4.5; main JS about 1.74 MB / 523 KB gzip; bundle size warning remains |
| Production browser smoke | PASS, limited | Built application opened; navigation and wallet connection dialog rendered; testnet loan count loaded |
| Development server in this Windows sandbox | BLOCKED | esbuild cannot traverse a parent directory; production build and preview work |
| Live SIWE with browser extension wallet | NOT VERIFIED | Requires real wallet interaction; mocked auth tests are not live Supabase authentication |
| Live cross-device Realtime | NOT VERIFIED | Backend publication/client subscriptions implemented; no two-client hosted end-to-end test completed |
| Community → onchain → verified backend end-to-end | NOT VERIFIED | Verifier is deployed to the existing Supabase project; no real-wallet receipt lifecycle has been completed |
| Hosted frontend / mainnet demo | NOT DONE | No public deployment or mainnet transaction |

121 automated checks pass (14 + 58 + 18 + 31). The fuzz iterations are not counted as separate checks. Superseded migration-003 harness is preserved but was not rerun as part of the supported fresh-install-plus-004 path. Supabase recorded migration `20261029140324_verified_community_loans`; schema inspection confirmed 10 added verification columns, 5 Realtime tables and the Testnet deployment registry. Edge Function version 1 is active with platform JWT verification. Live integration and an independent security audit remain outstanding.

Release-candidate recheck on 29 October 2026: `npm run check` passed; `npm test -- --maxWorkers 1 --minWorkers 1` passed 14/14; `npm run test:contracts -- --use .tools/solc.exe -v` passed 31/31. The default Vitest worker configuration did not complete in the Windows sandbox and is therefore not used as evidence. The production build was started successfully but remained slow in the sandbox; the prior documented production build remains valid evidence, with the known bundle-size warning. No live Supabase, browser-wallet, hosted frontend, GitHub, or mainnet verification was performed.
