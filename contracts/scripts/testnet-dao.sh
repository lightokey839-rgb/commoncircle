#!/usr/bin/env bash
# CommonCircle Gate 2 on TESTNET: a real Sputnik DAO lends from its treasury to a
# Trusted member by public proposal (Social Money: "reputation-based access on
# top of Sputnik DAO").
#
# Run the steps in order (each is safe to re-run; it skips what is already done):
#   ./contracts/scripts/testnet-dao.sh stewards   # steward account joins the circle; founder + steward become stewards
#   ./contracts/scripts/testnet-dao.sh dao        # DAO account from the Sputnik GLOBAL contract hash; USDC registered and seeded
#   CONFIRM_LOCK=yes ./contracts/scripts/testnet-dao.sh lock   # IRREVERSIBLE: delete the DAO account's keys (only proposals can move its money)
#   ./contracts/scripts/testnet-dao.sh attach     # founder hands admin + treasury to the DAO (founder powers end)
#   ./contracts/scripts/testnet-dao.sh refuse     # a steward asks the treasury for a loan -> E19_TREASURY_RULES
#   ./contracts/scripts/testnet-dao.sh loan       # the Trusted, non-steward member asks the treasury for 1 USDC
#   ./contracts/scripts/testnet-dao.sh propose    # the member files the Transfer-with-msg proposal (KIND=call for the FunctionCall form)
#   ./contracts/scripts/testnet-dao.sh vote       # both stewards approve; the DAO pays; the loan must be Funded
#   ./contracts/scripts/testnet-dao.sh lowgas     # F-16: fund with 40 Tgas against real USDC -> refused, lender unchanged
#   ./contracts/scripts/testnet-dao.sh repay [id] # the member repays (default: the last treasury loan) to the DAO
#   ./contracts/scripts/testnet-dao.sh clearflag <id>  # stewards vote; the DAO clears a late/overdue flag (F-09)
#   Treasury loans default to LOAN_DAYS=7: DEMO "days" are 60 s, so repay within 7 minutes of funding.
#   ./contracts/scripts/testnet-dao.sh status     # read-only summary
#
# Keys stay in the OS keychain (near-cli-rs). This script never prints or stores
# keys. Every tx hash goes to ~/commoncircle-deploy/proof-hashes.txt; step state
# (loan and proposal ids) goes to ~/commoncircle-deploy/dao-state.env.
set -euo pipefail

CIRCLE="${CIRCLE_ACCOUNT_ID:-commoncircle-light.testnet}"
CIRCLE_ID="${CIRCLE_ID:-3}"                                     # "The Dogs (DEMO)" circle created on interface 1.1.1
FOUNDER="${FOUNDER_ACCOUNT_ID:-commoncircle-light-lender.testnet}"
STEWARD="${STEWARD_ACCOUNT_ID:-commoncircle-light-steward.testnet}"
BORROWER="${BORROWER_ACCOUNT_ID:-commoncircle-light-borrower3.testnet}"
DAO="${DAO_ACCOUNT_ID:-dogs-dao.commoncircle-light.testnet}"
DAO_PARENT="${DAO_PARENT_ACCOUNT_ID:-commoncircle-light.testnet}"
# sputnikdao2 published on testnet as a global contract BY HASH (immutable).
# Checked 2026-11-11 over FastNEAR: view_global_contract_code returns 430308 bytes whose
# sha256 is this hash; exports new/add_proposal/act_proposal/get_policy; embeds "sputnikdao2".
SPUTNIK_HASH="${SPUTNIK_GLOBAL_HASH:-Ea8tHXFSQVszVwGASyzAfLq65DjcRDhkfab4FcPaRpgD}"
USDC_ID="3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af"
RPC="${NEAR_TESTNET_RPC_URL:-https://test.rpc.fastnear.com}"
AMOUNT=1000000          # 1 USDC
SEED=2000000            # 2 USDC seeded into the DAO treasury
BOND_YOCTO=100000000000000000000000   # 0.1 NEAR proposal bond (returned when the proposal passes)
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HOME/commoncircle-deploy"; mkdir -p "$OUT"
LOG="$OUT/proof-hashes.txt"
STATE="$OUT/dao-state.env"
[ -f "$STATE" ] && . "$STATE"

