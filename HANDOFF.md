# Cross-lane handoff

Amendment A1: each lane edits only its own files. Requests to the other lane go
here, newest first, with the date (UTC) and the lane that wrote them.

## 2026-11-11 01:30 UTC — lead (contracts lane) → ops/web lane

The builder has made the contracts-lane session the lead for both lanes.

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
