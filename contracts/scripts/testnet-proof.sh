#!/usr/bin/env bash
# CommonCircle F0 refund proof on TESTNET (v3: "Proven on testnet before it is claimed").
#
#   ./contracts/scripts/testnet-proof.sh setup   # create lender + borrower accounts, register lender with USDC
#   (get testnet USDC from Circle's faucet into the LENDER account)
#   ./contracts/scripts/testnet-proof.sh run     # DEMO circle, invite, loan, failed-forward refund, fund, repay
#
# Runs in Git Bash / WSL / Linux with near-cli-rs, node, curl. Keys are created
# by near-cli-rs in your OS keychain; this script never prints or stores keys.
# Every transaction hash is printed and also appended to ~/commoncircle-deploy/proof-hashes.txt.
set -euo pipefail

CIRCLE="${CIRCLE_ACCOUNT_ID:-commoncircle-light.testnet}"
LENDER="${LENDER_ACCOUNT_ID:-commoncircle-light-lender.testnet}"
BORROWER="${BORROWER_ACCOUNT_ID:-commoncircle-light-borrower.testnet}"
USDC_ID="3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af"
RPC="${NEAR_TESTNET_RPC_URL:-https://test.rpc.fastnear.com}"
AMOUNT=1000000            # 1 USDC (6 decimals)
OUT="$HOME/commoncircle-deploy"; mkdir -p "$OUT"
LOG="$OUT/proof-hashes.txt"

say() { printf '\n== %s\n' "$*"; }
rpc() { curl -s --max-time 30 "$RPC" -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":\"cc\",\"method\":\"$1\",\"params\":$2}"; }
view() { # view <account> <method> <args-json> -> JSON text or "null"/"ERROR ..."
  local b; b=$(printf '%s' "$3" | base64 | tr -d '\n')
  rpc query "{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$b\"}" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);if(r.result&&r.result.result){process.stdout.write(Buffer.from(r.result.result).toString())}else{process.stdout.write("ERROR "+JSON.stringify(r.error||r.result))}})'
}
exists() { rpc query "{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}" | grep -q '"amount"'; }
usdc_balance() { view "$USDC_ID" ft_balance_of "{\"account_id\":\"$1\"}" | tr -d '"'; }

# tx <label> <near args...>: run a near-cli-rs command, print and log its tx hash and EVENT_JSON lines.
tx() {
  local label="$1"; shift
  local out rc=0; out=$(near "$@" 2>&1) || rc=$?
  if [ "$rc" != 0 ]; then
    if [ "${SOFT:-0}" = 1 ]; then echo "   (near-cli exit $rc: an inner receipt failed; checking balances instead)";
    else echo "$out"; echo "STOP: '$label' failed"; exit 1; fi
  fi
  local hash; hash=$(printf '%s\n' "$out" | grep -oE 'Transaction ID: [1-9A-HJ-NP-Za-km-z]+' | head -1 | cut -d' ' -f3)
  printf '%s\n' "$out" | grep -oE 'EVENT_JSON:.*' | sed 's/^/   /' || true
  echo "   tx $label: ${hash:-<none>}"
  echo "$(date -u +%FT%TZ) $label $hash" >> "$LOG"
}

call() { # call <label> <signer> <contract> <method> <json> <deposit> [gas]
  tx "$1" contract call-function as-transaction "$3" "$4" json-args "$5" \
    prepaid-gas "${7:-150.0 Tgas}" attached-deposit "$6" sign-as "$2" \
    network-config testnet sign-with-keychain send
}

next_id() { # next_id <view> <argname> -> first id whose view returns null
  local i=1; while :; do
    local r; r=$(view "$CIRCLE" "$1" "{\"$2\":\"$i\"}")
    [ "$r" = "null" ] && { echo "$i"; return; }
    [[ "$r" == ERROR* ]] && { echo "STOP: view $1 failed: $r" >&2; exit 1; }
    i=$((i+1))
  done
}

