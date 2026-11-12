#!/usr/bin/env node
// Read one NEAR transaction over RPC and print what happened, receipt by receipt.
//
//   node contracts/scripts/near-tx.mjs <tx_hash> <sender_id> [--snapshot evidence/snapshots/x.json] [--json]
//
// Shows, for every receipt: predecessor -> receiver, method, attached gas (Tgas),
// attached deposit, success or error, and EVENT_JSON events. Also reports
// deposit refunds the contract sent back to the signer (F-01 check: on interface
// 1.1.1 the refund must be smaller than the deposit for a state-growing call).
//
// Read-only. Needs no keys. RPC: NEAR_RPC_URL or https://test.rpc.fastnear.com.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const snapshotPath = flag("--snapshot");
const asJson = args.includes("--json");
const [hash, sender] = args.filter((a) => a !== "--json");
if (!hash || !sender) {
  console.error("usage: near-tx.mjs <tx_hash> <sender_id> [--snapshot path] [--json]");
  process.exit(2);
}
const RPC = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";

async function rpc(method, params) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "cc", method, params }),
    });
    const body = await res.json();
    if (body.error && attempt < 4 && /TIMEOUT|UNKNOWN_TRANSACTION/i.test(JSON.stringify(body.error))) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    return body.result;
  }
}

const tgas = (g) => Math.round(Number(g) / 1e10) / 100; // 2 decimals
const near = (y) => {
  const v = BigInt(y ?? 0);
  const whole = v / 10n ** 24n;
  const frac = (v % 10n ** 24n).toString().padStart(24, "0").slice(0, 6);
  return `${whole}.${frac}`;
};

function describeStatus(status) {
  if (!status) return { ok: null, error: "unknown" };
  if ("SuccessValue" in status || "SuccessReceiptId" in status) {
    let value = null;
    if (status.SuccessValue) {
      try {
        value = Buffer.from(status.SuccessValue, "base64").toString();
      } catch {
        value = status.SuccessValue;
      }
    }
    return { ok: true, value };
  }
  if ("Failure" in status) {
    const f = JSON.stringify(status.Failure);
    const m = f.match(/E\d\d_[A-Z_]+[^"\\]*/);
    const exec = f.match(/"ExecutionError":"((?:[^"\\]|\\.)*)"/);
    return { ok: false, error: m ? m[0] : exec ? exec[1] : f.slice(0, 300) };
  }
  return { ok: null, error: JSON.stringify(status).slice(0, 200) };
}

function actionsSummary(actions) {
  return (actions ?? []).map((a) => {
    if (typeof a === "string") return { type: a };
    const [type, body] = Object.entries(a)[0];
    if (type === "FunctionCall") {
      return { type, method: body.method_name, gas_tgas: tgas(body.gas), deposit: body.deposit };
    }
    if (type === "Transfer") return { type, deposit: body.deposit };
    return { type };
  });
}

function events(logs) {
  const out = [];
  for (const l of logs ?? []) {
    if (!l.startsWith("EVENT_JSON:")) continue;
    try {
      out.push(JSON.parse(l.slice("EVENT_JSON:".length)));
    } catch {
      out.push({ unparsed: l });
    }
  }
  return out;
}

const r = await rpc("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" });
const tx = r.transaction;
const receiptById = new Map((r.receipts ?? []).map((x) => [x.receipt_id, x]));

// The transaction itself only converts into its first receipt (listed below),
// so it is not printed as a row of its own.
const rows = [];
for (const ro of r.receipts_outcome) {
  const rc = receiptById.get(ro.id);
  const action = rc?.receipt?.Action;
  rows.push({
    receipt_id: ro.id,
    predecessor: rc?.predecessor_id ?? "?",
    receiver: rc?.receiver_id ?? ro.outcome.executor_id,
    actions: actionsSummary(action?.actions),
    ...describeStatus(ro.outcome.status),
    gas_burnt_tgas: tgas(ro.outcome.gas_burnt),
    logs: ro.outcome.logs,
    events: events(ro.outcome.logs),
    kind: "receipt",
    block_hash: ro.block_hash,
  });
}

// Storage growth of the receiving contract across the blocks where its receipts
// ran (state before the first such block vs after the last). F-01: on 1.1.1 the
// NEAR kept from the deposit must cover this growth. Needs the RPC to still hold
// those blocks (non-archival nodes keep a few days).
async function storageGrowth(account) {
  const blocks = rows.filter((x) => x.receiver === account && x.predecessor !== "system").map((x) => x.block_hash);
  if (!blocks.length) return null;
  try {
    const first = await rpc("block", { block_id: blocks[0] });
    const view = (block_id) => rpc("query", { request_type: "view_account", account_id: account, block_id });
    const before = await view(first.header.prev_hash);
    const after = await view(blocks[blocks.length - 1]);
    const cost = await rpc("EXPERIMENTAL_protocol_config", { finality: "final" });
    const perByte = BigInt(cost.runtime_config.storage_amount_per_byte);
    const bytes = after.storage_usage - before.storage_usage;
    return { account, bytes, cost_yocto: (BigInt(bytes) * perByte).toString(), note: "other txs in the same blocks would also count" };
  } catch (e) {
    return { account, error: String(e.message ?? e).slice(0, 200) };
  }
}