say() { printf '\n== %s\n' "$*"; }
save() { touch "$STATE"; grep -v "^$1=" "$STATE" > "$STATE.tmp" || true; echo "$1=$2" >> "$STATE.tmp"; mv "$STATE.tmp" "$STATE"; eval "$1=$2"; }
rpc() { # retries: public RPCs sometimes answer empty under load
  local out="" i
  for i in 1 2 3 4; do
    out=$(curl -s --max-time 20 "$RPC" -H 'content-type: application/json' \
      -d "{\"jsonrpc\":\"2.0\",\"id\":\"cc\",\"method\":\"$1\",\"params\":$2}" || true)
    [ -n "$out" ] && break; sleep $((i * 2))
  done
  printf '%s' "$out"
}
view() { # view <account> <method> <args-json> -> JSON text or "ERROR ..."
  local b; b=$(printf '%s' "$3" | base64 | tr -d '\n')
  rpc query "{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$b\"}" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let r;try{r=JSON.parse(s)}catch{process.stdout.write("ERROR rpc gave no answer");return}if(r.result&&r.result.result){process.stdout.write(Buffer.from(r.result.result).toString())}else{process.stdout.write("ERROR "+JSON.stringify(r.error||r.result))}})'
}
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v;try{v=JSON.parse(s)}catch{console.log("?");return}for(const k of process.argv[1].split("."))v=v==null?v:v[k];console.log(typeof v==="object"?JSON.stringify(v):String(v))})' "$1"; }
account_json() { rpc query "{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}"; }
exists() { account_json "$1" | grep -q '"amount"'; }
# An account deployed BY GLOBAL HASH may report the hash in global_contract_hash
# (code_hash then reads 1111…); report whichever is set.
code_hash() { account_json "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let r;try{r=JSON.parse(s).result}catch{}if(!r){console.log("none");return}const e="11111111111111111111111111111111";console.log(r.global_contract_hash||(r.code_hash!==e?r.code_hash:"none"))})'; }
usdc_balance() { view "$USDC_ID" ft_balance_of "{\"account_id\":\"$1\"}" | tr -d '"'; }
passport() { view "$CIRCLE" passport_for "{\"circle_id\":\"$CIRCLE_ID\",\"account_id\":\"$1\"}"; }
circle() { view "$CIRCLE" get_circle "{\"circle_id\":\"$CIRCLE_ID\"}"; }

LAST_HASH=""
# tx <label> <near args...>: run near-cli-rs, print + log the tx hash and EVENT_JSON lines.
# SOFT=1: a failing transaction is expected (refusal proofs); keep going.
tx() {
  local label="$1"; shift
  # A missing argument makes near-cli ask a question, which the captured output
  # hides (on Windows it reads the console directly). Give up after 3 minutes.
  local out rc=0; out=$(timeout 180 near "$@" 2>&1 </dev/null) || rc=$?
  if [ "$rc" = 124 ]; then
    echo "STOP: '$label' waited 3 minutes: near-cli is asking a question (a command argument is missing). Nothing was sent by this step; tell the lead."
    exit 1
  fi
  LAST_HASH=$(printf '%s\n' "$out" | grep -oE 'Transaction ID: [1-9A-HJ-NP-Za-km-z]+' | head -1 | cut -d' ' -f3 || true)
  if [ "$rc" != 0 ]; then
    if [ "${SOFT:-0}" = 1 ]; then echo "   (near-cli exit $rc: failure expected here)";
      [ -n "$LAST_HASH" ] || { echo "$out" | grep -vi 'secret\|private' | tail -15; }
    else echo "$out" | grep -vi 'secret\|private'; echo "STOP: '$label' failed"; exit 1; fi
  fi
  printf '%s\n' "$out" | grep -oE 'EVENT_JSON:.*' | sed 's/^/   /' || true
  echo "   tx $label: ${LAST_HASH:-<none>}"
  echo "$(date -u +%FT%TZ) $label ${LAST_HASH}" >> "$LOG"
}
call() { # call <label> <signer> <contract> <method> <json> <deposit> [gas]
  tx "$1" contract call-function as-transaction "$3" "$4" json-args "$5" \
    prepaid-gas "${7:-150.0 Tgas}" attached-deposit "$6" sign-as "$2" \
    network-config testnet sign-with-keychain send
}
inspect() { # inspect <hash> <sender>: independent read of the outcome over RPC
  [ -n "$1" ] && node "$HERE/near-tx.mjs" "$1" "$2" || echo "   (no tx hash captured; paste near-cli output to the lead)"
}
costs() { view "$CIRCLE" storage_costs '{}'; }
cost_of() { costs | jget "$1"; }
next_loan_id() {
  local i=1; while :; do
    local r; r=$(view "$CIRCLE" get_loan "{\"loan_id\":\"$i\"}")
    [ "$r" = "null" ] && { echo "$i"; return; }
    [[ "$r" == ERROR* ]] && { echo "STOP: get_loan failed: $r" >&2; exit 1; }
    i=$((i+1))
  done
}
need_iface() {
  local v; v=$(view "$CIRCLE" get_config '{}' | jget interface_version)
  [ "$v" = "1.1.1" ] || { echo "STOP: $CIRCLE runs interface $v, expected 1.1.1"; exit 1; }
}

stewards() {
  need_iface
  say "1 Steward account $STEWARD"
  if exists "$STEWARD"; then echo "exists"; else
    tx "create $STEWARD" account create-account sponsor-by-faucet-service "$STEWARD" \
      autogenerate-new-keypair --signature-scheme ed25519 save-to-keychain network-config testnet create
  fi

  say "2 Named invite into circle $CIRCLE_ID; the steward redeems it"
  if [ "$(passport "$STEWARD")" != "null" ]; then echo "already a member"; else
    local inv; inv=$(node -e '
      const crypto=require("crypto");
      const A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
      const b58=b=>{let n=BigInt("0x"+Buffer.from(b).toString("hex")),s="";while(n>0n){s=A[Number(n%58n)]+s;n/=58n}for(const x of b){if(x===0)s="1"+s;else break}return s};
      const [contract,cid,caller]=process.argv.slice(1);
      const {publicKey,privateKey}=crypto.generateKeyPairSync("ed25519");
      const pk="ed25519:"+b58(publicKey.export({format:"der",type:"spki"}).subarray(-32));
      const msg=["commoncircle-invite-v1",contract,cid,caller,pk].join("\n");
      process.stdout.write(pk+" "+crypto.sign(null,Buffer.from(msg),privateKey).toString("base64"));' "$CIRCLE" "$CIRCLE_ID" "$STEWARD")
    local pk="${inv%% *}" sig="${inv##* }"   # throwaway invite key; the secret never leaves node
    local exp; exp=$(node -e 'process.stdout.write(String(BigInt(Date.now()+86400000)*1000000n))')
    call "register_invite steward" "$FOUNDER" "$CIRCLE" register_invite \
      "{\"circle_id\":\"$CIRCLE_ID\",\"invite_public_key\":\"$pk\",\"expires_at\":\"$exp\",\"invitee_id\":\"$STEWARD\"}" "$(cost_of register_invite) yoctoNEAR"
    call "redeem_invite steward" "$STEWARD" "$CIRCLE" redeem_invite \
      "{\"circle_id\":\"$CIRCLE_ID\",\"invite_public_key\":\"$pk\",\"signature\":\"$sig\"}" "$(cost_of redeem_invite) yoctoNEAR"
  fi

  say "3 Founder appoints two stewards (only possible before attach_dao)"
  for s in "$FOUNDER" "$STEWARD"; do
    if [ "$(passport "$s" | jget steward)" = "true" ]; then echo "$s already a steward"; else
      call "set_steward $s" "$FOUNDER" "$CIRCLE" set_steward \
        "{\"circle_id\":\"$CIRCLE_ID\",\"account_id\":\"$s\",\"steward\":true}" '1 yoctoNEAR' '30.0 Tgas'
    fi
  done
  echo "steward_count: $(circle | jget steward_count)  borrower tier: $(passport "$BORROWER" | jget tier)  borrower steward: $(passport "$BORROWER" | jget steward)"
}

dao() {
  say "1 Confirm the Sputnik global contract on testnet"
  local glen; glen=$(rpc query "{\"request_type\":\"view_global_contract_code\",\"finality\":\"final\",\"code_hash\":\"$SPUTNIK_HASH\"}" | jget result.code_base64 | wc -c)
  [ "$glen" -gt 100000 ] || { echo "STOP: global contract $SPUTNIK_HASH not found on testnet"; exit 1; }
  echo "global contract $SPUTNIK_HASH present ($glen base64 chars)"

  say "2 DAO account $DAO (created by $DAO_PARENT with 1 NEAR for its state)"
  if exists "$DAO"; then echo "exists"; else
    tx "create $DAO" account create-account fund-myself "$DAO" '1 NEAR' autogenerate-new-keypair \
      --signature-scheme ed25519 save-to-keychain sign-as "$DAO_PARENT" network-config testnet sign-with-keychain send
  fi

  say "3 Deploy Sputnik by global hash and initialise: council = the two stewards, strict majority, 1-hour proposals, 0.1 NEAR bond"
  if [ "$(code_hash "$DAO")" = "$SPUTNIK_HASH" ]; then echo "already deployed"; else
    local init; init=$(node -e '
      const [a,b,bond]=process.argv.slice(1);
      process.stdout.write(JSON.stringify({
        config:{name:"the-dogs-demo-treasury",purpose:"CommonCircle DEMO: treasury loans to Trusted, non-steward members of The Dogs (DEMO) circle, by public proposal. Testnet only.",metadata:""},
        policy:{
          roles:[
            {name:"stewards",kind:{Group:[a,b]},permissions:["*:*"],vote_policy:{}},
            {name:"members-may-ask",kind:"Everyone",permissions:["transfer:AddProposal","call:AddProposal"],vote_policy:{}}
          ],
          default_vote_policy:{weight_kind:"RoleWeight",quorum:"0",threshold:[1,2]},
          proposal_bond:bond, proposal_period:"3600000000000",
          bounty_bond:bond, bounty_forgiveness_period:"86400000000000"
        }}));' "$FOUNDER" "$STEWARD" "$BOND_YOCTO")
    tx "deploy $DAO by global hash" contract deploy "$DAO" use-global-hash "$SPUTNIK_HASH" \
      with-init-call new json-args "$init" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
      network-config testnet sign-with-keychain send
  fi
  echo "DAO code hash: $(code_hash "$DAO") (expected $SPUTNIK_HASH)"
  echo "DAO policy roles: $(view "$DAO" get_policy '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(JSON.stringify(p.roles.map(r=>({name:r.name,kind:r.kind}))), "threshold", JSON.stringify(p.default_vote_policy.threshold))})')"
  [ "$(code_hash "$DAO")" = "$SPUTNIK_HASH" ] || { echo "STOP: DAO code hash mismatch"; exit 1; }

  say "4 Register the DAO with testnet USDC and seed the treasury with 2 USDC from the founder"
  if [ "$(view "$USDC_ID" storage_balance_of "{\"account_id\":\"$DAO\"}")" = "null" ]; then
    call "usdc register dao" "$FOUNDER" "$USDC_ID" storage_deposit \
      "{\"account_id\":\"$DAO\",\"registration_only\":true}" '0.00125 NEAR' '30.0 Tgas'
  else echo "already registered"; fi
  if [ "$(usdc_balance "$DAO")" -ge "$AMOUNT" ] 2>/dev/null; then echo "DAO already holds $(usdc_balance "$DAO")"; else
    call "seed dao treasury" "$FOUNDER" "$USDC_ID" ft_transfer \
      "{\"receiver_id\":\"$DAO\",\"amount\":\"$SEED\",\"memo\":\"CommonCircle DEMO treasury seed\"}" '1 yoctoNEAR' '30.0 Tgas'
  fi
  echo "DAO USDC: $(usdc_balance "$DAO")"
}

lock() {
  say "Delete every access key on $DAO (IRREVERSIBLE: afterwards only passed proposals act for the DAO)"
  # The RPC lists [] keys for an account that does not exist, so check the deploy first.
  [ "$(code_hash "$DAO")" = "$SPUTNIK_HASH" ] || { echo "STOP: deploy the DAO first ('dao')"; exit 1; }
  local keys; keys=$(rpc query "{\"request_type\":\"view_access_key_list\",\"finality\":\"final\",\"account_id\":\"$DAO\"}" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).result;if(!r){console.error("STOP: cannot read DAO keys");process.exit(1)}console.log(r.keys.map(k=>k.public_key).join(","))})')
  if [ -z "$keys" ]; then echo "no keys: already locked"; return; fi
  [ "${CONFIRM_LOCK:-}" = "yes" ] || { echo "Keys to delete: $keys"; echo "Re-run with CONFIRM_LOCK=yes to delete them. This cannot be undone."; exit 1; }
  tx "lock $DAO (delete keys)" account delete-keys "$DAO" public-keys "$keys" network-config testnet sign-with-keychain send
  echo "access keys now: $(rpc query "{\"request_type\":\"view_access_key_list\",\"finality\":\"final\",\"account_id\":\"$DAO\"}" | jget result.keys)"
}

attach() {
  need_iface
  local c; c=$(circle)
  if [ "$(printf '%s' "$c" | jget dao_attached)" = "true" ]; then echo "DAO already attached: $(printf '%s' "$c" | jget treasury_id)"; return; fi
  [ "$(printf '%s' "$c" | jget steward_count)" -ge 2 ] || { echo "STOP: run 'stewards' first (after attach_dao the founder can no longer appoint them)"; exit 1; }
  [ "$(code_hash "$DAO")" = "$SPUTNIK_HASH" ] || { echo "STOP: run 'dao' first"; exit 1; }
  say "Founder attaches the DAO to circle $CIRCLE_ID (admin and treasury pass to the DAO)"
  call "attach_dao" "$FOUNDER" "$CIRCLE" attach_dao "{\"circle_id\":\"$CIRCLE_ID\",\"dao_id\":\"$DAO\"}" '1 yoctoNEAR' '30.0 Tgas'
  circle | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);console.log("admin",c.admin_id,"treasury",c.treasury_id,"dao_attached",c.dao_attached,"stewards",c.steward_count,"treasury_lending_enabled",c.treasury_lending_enabled)})'
}

