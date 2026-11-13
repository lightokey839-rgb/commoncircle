> **HISTORICAL — LoanBook (Arc/EVM), October 2026.** This file describes the earlier LoanBook app this repository started from (tag `baseline-loanbook-port`). It is kept for the record and is **not** about CommonCircle on NEAR. Current documents: `README.md`, `STATUS.md`, `docs/VERIFICATION.md`, `docs/SHIP_CHECKLIST.md`, `docs/DEMO_SCRIPT.md`.

# What is left

1. Deploy the tested additive SQL upgrade to the existing Loanbook Supabase project; validate and deploy the receipt verifier.
2. Configure native Web3 auth and the final HTTPS origin, then test Alice/Bob/Charlie with live Supabase and two separate browsers.
3. Test a complete community request → onchain creation → approval/funding → repayment → verified database status cycle on testnet. Test refresh/reconnect and rejected signatures.
4. Upload the reviewed source changes into the existing `codex/loanbook-release-candidate` branch in lightokey839-rgb/Loanbook without replacing history, configure CI/hosting, and publish a public app. Inform the user of the exact destinations first. Verify repository visibility and publication eligibility.
5. Finish/rehearse safe mainnet deployment automation, review contract bytecode/verification and security, then request user approval for deployment and a 0.01 USDC demonstration between two user-controlled wallets.
6. Record the video, fill real app/contract/transaction links, confirm competition requirements and submit.

User involvement: hosting/GitHub authorization only if the connected permissions are insufficient; real wallet connection/signatures; explicit mainnet approval. All other remaining engineering work can continue without asking the user to run commands.
