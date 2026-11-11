# CommonCircle events (NEP-297)

Contract: `circle`. Interface: `docs/CIRCLE_INTERFACE.md` 1.1.0.
Status: matches the source in `contracts/circle/src`. Not yet compiled or tested;
see `STATUS.md`.

Every event is one log line:

```text
EVENT_JSON:{"data":[{...}],"event":"<name>","standard":"commoncircle","version":"1.0.0"}
```

Key order is not guaranteed; parse the JSON. `data` always holds exactly one
object. Numbers follow the interface rules: u64 and u128 values are decimal
strings, timestamps are nanoseconds, `duration_days` is a JSON number.

Passport mints also log the standard NEP-171 event, so explorers index them:

```text
EVENT_JSON:{"data":[{"owner_id":"bob.testnet","token_ids":["1:bob.testnet"]}],"event":"nft_mint","standard":"nep171","version":"1.2.0"}
```

The server mirrors these events and nothing else (v3: "the server indexes those
and nothing else"). An event in a receipt that later failed did not happen:
index only events from successful receipts.

## Circle and membership

| Event | Emitted by | `data` fields |
| --- | --- | --- |
| `circle_created` | `create_circle` | `circle_id`, `founder_id`, `name`, `params` (CircleParams, interface 3.1) |
| `circle_theme_set` (1.1.0) | `create_circle` with a theme, `set_circle_theme` | `circle_id`, `by`, `tagline`, `background`, `accent`, `text`, `pattern`, `emblem_mime`, `emblem_bytes` (the image itself is not logged) |
| `dao_attached` | `attach_dao` | `circle_id`, `dao_id`, `previous_admin_id` |
| `invite_registered` | `register_invite` | `circle_id`, `inviter_id`, `invitee_id` (null for open invites), `invite_public_key`, `expires_at` |
| `invite_redeemed` | `redeem_invite`, and `create_circle` for the founder | `circle_id`, `account_id`, `token_id`, `inviter_id` (null for the founder), `invite_public_key` (null for the founder) |
| `steward_set` | `set_steward` | `circle_id`, `account_id`, `steward` (bool) |
| `passport_status_changed` | `set_passport_status` | `circle_id`, `account_id`, `token_id`, `previous`, `status` (`Active`/`Suspended`/`Revoked`) |
| `passport_expiry_set` | `set_passport_expiry` | `circle_id`, `account_id`, `expires_at` (or null) |
| `tier_changed` | the repayment callback that completes the Nth qualifying loan | `circle_id`, `account_id`, `token_id`, `from` (`Member`), `to` (`Trusted`), `loan_id` |
| `flag_cleared` | `clear_flag` | `loan_id`, `circle_id`, `borrower_id`, `late_count_reduced` (bool) |

Expiry and overdue are derived from time, so they have no event. Read them from
the views.

## Loans

| Event | Emitted by | `data` fields |
| --- | --- | --- |
| `loan_created` | `create_loan` | `loan_id`, `circle_id`, `borrower_id`, `lender_id`, `lender_is_treasury`, `principal`, `duration_days`, `duration_sec`, `funding_deadline` |
| `loan_cancelled` | `cancel_loan` | `loan_id`, `circle_id`, `reason` (`Borrower`) |
| `loan_funding_started` | `ft_on_transfer` (fund accepted, state Funding) | `loan_id`, `circle_id`, `sender_id`, `amount`, `funded_via` (`Lender`/`Vault`/`Treasury`) |
| `loan_funded` | `on_fund_forwarded`, forward succeeded | `loan_id`, `circle_id`, `borrower_id`, `lender_id`, `amount`, `funded_via`, `funded_at`, `due_at` |
| `loan_funding_failed` | `on_fund_forwarded`, forward failed; state back to Open, full amount refunded | `loan_id`, `circle_id`, `amount`, `reason` (`forward_failed`) |
| `loan_repayment_started` | `ft_on_transfer` (repay accepted, state Repaying) | `loan_id`, `circle_id`, `sender_id`, `amount`, `applied` |
| `loan_repayment` | `on_repay_forwarded`, partial repayment committed | `loan_id`, `circle_id`, `applied`, `total_repaid`, `outstanding` |
| `loan_repaid` | `on_repay_forwarded`, final repayment committed | `loan_id`, `circle_id`, `borrower_id`, `lender_id`, `applied`, `total_repaid`, `repaid_at`, `on_time`, `qualifying`, `excess_returned` |
| `loan_repayment_failed` | `on_repay_forwarded`, forward failed; state back to Funded, full amount refunded | `loan_id`, `circle_id`, `amount`, `reason` (`forward_failed`) |
| `loan_written_off` | `write_off_loan` | `loan_id`, `circle_id` |

A lapsed funding window has no event (no cron). The views report it as
`Cancelled` with `cancel_reason: "Lapsed"`.

## Refunds (not a state change)

| Event | Emitted by | `data` fields |
| --- | --- | --- |
| `transfer_refunded` | `ft_on_transfer` when it rejects a transfer; the full amount goes back as unused | `token_id` (the calling token contract), `sender_id`, `amount`, `reason` (error code), `loan_id` (or null) |

Refund reason codes: `E01_NOT_FOUND`, `E10_NO_PASSPORT`, `E11_LENDER_NO_PASSPORT`,
`E12_NOT_NAMED_LENDER`, `E17_WRONG_STATE`, `E18_WINDOW_LAPSED`,
`E19_TREASURY_RULES`, `E70_WRONG_TOKEN`, `E71_BAD_MSG`, `E72_WRONG_AMOUNT`,
`E73_IN_FLIGHT`.

A low-gas call (`E60_LOW_GAS`) panics instead, so there is no event; the token
refunds the sender because the receiver call failed.

## Recovery

`recovery_started`, `recovery_cancelled` and `recovery_completed` are reserved
names. Recovery is disabled in this build (`get_config().features.recovery` is
false) and emits nothing.

## Why a loan cannot stay stuck in Funding or Repaying

Gate 1 asks for either a recovery path or a proof. This is the argument; the
covering tests are listed after it.

1. `Funding` and `Repaying` are set only inside `ft_on_transfer`, in the same
   receipt that creates the forward promise and its callback. If that receipt
   fails for any reason (including running out of gas), its state change is
   rolled back and the token refunds the sender. The loan never enters the
   in-flight state without a scheduled callback.
2. `ft_on_transfer` first requires `prepaid_gas >= MIN_GAS_FT_ON_TRANSFER`
   (70 Tgas = 15 for the forward + 25 for the callback + 30 for itself, which pays the fees of the two receipts it creates). The
   callback's 25 Tgas is attached as static gas when the promise is created, so
   it is reserved and cannot be consumed by the forward.
3. NEAR runs a callback whether the promise it depends on succeeded or failed.
   The callback reads the result and moves the loan to its next state either way.
4. The callbacks have no panicking paths: no `unwrap` on input, saturating or
   bounded arithmetic, a missing or unexpected loan returns the refund value
   instead of panicking, and they make no further cross-contract calls.
5. Storage the callbacks add (`funded_at`, `due_at`, `repaid_at`, one lender on
   the passport, bounded by `min_distinct_lenders`) is prepaid by the borrower at
   `create_loan` through `LOAN_GROWTH_RESERVE_BYTES` (256 bytes), so the storage
   staking check cannot fail inside a callback.

Measured (sandbox, `gas_measurements_fit_reserved_budgets`): the callbacks burn
1.87 to 2.48 Tgas against the 25 Tgas reserve, and `ft_on_transfer` burns about
2.9 Tgas against its 30 Tgas budget. Figures are in `docs/VERIFICATION.md`.

Covering tests: unit tests `failed_forward_reverts_to_open_and_returns_everything`,
`failed_repay_forward_returns_everything_and_stays_funded`,
`double_fund_while_in_flight_is_refunded`, `low_gas_fails_early`,
`gas_at_minimum_is_accepted`; sandbox tests `fund_to_an_unregistered_borrower`,
`a3_repay_forward_fails_when_lender_unregistered`,
`f0_low_gas_fails_early_and_is_refunded`, `f0_double_fund_is_refunded`.