refuse() {
  say "A steward ($FOUNDER) asks the treasury for a loan -> must fail with E19_TREASURY_RULES"
  SOFT=1 call "steward asks treasury (expect E19)" "$FOUNDER" "$CIRCLE" create_loan \
    "{\"circle_id\":\"$CIRCLE_ID\",\"lender_id\":\"$DAO\",\"amount\":\"$AMOUNT\",\"duration_days\":1}" "$(cost_of create_loan) yoctoNEAR"
  inspect "$LAST_HASH" "$FOUNDER" | grep -E '^final|E19' || true
  save REFUSE_TX "$LAST_HASH"
}

loan() {
  # DEMO circles use 60-second "days": a 1-day loan is due one MINUTE after funding.
  # Default to 7 days (7 minutes) so there is time to repay after the vote.
  local days="${LOAN_DAYS:-7}"
  say "The Trusted, non-steward member asks the treasury for 1 USDC for $days demo days ($days minutes after funding)"
  echo "borrower effective tier $(passport "$BORROWER" | jget effective_tier), steward $(passport "$BORROWER" | jget steward), overdue loans $(passport "$BORROWER" | jget overdue_loans)"
  local lid; lid=$(next_loan_id)
  call "treasury create_loan $lid" "$BORROWER" "$CIRCLE" create_loan \
    "{\"circle_id\":\"$CIRCLE_ID\",\"lender_id\":\"$DAO\",\"amount\":\"$AMOUNT\",\"duration_days\":$days}" "$(cost_of create_loan) yoctoNEAR"
  save LOAN_ID "$lid"; save LOAN_TX "$LAST_HASH"
  echo "loan $lid: $(view "$CIRCLE" get_loan "{\"loan_id\":\"$lid\"}" | jget state); fund it within 1 hour, then repay within $days minutes of funding"
}

