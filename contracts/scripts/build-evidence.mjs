#!/usr/bin/env node
// Tier A evidence rows (Open Innovation, NFTs That Do Something, Social Money).
//
//   node contracts/scripts/build-evidence.mjs        # re-read every row from testnet, write snapshots + evidence.json
//   npm run claims                                   # compare each snapshot with its `expected`
//
// Running this script is the online check: every tx and view snapshot is
// fetched again from FastNEAR, so `npm run claims` afterwards compares the
// claims with what the chain says now. Test rows point at the committed CI
// report evidence/reports/ci-43108982043-rust.json.
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const C = "commoncircle-light.testnet";
const DAO = "dogs-dao.commoncircle-light.testnet";
const USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const LENDER = "commoncircle-light-lender.testnet";
const STEWARD = "commoncircle-light-steward.testnet";
const B3 = "commoncircle-light-borrower3.testnet";
const CI = "evidence/reports/ci-43108982043-rust.json";
const SPUTNIK = "Ea8tHXFSQVszVwGASyzAfLq65DjcRDhkfab4FcPaRpgD";

const OI = "Open Innovation", NFT = "NFTs That Do Something", SM = "Social Money";
const F0 = "Loans that never rest in the contract; every failure refunds", F1 = "Passport NFT written by repayments; gates credit", F2 = "Sputnik DAO treasury lends to Trusted members by proposal";

const tx = (id, track, feature, hash, signer, expected) => ({ id, track, feature, kind: "tx", hash, signer, expected });
const view = (id, track, feature, account, method, args, expected) => ({ id, track, feature, kind: "view", account, method, args, expected });
const test = (id, track, feature, names) => ({
  id, track, feature, kind: "test", reference: { report: CI },
  expected: { tests: Object.fromEntries(names.map((n) => [n, "ok"])) },
});
const ok = { final_execution_status: "FINAL", status: "success" };

