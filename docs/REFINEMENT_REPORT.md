# CommonCircle refinement report (13 Nov 2026)

Branch `lane/contracts`, commits `9b911f9` (chat backend + quality pipeline) and
`da8826c` (dashboard). Built on `13bdf17` (the fixes pass), one commit newer than the
attached ZIP (`0d1e15c`). **No contract change**: interface 1.1.1 on
`commoncircle-light.testnet` is untouched. No keys deleted, no mainnet, no testnet
transactions sent from this pass.

## C. Chat report

| Topic | What it is now |
|---|---|
| Authentication | NEP-413. `POST /nonce` stores a one-time challenge (5 min) that names this app's host; the server now **refuses any other recipient**, so a look-alike site cannot fetch a challenge naming itself and relay the signature. `POST /verify` consumes the nonce atomically first, verifies the ed25519 signature over the NEP-413 hash, checks the key is a **full-access key** of the account on testnet, then issues an HS256 session token (12 h; `iss`/`aud`/`alg` checked). The signing secret is server-only (`AUTH_JWT_SECRET`, required in production). |
| Membership | Every chat and request call runs the contract's `check_access`. "Member" answers are cached 15 s, "not a member" 5 s, failures never. RPC failure ⇒ **503 "try again"** (fail closed, not "banned"). A revoked passport loses access within 15 s. |
| Database | PostgreSQL (`server/migrations/001_chat.sql`): `chat_rooms` (per-room counter), `chat_messages` (circle, seq, author, body, time), `loan_requests` (circle, borrower, amount in base units, days, note, offers[], lender, loan_id, cancelled, direct, timestamps; unique `(circle_id, loan_id)`), `auth_challenges`, `rate_limits`. Migrations apply on start under an advisory lock. |
| Message persistence | Per-room numbers assigned under a row lock: visible in order, gap-free, so polling never skips one. Tested: concurrent posters, restart, paging. |
| Loan request persistence | Read-check-write under a per-room lock + unique index: concurrent offers are not lost; one on-chain loan links to one card; existing checks (borrower, circle, amount, days, lender offered, no double link) kept. |
| Delivery | Polling: every 3 s while the chat is open, 15 s in the background; `after=` cursor, merged by id (no duplicates), `before=` for "Load earlier messages". Not instant push, and the app says so. |
| Rate limits | Shared counters in the database: 20 challenges / 20 verifies per IP per minute, 8 messages per 30 s per account, 240 reads and 30 writes per account per minute. |
| Deployment | `deploy/Dockerfile` (Node 24, only `pg` installed) + `render.yaml` (web service + Postgres). Production refuses to start without `DATABASE_URL`, `AUTH_JWT_SECRET` (≥ 32 chars), https `APP_ORIGINS` and recipients. No JSON-file fallback in production. Details: `docs/CHAT_SERVER.md`. |
| Works locally | `npm run auth` (file store), app → server health, CORS, challenge issue, foreign-recipient refusal (checked in the browser). `npm run test:db`: 20 store tests on a real local PostgreSQL + the real server started twice on it. |
| Verified on the public deployment | Not yet: needs a host (see H). |
| Privacy | Access-controlled, **not end-to-end encrypted**; off-chain; never on-chain. |

## D. Error register

