# CommonCircle web scaffold

This directory is the ops/web handoff surface for the live testnet
`docs/CIRCLE_INTERFACE.md` 1.1.0 interface supplied by the contracts lane.

- `circle-client.ts` contains typed JSON-RPC views and the invite transaction
  wrapper. U64/U128 values remain decimal strings; no money is converted to a
  JavaScript number.
- `invite.ts` generates an Ed25519 key pair in WebCrypto, registers the public
  key, and puts only the private secret in the URL fragment of a share link.
- `CircleClient.fundLoan`, `fundLoanFromVault`, and `repayLoan` send the exact
  NEP-141 `ft_transfer_call` messages with 1 yoctoNEAR and 150 Tgas. Their
  result parser exposes unused amounts and the CommonCircle funding/refund/
  repayment events without treating a UI submission as proof of finality.
- The client exposes circle/loan creation, cancellation, all core loan/passport
  views, caller-controlled pagination, passport card SVG, NEP-171 metadata
  views, and per-circle passport themes. The visible creation forms use
  labelled testnet DEMO parameters only.
- `demo.ts` provides a wallet-free read-only mode against testnet contract
  `commoncircle-light.testnet` via `https://test.rpc.fastnear.com`. The contract
  code hash handoff for interface 1.1.0 is
  `CCYR2EZ87by5MX65Ci1V49EVqhF93p8ymwFa6LeH9whm`; the default screen is the
  read-only circle 2 **The Dogs (DEMO)** with passport cards.
- `server/relayer.ts` is the F4 authorization core: it verifies a current
  on-chain invite and its canonical signature, or an active passport, restricts
  receivers/methods to the configured circle/vault/USDC allowlist, and reserves
  configurable per-account and total UTC-day budgets. It does not contain a
  private key or submit transactions.
- `nep413.ts` performs the nonce → wallet `signMessage` → server verification
  flow. The server receives the signed challenge, never an invite secret.
- `index.html`, `app.ts`, `styles.css`, and `theme.ts` are the join-by-invite,
  theme-editor, chat-gate, passport-card, request-to-fund, and “my positions”
  screen scaffold. A wallet adapter is injected as
  `window.commonCircleWallet`; the host build can provide the real wallet
  selector without changing the typed contract client.

This is a scaffold, not a claim that a user transaction succeeded. The
read-only demo is explicitly labelled, and transaction finality still needs
receipt evidence from the contract lane before it is called a live pilot.
