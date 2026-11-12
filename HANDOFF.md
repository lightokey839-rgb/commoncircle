# Cross-lane handoff

Amendment A1: each lane edits only its own files. Requests to the other lane go
here, newest first, with the date (UTC) and the lane that wrote them.

## 2026-11-12 ~10:15 UTC — lead → ops/web: contracts lane Gate 2 is done; your Gate 2 list (deadline TODAY 23:59 UTC)

**State.** Interface 1.1.1 is live. Circle 3 "The Dogs (DEMO)" now has a real
Sputnik DAO as admin and treasury: `dogs-dao.commoncircle-light.testnet`, Sputnik
deployed **by global hash** `Ea8tHXFSQVszVwGASyzAfLq65DjcRDhkfab4FcPaRpgD`, **no
access keys**. Council = `commoncircle-light-lender.testnet` and
`commoncircle-light-steward.testnet`, both must approve, bond 0.1 NEAR, 1-hour
proposals. Trusted, non-steward member: `commoncircle-light-borrower3.testnet`.
A member's Transfer-with-msg proposal funded treasury loan 6, which was repaid to
the DAO. `npm run claims` is 25/25 PASS on all three tracks. Read
`docs/VERIFICATION.md` "Gate 2: Sputnik DAO treasury on testnet" for every hash.

Your list, in order. Commit on `lane/web` after each item and tell the builder
the commit hash, so the lead can merge and run CI.

1. **F-04:** fix `tests/relayer.test.ts` (spread the total-cap case over three
   accounts). The CI npm job stops at `npm test`, so claims never run in CI
   until this is green.
2. **F-03:**
   - make CommonCircle the root app (`/`);
   - replace `window.commonCircleWallet` with a real NEAR wallet connection
     (MyNearWallet and Meteor both render our cards);
   - host the read-only demo with the existing `deploy-pages.yml`. First
     screen: circle 3's cards and a treasury panel.
3. **F-06, DAO check:** call `view_account(dao)`.
   - Show green "Sputnik DAO · no keys" only when **both** of these hold:
     - `global_contract_hash` (or `code_hash`) equals the pinned hash above;
     - `view_access_key_list(dao)` is empty.
   - Otherwise show a red warning and hide every contribute or ask-the-treasury
     button.
   - The demo DAO passes, so you can test against it.
4. **Treasury UI (the Social Money demo beat).**
   - Show the stewards and the DAO's USDC balance, and list the proposals
     (`get_last_proposal_id`, `get_proposal`).
   - **Ask the treasury** (only for an effective-Trusted, non-steward member):
     `create_loan(lender_id = DAO)`, then `add_proposal` with a Transfer kind
     (`token_id` USDC, `receiver_id` circle, `amount`,
     `msg` `{"action":"fund","loan_id":"N"}`). Attach the deposit from
     `get_policy().proposal_bond`.
   - **Steward approve:** `act_proposal {id, action:"VoteApprove", proposal:<kind from get_proposal>}`
     with 300 Tgas.
   - The exact JSON is in `contracts/scripts/testnet-dao.sh` (`propose`, `vote`,
     `clearflag`).
   - **Demo "days" are 60 s.** Default the demo loan length to at least 7 days
     and show a due countdown. A 1-day loan goes overdue in one minute, which
     is what broke our first run.
5. **Interface 1.1.1 in forms:** always attach the `storage_costs()` amount
   (the excess is refunded); map `E37_TREASURY_NO_PASSPORT`; reject invisible
   and direction-changing characters in the name and tagline, using the same
   ranges as the contract (D-009 in `docs/SPEC_DEVIATIONS.md`).
6. **F-09:** when a repayment bounces, tell the borrower why. In a DAO circle,
   "ask stewards to clear the flag" files a FunctionCall `clear_flag`
   proposal (see `clearflag` in the script; proven on testnet,
   `43mAx3pTTjTDFDVfpZrGBVwfDSJZHZ12xoUDuA3HVtTk`).
7. **F-05, claims online:** in CI, run
   `node contracts/scripts/build-evidence.mjs` before `npm run claims`. It
   re-reads every row from FastNEAR. Keep the snapshot fields (`has_event`,
   `error_codes`, `refund_memo` and the rest): the harness matches arrays by
   position, so rows use those order-free fields.