setup() {
  for a in "$LENDER" "$BORROWER"; do
    say "Account $a"
    if exists "$a"; then echo "exists"; else
      tx "create $a" account create-account sponsor-by-faucet-service "$a" \
        autogenerate-new-keypair --signature-scheme ed25519 save-to-keychain network-config testnet create
    fi
  done
  say "Register the lender with testnet USDC (the borrower stays UNREGISTERED on purpose)"
  if [ "$(view "$USDC_ID" storage_balance_of "{\"account_id\":\"$LENDER\"}")" = "null" ]; then
    call "usdc register lender" "$LENDER" "$USDC_ID" storage_deposit \
      "{\"account_id\":\"$LENDER\",\"registration_only\":true}" '0.00125 NEAR' '30.0 Tgas'
  else echo "already registered"; fi
  echo
  echo "NEXT: open https://faucet.circle.com , choose USDC and network NEAR Testnet,"
  echo "      paste this address: $LENDER  (needs at least 1 USDC), then run: $0 run"
}

run() {
  say "0 Preconditions"
  local lb; lb=$(usdc_balance "$LENDER"); echo "lender USDC: $lb"
  [ "${lb:-0}" -ge "$AMOUNT" ] 2>/dev/null || { echo "STOP: lender needs >= 1 USDC from the faucet"; exit 1; }
  [ "$(view "$USDC_ID" storage_balance_of "{\"account_id\":\"$BORROWER\"}")" = "null" ] ||
    { echo "STOP: borrower is already registered with USDC; set BORROWER_ACCOUNT_ID to a fresh account"; exit 1; }
  echo "circle USDC: $(usdc_balance "$CIRCLE")"

  say "1 Lender creates a DEMO circle (60-second days, 1-hour funding window, pilot N=1)"
  local cid; cid=$(next_id get_circle circle_id)
  local cost; cost=$(view "$CIRCLE" storage_costs '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);console.log(c.create_circle, c.register_invite, c.redeem_invite, c.create_loan)})')
  read -r C_CIRCLE C_INVITE C_REDEEM C_LOAN <<<"$cost"
  local params='{"min_amount":"1000000","member_max_amount":"10000000","trusted_max_amount":"20000000","max_duration_days":7,"day_length_sec":"60","funding_window_sec":"3600","qualifying_min_amount":"1000000","qualifying_min_days":1,"trusted_threshold":1,"min_distinct_lenders":1,"recovery_lock_sec":"0","writeoff_grace_sec":"600"}'
  call "create_circle $cid" "$LENDER" "$CIRCLE" create_circle "{\"name\":\"DEMO testnet proof\",\"params\":$params}" "$C_CIRCLE yoctoNEAR"

  say "2 Named invite for the borrower; borrower redeems it"
  local inv; inv=$(node -e '
    const crypto=require("crypto");
    const A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const b58=b=>{let n=BigInt("0x"+Buffer.from(b).toString("hex")),s="";while(n>0n){s=A[Number(n%58n)]+s;n/=58n}for(const x of b){if(x===0)s="1"+s;else break}return s};
    const [contract,cid,caller]=process.argv.slice(1);
    const {publicKey,privateKey}=crypto.generateKeyPairSync("ed25519");
    const pk="ed25519:"+b58(publicKey.export({format:"der",type:"spki"}).subarray(-32));
    const msg=["commoncircle-invite-v1",contract,cid,caller,pk].join("\n");
    const sig=crypto.sign(null,Buffer.from(msg),privateKey).toString("base64");
    process.stdout.write(pk+" "+sig);' "$CIRCLE" "$cid" "$BORROWER")
  local pk="${inv%% *}" sig="${inv##* }"   # throwaway invite key; the secret never leaves this process
  local exp; exp=$(node -e 'process.stdout.write(String(BigInt(Date.now()+86400000)*1000000n))')
  call "register_invite" "$LENDER" "$CIRCLE" register_invite \
    "{\"circle_id\":\"$cid\",\"invite_public_key\":\"$pk\",\"expires_at\":\"$exp\",\"invitee_id\":\"$BORROWER\"}" "$C_INVITE yoctoNEAR"
  call "redeem_invite" "$BORROWER" "$CIRCLE" redeem_invite \
    "{\"circle_id\":\"$cid\",\"invite_public_key\":\"$pk\",\"signature\":\"$sig\"}" "$C_REDEEM yoctoNEAR"

  say "3 Borrower creates a 1 USDC, 1-day loan naming the lender"
  local lid; lid=$(next_id get_loan loan_id)
  call "create_loan $lid" "$BORROWER" "$CIRCLE" create_loan \
    "{\"circle_id\":\"$cid\",\"lender_id\":\"$LENDER\",\"amount\":\"$AMOUNT\",\"duration_days\":1}" "$C_LOAN yoctoNEAR"

  local fund="{\"receiver_id\":\"$CIRCLE\",\"amount\":\"$AMOUNT\",\"msg\":\"{\\\"action\\\":\\\"fund\\\",\\\"loan_id\\\":\\\"$lid\\\"}\"}"
  local repay="{\"receiver_id\":\"$CIRCLE\",\"amount\":\"$AMOUNT\",\"msg\":\"{\\\"action\\\":\\\"repay\\\",\\\"loan_id\\\":\\\"$lid\\\"}\"}"

  say "4 PROOF: fund while the borrower is NOT registered with USDC -> forward fails, lender refunded"
  local before; before=$(usdc_balance "$LENDER")
  SOFT=1 call "fund (borrower unregistered)" "$LENDER" "$USDC_ID" ft_transfer_call "$fund" '1 yoctoNEAR'
  local after; after=$(usdc_balance "$LENDER")
  echo "lender USDC before $before after $after; circle USDC $(usdc_balance "$CIRCLE"); loan state $(view "$CIRCLE" get_loan "{\"loan_id\":\"$lid\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).state))')"
  [ "$before" = "$after" ] || { echo "STOP: lender balance changed on a failed forward"; exit 1; }

  say "5 Borrower registers with USDC"
  call "usdc register borrower" "$BORROWER" "$USDC_ID" storage_deposit \
    "{\"account_id\":\"$BORROWER\",\"registration_only\":true}" '0.00125 NEAR' '30.0 Tgas'

  say "6 Lender funds again -> loan Funded, borrower receives 1 USDC"
  call "fund" "$LENDER" "$USDC_ID" ft_transfer_call "$fund" '1 yoctoNEAR'
  echo "borrower USDC $(usdc_balance "$BORROWER"); circle USDC $(usdc_balance "$CIRCLE")"

  say "7 Borrower repays in full -> Repaid on time, passport Trusted (N=1)"
  call "repay" "$BORROWER" "$USDC_ID" ft_transfer_call "$repay" '1 yoctoNEAR'

  say "8 Verify by view"
  local loan; loan=$(view "$CIRCLE" get_loan "{\"loan_id\":\"$lid\"}")
  local pass; pass=$(view "$CIRCLE" passport_for "{\"circle_id\":\"$cid\",\"account_id\":\"$BORROWER\"}")
  local cb; cb=$(usdc_balance "$CIRCLE")
  echo "loan: $loan"
  echo "passport: $(printf '%s' "$pass" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(JSON.stringify({token_id:p.token_id,tier:p.tier,on_time_count:p.on_time_count,status:p.status}))})')"
  echo "circle USDC: $cb   lender USDC: $(usdc_balance "$LENDER")"
  node -e '
    const [l,p,cb]=process.argv.slice(1); const loan=JSON.parse(l), pass=JSON.parse(p); const f=[];
    if(loan.state!=="Repaid") f.push("loan not Repaid");
    if(loan.repaid_on_time!==true) f.push("not on time");
    if(pass.tier!=="Trusted") f.push("passport not Trusted");
    if(cb!=="0") f.push("circle holds USDC");
    if(f.length){console.log("PROOF FAILED: "+f.join(", "));process.exit(1)} console.log("PROOF OK");' "$loan" "$pass" "$cb"
  echo
  echo "Token for the wallet check: $(printf '%s' "$pass" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token_id))') on $CIRCLE"
  echo "Paste everything from '== 0' to 'PROOF OK' to the contracts lane (hashes only, no keys). Log: $LOG"
}

case "${1:-}" in
  setup) setup ;;
  run) run ;;
  *) echo "usage: $0 setup|run"; exit 2 ;;
esac
