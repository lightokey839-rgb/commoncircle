# Ship checklist (needs the builder's explicit approval, step by step)

Nothing here has been run by the lead. Every step is either irreversible or public.
Testnet only: no step touches mainnet. Run from `work/commoncircle-contracts` in Git Bash
(or PowerShell wrapped as in `HANDOFF.md`).

## 1. Final testnet state (read-only, safe any time)

```bash
node contracts/scripts/check-testnet.mjs
node contracts/scripts/near-view.mjs commoncircle-light.testnet view_account
curl -s https://test.rpc.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"commoncircle-light.testnet"}}'
```

Expected: code hash `J4X6efoAqFoKVYxaSNtpDYUTyKrKDzrqa2vPZxvMLxGr`, interface 1.1.1,
circle USDC balance 0, and **1 full-access key** (as of 13 Nov 2026 00:45 UTC).

## 2. Decide on the contract's full-access key (irreversible)

What the key means today: whoever holds it can redeploy different code to
`commoncircle-light.testnet` at any time, so nothing may call the contract "immutable"
or "locked" while it exists.

If it is deleted:

- nobody can upgrade or fix the contract again, including bugs found later;
- `recovery` stays disabled for ever (it is switched off in this build);
- the DAO keeps its admin powers over circle 3 (it acts by proposal, not by key);
- demo circles 1 and 2 keep the founder as admin (an account key, not the contract key).

Procedure (only after "yes, delete the contract key" from the builder):

1. List the keys (step 1) and copy the exact public key shown.
2. `near account delete-keys commoncircle-light.testnet public-keys <ed25519:…> network-config testnet sign-with-keychain send`
   (not run by the lead; check the exact form with `near account delete-keys --help` for the installed near-cli-rs first)
3. List the keys again: the list must be empty. Record the tx hash in `docs/VERIFICATION.md` and flip the README row "List the access keys on the contract account".

Never run `near account export-account` (it prints the secret key).

## 3. Code hash

The hash on chain must equal the reproducible build tested in CI (run `43059776368`):
`J4X6efoAqFoKVYxaSNtpDYUTyKrKDzrqa2vPZxvMLxGr`. If the contract source changes, a new
`SPEC_DEVIATIONS.md` entry, a full CI run and a new hash are required first.

## 4. Evidence refresh (read-only)

```bash
node contracts/scripts/build-evidence.mjs && npm run claims && npm run claims:test
```

Commit `evidence/`, `EVIDENCE.md`, `README.md` (track table) and `web/evidence-status.json`.

## 5. Push and CI (needs approval: pushes to the private remote)

```bash
git -c safe.directory=* -c credential.helper= -c 'credential.helper=!gh auth git-credential' push private lane/web-polish
```

Then fast-forward `lane/web` and `lane/contracts` (see `HANDOFF.md`) and check the
"CommonCircle Gate 1" workflow (Rust unit, sandbox, red-team, README rows, Sputnik,
reproducible wasm, online claims). The lead cannot run the Rust suites on this PC.

## 6. Backend (chat, loan requests, sign-in)

`server/auth.ts` runs locally (`npm run auth`). Its nonces are in memory and its chat
and request history are JSON files in `server/.data/`. A public deployment needs a host,
`AUTH_JWT_SECRET`, `APP_DOMAIN`, `ALLOWED_ORIGINS` and a durable store; none is set up.
Without it, a public copy of the app shows "Chat and loan requests need the sign-in
server, which is not hosted for this public copy" and everything else still works.

## 7. Public front end (needs approval: changes repository visibility)

GitHub Pages cannot serve the private repository. At ship: make the repository public,
then run the manual `deploy-pages.yml` workflow (it uploads `web/dist`).

## 8. Submission

Repository link, hosted app link (or local run instructions), the video (< 2:20),
the X post (@NEARProtocol, #NEARHackathon), tracks: NFTs That Do Something, Social Money,
Open Innovation.