const rows = [
  // Open Innovation: F0 on interface 1.1.1 (circle 3)
  view("f0-code-hash", OI, F0, C, "view_account", {}, { result: { code_hash: "J4X6efoAqFoKVYxaSNtpDYUTyKrKDzrqa2vPZxvMLxGr" } }),
  view("f0-interface", OI, F0, C, "get_config", {}, { result: { interface_version: "1.1.1", usdc_id: USDC } }),
  tx("f0-refund", OI, F0, "9eRRis9rGq1QFjYWdAr7E627HXvtHvEjmnQEwjJQ9B2K", LENDER,
    { ...ok, has_event: { loan_funding_failed: true }, refund_memo: true }),
  tx("f0-fund", OI, F0, "CyYFrPZW2P8iaWKKzFEa3e6wrYfsJJT8HDzzjtRnDxKn", LENDER, { ...ok, has_event: { loan_funded: true } }),
  tx("f0-repay", OI, F0, "2d42VciE6yCvsXmZ4SPBkrGqnezaseEgv8eYHn8HJv1Q", B3, { ...ok, has_event: { loan_repaid: true } }),
  tx("f0-storage-charged", OI, F0, "9bR1fvUPNYqvAgg18uuYhpiNSNt4akvcGygxVjuHAzr8", LENDER,
    { ...ok, storage_verdict: "deposit covers storage growth" }),
  tx("f0-low-gas-real-usdc", OI, F0, "DiMweYz7TbTGGVdraXFcjZm3y7352J2LBFPop3hsMuNj", LENDER,
    { ...ok, error_codes: { E60_LOW_GAS: true }, refund_memo: true }),
  view("f0-zero-balance", OI, F0, USDC, "ft_balance_of", { account_id: C }, { result: "0" }),
  test("f0-sandbox", OI, F0, ["readme_checks::fund_to_an_unregistered_borrower", "sandbox_f0::f0_low_gas_fails_early_and_is_refunded",
    "redteam::rt_contract_never_subsidises_storage"]),

  // NFTs That Do Something: F1
  tx("f1-tier-flip", NFT, F1, "2d42VciE6yCvsXmZ4SPBkrGqnezaseEgv8eYHn8HJv1Q", B3, { ...ok, has_event: { tier_changed: true } }),
  view("f1-passport", NFT, F1, C, "passport_for", { circle_id: "3", account_id: B3 },
    { result: { tier: "Trusted", effective_tier: "Trusted", status: "Active", steward: false } }),
  view("f1-card", NFT, F1, C, "nft_token", { token_id: `3:${B3}` }, { result: { owner_id: B3, metadata: { title: "The Dogs (DEMO) Passport" } } }),
  test("f1-gates", NFT, F1, ["readme_checks::try_nft_transfer_on_a_passport", "readme_checks::create_a_loan_naming_a_non_member"]),

  // Social Money: F2
  view("f2-dao-by-hash-locked", SM, F2, DAO, "view_account", {}, { result: { global_contract_hash: SPUTNIK, key_count: 0 } }),
  view("f2-dao-council", SM, F2, DAO, "get_policy", {}, {
    // Sputnik keeps the council as a set; this is the order it returns for this policy.
    result: { roles: [{ name: "stewards", kind: { Group: [STEWARD, LENDER] } }], default_vote_policy: { threshold: [1, 2] } },
  }),
  tx("f2-attach", SM, F2, "2zYZ7zxQw8S9w121k1hHvYjcG3vLaz68iipNv4M5iduR", LENDER, { ...ok, has_event: { dao_attached: true } }),
  view("f2-circle", SM, F2, C, "get_circle", { circle_id: "3" },
    { result: { admin_id: DAO, treasury_id: DAO, dao_attached: true, steward_count: 2, treasury_lending_enabled: true } }),
  tx("f2-steward-refused", SM, F2, "J7XZHt17De96uBniiMWwHdzoA8tSc2X7cDJ8PxdRmuMd", LENDER,
    { final_execution_status: "FINAL", status: "failure", error_codes: { E19_TREASURY_RULES: true } }),
  tx("f2-proposal-funds-loan", SM, F2, "3dYZEiVpvXFGRPjte9TvCFsKPhPstqJTS4th8Cv8je1r", STEWARD,
    { ...ok, has_event: { loan_funded: true } }),
  view("f2-proposal", SM, F2, DAO, "get_proposal", { id: 3 },
    { result: { proposer: B3, status: "Approved", kind: { Transfer: { receiver_id: C, amount: "1000000" } } } }),
  tx("f2-treasury-repaid", SM, F2, "BtakkTRfz1iEgJEHoz4YRG39K4PBrJVMfKwzG1C3xC5r", B3, { ...ok, has_event: { loan_repaid: true } }),
  view("f2-treasury-loan", SM, F2, C, "get_loan", { loan_id: "6" },
    { result: { lender_id: DAO, funded_via: "Treasury", state: "Repaid", repaid_on_time: true } }),
  tx("f2-approved-but-not-trusted", SM, F2, "AmBADVeLJJqM66KSP1eRjGhqH8cHQD5zRNz5WPv3qpvQ", STEWARD,
    { ...ok, error_codes: { E19_TREASURY_RULES: true }, refund_memo: true }),
  tx("f2-dao-clears-flag", SM, F2, "43mAx3pTTjTDFDVfpZrGBVwfDSJZHZ12xoUDuA3HVtTk", STEWARD, { ...ok, has_event: { flag_cleared: true } }),
  test("f2-sandbox", SM, F2, ["sandbox_sputnik::sputnik_function_call_proposal_funds_a_treasury_loan",
    "sandbox_sputnik::sputnik_transfer_with_msg_funds_or_leaves_the_treasury_whole",
    "readme_checks::treasury_loan_for_a_steward_or_with_fewer_than_two_stewards", "redteam::rt_dao_cannot_take_a_passport_or_count_as_steward"]),
];

const claims = [];
for (const r of rows) {
  if (r.kind === "test") {
    claims.push({ id: r.id, track: r.track, feature: r.feature, network: "testnet", kind: "test", reference: r.reference, expected: r.expected });
    continue;
  }
  const snapshot = `evidence/snapshots/${r.id}.json`;
  const argv = r.kind === "tx"
    ? [join(here, "near-tx.mjs"), r.hash, r.signer, "--json", "--snapshot", snapshot]
    : [join(here, "near-view.mjs"), r.account, r.method, JSON.stringify(r.args), "--snapshot", snapshot];
  execFileSync(process.execPath, argv, { stdio: ["ignore", "ignore", "inherit"] });
  const reference = r.kind === "tx"
    ? { tx_hash: r.hash, signer_id: r.signer, explorer: `https://testnet.nearblocks.io/txns/${r.hash}`, snapshot }
    : { account_id: r.account, method: r.method, args: r.args, snapshot };
  claims.push({ id: r.id, track: r.track, feature: r.feature, network: "testnet", kind: r.kind, reference, expected: r.expected });
}

const doc = { schema_version: "A9", project: "CommonCircle", generated_at: new Date().toISOString(), claims };
await writeFile("evidence/evidence.json", JSON.stringify(doc, null, 2) + "\n");
console.log(`wrote evidence/evidence.json with ${claims.length} rows`);
