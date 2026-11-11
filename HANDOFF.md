# Cross-lane handoff

Amendment A1: each lane edits only its own files. Requests to the other lane go
here, newest first, with the date (UTC) and the lane that wrote them.

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
