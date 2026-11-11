# `ft_transfer_call` msg schema (circle contract)

Interface: `docs/CIRCLE_INTERFACE.md` 1.0.0, section 5.
Status: matches the source in `contracts/circle/src/types.rs` (`TransferMsg`).
Not yet compiled or tested; see `STATUS.md`.

Funding and repayment use the pinned USDC contract's `ft_transfer_call`, with
`receiver_id` set to the circle contract and `msg` set to one of the JSON
strings below. `msg` is a **string** containing JSON, so it is escaped once inside
the outer call arguments.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `action` | `"fund"` or `"repay"` | yes | What the transfer is for |
| `loan_id` | U64 string | yes | The loan |
| `lender_id` | account id | fund only, optional | The lender the sender acts for (required when the sender is the vault) |

Unknown fields are ignored. Anything that does not parse is refunded with
`E71_BAD_MSG`.

## 1. Lender funds a loan

```json
{"action":"fund","loan_id":"7"}
```

Sender must be the loan's named `lender_id`. `amount` must equal the principal
exactly. Including `"lender_id"` is allowed if it names the sender.

## 2. Vault funds on a lender's behalf

```json
{"action":"fund","loan_id":"7","lender_id":"alice.testnet"}
```

Sender must be the vault pinned at init (`get_config().vault_id`), and
`lender_id` must equal the loan's named lender.

**Trust boundary:** the circle contract trusts the pinned vault to name the
lender honestly. It cannot check that the money came from that lender's
set-aside; it only checks that the sender is the vault and the named lender
matches the loan. A vault bug could fund a loan "on behalf of" a lender who
never agreed to it. The vault is pinned at init and cannot be changed, so this
trust is fixed and public. `contracts/vault` is still a scaffold in Gate 1.

## 3. Circle treasury (DAO) funds a treasury loan

```json
{"action":"fund","loan_id":"7"}
```

Sender must be the circle's `treasury_id` (the DAO after `attach_dao`), which
must also be the loan's `lender_id`. Treasury rules apply at funding time too:
at least 2 Active stewards, borrower effectively Trusted and not a steward.

### Sputnik DAO Transfer proposal with msg

v3 F2: a passed Transfer proposal with a `msg` makes the DAO call
`ft_transfer_call` itself. The proposal kind (Sputnik v2 `add_proposal`) is:

```json
{
  "proposal": {
    "description": "Treasury loan 7 to bob.testnet",
    "kind": {
      "Transfer": {
        "token_id": "<USDC contract id>",
        "receiver_id": "<circle contract id>",
        "amount": "10000000",
        "msg": "{\"action\":\"fund\",\"loan_id\":\"7\"}"
      }
    }
  }
}
```

Open, gate-2 check: v3 asks us to confirm that the gas Sputnik attaches to this
`ft_transfer_call` covers `MIN_GAS_FT_ON_TRANSFER` (70 Tgas at the receiver).
If it does not, the call fails early and the DAO is refunded; use a
`FunctionCall` proposal on the USDC contract with explicit gas (150 Tgas) and
1 yoctoNEAR instead:

```json
{
  "proposal": {
    "description": "Treasury loan 7 to bob.testnet (explicit gas)",
    "kind": {
      "FunctionCall": {
        "receiver_id": "<USDC contract id>",
        "actions": [{
          "method_name": "ft_transfer_call",
          "args": "<base64 of {\"receiver_id\":\"<circle>\",\"amount\":\"10000000\",\"msg\":\"{\\\"action\\\":\\\"fund\\\",\\\"loan_id\\\":\\\"7\\\"}\"}>",
          "deposit": "1",
          "gas": "150000000000000"
        }]
      }
    }
  }
}
```

Neither form has been run yet. Proof belongs to Gate 2 (`dao_proposal_passes`).

## 4. Anyone repays

```json
{"action":"repay","loan_id":"7"}
```

Any sender. The loan must be `Funded` (including `WrittenOff`).
`min(amount, outstanding)` goes to the lender; the rest is returned as unused.

## Gas and deposit

Attach exactly 1 yoctoNEAR and 150 Tgas (recommended) to `ft_transfer_call`.
Below 70 Tgas reaching the receiver, the circle panics with
`E60_LOW_GAS` and the token refunds. Both the sender and the receiver of the
forward must be registered with USDC (`storage_deposit`).