# clearflag <loan_id>: the stewards vote to forgive a late/overdue flag. The DAO is the
# circle admin, so it calls clear_flag itself through a FunctionCall proposal (F-09).
clearflag() {
  local lid="${1:?usage: clearflag <loan_id>}"
  local proposal; proposal=$(node -e '
    const [circle,lid]=process.argv.slice(1);
    process.stdout.write(JSON.stringify({proposal:{description:`CommonCircle: forgive the late flag on loan ${lid}`,
      kind:{FunctionCall:{receiver_id:circle,actions:[{method_name:"clear_flag",
        args:Buffer.from(JSON.stringify({loan_id:lid})).toString("base64"),deposit:"1",gas:"30000000000000"}]}}}}));' "$CIRCLE" "$lid")
  local pid; pid=$(view "$DAO" get_last_proposal_id '{}')
  say "A steward files proposal $pid: the DAO clears the flag on loan $lid"
  call "add_proposal $pid (clear_flag loan $lid)" "$FOUNDER" "$DAO" add_proposal "$proposal" "$BOND_YOCTO yoctoNEAR" '50.0 Tgas'
  save CLEARFLAG_PROPOSAL_ID "$pid"
  local kind; kind=$(view "$DAO" get_proposal "{\"id\":$pid}" | jget kind)
  local n=0
  for s in "$FOUNDER" "$STEWARD"; do
    n=$((n+1))
    [ "$(view "$DAO" get_proposal "{\"id\":$pid}" | jget status)" = "InProgress" ] || break
    call "clear_flag vote $n proposal $pid" "$s" "$DAO" act_proposal \
      "{\"id\":$pid,\"action\":\"VoteApprove\",\"proposal\":$kind}" '0 NEAR' '300.0 Tgas'
    save "CLEARFLAG_VOTE${n}_TX" "$LAST_HASH"
  done
  echo "proposal $pid: $(view "$DAO" get_proposal "{\"id\":$pid}" | jget status); loan $lid flag_cleared: $(view "$CIRCLE" get_loan "{\"loan_id\":\"$lid\"}" | jget flag_cleared)"
  passport "$BORROWER" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log("borrower passport:",JSON.stringify({tier:p.tier,effective_tier:p.effective_tier,on_time:p.on_time_count,late:p.late_count,overdue_loans:p.overdue_loans,perks_paused:p.perks_paused}))})'
}

