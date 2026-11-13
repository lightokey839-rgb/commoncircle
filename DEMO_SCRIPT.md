> **HISTORICAL — LoanBook (Arc/EVM), October 2026.** This file describes the earlier LoanBook app this repository started from (tag `baseline-loanbook-port`). It is kept for the record and is **not** about CommonCircle on NEAR. Current documents: `README.md`, `STATUS.md`, `docs/VERIFICATION.md`, `docs/SHIP_CHECKLIST.md`, `docs/DEMO_SCRIPT.md`.

# Demo script — record only after live verification

1. Show the original Arc Studio project and identify the integrated improvements.
2. Alice connects and signs in, creates a lending circle, copies its invitation.
3. Bob opens the invite in a separate wallet/browser, signs in and joins.
4. Exchange chat messages; refresh to demonstrate persistence. Show Charlie cannot see the private circle.
5. Alice requests 0.01 USDC for one day. Bob offers to lend. Alice selects Bob and checks his full address.
6. Alice creates the onchain agreement. Show the confirmed transaction and matched loan ID.
7. Bob approves exactly 0.01 USDC then funds. Show verified funding and the direct transfer to Alice.
8. Alice approves exactly 0.01 USDC then repays. Show verified repayment and explorer evidence.
9. Show Direct Loan separately and explain zero interest, no collateral, no pooled custody, and nonpayment risk.

Rehearse on testnet first. For the required mainnet segment use two user-controlled wallets and reserve gas in both. Every mainnet transaction requires explicit user approval. 0.01 USDC is a proposed principal, not authorization. Capture only real confirmed hashes; no placeholder should be submitted as evidence. Video has not been recorded.
