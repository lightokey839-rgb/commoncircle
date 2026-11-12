#!/usr/bin/env node
// Read one view over RPC and print it (optionally save it as an evidence snapshot).
//
//   node contracts/scripts/near-view.mjs <account> <method> [args-json] [--snapshot path]
//   node contracts/scripts/near-view.mjs <account> view_account [--snapshot path]
//
// `view_account` is a pseudo-method: it saves the account's code hash, global
// contract hash and its access-key count (0 = nobody holds a key to it).
// Read-only; no keys. RPC: NEAR_RPC_URL or https://test.rpc.fastnear.com.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const si = args.indexOf("--snapshot");
const snapshotPath = si === -1 ? undefined : args.splice(si, 2)[1];
const [account, method, json = "{}"] = args;
if (!account || !method) {
  console.error("usage: near-view.mjs <account> <method> [args-json] [--snapshot path]");
  process.exit(2);
}
const RPC = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";

async function rpc(m, params) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "cc", method: m, params }),
      });
      const body = await res.json();
      if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 300));
      return body.result;
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

let result, block_height;
if (method === "view_account") {
  const a = await rpc("query", { request_type: "view_account", finality: "final", account_id: account });
  const k = await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: account });
  block_height = a.block_height;
  result = {
    code_hash: a.code_hash,
    global_contract_hash: a.global_contract_hash ?? null,
    storage_usage: a.storage_usage,
    key_count: k.keys.length,
    full_access_key_count: k.keys.filter((x) => x.access_key.permission === "FullAccess").length,
  };
} else {
  const r = await rpc("query", {
    request_type: "call_function",
    finality: "final",
    account_id: account,
    method_name: method,
    args_base64: Buffer.from(json).toString("base64"),
  });
  block_height = r.block_height;
  result = JSON.parse(Buffer.from(r.result).toString());
}

const snapshot = {
  network: RPC.includes("test") ? "testnet" : "mainnet",
  account_id: account,
  method,
  args: JSON.parse(json),
  block_height,
  result,
  rpc: RPC,
  read_at: new Date().toISOString(),
};
console.log(JSON.stringify(result, null, 2));
if (snapshotPath) {
  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n");
  console.error(`snapshot written: ${snapshotPath}`);
}
