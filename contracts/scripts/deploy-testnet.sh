#!/usr/bin/env bash
# CommonCircle circle contract: idempotent TESTNET deploy (Gate 1 phase 1E).
#
# Runs in Git Bash (Windows), WSL or Linux. Needs: near-cli-rs (`near`), node,
# curl, sha256sum. Keys are created by near-cli-rs and saved in YOUR OS
# keychain / ~/.near-credentials, never in this repo or its logs.
#
# Usage:
#   CIRCLE_ACCOUNT_ID=commoncircle-<you>.testnet \
#   WASM=path/to/commoncircle_circle.wasm \
#   EXPECTED_SHA256=<sha256 from the reproducible CI build> \
#   ./contracts/scripts/deploy-testnet.sh
#
# REDEPLOY=1: if the contract is already initialised but runs other code,
# deploy the new wasm in place WITHOUT calling init (state is kept). Only valid
# while the account still has its key (testnet); never after key deletion.
#
# Optional: VAULT_ACCOUNT_ID (default vault.$CIRCLE_ACCOUNT_ID),
# HARD_LOAN_CAP (default 50000000 = 50 USDC), NEAR_TESTNET_RPC_URL (default A6
# FastNEAR), EXPECTED_CODE_HASH (base58; checked if set).
#
# Every step checks chain state first and is skipped if already done, so it is
# safe to re-run after a failure.
set -euo pipefail

NETWORK=testnet
USDC_ID="3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af"
RPC="${NEAR_TESTNET_RPC_URL:-https://test.rpc.fastnear.com}"
: "${CIRCLE_ACCOUNT_ID:?set CIRCLE_ACCOUNT_ID, e.g. commoncircle-yourname.testnet}"
: "${WASM:?set WASM to the circle wasm path}"
: "${EXPECTED_SHA256:?set EXPECTED_SHA256 to the recorded wasm sha256}"
C="$CIRCLE_ACCOUNT_ID"
VAULT="${VAULT_ACCOUNT_ID:-vault.$C}"
CAP="${HARD_LOAN_CAP:-50000000}"

say() { printf '\n== %s\n' "$*"; }

rpc() { # rpc <method> <params-json>
  curl -s "$RPC" -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":\"cc\",\"method\":\"$1\",\"params\":$2}"
}

view() { # view <account> <method> <args-json>  -> prints decoded JSON result or "ERROR ..."
  local args_b64
  args_b64=$(printf '%s' "$3" | base64 | tr -d '\n')
  rpc query "{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$args_b64\"}" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);if(r.result&&r.result.result){process.stdout.write(Buffer.from(r.result.result).toString())}else{process.stdout.write("ERROR "+JSON.stringify(r.error||r.result))}})'
}

account_exists() {
  rpc query "{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}" | grep -q '"amount"'
}

code_hash() {
  rpc query "{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);process.stdout.write((r.result&&r.result.code_hash)||"none")})'
}

say "1/6 Check the wasm"
ACTUAL_SHA=$(sha256sum "$WASM" | cut -d' ' -f1)
echo "sha256 $ACTUAL_SHA"
[ "$ACTUAL_SHA" = "$EXPECTED_SHA256" ] || { echo "STOP: wasm sha256 does not match EXPECTED_SHA256"; exit 1; }

say "2/6 Circle account $C"
if account_exists "$C"; then
  echo "exists, skipping creation"
else
  near account create-account sponsor-by-faucet-service "$C" \
    autogenerate-new-keypair --signature-scheme ed25519 save-to-keychain network-config "$NETWORK" create
fi

say "3/6 Vault account $VAULT (reserved now so nobody else can take the pinned id)"
if account_exists "$VAULT"; then
  echo "exists, skipping creation"
else
  near account create-account fund-myself "$VAULT" '0.1 NEAR' \
    autogenerate-new-keypair --signature-scheme ed25519 save-to-keychain sign-as "$C" \
    network-config "$NETWORK" sign-with-keychain send
fi

INIT_ARGS=$(node -e '
const [usdc,vault,cap]=process.argv.slice(1);
process.stdout.write(JSON.stringify({usdc_id:usdc,vault_id:vault,hard_loan_cap:cap,
  floors:{funding_window_sec:"0",qualifying_duration_sec:"0",recovery_lock_sec:"0",day_length_sec:"0"}}));
' "$USDC_ID" "$VAULT" "$CAP")

say "4/6 Deploy and init"
CONFIG=$(view "$C" get_config '{}')
if [[ "$CONFIG" != ERROR* ]]; then
  CUR=$(code_hash "$C")
  if [ -n "${EXPECTED_CODE_HASH:-}" ] && [ "$CUR" != "$EXPECTED_CODE_HASH" ] && [ "${REDEPLOY:-0}" = 1 ]; then
    echo "initialised with code $CUR; REDEPLOY=1: deploying new code in place (no init)"
    near contract deploy "$C" use-file "$WASM" without-init-call       network-config "$NETWORK" sign-with-keychain send
  else
    echo "already initialised (code $CUR), skipping deploy"
  fi
elif [ "$(code_hash "$C")" != "11111111111111111111111111111111" ]; then
  echo "code present but not initialised: calling new"
  near contract call-function as-transaction "$C" new json-args "$INIT_ARGS" \
    prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as "$C" \
    network-config "$NETWORK" sign-with-keychain send
else
  near contract deploy "$C" use-file "$WASM" with-init-call new json-args "$INIT_ARGS" \
    prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
    network-config "$NETWORK" sign-with-keychain send
fi

say "5/6 Register the circle with USDC"
REG=$(view "$USDC_ID" storage_balance_of "{\"account_id\":\"$C\"}")
if [[ "$REG" != ERROR* && "$REG" != "null" ]]; then
  echo "already registered: $REG"
else
  near contract call-function as-transaction "$USDC_ID" storage_deposit \
    json-args "{\"account_id\":\"$C\",\"registration_only\":true}" \
    prepaid-gas '30.0 Tgas' attached-deposit '0.00125 NEAR' sign-as "$C" \
    network-config "$NETWORK" sign-with-keychain send
fi

say "6/6 Verify by view"
CONFIG=$(view "$C" get_config '{}')
echo "get_config: $CONFIG"
HASH=$(code_hash "$C")
echo "code_hash: $HASH"
REG=$(view "$USDC_ID" storage_balance_of "{\"account_id\":\"$C\"}")
echo "usdc storage_balance_of: $REG"
BAL=$(view "$USDC_ID" ft_balance_of "{\"account_id\":\"$C\"}")
echo "usdc ft_balance_of: $BAL"
node -e '
const [cfg,usdc,vault,cap,reg,bal,hash,want]=process.argv.slice(1);
const c=JSON.parse(cfg); const fail=[];
if(c.usdc_id!==usdc) fail.push("usdc_id");
if(c.vault_id!==vault) fail.push("vault_id");
if(c.hard_loan_cap!==cap) fail.push("hard_loan_cap");
if(reg==="null"||reg.startsWith("ERROR")) fail.push("usdc registration");
if(bal!=="\"0\"") fail.push("circle USDC balance is not zero");
if(want && hash!==want) fail.push("code hash != EXPECTED_CODE_HASH");
if(fail.length){console.log("VERIFY FAILED: "+fail.join(", "));process.exit(1)}
console.log("VERIFY OK");
' "$CONFIG" "$USDC_ID" "$VAULT" "$CAP" "$REG" "$BAL" "$HASH" "${EXPECTED_CODE_HASH:-}"
echo
echo "Paste everything from '== 1/6' to 'VERIFY OK' back to the contracts lane."
echo "It contains account ids and hashes only; no keys are printed."