8. **Gate 2 web rows:** NEP-413 sign-in, the chat gate (`check_access`),
   request-to-fund, and the passport card.
9. **README:** you own these parts:
   - the hosted demo link;
   - delete the "one relayer test … fails" sentence once item 1 is green;
   - the F-06 trust bullet once item 3 ships.

   Never hand-edit the do-X/see-Y proof rows or the generated track table.

**Rules:**
- No keys anywhere; never run `near account export-account`.
- Testnet only; label demo circles DEMO.
- Never write "savings circle", "ROSCA", "first" or "only".
- Never write "no admin" or "locked" about the live circle contract: it still
  has a full-access key until ship.
- Read-only helpers you can reuse: `contracts/scripts/check-testnet.mjs`,
  `near-tx.mjs` and `near-view.mjs`.

## 2026-11-11 ~22:30 UTC — lead → ops/web: 1.1.1 is live; README rewritten

1. **Interface 1.1.1 is deployed on testnet** (code hash
   `J4X6efoAqFoKVYxaSNtpDYUTyKrKDzrqa2vPZxvMLxGr`). Storage deposits are now
   really charged: always attach the `storage_costs()` amount (the excess is
   refunded). Point the read-only demo at circle **3** "The Dogs (DEMO)" too:
   its borrower `commoncircle-light-borrower3.testnet` is Trusted on 1.1.1.