// Deposits attached by the signer, and NEAR the contracts sent back to the signer
// (excluding the protocol's gas refunds, whose predecessor is "system").
const attached = (tx.actions ?? []).reduce((sum, a) => {
  const body = a.FunctionCall ?? a.Transfer;
  return sum + BigInt(body?.deposit ?? 0);
}, 0n);
const refunds = rows
  .filter((x) => x.kind === "receipt" && x.receiver === tx.signer_id && x.predecessor !== "system")
  .flatMap((x) => x.actions.filter((a) => a.type === "Transfer").map((a) => BigInt(a.deposit)));
const refunded = refunds.reduce((a, b) => a + b, 0n);

const overall = describeStatus(r.status);
const allEvents = rows.flatMap((x) => x.events);
const failures = rows.filter((x) => x.ok === false).map((x) => ({ receiver: x.receiver, error: x.error }));
const fnCalls = rows.flatMap((x) =>
  x.actions
    .filter((a) => a.type === "FunctionCall")
    .map((a) => ({ receiver: x.receiver, predecessor: x.predecessor, method: a.method, gas_tgas: a.gas_tgas, ok: x.ok })),
);

// 1 yoctoNEAR is the NEP-141 security deposit, not a storage payment.
const growth = attached > 1n ? await storageGrowth(tx.receiver_id) : null;
const kept = attached - refunded;
let storageVerdict = null;
if (growth && growth.bytes !== undefined) {
  storageVerdict = kept >= BigInt(growth.cost_yocto) ? "deposit covers storage growth" : "STORAGE SUBSIDISED by the contract";
}

// Order-free summaries, so evidence rows can match on them (the claims harness
// compares arrays position by position).
const hasEvent = Object.fromEntries(allEvents.filter((e) => e.event).map((e) => [e.event, true]));
const errorCodes = {};
for (const f of [...failures.map((x) => x.error), overall.ok ? "" : overall.error]) {
  const m = String(f ?? "").match(/E\d\d_[A-Z_]+/);
  if (m) errorCodes[m[0]] = true;
}
for (const e of allEvents) {
  for (const d of e.data ?? []) if (typeof d?.reason === "string" && /^E\d\d_/.test(d.reason)) errorCodes[d.reason] = true;
}
const refundMemo = allEvents.some((e) => e.event === "ft_transfer" && (e.data ?? []).some((d) => d.memo === "refund"));
const gasAt = {};
for (const f of fnCalls) if (!(f.method in gasAt)) gasAt[f.method] = f.gas_tgas;

const snapshot = {
  network: RPC.includes("test") ? "testnet" : "mainnet",
  tx_hash: tx.hash,
  signer_id: tx.signer_id,
  receiver_id: tx.receiver_id,
  final_execution_status: r.final_execution_status,
  status: overall.ok ? "success" : "failure",
  error: overall.ok ? null : overall.error,
  attached_deposit: attached.toString(),
  refunded_to_signer: refunded.toString(),
  storage_kept: kept.toString(),
  storage_growth: growth,
  storage_verdict: storageVerdict,
  has_event: hasEvent,
  error_codes: errorCodes,
  refund_memo: refundMemo,
  gas_at_tgas: gasAt,
  function_calls: fnCalls,
  receipt_failures: failures,
  events: allEvents,
  rpc: RPC,
  read_at: new Date().toISOString(),
};

if (asJson) {
  console.log(JSON.stringify(snapshot, null, 2));
} else {
  console.log(`tx ${tx.hash}  ${tx.signer_id} -> ${tx.receiver_id}`);
  console.log(`final: ${r.final_execution_status}  outcome: ${overall.ok ? "SUCCESS" : "FAILURE " + overall.error}`);
  for (const x of rows) {
    const acts = x.actions
      .map((a) =>
        a.type === "FunctionCall"
          ? `${a.method}(gas ${a.gas_tgas} Tgas, deposit ${a.deposit})`
          : a.type === "Transfer"
            ? `Transfer ${near(a.deposit)} NEAR`
            : a.type,
      )
      .join(", ");
    const st = x.ok === true ? "ok" : x.ok === false ? `FAILED ${x.error}` : "?";
    console.log(`  ${x.predecessor} -> ${x.receiver}: ${acts}  [${st}, burnt ${x.gas_burnt_tgas} Tgas]`);
    for (const e of x.events) console.log(`      event ${e.standard ?? ""} ${e.event ?? ""} ${JSON.stringify(e.data ?? e).slice(0, 220)}`);
  }
  console.log(`deposit attached ${near(attached)} NEAR; refunded to signer ${near(refunded)} NEAR; kept ${near(kept)} NEAR`);
  if (growth?.error) console.log(`storage growth of ${growth.account}: not readable (${growth.error})`);
  else if (growth) {
    console.log(`storage growth of ${growth.account}: ${growth.bytes} bytes = ${near(growth.cost_yocto)} NEAR -> ${storageVerdict}`);
  }
}

if (snapshotPath) {
  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n");
  console.error(`snapshot written: ${snapshotPath}`);
}
