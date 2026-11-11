# Cross-lane handoff

Amendment A1: each lane edits only its own files. Requests to the other lane go
here, newest first, with the date (UTC) and the lane that wrote them.

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
