import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "commoncircle-claims-"));
const script = path.resolve("scripts/claims.mjs");
const evidenceDir = path.join(root, "evidence", "snapshots");
await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(root, "README.md"), "# claims fixture\n");
await writeFile(path.join(evidenceDir, "loan.json"), JSON.stringify({ hash: "tx-good", success: true }));

const baseClaim = {
  id: "claim-loan",
  track: "Open Innovation",
  feature: "F0",
  network: "testnet",
  kind: "tx",
  reference: { snapshot: "evidence/snapshots/loan.json" },
  expected: { hash: "tx-good", success: true },
};
const evidencePath = path.join(root, "evidence", "evidence.json");
await writeFile(path.join(root, "evidence", "evidence.json"), JSON.stringify({ schema_version: "v3", claims: [baseClaim] }));
execFileSync(process.execPath, [script], { cwd: root, stdio: "pipe" });

await writeFile(evidencePath, JSON.stringify({
  schema_version: "v3",
  claims: [{ ...baseClaim, expected: { hash: "tx-wrong", success: true } }],
}));
let failed = false;
try {
  execFileSync(process.execPath, [script], { cwd: root, stdio: "pipe" });
} catch {
  failed = true;
}
await rm(root, { recursive: true, force: true });
if (!failed) throw new Error("claims harness accepted a wrong expected transaction hash");
console.log("claims self-test passed: valid evidence accepted and wrong hash rejected");
