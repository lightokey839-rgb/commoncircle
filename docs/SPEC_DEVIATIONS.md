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

## D-003 — loan length uses a per-circle day length

- Status: planned in `docs/CIRCLE_INTERFACE.md` 1.0.0, not implemented.
- Spec surface: v3 and Gate 1 name `create_loan(..., duration_days)`, while v3
  says testnet demo circles use minutes and amendment A4 says test time
  parameters are seconds-scale. Whole days cannot express either.
- Safe reading: keep `duration_days` in the signature and add an immutable
  per-circle `day_length_sec`, bounded below by an init floor (mainnet
  `86400`, so a mainnet "day" can never be shorter than 24 h; testnet floor 0,
  contract still enforces at least 1 second). Testnet DEMO circles may use, for
  example, 60-second days and must be labelled DEMO in the UI.
- Covering test: a circle below the floor is rejected; `due_at` equals
  `funded_at + duration_days * day_length_sec`.

## D-004 — Steward is a badge beside the earned tier

- Status: planned in `docs/CIRCLE_INTERFACE.md` 1.0.0, not implemented.
- Spec surface: v3 lists Member, Trusted and Steward as tiers, but treasury
  loans need a "Trusted, non-steward" borrower, so Steward cannot simply be a
  higher rung of the same ladder.
- Safe reading: the passport stores an earned `tier` (Member or Trusted, never
  downgraded) and a separate `steward` flag set only by the circle admin.
  `display_tier` shows Steward when the flag is set. Perks (cap, open-loan
  limit, inviting) follow the earned tier only; a steward who is not Trusted
  cannot invite.
- Covering test: steward borrower rejected for a treasury loan; steward without
  Trusted cannot register an invite.

## D-005 — founder invite power ends at `attach_dao`

- Status: planned in `docs/CIRCLE_INTERFACE.md` 1.0.0, not implemented.
- Spec surface: Gate 1 says `attach_dao` "removes founder powers", and v3 says
  the inviter is "a founder or a Trusted member".
- Safe reading: the founder may invite only while still the circle admin. After
  `attach_dao` the founder invites only if their passport is effectively
  Trusted, like any member.
- Covering test: founder invite succeeds before `attach_dao` and fails after it
  while the founder is still Member tier.

## D-006 — qualifying minimum amount is its own parameter

- Status: planned in `docs/CIRCLE_INTERFACE.md` 1.0.0, not implemented.
- Spec surface: v3 anti-farming counts a repayment only if "the loan met the
  circle's minimum amount", which every loan does by construction.
- Safe reading: add an immutable `qualifying_min_amount >= min_amount`, so a
  circle can allow small loans that do not count toward Trusted.
- Covering test: an on-time repayment below `qualifying_min_amount` does not
  increase `qualifying_count`.

## D-007 — square passport card (change inside the Gate 1 window)

- Status: implemented in interface 1.1.0, before the Gate 1 freeze deadline
  (Wed 11 Nov 23:59 UTC), at the builder's request.
- Why: Meteor Wallet (testnet) crops NFT media to a square; the 400x300 card
  lost its edges ("MONCIRCLE #1", "TIME 1 / LATE 0"). v3/v4 ask that the art
  render in two wallets.
- What: 512x512 card with every element at least 40 px from the edge. Art
  only; no change to loans, money paths or stored records.
- Covering tests: `themed_card_has_name_tag_tagline_colours_and_emblem`
  (square viewBox), `card_samples_for_every_tier_and_state`, the existing
  tier-flip and paused-card checks; rendering re-checked in a wallet after the
  testnet redeploy.

## D-008 — per-circle passport themes (addition)

- Status: implemented in interface 1.1.0 (additive; 1.0.0 calls unchanged).
- Spec surface: v3/v4 F1 say card art is generated on-chain from tier and
  status with no personal data. The builder asked that each community styles
  its own passports (name tag such as "The Dogs", its own emblem art).
- Safe reading: the circle admin (founder, then the DAO, so no platform
  admin) sets a theme: tagline, three colours, a pattern and an optional
  raster emblem (PNG/JPEG/GIF/WebP, max 12 KiB, magic-byte checked; SVG
  rejected so no script can be embedded). The circle name is the name tag. Tier
  and status still drive the frame, ribbon, chip and sash, so the card still
  changes on a tier flip. No member data is drawn; all text is XML-escaped; no
  floating point. Themes are stored under raw keys outside `Circle`, so the
  stored layout is unchanged and testnet can be redeployed in place.
- Cost and limits: the admin pays theme storage (up to about 0.128 NEAR for a
  full 12 KiB emblem); freed bytes are not refunded. A 50-token enumeration
  stays around 1 MB.
- Covering tests: `themed_card_has_name_tag_tagline_colours_and_emblem`,
  `circle_name_and_tagline_are_xml_escaped`, `bad_colour_is_rejected`,
  `svg_emblem_is_rejected`, `oversize_emblem_is_rejected`,
  `only_the_admin_can_set_the_theme`, `dao_sets_the_theme_after_attach`,
  `default_theme_is_reported_when_none_is_set`, sandbox
  `themed_circle_passport_art_in_sandbox`.

## Contract freeze notice (Gate 1 phase 1E)

- Frozen source: `contracts/circle/src` git tree `227e4b9dc155fc7a93dffc7df4f9e90e0e538d55`
  (first at commit `913998e` on `lane/contracts`).
- Deploy artifact: reproducible wasm from CI run `42984600861` (commit `0c4b4f4`,
  cargo-near 0.23.0, image
  `sourcescan/cargo-near:0.23.0-rust-1.99.1@sha256:8013f039e8005627f10ae66b5519d1a6eeeed7d7aef4b5067d5e9a86c4302fcc`),
  sha256 `2ad7e0945070654fa46a88277527efcbd299632b47adebe05935f62d5aee0e37`,
  code hash `3tF3gbHWdjhoSfMe2KDHrP7TSCEPAXNZh8dm9q97JrB8`, tested in the same CI job
  (F0 sandbox 11/11, contract README rows 9/9). cargo-near embeds the commit,
  so later commits give other hashes for the same source; deploy only this file.
- From here on, any change under `contracts/circle/src` needs a new entry in
  this file (what, why, covering test), a full sandbox re-run, and a new
  reproducible hash recorded in `docs/VERIFICATION.md`.
