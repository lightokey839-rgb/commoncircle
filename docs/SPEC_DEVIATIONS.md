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

## D-009 — post-freeze fixes from the Gate 1 red team (interface 1.1.1)

Found by `docs/REDTEAM_GATE1.md` after the Gate 1 freeze. Confirmed bugs, so
the freeze rule allows the change; it needs a full CI run, a new reproducible
hash and an in-place testnet redeploy approved by the builder.

1. **Storage was not charged (Critical).** near-sdk `store` collections flush
   their writes when the contract struct is dropped, after the method body, so
   `env::storage_usage()` inside the method saw no growth and the full deposit
   was refunded. Proven on testnet: `create_circle` tx `6PwNu7df…` attached
   0.029 NEAR and was refunded 0.029; `register_invite` `GkWBK471…` refunded in
   full; `create_loan` `2ihs24Ue…` kept only the 256-byte reserve. Anyone could
   grow the contract's state for gas alone until its NEAR balance could no
   longer cover storage, after which state-growing calls and callbacks fail.
   Fix: `flush_all()` before every storage measurement (`create_circle`,
   `register_invite`, `redeem_invite`, `create_loan`, `set_circle_theme`).
   Tests: `rt_contract_never_subsidises_storage`, `rt_underpaid_storage_is_rejected`.
2. **The DAO could take a passport (Medium).** After `attach_dao` the treasury
   account could redeem an invite, make itself a steward and satisfy the
   2-steward rule with one human steward. Fix: `mint_passport` rejects the
   circle's treasury account (`E37_TREASURY_NO_PASSPORT`). Test:
   `rt_dao_cannot_take_a_passport_or_count_as_steward`. This does not stop one
   person controlling two steward accounts; that limit is stated in the trust
   assumptions (see `docs/REDTEAM_GATE1.md`).
3. **Invisible and direction-changing characters in names (Low).** Circle
   names and taglines accepted bidi overrides, zero-width characters and
   newlines, which reach the card and the token title and can imitate another
   circle's name. Fix: both are rejected with `E04_BAD_PARAMS`; names may not
   start or end with a space. Test: `rt_bidi_and_control_characters_in_circle_name`.

Not changed (accepted, documented): emblem image dimensions are not checked
(`rt_png_with_huge_declared_dimensions_is_accepted_known_issue`); a lender who
leaves the token can make an honest borrower late until the circle admin clears
the flag (`rt_lender_unregistering_makes_an_honest_borrower_late_known_issue`);
admin methods that take 1 yoctoNEAR (`set_steward`, `attach_dao`,
`set_passport_expiry`) can add a few dozen bytes without charging them; the
event `version` string is still `1.0.0`.

## Contract freeze notice (Gate 1 phase 1E)

**Deployed on testnet (interface 1.1.1, D-009; deployed 2026-11-11 16:51 UTC, verified by the lead ~21:30 UTC):**
source tree `c6daa1d066d041420597f932bf9dc51b404930a8` (commit `2e45eef`); deploy artifact = reproducible wasm of
CI run `43059776368`, sha256
`fd7d73903294bd371b79452861c243c7722cb0386a2a9c1fdcf80b410032526b`, code hash
`J4X6efoAqFoKVYxaSNtpDYUTyKrKDzrqa2vPZxvMLxGr`, tested in the same job.
Redeploy tx `HZMY2FpFjjAAzRJnc8we3tptUYJLH2FfVqYtWjbugUSB`; refund proof rerun
on 1.1.1 in circle 3 (`docs/VERIFICATION.md`, "Interface 1.1.1 on testnet").
The 1.1.0 entry below is history.

**Deployed on testnet (interface 1.1.0, recorded 2026-11-11 ~16:00 UTC):** frozen source
`contracts/circle/src` tree `5941c7fd00c5caf221ee413ce8d39a097249b170` (commit `3a4f386`); deploy artifact =
reproducible wasm of CI run `43042449897`, sha256
`a6657716eb49b87f8716a16ac9f15104d84270002f9eef73ed64c5de428ee174`, code hash
`CCYR2EZ87by5MX65Ci1V49EVqhF93p8ymwFa6LeH9whm`, tested in the same job. The
1.0.0 entry below is kept as history (it ran the first testnet proof).


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
