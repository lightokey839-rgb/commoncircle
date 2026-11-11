#!/usr/bin/env node
// Read-only check of the live CommonCircle testnet deployment. No wallet, no keys.
//
//   node contracts/scripts/check-testnet.mjs
//
// Prints PASS/FAIL lines for: contract code hash, interface version, the circle's
// USDC balance (must be 0: loans never rest in the contract), the demo circles,
// a Trusted passport and its NFT metadata, and the access keys on the contract
// account (still present until ship; reported, not hidden).
import process from "node:process";

const RPC = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const CIRCLE = process.env.CIRCLE_ACCOUNT_ID ?? "commoncircle-light.testnet";
const USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const EXPECTED_CODE_HASH = "J4X6efoAqFoKVYxaSNtpDYUTyKrKDzrqa2vPZxvMLxGr"; // interface 1.1.1, CI run 43059776368
const DEMO_CIRCLE = "3";
const TRUSTED = "commoncircle-light-borrower3.testnet";

async function rpc(method, params) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "cc", method, params }),
      });
      const body = await res.json();
      if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 200));
      return body.result;
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}
const view = async (account_id, method_name, args = {}) => {
  const r = await rpc("query", {
    request_type: "call_function",
    finality: "final",
    account_id,
    method_name,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString());
};

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`);
};

const acct = await rpc("query", { request_type: "view_account", finality: "final", account_id: CIRCLE });
check("contract code hash is the tested reproducible build", acct.code_hash === EXPECTED_CODE_HASH, acct.code_hash);

const cfg = await view(CIRCLE, "get_config");
check("interface version", cfg.interface_version === "1.1.1", cfg.interface_version);
check("pinned token is Circle testnet USDC", cfg.usdc_id === USDC, cfg.usdc_id);

const bal = await view(USDC, "ft_balance_of", { account_id: CIRCLE });
check("contract holds zero USDC (loans never rest here)", bal === "0", `${bal}`);

for (const id of ["1", "2", DEMO_CIRCLE]) {
  const c = await view(CIRCLE, "get_circle", { circle_id: id });
  check(`circle ${id} readable`, !!c, c ? `"${c.name}", ${c.member_count} members, ${c.loan_count} loans, DAO ${c.dao_attached ? c.treasury_id : "not attached"}` : "missing");
}

const p = await view(CIRCLE, "passport_for", { circle_id: DEMO_CIRCLE, account_id: TRUSTED });
check("passport tier written by an on-time repayment", p?.tier === "Trusted", p ? `${p.token_id} ${p.tier}, on time ${p.on_time_count}, late ${p.late_count ?? 0}` : "missing");
const t = await view(CIRCLE, "nft_token", { token_id: `${DEMO_CIRCLE}:${TRUSTED}` });
check("NEP-171 token metadata shows the tier", /Tier: Trusted/.test(t?.metadata?.description ?? ""), t?.metadata?.title);

const keys = await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: CIRCLE });
const full = keys.keys.filter((k) => k.access_key.permission === "FullAccess").length;
console.log(`INFO  contract account full-access keys: ${full} (the builder can upgrade this testnet contract until they are deleted at ship)`);

console.log(failed ? `\n${failed} check(s) failed` : "\nALL CHECKS PASS");
process.exit(failed ? 1 : 0);