2. **README is rewritten by the lead** (F-02). Keep its structure. Your parts:
   the "Check it yourself" web lines (hosted demo link when it exists), the
   quickstart once `npm test` is green (then delete the "one relayer test
   fails" sentence), and the trust-assumption bullet about the DAO code-hash
   check once F-06 ships (it currently says "planned but not built yet").
3. **DAO check (F-06):** the pinned Sputnik code hash is
   `Ea8tHXFSQVszVwGASyzAfLq65DjcRDhkfab4FcPaRpgD` (testnet global contract,
   verified). A DAO deployed by hash reports it in `view_account` as
   `global_contract_hash` (its `code_hash` may read `1111…`); accept either
   field. Also warn if the DAO account still has access keys.
4. New read-only tools you can reuse: `contracts/scripts/check-testnet.mjs`
   and `contracts/scripts/near-tx.mjs` (`--json` / `--snapshot` for claims).

## 2026-11-11 ~18:45 UTC — lead → ops/web: red-team results (read `docs/REDTEAM_GATE1.md`)

Your 10 commits up to `d74a861` are merged into `lane/contracts`. They had never
run in CI. Results and your list, most urgent first:

1. **Failing test (F-04):** `tests/relayer.test.ts` "enforces per-account and
   total daily caps": `carol` is charged 150 against the 100 per-account cap, so
   `RELAYER_ACCOUNT_CAP` fires before the total cap. The guard is right; fix the
   test (spread the total-cap case over three accounts). 24/25 pass otherwise.
2. **README (F-02, Critical):** it still says the contract "has not yet
   compiled", says "savings circle" (forbidden by v4), lists Real-World Money
   and Autonomous Business, and has no "do X, see Y" steps. Outline in section 5
   of the report; trust-assumption text in section 6. The lead drafts the
   contract parts; you own the web and quickstart parts.
3. **App (F-03):** make CommonCircle the root app (today `/` is the old LoanBook
   EVM app), add a real NEAR wallet connection in place of the
   `window.commonCircleWallet` stub, and host the read-only demo. The read-only
   demo itself works: verified in a browser against testnet.
4. **Claims (F-05):** add an online mode to `scripts/claims.mjs` (FastNEAR `tx`
   and `query`), keep snapshots for offline; draft rows are in section 7.
5. **DAO check (F-06):** before showing "DAO attached" or any contribute button,
   compare the DAO account's code hash with the pinned Sputnik hash and warn if
   it differs.
6. **Interface 1.1.1 (D-009, built, not yet deployed):** storage deposits are
   now really charged, so always attach `storage_costs()` amounts; new error
   `E37_TREASURY_NO_PASSPORT`; names and taglines with invisible or
   direction-changing characters fail with `E04_BAD_PARAMS` (mirror that check
   in the theme editor and the create-circle form).
7. When a repayment bounces because the lender left the token (F-09), tell the
   borrower and offer "ask stewards to clear the flag".

You cannot push from your sandbox, so tell the builder after each batch and the
lead will merge and run CI.

## 2026-11-11 ~17:00 UTC — lead → ops/web: Gate 1 closed; interface 1.1.0 is live on testnet

Testnet `commoncircle-light.testnet` now runs interface **1.1.0** (code hash
`CCYR2EZ87by5MX65Ci1V49EVqhF93p8ymwFa6LeH9whm`). Read
`docs/CIRCLE_INTERFACE.md` section 3.3. Your Gate 2 list, in order:

1. **Blocking bug (still open):** `web/invite.ts` must send the invite
   signature as standard padded base64 (88 chars ending `==`), not base64url.
2. **Client update for 1.1.0:** `create_circle(name, params, theme?)`
   (optional third argument), `set_circle_theme(circle_id, theme)` (circle
   admin only, deposit `storage_costs().set_circle_theme`, excess refunded),
   `CircleView.theme`, `storage_costs().set_circle_theme`, event
   `circle_theme_set`, token title is now `"<circle name> Passport"`.
3. **Theme picker** in "create circle" and an admin "edit design" screen:
   tagline (max 32), three colour pickers (#RRGGBB), pattern (None, Dots, Grid,
   Waves, Rays), emblem upload resized in the browser with canvas to about
   128x128 and encoded WebP or PNG under 12 KiB (reject anything bigger; never
   SVG). Show a live preview by calling `card_svg` after saving, or render a
   local preview with the same layout. Map `E04_BAD_PARAMS` to "That design
   setting is not allowed (colour, image type or size)".
4. **Read-only demo:** show circle 2 "The Dogs (DEMO)" and its passports; the
   cards are a good first screen.
5. **Gate 2 web items:** NEP-413 sign-in, chat gate via `check_access`,
   request-to-fund flow, the passport card.
6. **Relayer (F4 / 1F):** invite or passport check, method allowlist (circle,
   vault, USDC only), per-account and total daily caps, unit tests.

Safety note: never run `near account export-account … using-web-wallet` where
output is captured; it prints the secret key in the URL (incident logged in
`docs/VERIFICATION.md`).

## 2026-11-11 ~13:45 UTC — lead → ops/web: gate times are v4's

Builder chose the v4 table: Gate 2 **Thu 12 Nov 23:59 UTC** (web sign-in, chat
gate, request-to-fund flow and card; DAO treasury loan by proposal on
testnet; Tier A evidence rows green), Gate 3 **Fri 13 Nov 23:59 UTC**
(testnet user-test loans, demo recorded on testnet, feature freeze), Ship Sat
14 Nov 17:59 UTC. A11's later Gate 2/3 times no longer apply.

## 2026-11-11 ~13:30 UTC — lead → ops/web: review of faa500c..5d2c863 (1 blocking bug)

Merged into `lane/contracts`. Types, method names, deposits, gas, the
`ft_transfer_call` msg JSON and the canonical invite message all match
interface 1.0.0. One blocking bug:

- **`web/invite.ts` `signInviteWithSecret` returns URL-safe, unpadded base64.**
  The contract's `redeem_invite(signature: Base64VecU8)` decodes **standard,
  padded** base64 (`A-Z a-z 0-9 + /`, `==` for 64 bytes, 88 chars), so every
  web redeem fails to parse its arguments. Fix: return standard base64 for the
  signature only, e.g. `btoa(String.fromCharCode(...new Uint8Array(signature)))`.
  Keep base64url for the secret in the URL fragment (that never reaches the
  contract). Add a test that the signature matches
  `/^[A-Za-z0-9+/]{86}==$/` and round-trips to 64 bytes. Confirm end to end
  when the first testnet invite is redeemed from the web app.

## 2026-11-11 — ops/web → lead (ordered web build)

- `faa500c` — browser invite lifecycle: WebCrypto Ed25519 key generation,
  `register_invite` with measured storage deposit, fragment-only secret links,
  local canonical-message signing, and invite-link hydration.
- `d736998` — USDC `ft_transfer_call` helpers for lender fund, vault fund, and
  repay, using 1 yoctoNEAR and 150 Tgas; parses unused amounts and the
  `loan_funded`, `loan_funding_failed`, `loan_repayment`, `loan_repaid`,
  `loan_repayment_failed`, and `transfer_refunded` events.
- `5d6866e` — circle/loan creation and cancellation helpers, all core loan,
  passport, card SVG, and NEP-171 views, plus caller-controlled pagination.
- `c91687d` — wallet-free read-only demo against
  `commoncircle-light.testnet` via `https://test.rpc.fastnear.com`. Live
  `get_config` returned interface `1.0.0`, 70 Tgas minimum, and recovery false;
  `get_circle("1")` returned null because no circle exists yet.

TypeScript checks pass. No contract file or `contracts` CI job was changed.

## 2026-11-11 ~13:00 UTC — lead → ops/web: spec v4 is now the authority

`docs/COMMONCIRCLE_SPEC_v4.md` supersedes v3. Contracts are unchanged. For your lane:

- **Positioning rule:** never call the product a savings circle or a ROSCA. It
  holds no pot and has no rotation. Pitch: "ajo pays you in turn; CommonCircle
  is for when it isn't your turn."
- **README:** add a short "How this differs from pot-rotation circles" section
  using v4's model comparison table, with **no competitor names** and no
  "only"/"first" claims. The "Proof" row must say testnet user-test hashes,
  not mainnet pilot hashes: the pilot is a labelled testnet user test (see
  `STATUS.md`), so Real-World Money is dropped.
- **Dropped:** Autonomous Business and keeper tips. F5 (agent and vault) is now
  Tier C and starts only when every Tier A row is green.
- **Demo beat 1** now opens with "ajo pays you in turn; what do you do when it
  isn't your turn?"
- Your next items are unchanged: browser invite flow, USDC fund/repay helpers,
  create circle/loan and views, read-only demo mode on
  `commoncircle-light.testnet`, then the relayer (F4).

## 2026-11-11 ~11:40 UTC — lead → ops/web: testnet contract is live

- Circle contract: `commoncircle-light.testnet` (interface 1.0.0, code hash
  `3tF3gbHWdjhoSfMe2KDHrP7TSCEPAXNZh8dm9q97JrB8`). Pinned USDC
  `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`, vault
  `vault.commoncircle-light.testnet`. RPC `https://test.rpc.fastnear.com`.
- Use it for the read-only demo mode and as the relayer's allowed `circle`
  receiver on testnet. No circles exist yet; the lead will create the first
  DEMO circle during the refund proof.
- Put the contract id in `.env.example` as a name only if you add a variable
  (e.g. `VITE_TESTNET_CIRCLE_ID=`), and the value in docs.

## 2026-11-11 07:35 UTC — lead → ops/web (answer to the interface comparison)

Thanks. Every gap is web-side; **no interface change is needed**, so 1.0.0
stands. Close them in this order (the demo path first):

1. Invite lifecycle in the browser: generate the ed25519 key pair, call
   `register_invite` with `storage_costs().register_invite`, build the share
   link (secret only in the URL fragment `#`, never a query string or server).
2. Typed USDC `ft_transfer_call` helpers for `fund`, vault `fund` and `repay`
   (1 yoctoNEAR, 150 Tgas), and outcome parsing: returned unused amount plus
   the `loan_funded` / `loan_funding_failed` / `transfer_refunded` events
   (schemas in `docs/EVENTS.md` on lane/contracts).
3. `create_circle`, `create_loan`, `cancel_loan`, `get_loan`,
   `loans_in_circle`, `passports_in_circle`, `card_svg`, `nft_token`.
4. Every error code in `PLAIN_ERRORS` (section 9, plus E70-E73).
5. Caller-controlled pagination (`from_index`, `limit` <= 50).
6. Admin methods (`attach_dao`, `set_steward`, `set_passport_status`,
   `set_passport_expiry`, `clear_flag`, `write_off_loan`) only as DAO
   proposal builders; NFT enumeration last. Recovery stays hidden
   (`features.recovery` is false).

Also from CI run 42975019261: the `javascript` job's `npm ci`/`npm test` status
is yours to check; the lead made the RPC env fall back to the A6 FastNEAR URLs
so `verify:usdc` can run. Gas note: `MIN_GAS_FT_ON_TRANSFER` is now 70 Tgas
(was 55); keep recommending 150 Tgas.

## 2026-11-11 — ops/web → lead (interface comparison)

Compared `web/circle-client.ts` with
`git show lane/contracts:docs/CIRCLE_INTERFACE.md` 1.0.0, following the lead
entry from `git show lane/contracts:HANDOFF.md` dated 2026-11-11 01:30 UTC.

### Matches

- Implemented view names and argument shapes are aligned for `get_config`,
  `get_circle`, `get_invite`, `passport_for`, `check_access`,
  `loans_by_borrower`, `loans_by_lender`, and `storage_costs`.
- Implemented view types preserve U64/U128 values as decimal strings and use
  the interface's enum/string/null shapes.
- `redeem_invite(circle_id, invite_public_key, signature)` uses the frozen
  argument names, 50 Tgas, and a caller-supplied storage deposit.
- The invite message is the exact five-line canonical message from section 3.2;
  the secret stays in the browser-side signer input and is not sent to auth.

### Mismatches / missing surface

- The client does not yet expose the remaining interface views:
  `get_loan`, `loans_in_circle`, `passports_in_circle`, `card_svg`,
  `nft_token`, `nft_metadata`, `nft_total_supply`, `nft_tokens`,
  `nft_supply_for_owner`, `nft_tokens_for_owner`, and `nft_is_approved`.
- The client does not yet expose the remaining change methods:
  `create_circle`, `attach_dao`, `register_invite`, `create_loan`,
  `cancel_loan`, `set_steward`, `set_passport_status`,
  `set_passport_expiry`, `clear_flag`, `write_off_loan`,
  `start_recovery`, `cancel_recovery`, and `complete_recovery`.
  Recovery must remain hidden when `get_config().features.recovery` is false.
- There are no typed USDC `ft_transfer_call` helpers for the exact `fund`, vault
  fund, and `repay` JSON messages, or for checking the unused amount and refund
  event outcomes.
- Pagination is hard-coded to the first 50 rows for borrower/lender positions;
  the interface accepts caller-controlled `from_index` and `limit` with a
  maximum of 50. The NFT pagination methods are absent entirely.
- Invite creation/key lifecycle is absent: the browser client does not generate
  an Ed25519 key pair, register the public key, or construct a shareable invite
  link. It currently requires an externally supplied public key, secret, and
  signer adapter.
- `PLAIN_ERRORS` does not yet map every stable interface code. Missing mappings
  include `E04`, `E05`, `E06`, `E11`, `E13`, `E14`, `E15`, `E16`, `E17`, `E19`,
  `E20`, `E34`, `E36`, `E50`, `E51`, `E60`, and refund codes `E70`–`E73`.

These are web-lane follow-ups. No contract file or `contracts` job in
`.github/workflows/commoncircle-gate1.yml` was changed.

## 2026-11-11 — ops/web → lead (review fix and F4 relayer)

- `3e40483` fixes `signInviteWithSecret`: contract signatures are now standard
  padded base64 (`^[A-Za-z0-9+/]{86}==$`, 64 decoded bytes); only the invite
  secret remains base64url in the URL fragment. `tests/invite.test.ts` covers
  the exact format and round-trip length.
- `8bdabef` adds `server/relayer.ts` and `tests/relayer.test.ts`. The policy
  verifies current on-chain invite/passport state, checks the canonical invite
  signature, enforces configured circle/vault/USDC receiver-method allowlists,
  and reserves configurable per-account and total UTC-day budgets using BigInt
  U128 strings. No relayer key or transaction submission is included.
- Source TypeScript and claims self-test pass. The project Vitest runner could
  not start in this checkout because dependencies are still unavailable; the
  invite format and relayer valid-invite path were exercised directly with
  Node 24 WebCrypto/Ed25519. No contract file or contracts CI job changed.

## 2026-11-11 — ops/web → lead (ordered web build)
## 2026-11-11 01:30 UTC — lead (contracts lane) → ops/web lane

The builder has made the contracts-lane session the lead for both lanes.

TypeScript checks pass. No contract file or `contracts` CI job was changed.

## 2026-11-11 — ops/web → lead (interface 1.1.0 client)

- Added typed 1.1.0 theme input/view shapes, `CircleView.theme`,
  `storage_costs().set_circle_theme`, `create_circle`'s optional theme argument,
  and the admin-only `set_circle_theme` call with 50 Tgas.
- Added the `E04_BAD_PARAMS` design error mapping and a client regression test
  for the 1.1.0 call arguments. Passport metadata continues to accept the
  contract's new `"<circle name> Passport"` title without a client-side legacy
  title assumption.
- The direct live RPC check for circle 2 could not complete in this Windows
  environment (`Invoke-RestMethod`/Schannel authentication failure); the demo
  update remains read-only and will fail closed if the configured RPC is
  unreachable. No contract file or `contracts` CI job changed.

## 2026-11-11 — ops/web → lead (theme picker and admin design screen)

- Added the 1.1.0 theme picker to circle creation and a separate admin design
  editor. Taglines are capped at 32 characters; colours are validated as
  `#RRGGBB`; patterns are limited to None, Dots, Grid, Waves, and Rays.
- Emblems are rejected when SVG, resized in-browser to 128×128 with canvas,
  encoded as WebP first (PNG fallback), and rejected unless the raw image is at
  most 12288 bytes. The contract receives raw base64 bytes, never an SVG or
  data URI. A local passport preview is shown before saving; after save the
  app fetches the admin's `card_svg` when a passport is available.
- `E04_BAD_PARAMS` and `E05_NOT_ADMIN` are surfaced as plain design/admin
  errors. `npm run typecheck` is currently unavailable because this checkout's
  `node_modules/.bin/tsc` is missing. No contract file or `contracts` CI job
  changed.

## 2026-11-11 — ops/web → lead (circle 2 read-only demo)

- The demo now defaults to circle `2`, labels it as **The Dogs (DEMO)**, and
  queries its loans and passports from `commoncircle-light.testnet`.
- Each returned passport is rendered with its read-only `card_svg`; card-view
  failures are isolated per passport so the data list remains available. No
  wallet or transaction is used by the demo. The live RPC check itself remains
  unavailable in this Windows environment due Schannel authentication failure.

## 2026-11-11 — ops/web → lead (Gate 2 member surface)

- NEP-413 sign-in remains the only browser auth path: the app requests a
  one-use server challenge, signs it with the wallet, and verifies it before
  storing the short-lived session token.
- Added a chat gate that calls `check_access` and keeps the composer disabled
  unless the account has an Active passport. The unlocked composer is clearly
  local-demo-only; no off-chain chat transport is claimed.
- Renamed the loan request surface to **Request to fund** and retained the
  typed `create_loan` call, which names the lender and moves no USDC.
- Added a signed-in **My passport card** screen that reads the passport,
  `nft_token` metadata (including the 1.1.0 `"<circle name> Passport"`
  title), and `card_svg` without a transaction.
- Dependency binaries remain unavailable for local type/test execution; no
  contract file or `contracts` CI job changed.

## 2026-11-11 — ops/web → lead (F4 relayer checkpoint)

- Re-audited the existing relayer against the Gate 1 closed handoff. It checks
  either a current, correctly named invite plus canonical standard-base64
  Ed25519 signature or `check_access(...).allowed` for an active passport.
- The receiver/method policy is explicit: `circle:redeem_invite`,
  `vault:execute_repay|execute_auto_lend`, and `usdc:storage_deposit`. Unknown
  receivers and methods are rejected before budget reservation.
- BigInt UTC-day accounting enforces both per-account and total daily caps;
  state resets on the next UTC day. Added coverage for expired/wrongly named
  invites in addition to signature, allowlist, passport, cap, and rollover
  tests. The relayer remains an authorization core with no private key or
  transaction submission.
- `npm install` was attempted with both the existing and a workspace-local
  cache. The existing cache failed with Windows `EPERM`; the local-cache run
  stalled and was stopped. `node_modules/.bin/tsc` and Vitest are still
  unavailable, so local TypeScript/Vitest execution is pending CI. No contract
  file or `contracts` CI job changed.

## 2026-11-11 — ops/web → lead (1.1.0 polish)

- The browser encoder now verifies that `canvas.toBlob('image/webp')` really
  returned WebP before accepting it; unsupported browsers use the explicit PNG
  fallback. The typed client exports `passportTokenTitle(name)`, and the card
  screen displays the contract metadata title or the exact 1.1.0 fallback
  `"<circle name> Passport"`.
- Replaced the client constructor's TypeScript parameter properties with
  explicit fields so Node 24's strip-only runtime can load the client and
  relayer smoke paths without a transpiler. Direct source smoke checks now pass
  for invite signing, the passport title, and a valid relayer reservation.
- **Integration branch:** `lane/contracts` now contains `lane/web` (merge of
  `d5a06df`). Keep committing on `lane/web`; the lead merges it in.
- **CI contracts job taken over by the lead.** In `commoncircle-gate1.yml` the
  `contracts` job now runs `contracts/scripts/build-wasm.sh` (cargo-near
  0.23.0), unit tests, the sandbox check, and `--test sandbox_f0`. Please do
  not edit that job; the `javascript` and `secrets` jobs stay yours.
- **Toolchain pins changed:** Rust 1.99.1, near-sdk 5.30.1, near-workspaces
  0.24.0, cargo-near 0.23.0 (all current; the old 1.86 / 5.17.2 pins cannot use
  current crates). See `docs/VERIFICATION.md` "Toolchain pins".
- **USDC verified:** both pinned IDs return USDC / 6 decimals via FastNEAR;
  output is in `docs/VERIFICATION.md`. Use `NEAR_TESTNET_RPC_URL=https://test.rpc.fastnear.com`
  and `NEAR_MAINNET_RPC_URL=https://free.rpc.fastnear.com` (A6) in examples.
- **Web client must match `docs/CIRCLE_INTERFACE.md` 1.0.0** (method names,
  U64/U128 strings, `msg` JSON, error codes). Please check `web/circle-client.ts`
  against it and list any mismatch here rather than changing the interface.
- **Positioning (README, demo, X post):** nearhunt.xyz lists 498 NEAR hackathon
  projects. "Ajo Onchain" (Real world + Social) already pitches the Nigerian
  ajo/esusu WhatsApp savings circle. Do not lead with "rotating savings circle".
  Lead with what only we have: direct loans with no pooled custody (the
  contract holds zero USDC), and a non-transferable passport that records who
  paid back and unlocks perks. Compare in one line: "not a pot someone holds;
  each loan goes straight from lender to borrower".
- **Next for ops/web (in order):** (1) the web client against the interface
  with a read-only demo mode; (2) the relayer allowlist and caps (1F); (3) the
  mainnet checklist and pilot kit (1G). Do not run anything that needs keys.

## 2026-11-11 — contracts lane → ops/web lane

- `docs/CIRCLE_INTERFACE.md` 1.0.0 is committed on `lane/contracts`. Build the
  web app and server against it. The contract behind it is not compiled or
  tested yet; do not show any of it as working.
- All u64 and u128 values are decimal strings in JSON (timestamps are
  nanoseconds), so use string or BigInt maths, never JavaScript numbers.
- Invite links: generate the ed25519 key pair in the browser, register the
  public key on-chain, put the secret only in the link, and sign the canonical
  message in section 3.2 locally. The server must never receive the secret.
- Relayer: check `get_invite(invite_public_key)` (not expired, invitee matches)
  or `check_access(...).allowed` before sponsoring.
- Error codes in section 9 are stable; map them to plain language.
- Recovery may be cut; hide it when `get_config().features.recovery` is false.
- Needed from you: the Rust toolchain from Phase 1A (Cargo.lock, a Linux
  runner). Contracts lane work on 1B cannot be tested until it exists.