propose() {
  [ -n "${LOAN_ID:-}" ] || { echo "STOP: run 'loan' first"; exit 1; }
  local kind="${KIND:-transfer}" fundmsg="{\"action\":\"fund\",\"loan_id\":\"$LOAN_ID\"}" proposal
  proposal=$(node -e '
    const [kind,usdc,circle,amount,msg,lid,who]=process.argv.slice(1);
    const k = kind==="call"
      ? {FunctionCall:{receiver_id:usdc,actions:[{method_name:"ft_transfer_call",
          args:Buffer.from(JSON.stringify({receiver_id:circle,amount,msg})).toString("base64"),
          deposit:"1",gas:"150000000000000"}]}}
      : {Transfer:{token_id:usdc,receiver_id:circle,amount,msg}};
    process.stdout.write(JSON.stringify({proposal:{description:`CommonCircle treasury loan ${lid}: 1 USDC to ${who} (Trusted, not a steward)`,kind:k}}));' \
    "$kind" "$USDC_ID" "$CIRCLE" "$AMOUNT" "$fundmsg" "$LOAN_ID" "$BORROWER")
  local pid; pid=$(view "$DAO" get_last_proposal_id '{}')
  say "The member files a $kind proposal $pid: the DAO funds loan $LOAN_ID"
  call "add_proposal $pid ($kind, loan $LOAN_ID)" "$BORROWER" "$DAO" add_proposal "$proposal" "$BOND_YOCTO yoctoNEAR" '50.0 Tgas'
  save PROPOSAL_ID "$pid"; save PROPOSAL_TX "$LAST_HASH"; save PROPOSAL_KIND "$kind"
  echo "proposal $pid: $(view "$DAO" get_proposal "{\"id\":$pid}" | jget status)"
}

vote() {
  [ -n "${PROPOSAL_ID:-}" ] || { echo "STOP: run 'propose' first"; exit 1; }
  local kind; kind=$(view "$DAO" get_proposal "{\"id\":$PROPOSAL_ID}" | jget kind)
  local n=0
  for s in "$FOUNDER" "$STEWARD"; do
    n=$((n+1))
    local st; st=$(view "$DAO" get_proposal "{\"id\":$PROPOSAL_ID}" | jget status)
    [ "$st" = "InProgress" ] || { echo "proposal is $st"; break; }
    say "Steward $s approves proposal $PROPOSAL_ID"
    call "vote $n proposal $PROPOSAL_ID" "$s" "$DAO" act_proposal \
      "{\"id\":$PROPOSAL_ID,\"action\":\"VoteApprove\",\"proposal\":$kind}" '0 NEAR' '300.0 Tgas'
    save "VOTE${n}_TX" "$LAST_HASH"
  done
  say "Result"
  echo "proposal $PROPOSAL_ID: $(view "$DAO" get_proposal "{\"id\":$PROPOSAL_ID}" | jget status)"
  local state; state=$(view "$CIRCLE" get_loan "{\"loan_id\":\"$LOAN_ID\"}" | jget state)
  echo "loan $LOAN_ID: $state; DAO USDC $(usdc_balance "$DAO"); borrower USDC $(usdc_balance "$BORROWER"); circle USDC $(usdc_balance "$CIRCLE")"
  echo; echo "Gas at each hop of the executing vote (ft_on_transfer must get >= 70 Tgas):"
  inspect "${VOTE2_TX:-$LAST_HASH}" "$STEWARD" | grep -E 'ft_transfer_call|ft_on_transfer|FAILED|loan_funded|loan_funding_failed|refund|^final' || true
  if [ "$state" = "Funded" ]; then echo "DAO PROPOSAL FUNDED THE LOAN (KIND=${PROPOSAL_KIND:-?})"
  else echo "Loan not funded by the ${PROPOSAL_KIND:-?} proposal. If that was 'transfer', run: KIND=call $0 propose && $0 vote"; fi
}

lowgas() {
  say "F-16: the member asks the founder for 1 USDC; the founder funds with only 40 Tgas against real USDC"
  local lid; lid=$(next_loan_id)
  call "lowgas create_loan $lid" "$BORROWER" "$CIRCLE" create_loan \
    "{\"circle_id\":\"$CIRCLE_ID\",\"lender_id\":\"$FOUNDER\",\"amount\":\"$AMOUNT\",\"duration_days\":1}" "$(cost_of create_loan) yoctoNEAR"
  local before; before=$(usdc_balance "$FOUNDER")
  SOFT=1 call "fund 40 Tgas (expect refusal)" "$FOUNDER" "$USDC_ID" ft_transfer_call \
    "{\"receiver_id\":\"$CIRCLE\",\"amount\":\"$AMOUNT\",\"msg\":\"{\\\"action\\\":\\\"fund\\\",\\\"loan_id\\\":\\\"$lid\\\"}\"}" '1 yoctoNEAR' '40.0 Tgas'
  save LOWGAS_TX "$LAST_HASH"; save LOWGAS_LOAN_ID "$lid"
  local after; after=$(usdc_balance "$FOUNDER")
  echo "founder USDC before $before after $after; loan $lid $(view "$CIRCLE" get_loan "{\"loan_id\":\"$lid\"}" | jget state); circle USDC $(usdc_balance "$CIRCLE")"
  inspect "$LAST_HASH" "$FOUNDER" | grep -E 'ft_on_transfer|FAILED|E60|refund|^final' || true
  [ "$before" = "$after" ] && echo "LOW-GAS REFUSAL OK" || echo "STOP: founder balance changed"
}

repay() { # repay [loan_id]  (default: the last treasury loan)
  local lid="${1:-${LOAN_ID:-}}"
  [ -n "$lid" ] || { echo "STOP: no treasury loan"; exit 1; }
  say "The member repays loan $lid (the money goes to its lender: the DAO for a treasury loan)"
  echo "borrower USDC $(usdc_balance "$BORROWER"); loan $lid $(view "$CIRCLE" get_loan "{\"loan_id\":\"$lid\"}" | jget state)"
  call "repay loan $lid" "$BORROWER" "$USDC_ID" ft_transfer_call \
    "{\"receiver_id\":\"$CIRCLE\",\"amount\":\"$AMOUNT\",\"msg\":\"{\\\"action\\\":\\\"repay\\\",\\\"loan_id\\\":\\\"$lid\\\"}\"}" '1 yoctoNEAR'
  save "REPAY_${lid}_TX" "$LAST_HASH"
  view "$CIRCLE" get_loan "{\"loan_id\":\"$lid\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const l=JSON.parse(s);console.log("loan",l.loan_id,l.state,"on time:",l.repaid_on_time,"flag_cleared:",l.flag_cleared)})'
  echo "DAO USDC $(usdc_balance "$DAO"); circle USDC $(usdc_balance "$CIRCLE")"
}

status() {
  echo "circle: $(circle | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);console.log(JSON.stringify({name:c.name,admin:c.admin_id,treasury:c.treasury_id,dao_attached:c.dao_attached,stewards:c.steward_count,members:c.member_count,treasury_lending_enabled:c.treasury_lending_enabled}))})')"
  echo "DAO $DAO code hash: $(code_hash "$DAO" 2>/dev/null) (Sputnik $SPUTNIK_HASH)"
  echo "DAO keys: $(rpc query "{\"request_type\":\"view_access_key_list\",\"finality\":\"final\",\"account_id\":\"$DAO\"}" | jget result.keys)"
  echo "DAO USDC: $(usdc_balance "$DAO")  circle USDC: $(usdc_balance "$CIRCLE")"
  if [ -f "$STATE" ]; then echo "state:"; sed 's/^/  /' "$STATE"; fi
}

case "${1:-}" in
  stewards|dao|lock|attach|refuse|loan|propose|vote|lowgas|repay|clearflag|status) "$1" "${2:-}" ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
