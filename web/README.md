# CommonCircle web scaffold

This directory is the ops/web handoff surface for the frozen
`docs/CIRCLE_INTERFACE.md` 1.0.0 interface supplied by the contracts lane.

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
  views, caller-controlled pagination, passport card SVG, and NEP-171 metadata
  views. The visible creation forms use labelled testnet DEMO parameters only.
- `demo.ts` provides a wallet-free read-only mode against testnet contract
  `commoncircle-light.testnet` via `https://test.rpc.fastnear.com`. The contract
  code hash handoff is `3tF3gbHWdjhoSfMe2KDHrP7TSCEPAXNZh8dm9q97JrB8`; no
  circle currently exists, so an empty-circle response is expected rather than
  treated as a successful product claim.
- `server/relayer.ts` is the F4 authorization core: it verifies a current
  on-chain invite and its canonical signature, or an active passport, restricts
  receivers/methods to the configured circle/vault/USDC allowlist, and reserves
  configurable per-account and total UTC-day budgets. It does not contain a
  private key or submit transactions.
- `nep413.ts` performs the nonce → wallet `signMessage` → server verification
  flow. The server receives the signed challenge, never an invite secret.
- `index.html`, `app.ts`, and `styles.css` are the join-by-invite and “my
  positions” screen scaffold. A wallet adapter is injected as
  `window.commonCircleWallet`; the host build can provide the real wallet
  selector without changing the typed contract client.

This is a scaffold, not evidence of a deployed contract. The contract lane has
not yet compiled or tested the interface, and the screen must stay labelled as
such until the corresponding evidence rows pass.
