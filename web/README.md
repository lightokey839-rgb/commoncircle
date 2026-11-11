# CommonCircle web scaffold

This directory is the ops/web handoff surface for the frozen
`docs/CIRCLE_INTERFACE.md` 1.0.0 interface supplied by the contracts lane.

- `circle-client.ts` contains typed JSON-RPC views and the invite transaction
  wrapper. U64/U128 values remain decimal strings; no money is converted to a
  JavaScript number.
- `nep413.ts` performs the nonce → wallet `signMessage` → server verification
  flow. The server receives the signed challenge, never an invite secret.
- `index.html`, `app.ts`, and `styles.css` are the join-by-invite and “my
  positions” screen scaffold. A wallet adapter is injected as
  `window.commonCircleWallet`; the host build can provide the real wallet
  selector without changing the typed contract client.

This is a scaffold, not evidence of a deployed contract. The contract lane has
not yet compiled or tested the interface, and the screen must stay labelled as
such until the corresponding evidence rows pass.
