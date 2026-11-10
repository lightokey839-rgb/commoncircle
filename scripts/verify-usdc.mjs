#!/usr/bin/env node

// Read-only Gate 1 check for the two USDC contracts pinned by the v3 spec.
// No account, key, seed, or token is used by this script.

const CONTRACTS = [
  {
    network: "mainnet",
    accountId:
      process.env.USDC_MAINNET_ID ??
      "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    rpcUrl: process.env.NEAR_MAINNET_RPC_URL ?? process.env.NEAR_RPC_URL,
  },
  {
    network: "testnet",
    accountId:
      process.env.USDC_TESTNET_ID ??
      "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
    rpcUrl: process.env.NEAR_TESTNET_RPC_URL ?? process.env.NEAR_RPC_URL,
  },
];

const timeoutMs = Number(process.env.NEAR_RPC_TIMEOUT_MS ?? 20_000);

async function viewFunction(rpcUrl, accountId, methodName) {
  if (!rpcUrl) {
    throw new Error(
      `missing RPC URL for this network; set NEAR_RPC_URL, NEAR_MAINNET_RPC_URL, or NEAR_TESTNET_RPC_URL`,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "commoncircle-usdc-check",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: accountId,
          method_name: methodName,
          args_base64: Buffer.from("{}", "utf8").toString("base64"),
        },
      }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok || payload.error) {
      throw new Error(JSON.stringify(payload.error ?? { status: response.status }));
    }
    const bytes = payload.result?.result;
    if (!Array.isArray(bytes)) {
      throw new Error("RPC response omitted result bytes");
    }
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } finally {
    clearTimeout(timer);
  }
}

for (const contract of CONTRACTS) {
  console.log(`== ${contract.network} ${contract.accountId} ==`);
  try {
    const metadata = await viewFunction(contract.rpcUrl, contract.accountId, "ft_metadata");
    const bounds = await viewFunction(
      contract.rpcUrl,
      contract.accountId,
      "storage_balance_bounds",
    );
    console.log(JSON.stringify({ network: contract.network, metadata, storage_balance_bounds: bounds }));
    if (metadata.symbol !== "USDC" || metadata.decimals !== 6) {
      throw new Error("unexpected USDC metadata: expected symbol USDC and decimals 6");
    }
  } catch (error) {
    console.error(`${contract.network}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
