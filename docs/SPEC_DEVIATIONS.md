# CommonCircle specification deviations

This file records the safest interpretations required by the Gate 1 request.
No deviation is a README claim; each must have a covering test before the
corresponding behavior is shipped.

## D-001 — invite signature domain separation

- Status: planned, not implemented.
- Spec surface: v3 F1 invite redemption describes a signature over circle,
  caller, and invite key. Gate 1 additionally requires a fixed tag and this
  contract account ID in the canonical message for replay safety.
- Safe reading: use the fixed tag, this contract account ID, circle ID, caller,
  and invite public key in one documented canonical byte sequence, then verify
  with `env::ed25519_verify`.
- Covering test: invite register/redeem, replay, expiry, named-account mismatch,
  and a signature replayed against a different contract account.

## D-002 — pilot Trusted-tier anti-farming threshold

- Status: planned, not implemented.
- Spec surface: v3 gives a default of three qualifying repayments and at least
  two different lenders, while the Gate 1 pilot requires N = 1, one lender, and
  a one-day minimum. Those defaults cannot all hold for the pilot.
- Safe reading: keep both values immutable circle parameters; configure the
  pilot with N = 1 and `min_distinct_lenders = 1`, while mainnet defaults remain
  the stricter values.
- Covering test: qualification succeeds at the pilot parameters and fails when
  either the repayment count or distinct-lender requirement is below the circle
  setting.
