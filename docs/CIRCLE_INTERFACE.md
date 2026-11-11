# CommonCircle `circle` contract interface

Interface version: **1.0.0** (frozen 2026-11-11, contracts lane).
Authority: `docs/COMMONCIRCLE_SPEC_v3.md` and the Gate 1 prompt with amendments A1 to A11.
Owner: contracts lane (`lane/contracts`). The web lane builds against this file.

**Status: interface only.** The contract behind this interface is not compiled or
tested yet (see `STATUS.md`). Nothing here is a README claim.

Change rule: after this commit, any change to a method name, argument, return
shape, event name or error code needs a version bump here and an entry in
`HANDOFF.md`. Adding a field to a view or event payload is a minor bump, and
clients must ignore unknown fields.

## 1. Conventions

| Topic | Rule |
| --- | --- |
| JSON | All methods take and return JSON (near-sdk default). |
| u128 values (USDC, yoctoNEAR) | Decimal **strings** (`U128`), e.g. `"20000000"` = 20 USDC. USDC has 6 decimals. No floats anywhere. |
| u64 values (ids, timestamps, durations in seconds) | Decimal **strings** (`U64`), e.g. `"1731283200000000000"`. Timestamps are nanoseconds since the Unix epoch (`block_timestamp`). |
| u32 values (counts, `duration_days`, `limit`, thresholds) | JSON numbers. |
| Pagination | `from_index: number \| null` (default 0) and `limit: number \| null` (default 50). A `limit` above 50 is clamped to 50. Results are in insertion order. |
| Ids | `circle_id` and `loan_id` are `U64` strings that start at `"1"`. A passport `token_id` is `"<circle_id>:<owner_account_id>"` (an account id cannot contain `:`). |
| Time | Every duration is a parameter. Per-circle durations are given in seconds, except loan length, which is `duration_days` multiplied by the circle's `day_length_sec` (see D-003 in `docs/SPEC_DEVIATIONS.md`). Mainnet floors force `day_length_sec >= 86400`. |
| Storage | Callers pay storage. Every payable method checks the attached deposit against the measured storage increase and refunds the excess in the same call. `storage_costs()` returns upper bounds to attach. |
| Errors | Every rejection panics with a message that starts with a stable code, e.g. `E12_NOT_NAMED_LENDER: ...`. The web lane maps codes to plain language (section 9). |
| Admin | No contract owner, no upgrade path, no global admin. Each circle has an `admin_id`: its founder at creation, and its DAO for good after `attach_dao`. |
| Callbacks | `on_fund_forwarded` and `on_repay_forwarded` are `#[private]`. Clients never call them. |

## 2. Initialisation (once, by the contract account itself)

```text
new(
  usdc_id: AccountId,           // pinned NEP-141 USDC; immutable
  vault_id: AccountId,          // pinned vault; immutable
  hard_loan_cap: U128,          // mainnet "50000000" (50 USDC); testnet as chosen
  floors: {
    funding_window_sec: U64,    // testnet "0"
    qualifying_duration_sec: U64,
    recovery_lock_sec: U64,
    day_length_sec: U64         // mainnet "86400"; testnet "0" (contract still enforces >= 1)
  }
)
```

`#[init]` and `#[private]`: only the contract account can call it, in the deploy
batch. Same wasm on testnet and mainnet; only these arguments differ.

## 3. Change methods

Gas in the table is the amount the web app should attach. It is provisional until
the sandbox measurements are recorded in `docs/VERIFICATION.md`.