| # | Sev | File | Root cause | Fix | Test | Result |
|---|---|---|---|---|---|---|
| 1 | High | `server/auth.ts` | `/nonce` accepted any `recipient`, enabling a relayed sign-in from a look-alike site | Recipient allowlist from config | `chat-server.test.ts` "only issues challenges naming this app" | Fixed |
| 2 | High | `server/chat.ts`, `requests.ts` | Messages and cards in local JSON files; not shareable, lost on redeploy | `CircleStore` + PostgreSQL store | `store.test.ts` (memory/file/postgres) | Fixed |
| 3 | High | `server/auth.ts` | Challenges in an in-memory Map: replay protection broke across processes | Atomic `DELETE … RETURNING` in the store | store + HTTP replay tests | Fixed |
| 4 | High | `server/auth.ts` | Node path listened on 127.0.0.1 only; cannot be hosted | `HOST`/`PORT` config, 0.0.0.0 in production | `test:db` server round | Fixed |
| 5 | Med | `server/auth.ts` | JWT secret silently from a local file in any environment | Required env in production; config refuses to start | config tests | Fixed |
| 6 | Med | `server/chat.ts` | When testnet RPC was unreachable the membership fetch threw an untyped error (500) and had no timeout | Fail closed with a typed 503 "try again"; 8 s timeout | "fails closed" test | Fixed |
| 7 | Med | `server/requests.ts` | Concurrent offers could overwrite each other (read-modify-write) | Per-room lock in the store | "no lost update" test | Fixed |
| 8 | Med | `web/app.ts` | Direct Loans looked blank: non-members/no-data got one muted line; the form was rebuilt on every refresh (wiping input) | Full states with actions; cached forms keyed on inputs | browser check; `formKey` | Fixed |
| 9 | Med | `web/app.ts` | Network banner reused a single timer; any one RPC success hid it; stale data could feed money actions | `web/net-state.ts`, `requireFresh`, fresh `get_loan` before every money dialog | `net-state.test.ts` | Fixed |
| 10 | Med | `web/app.ts` | Reads for a previous wallet could land after a switch | Epoch guard on `refreshMe` | code review | Fixed |
| 11 | Med | `web/demo.ts` | Only the first 50 loans/passports were read ("first 50") | Page through every view | `allPages` test | Fixed |
| 12 | Low | `web/app.ts` | My Passport showed another member's stats under "My Passport" | "Member passport" label + account shown + notice | browser | Fixed |
| 13 | Low | `web/styles.css` | Treasury/proposal avatars stretched to ovals (first-child flex rule) | Avatar rows keep size | browser screenshot | Fixed |
| 14 | Low | `web/app.ts` | "17 loans" vs loan #19; 5 repaid vs 3+1 passport marks | Explained: loan ids are global; DAO forgave loan #4's late mark. UI now says both | live data check | Explained |
| 15 | Low | `web/app.ts` | New circles defaulted to demo rules | Standard rules are the default | browser | Fixed |
| 16 | Low | `tsconfig.json`, `package.json` | typecheck/lint covered legacy `src`/`scripts` (4 binary files), not `web`/`server` | Retargeted; legacy moved to `*:legacy` | `npm run typecheck`, `lint` | Fixed |
| 17 | Low | `package.json` | `test:db` pointed to a missing script | `scripts/test-db.mjs` implemented; CI service container | CI | Fixed |
| 18 | Low | `package.json` | `contracts:build/test` ran Foundry (LoanBook) | Now the NEAR Rust workspace; Foundry under `legacy:` | needs Rust (CI) | Fixed (not run locally) |
| 19 | Low | `.env.example` | LoanBook/Arc/Supabase values | Rewritten for CommonCircle | review | Fixed |
| 20 | Low | `tests/*.ts` | 6 type errors never caught (tests were not typechecked) | Fixed | typecheck | Fixed |
| 21 | Info | `scripts/{compass-deploy,…}.ts` | 4 LoanBook scripts are binary/corrupt since the baseline | Excluded, not deleted (history) | — | Left as is |
| 22 | Info | `supabase/` | Old LoanBook schema, not the chat backend | Not reused; new schema in `server/migrations` | — | Documented |

Known limits still needing the frozen contract (unchanged): emblem dimension check,
lender-unregister griefing, on-chain DAO policy check, steward invites.

## E. Product and tracks (working features only)

1. **NFTs That Do Something** — one non-transferable NEP-171 passport per member per
   circle; qualifying on-time repayments turn Member → Trusted, which raises the limit,
   allows 2 open loans, invites and treasury loans; overdue pauses perks. My Passport
   shows tier, counts, progress, limits and eligibility from the contract.
2. **Social Money** — ask your circle in the members-only chat (off-chain card → offers →
   choose who to borrow from → on-chain loan → lender funds), or ask one member directly;
   Sputnik DAO treasury lends to Trusted non-stewards when both stewards approve.
3. **Open Innovation** — zero custody: lender → contract checks → borrower in one
   `ft_transfer_call`; failures refund; contract USDC balance 0 at rest, shown live and
   kept separate from the DAO balance.

Evidence: 36 claims (7 / 12 / 17), all PASS in the last `npm run claims` run.

## F. Test report

| Group | Result |
|---|---|
| `npm test` (vitest, CommonCircle) | **161 passed**, 1 skipped (Postgres suite without DB) |
| `npm run test:db` (local PostgreSQL) | **20 passed** + real server restart on Postgres OK |
| `npm run typecheck` / `npm run lint` | **clean** (web, server, tests) |
| `npm run build` | OK |
| `npm run claims:test` | passed (baseline run) |
| CI on `9b911f9` (Rust unit + sandbox, reproducible wasm, npm, Postgres, gitleaks) | **success** |
| Browser: 14 pages at 320 px, 375 px, 1024 px, 1366 px | no overflow, no console errors |
| `npm run contracts:build` / `contracts:test` | **not run locally** (no Rust on this PC); run in CI |
| Requires two live testnet wallets | sign-in, chat between two people, offer → choose lender → fund → repay, repay to an unregistered lender (0.00125 NEAR route), treasury proposal/approval — **not run in this pass** |
| Requires external services | hosted chat server (Render) — **not deployed yet** |
| `npm run test:legacy` | LoanBook tests, separate |

## G. Run and deploy

Windows PowerShell (repo root):

```powershell
npm ci
npm run build; npm run preview      # http://localhost:5173
npm run auth                        # second window: chat server on :3001 (dev files)
npm test; npm run typecheck; npm run lint; npm run test:db
```

WSL / bash: the same commands. With your own Postgres:
`DATABASE_URL=postgres://user:pass@host/db npm run auth`.

Production chat server: see `docs/CHAT_SERVER.md` (Render blueprint or any Docker host).
Then set the repository variable `COMMONCIRCLE_AUTH_URL` and run the
"Deploy CommonCircle testnet demo" workflow.

## H. Needs your approval or action

1. **Host the chat server**: create the Render blueprint (your account), send the URL.
2. Two-wallet live run of chat sign-in, ask → offer → choose → fund → repay.
3. The lender-registration repay route (0.00125 NEAR) on testnet.
4. Ship-day key deletion on `commoncircle-light.testnet` (`docs/SHIP_CHECKLIST.md`) — not done.
