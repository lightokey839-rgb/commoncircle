import { readFile } from "node:fs/promises";
import process from "node:process";

const path = process.argv[2] ?? "evidence/evidence.json";
const document = JSON.parse(await readFile(path, "utf8"));
const claims = Array.isArray(document.claims) ? document.claims : [];

const rows = claims.map((claim) => ({
  id: claim.id ?? "-",
  status: claim.status ?? "UNVERIFIED",
  claim: claim.claim ?? "-",
  evidence: Array.isArray(claim.evidence) ? claim.evidence.length : 0,
}));

if (rows.length === 0) {
  console.log("No claims recorded.");
} else {
  console.table(rows);
}