| Method | Caller | Deposit | Gas | Returns |
| --- | --- | --- | --- | --- |
| `create_circle(name, params)` | anyone (becomes founder and admin; founder gets a Member passport) | `storage_costs().create_circle` | 30 Tgas | `circle_id` (U64) |
| `attach_dao(circle_id, dao_id)` | founder, once, while founder is admin | 1 yoctoNEAR | 30 Tgas | — |
| `register_invite(circle_id, invite_public_key, expires_at, invitee_id?)` | founder while admin, or an Active passport holder with effective Trusted tier | `storage_costs().register_invite` | 30 Tgas | — |
| `redeem_invite(circle_id, invite_public_key, signature)` | the invitee (or anyone, for an open invite) | `storage_costs().redeem_invite` | 50 Tgas | `token_id` |
| `create_loan(circle_id, lender_id, amount, duration_days)` | borrower | `storage_costs().create_loan` | 50 Tgas | `loan_id` (U64) |
| `cancel_loan(loan_id)` | borrower, while Open and not lapsed | 1 yoctoNEAR | 30 Tgas | — |
| `set_steward(circle_id, account_id, steward: bool)` | circle admin | 1 yoctoNEAR | 30 Tgas | — |
| `set_passport_status(circle_id, account_id, status)` | circle admin; `status` is `"Active"`, `"Suspended"` or `"Revoked"`; Revoked is final | 1 yoctoNEAR | 30 Tgas | — |
| `set_passport_expiry(circle_id, account_id, expires_at: U64 \| null)` | circle admin | 1 yoctoNEAR | 30 Tgas | — |
| `clear_flag(loan_id)` | circle admin of the loan's circle | 1 yoctoNEAR | 30 Tgas | — |
| `write_off_loan(loan_id)` | circle admin; treasury loans only, `now >= due_at + writeoff_grace_sec` | 1 yoctoNEAR | 30 Tgas | — |
| `start_recovery(circle_id, new_account_id)` | passport owner | 1 yoctoNEAR | 30 Tgas | — |
| `cancel_recovery(circle_id)` | passport owner (old account) | 1 yoctoNEAR | 30 Tgas | — |
| `complete_recovery(circle_id, old_account_id)` | the new account, after `recovery_lock_sec` | `storage_costs().redeem_invite` | 50 Tgas | new `token_id` |
| `ft_on_transfer(sender_id, amount, msg)` | the pinned USDC contract only (called by `ft_transfer_call`) | — | see section 5 | unused amount (U128) |
| `nft_transfer`, `nft_transfer_call`, `nft_approve`, `nft_revoke`, `nft_revoke_all` | — | — | — | always panic `E40_NON_TRANSFERABLE` |

Recovery is cut first if Gate 1 runs late. If it is cut, the three recovery methods
panic `E50_RECOVERY_DISABLED` and `get_config().features.recovery` is `false`; the
web app must hide recovery when that flag is false.

### 3.1 Circle parameters (`create_circle`)

All are fixed when the circle is created.

```text
name: string                       // 1..64 chars; public on-chain; no personal data
params: {
  min_amount: U128,                // smallest loan
  member_max_amount: U128,         // cap at Member tier (or when Trusted perks are paused)
  trusted_max_amount: U128,        // cap at effective Trusted; <= hard_loan_cap
  max_duration_days: number,       // >= 1
  day_length_sec: U64,             // >= max(1, floor); pilot/mainnet "86400"; testnet DEMO e.g. "60"
  funding_window_sec: U64,         // default "259200" (72 h); >= floor
  qualifying_min_amount: U128,     // a repayment counts toward Trusted only if principal >= this
  qualifying_min_days: number,     // ... and duration_days >= this; days * day_length_sec >= floor
  trusted_threshold: number,       // N qualifying on-time repayments; default 3; pilot 1; >= 1
  min_distinct_lenders: number,    // default 2; pilot 1; stored as min(value, N)
  recovery_lock_sec: U64,          // default "259200"; >= floor
  writeoff_grace_sec: U64          // default "2592000" (30 days)
}
```

Checks: `min_amount <= member_max_amount <= trusted_max_amount <= hard_loan_cap`,
`qualifying_min_amount >= min_amount`, every value at or above its init floor.

### 3.2 Invites

- `invite_public_key` is the string form `"ed25519:<base58>"`. The link carries the
  matching secret key; the contract stores only the public key.
- `expires_at` is a U64 nanosecond timestamp in the future.
- `invitee_id` set means a named invite: only that account can redeem it. The UI
  should default to named invites.
- `signature` is base64 of the 64-byte ed25519 signature, made with the invite
  secret key over these exact UTF-8 bytes (fields joined by `\n`, no trailing newline):

```text
commoncircle-invite-v1
<this contract's account id>
<circle_id as decimal>
<caller account id (the redeemer)>
<invite_public_key exactly as registered>
```

The contract id and the fixed tag stop a signature being replayed on another
deployment (deviation D-001). An invite is deleted when redeemed (single use). One
passport per account per circle; an account that ever held one in a circle cannot
redeem another there. At redeem time the inviter must still be the founder or
hold an Active passport; otherwise the invite fails with `E34_NOT_INVITER`.

## 4. Loan rules the UI must reflect

- Borrower and lender both need an **Active** passport in the circle, at
  `create_loan` and again at funding. The exception is the circle's `treasury_id`
  (the DAO after `attach_dao`) as lender.
- Treasury loans need all of: a DAO attached, at least 2 Active Steward passports,
  a borrower with effective Trusted tier who is not a Steward.
- Lender cannot be the borrower.
- Amount: `min_amount <= amount <= cap`, where cap is `trusted_max_amount` for
  effective Trusted and `member_max_amount` otherwise, and always `<= hard_loan_cap`.
- `1 <= duration_days <= max_duration_days`.
- Open loans per borrower per circle: 1 at Member, 2 at effective Trusted. A loan is
  open unless it is Repaid, Cancelled, or Open past its funding window.
- Effective Trusted = tier Trusted and no overdue loan as borrower in that circle
  (an overdue loan whose flag was cleared does not count).
- The term starts at funding: `due_at = funded_at + duration_days * day_length_sec`.
- Repayment can come from anyone, in parts. Excess is returned.
- A revoked, suspended or expired passport stops new loans, funding and chat; open
  loans stay payable.

### Loan states (`get_loan().state`)

| State | Meaning |
| --- | --- |
| `Open` | Created, waiting for funding, window not lapsed |
| `Funding` | Funding transfer in flight (blocks double-funding) |
| `Funded` | Forward to borrower confirmed |
| `Repaying` | A repayment transfer is in flight |
| `Repaid` | Fully repaid; `repaid_on_time` says whether by `due_at` |
| `Cancelled` | Cancelled by borrower (`cancel_reason: "Borrower"`) or window lapsed (`"Lapsed"`, derived, no cron) |
| `WrittenOff` | Treasury loan written off by the DAO; still payable; full repayment gives `Repaid` (late) |

`overdue` is a derived boolean, never a state.

## 5. Funding and repaying with `ft_transfer_call`

The member (or vault, or DAO) calls the **USDC contract**:

```text
<usdc_id>.ft_transfer_call({
  receiver_id: "<circle contract id>",
  amount: "<U128>",
  msg: "<JSON string, see below>"
})
deposit: 1 yoctoNEAR    gas: 150 Tgas (recommended; provisional)
```

The sender must be registered with USDC (`storage_deposit`). The borrower must be
registered to receive funding; the lender must be registered to receive repayment.
If a receiver is not registered, the forward fails and the sender gets the full
amount back.

`msg` schemas (full detail in `docs/MSG_SCHEMA.md`):

```json
{"action":"fund","loan_id":"7"}
{"action":"fund","loan_id":"7","lender_id":"alice.testnet"}
{"action":"repay","loan_id":"7"}
```

The second form is only for the pinned vault, which names the lender it acts for.

Funding is accepted only when all of these hold; otherwise the **full amount is
refunded** and the loan does not change:

- caller is the pinned USDC contract;
- the loan is `Open` and inside its funding window;
- `amount` equals the principal exactly;
- the sender is the named lender, or the pinned vault with `lender_id` equal to the
  named lender, or the circle treasury when the treasury is the named lender;
- passport and treasury rules in section 4 still hold;
- the attached gas is at least the minimum (else it panics early and USDC refunds).

Repayment is accepted from any sender while the loan is `Funded` or `WrittenOff`.
`min(amount, outstanding)` is forwarded to the lender; the rest is returned as unused.
If the forward to the lender fails, the full amount is returned and nothing changes.

Final state commits only in the private callback after the forward succeeds. The
circle contract's USDC balance is zero at rest.

## 6. Views (all free, no deposit)

| View | Returns |
| --- | --- |
| `get_config()` | `ConfigView` |
| `storage_costs()` | `{ create_circle, register_invite, redeem_invite, create_loan }`, each U128 yoctoNEAR (upper bound; excess refunded) |
| `get_circle(circle_id)` | `CircleView \| null` |
| `get_loan(loan_id)` | `LoanView \| null` |
| `loans_by_borrower(account_id, from_index?, limit?)` | `LoanView[]` (all circles) |
| `loans_by_lender(account_id, from_index?, limit?)` | `LoanView[]` (all circles; includes treasury loans for a DAO id) |
| `loans_in_circle(circle_id, from_index?, limit?)` | `LoanView[]` |
| `passport_for(circle_id, account_id)` | `PassportView \| null` |
| `passports_in_circle(circle_id, from_index?, limit?)` | `PassportView[]` |
| `check_access(circle_id, account_id)` | `AccessView` |
| `get_invite(invite_public_key)` | `InviteView \| null` (for the relayer and the join screen) |
| `card_svg(token_id)` | `string \| null`: the raw SVG, the same image as the token's `media` data URI |
| `nft_token(token_id)` | NEP-171 `Token \| null` with NEP-177 metadata |
| `nft_metadata()` | NEP-177 contract metadata (`spec: "nft-2.0.0"`, `name: "CommonCircle Passport"`, `symbol: "CCPASS"`) |
| `nft_total_supply()` | U128 |
| `nft_tokens(from_index?: U128, limit?: number)` | `Token[]` (NEP-181 types) |
| `nft_supply_for_owner(account_id)` | U128 |
| `nft_tokens_for_owner(account_id, from_index?: U128, limit?: number)` | `Token[]` |
| `nft_is_approved(token_id, approved_account_id, approval_id?)` | always `false` |

### 6.1 View shapes

```ts
type ConfigView = {
  interface_version: "1.0.0";
  usdc_id: string; vault_id: string;
  hard_loan_cap: string;                    // U128
  floors: { funding_window_sec: string; qualifying_duration_sec: string;
            recovery_lock_sec: string; day_length_sec: string };
  gas: { min_ft_on_transfer: string;        // Tgas as U64 string
         recommended_ft_transfer_call: string };
  features: { recovery: boolean };
};

type CircleView = {
  circle_id: string; name: string;
  founder_id: string; admin_id: string;     // admin == founder until attach_dao
  treasury_id: string | null;               // the DAO after attach_dao
  dao_attached: boolean;
  created_at: string;                       // ns
  params: CircleParams;                     // section 3.1, same field names
  member_count: number;                     // passports ever issued here (any status)
  steward_count: number;                    // stewards whose passport is Active now
  loan_count: number;
  treasury_lending_enabled: boolean;        // dao_attached && steward_count >= 2
};

type LoanView = {
  loan_id: string; circle_id: string;
  borrower_id: string; lender_id: string;
  lender_is_treasury: boolean;
  principal: string; total_repaid: string; outstanding: string;   // U128
  duration_days: number; duration_sec: string;
  created_at: string; funding_deadline: string;                   // ns
  funded_at: string | null; due_at: string | null; repaid_at: string | null;
  state: "Open" | "Funding" | "Funded" | "Repaying" | "Repaid" | "Cancelled" | "WrittenOff";
  cancel_reason: "Borrower" | "Lapsed" | null;
  funded_via: "Lender" | "Vault" | "Treasury" | null;
  overdue: boolean;                         // derived
  repaid_on_time: boolean | null;
  qualifying: boolean | null;               // counted toward Trusted (set at full repayment)
  flag_cleared: boolean;
};

type PassportView = {
  token_id: string; circle_id: string; owner_id: string;
  tier: "Member" | "Trusted";               // earned; never goes down
  steward: boolean;
  display_tier: "Member" | "Trusted" | "Steward";
  status: "Active" | "Suspended" | "Revoked" | "Expired";   // Expired is derived from expires_at
  expires_at: string | null;
  joined_at: string; invited_by: string | null;
  on_time_count: number; late_count: number;
  qualifying_count: number; distinct_lenders: number;
  open_loans: number; overdue_loans: number;                 // derived
  perks_paused: boolean;                    // tier Trusted with an uncleared overdue loan
  effective_tier: "Member" | "Trusted";
  recovery: { new_account_id: string; unlocks_at: string } | null;
};

type AccessView = {
  allowed: boolean;                         // chat and new agreements
  reason: "Active" | "NoPassport" | "Suspended" | "Revoked" | "Expired" | "NoCircle";
  token_id: string | null;
  display_tier: "Member" | "Trusted" | "Steward" | null;
};

type InviteView = {
  circle_id: string; invite_public_key: string;
  inviter_id: string; invitee_id: string | null;
  expires_at: string; expired: boolean;
};
```

NEP-177 token metadata: `title` = `"CommonCircle Passport #<circle_id>"`,
`description` = fixed text with the display tier and status, `media` =
`data:image/svg+xml;base64,<svg>`, `media_hash` = null, `copies` = 1,
`issued_at` = join time in ms as a string. No personal data in the art; it is
derived only from circle id, display tier, status and the on-time and late counts.

## 7. Events (NEP-297)

Every state change logs `EVENT_JSON:{"standard":"commoncircle","version":"1.0.0","event":<name>,"data":[...]}`.
Passport mint and burn also log the standard `nep171` `nft_mint` / `nft_burn`
events so explorers index them. Payload fields are in `docs/EVENTS.md`.

Event names: `circle_created`, `dao_attached`, `invite_registered`,
`invite_redeemed`, `passport_status_changed`, `passport_expiry_set`,
`steward_set`, `tier_changed`, `loan_created`, `loan_cancelled`,
`loan_funding_started`, `loan_funded`, `loan_funding_failed`,
`loan_repayment_started`, `loan_repayment`, `loan_repaid`,
`loan_repayment_failed`, `loan_written_off`, `flag_cleared`,
`transfer_refunded` (not a state change: a rejected `ft_on_transfer` and its
reason code), `recovery_started`, `recovery_cancelled`, `recovery_completed`.

The server indexes these events and nothing else.

## 8. Typical flows for the web app

1. **Create circle**: read `storage_costs()`, call `create_circle` with that deposit.
2. **Invite**: generate an ed25519 key pair in the browser; call `register_invite`
   with the public key and the invitee's account id; share a link holding the
   secret key (WhatsApp share). Never send the secret to the server.
3. **Join**: the invitee opens the link, signs the canonical message (section 3.2)
   locally with the invite secret, calls `redeem_invite`. The relayer may sponsor
   gas (other lane).
4. **Borrow**: `create_loan` naming one lender. Show `funding_deadline`.
5. **Fund**: lender calls `ft_transfer_call` on USDC with `{"action":"fund",...}`.
   Check the result: the returned unused amount is `"0"` on success; otherwise read
   `transfer_refunded` / `loan_funding_failed` from the receipt logs.
6. **Repay**: anyone calls `ft_transfer_call` with `{"action":"repay",...}`.
7. **Access**: the server calls `check_access` before returning messages.

## 9. Error codes

| Code | Plain meaning for the UI |
| --- | --- |
| `E01_NOT_FOUND` | That circle, loan or passport does not exist. |
| `E02_DEPOSIT` | Attach more NEAR for storage (see `storage_costs`). |
| `E03_ONE_YOCTO` | Attach exactly 1 yoctoNEAR (wallet confirmation). |
| `E04_BAD_PARAMS` | A circle setting is out of range or below the network floor. |
| `E05_NOT_ADMIN` | Only the circle admin (founder, or the DAO once attached) can do this. |
| `E06_DAO_ALREADY_ATTACHED` | The circle already has its DAO. |
| `E10_NO_PASSPORT` | You need an active passport in this circle. |
| `E11_LENDER_NO_PASSPORT` | The lender needs an active passport in this circle. |
| `E12_NOT_NAMED_LENDER` | Only the named lender can fund this loan. (In `ft_on_transfer` this is a refund reason, not a panic.) |
| `E13_SELF_LOAN` | You cannot lend to yourself. |
| `E14_AMOUNT_OUT_OF_RANGE` | The amount is outside this circle's limits. |
| `E15_DURATION_OUT_OF_RANGE` | The loan length is outside this circle's limits. |
| `E16_OPEN_LOAN_LIMIT` | You already have the most open loans your tier allows. |
| `E17_WRONG_STATE` | The loan is not in a state that allows this. |
| `E18_WINDOW_LAPSED` | The funding window has closed. |
| `E19_TREASURY_RULES` | Treasury loans need a Trusted, non-steward borrower and at least 2 stewards. |
| `E20_NOT_BORROWER` | Only the borrower can do this. |
| `E30_INVITE_NOT_FOUND` | This invite does not exist or was already used. |
| `E31_INVITE_EXPIRED` | This invite has expired. |
| `E32_INVITE_WRONG_ACCOUNT` | This invite is for a different account. |
| `E33_INVITE_BAD_SIGNATURE` | The invite link is invalid. |
| `E34_NOT_INVITER` | Only the founder or a Trusted member can invite. |
| `E35_ALREADY_MEMBER` | You already have (or had) a passport in this circle. |
| `E36_INVITE_EXISTS` | That invite key is already registered. |
| `E40_NON_TRANSFERABLE` | Passports cannot be transferred or approved. |
| `E50_RECOVERY_DISABLED` | Recovery is not available in this deployment. |
| `E51_RECOVERY_LOCKED` | Recovery is still time-locked. |
| `E60_LOW_GAS` | Not enough gas attached; the transfer was refunded. |

Refund reasons in `transfer_refunded` reuse these codes plus
`E70_WRONG_TOKEN`, `E71_BAD_MSG`, `E72_WRONG_AMOUNT`, `E73_IN_FLIGHT`.
