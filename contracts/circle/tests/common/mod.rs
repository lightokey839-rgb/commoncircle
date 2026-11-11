//! Sandbox harness. Needs prebuilt wasm (see contracts/scripts/build-wasm.sh):
//!   $CARGO_TARGET_DIR/near-wasm/commoncircle_circle.wasm
//!   $CARGO_TARGET_DIR/near-wasm/commoncircle_mock_ft.wasm
//! Override with CIRCLE_WASM / MOCK_FT_WASM.
#![allow(dead_code)]

use anyhow::{anyhow, Result};
use ed25519_dalek::{Signer, SigningKey};
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

pub const USDC: u128 = 1_000_000; // 1 USDC in base units
pub const RECOMMENDED_TGAS: u64 = 150;

fn wasm(var: &str, file: &str) -> Result<Vec<u8>> {
    let path = std::env::var(var).unwrap_or_else(|_| {
        let target = std::env::var("CARGO_TARGET_DIR").unwrap_or_else(|_| "../target".into());
        format!("{}/near-wasm/{}", target, file)
    });
    std::fs::read(&path).map_err(|e| anyhow!("cannot read {}: {} (run contracts/scripts/build-wasm.sh)", path, e))
}

pub struct World {
    pub worker: Worker<Sandbox>,
    pub usdc: Contract,
    pub fake: Contract,
    pub circle: Contract,
    pub vault: Account,
    pub founder: Account,
    pub bob: Account,
    pub carol: Account,
}

/// Default pilot-like params on seconds-scale days (A4).
pub fn params() -> Value {
    json!({
        "min_amount": (USDC).to_string(),
        "member_max_amount": (20 * USDC).to_string(),
        "trusted_max_amount": (50 * USDC).to_string(),
        "max_duration_days": 30,
        "day_length_sec": "60",
        "funding_window_sec": "600",
        "qualifying_min_amount": (USDC).to_string(),
        "qualifying_min_days": 1,
        "trusted_threshold": 1,
        "min_distinct_lenders": 1,
        "recovery_lock_sec": "0",
        "writeoff_grace_sec": "60"
    })
}

async fn deploy_ft(worker: &Worker<Sandbox>, code: &[u8], symbol: &str) -> Result<Contract> {
    let ft = worker.dev_deploy(code).await?;
    ft.call("new")
        .args_json(json!({
            "owner_id": ft.id(),
            "total_supply": (1_000_000 * USDC).to_string(),
            "symbol": symbol,
            "decimals": 6
        }))
        .transact()
        .await?
        .into_result()?;
    Ok(ft)
}

pub async fn world_with(params: Value) -> Result<World> {
    let worker = near_workspaces::sandbox().await?;
    let ft_code = wasm("MOCK_FT_WASM", "commoncircle_mock_ft.wasm")?;
    let circle_code = wasm("CIRCLE_WASM", "commoncircle_circle.wasm")?;
    let usdc = deploy_ft(&worker, &ft_code, "USDC").await?;
    let fake = deploy_ft(&worker, &ft_code, "USDC").await?; // same symbol, wrong contract
    let vault = worker.dev_create_account().await?;
    let circle = worker.dev_deploy(&circle_code).await?;
    circle
        .call("new")
        .args_json(json!({
            "usdc_id": usdc.id(),
            "vault_id": vault.id(),
            "hard_loan_cap": (50 * USDC).to_string(),
            "floors": {
                "funding_window_sec": "0",
                "qualifying_duration_sec": "0",
                "recovery_lock_sec": "0",
                "day_length_sec": "0"
            }
        }))
        .transact()
        .await?
        .into_result()?;
    let founder = worker.dev_create_account().await?;
    let bob = worker.dev_create_account().await?;
    let carol = worker.dev_create_account().await?;
    let w = World { worker, usdc, fake, circle, vault, founder, bob, carol };
    // The circle account must be registered with USDC to receive transfers.
    register(w.usdc.as_account(), &w.usdc, w.circle.id()).await?;
    register(w.fake.as_account(), &w.fake, w.circle.id()).await?;
    let cost = storage_cost(&w, "create_circle").await?;
    w.founder
        .call(w.circle.id(), "create_circle")
        .args_json(json!({ "name": "Sandbox circle", "params": params }))
        .deposit(NearToken::from_yoctonear(cost))
        .transact()
        .await?
        .into_result()?;
    Ok(w)
}

pub async fn world() -> Result<World> {
    world_with(params()).await
}

pub async fn storage_cost(w: &World, key: &str) -> Result<u128> {
    let v: Value = w.circle.view("storage_costs").await?.json()?;
    Ok(v[key].as_str().ok_or_else(|| anyhow!("no {}", key))?.parse()?)
}

/// Register `who` on `token`, paid by `payer`.
pub async fn register(payer: &Account, token: &Contract, who: &AccountId) -> Result<()> {
    payer
        .call(token.id(), "storage_deposit")
        .args_json(json!({ "account_id": who, "registration_only": true }))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

/// Register (if needed) and give `who` `amount` of `token`.
pub async fn mint(token: &Contract, who: &AccountId, amount: u128) -> Result<()> {
    register(token.as_account(), token, who).await?;
    token
        .call("ft_transfer")
        .args_json(json!({ "receiver_id": who, "amount": amount.to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

pub async fn balance(token: &Contract, who: &AccountId) -> Result<u128> {
    let v: String = token.view("ft_balance_of").args_json(json!({ "account_id": who })).await?.json()?;
    Ok(v.parse()?)
}

pub async fn assert_circle_holds_zero(w: &World) -> Result<()> {
    assert_eq!(balance(&w.usdc, w.circle.id()).await?, 0, "circle must hold zero USDC at rest");
    assert_eq!(balance(&w.fake, w.circle.id()).await?, 0, "circle must hold zero of any token at rest");
    Ok(())
}

pub async fn ft_transfer_call(
    from: &Account,
    token: &Contract,
    to: &AccountId,
    amount: u128,
    msg: Value,
    tgas: u64,
) -> Result<ExecutionFinalResult> {
    Ok(from
        .call(token.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": to, "amount": amount.to_string(), "msg": msg.to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(tgas))
        .transact()
        .await?)
}

pub fn fund_msg(loan_id: u64) -> Value {
    json!({ "action": "fund", "loan_id": loan_id.to_string() })
}

pub fn repay_msg(loan_id: u64) -> Value {
    json!({ "action": "repay", "loan_id": loan_id.to_string() })
}

pub fn invite_key(seed: u8) -> (SigningKey, String) {
    let sk = SigningKey::from_bytes(&[seed; 32]);
    let pk = format!("ed25519:{}", bs58::encode(sk.verifying_key().to_bytes()).into_string());
    (sk, pk)
}

pub fn invite_signature(sk: &SigningKey, contract: &AccountId, circle_id: u64, caller: &AccountId, pk: &str) -> String {
    use base64_engine::encode;
    let msg = format!("commoncircle-invite-v1\n{}\n{}\n{}\n{}", contract, circle_id, caller, pk);
    encode(&sk.sign(msg.as_bytes()).to_bytes())
}

/// Tiny standard base64 encoder so tests do not need another crate.
pub mod base64_engine {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    pub fn encode(input: &[u8]) -> String {
        let mut out = String::new();
        for c in input.chunks(3) {
            let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
            let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
            out.push(T[(n >> 18) as usize & 63] as char);
            out.push(T[(n >> 12) as usize & 63] as char);
            out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
            out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
        }
        out
    }
}

/// `inviter` registers a named invite for `who` in circle 1; `who` redeems it.
pub async fn join(w: &World, inviter: &Account, who: &Account, seed: u8) -> Result<()> {
    let (sk, pk) = invite_key(seed);
    let cost = storage_cost(w, "register_invite").await?;
    inviter
        .call(w.circle.id(), "register_invite")
        .args_json(json!({
            "circle_id": "1",
            "invite_public_key": pk,
            "expires_at": (u64::MAX / 2).to_string(),
            "invitee_id": who.id()
        }))
        .deposit(NearToken::from_yoctonear(cost))
        .transact()
        .await?
        .into_result()?;
    let sig = invite_signature(&sk, w.circle.id(), 1, who.id(), &pk);
    let cost = storage_cost(w, "redeem_invite").await?;
    who.call(w.circle.id(), "redeem_invite")
        .args_json(json!({ "circle_id": "1", "invite_public_key": pk, "signature": sig }))
        .deposit(NearToken::from_yoctonear(cost))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

/// bob borrows `amount` from `lender` for `days`; returns loan id.
pub async fn create_loan(w: &World, borrower: &Account, lender: &AccountId, amount: u128, days: u32) -> Result<ExecutionFinalResult> {
    let cost = storage_cost(w, "create_loan").await?;
    Ok(borrower
        .call(w.circle.id(), "create_loan")
        .args_json(json!({
            "circle_id": "1",
            "lender_id": lender,
            "amount": amount.to_string(),
            "duration_days": days
        }))
        .deposit(NearToken::from_yoctonear(cost))
        .max_gas()
        .transact()
        .await?)
}

pub async fn loan(w: &World, id: u64) -> Result<Value> {
    Ok(w.circle.view("get_loan").args_json(json!({ "loan_id": id.to_string() })).await?.json()?)
}

pub async fn loan_state(w: &World, id: u64) -> Result<String> {
    Ok(loan(w, id).await?["state"].as_str().unwrap_or("?").to_string())
}

pub fn has_event(r: &ExecutionFinalResult, event: &str) -> bool {
    r.logs().iter().any(|l| l.starts_with("EVENT_JSON:") && l.contains(&format!("\"event\":\"{}\"", event)))
}

pub fn refund_reason(r: &ExecutionFinalResult) -> Option<String> {
    r.logs().iter().find_map(|l| {
        let body = l.strip_prefix("EVENT_JSON:")?;
        let v: Value = serde_json::from_str(body).ok()?;
        if v["event"] == "transfer_refunded" {
            v["data"][0]["reason"].as_str().map(String::from)
        } else {
            None
        }
    })
}

/// Standard setup: founder invites bob and carol; carol holds 100 USDC.
pub async fn members(w: &World) -> Result<()> {
    join(w, &w.founder, &w.bob, 1).await?;
    join(w, &w.founder, &w.carol, 2).await?;
    mint(&w.usdc, w.carol.id(), 100 * USDC).await?;
    Ok(())
}

/// Register an invite in circle 1 (named if `invitee` is Some).
pub async fn register_invite(w: &World, inviter: &Account, pk: &str, invitee: Option<&AccountId>) -> Result<ExecutionFinalResult> {
    let cost = storage_cost(w, "register_invite").await?;
    Ok(inviter
        .call(w.circle.id(), "register_invite")
        .args_json(json!({
            "circle_id": "1",
            "invite_public_key": pk,
            "expires_at": (u64::MAX / 2).to_string(),
            "invitee_id": invitee
        }))
        .deposit(NearToken::from_yoctonear(cost))
        .transact()
        .await?)
}

/// `who` redeems the invite with a signature made for `who`.
pub async fn redeem(w: &World, who: &Account, sk: &SigningKey, pk: &str) -> Result<ExecutionFinalResult> {
    let sig = invite_signature(sk, w.circle.id(), 1, who.id(), pk);
    let cost = storage_cost(w, "redeem_invite").await?;
    Ok(who
        .call(w.circle.id(), "redeem_invite")
        .args_json(json!({ "circle_id": "1", "invite_public_key": pk, "signature": sig }))
        .deposit(NearToken::from_yoctonear(cost))
        .max_gas()
        .transact()
        .await?)
}

/// Admin-style call with 1 yoctoNEAR.
pub async fn call1(w: &World, who: &Account, method: &str, args: Value) -> Result<ExecutionFinalResult> {
    Ok(who
        .call(w.circle.id(), method)
        .args_json(args)
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?)
}

pub async fn passport(w: &World, who: &AccountId) -> Result<Value> {
    Ok(w.circle
        .view("passport_for")
        .args_json(json!({ "circle_id": "1", "account_id": who }))
        .await?
        .json()?)
}

pub async fn token_media(w: &World, token_id: &str) -> Result<String> {
    let t: Value = w.circle.view("nft_token").args_json(json!({ "token_id": token_id })).await?.json()?;
    Ok(t["metadata"]["media"].as_str().unwrap_or_default().to_string())
}

pub fn failed_with(r: ExecutionFinalResult, code: &str) -> bool {
    format!("{:?}", r.into_result()).contains(code)
}

/// Write a named sample into $ARTIFACT_DIR (CI uploads it) and stdout.
pub fn save_artifact(name: &str, body: &str) {
    println!("{}: {}", name, body);
    if let Ok(dir) = std::env::var("ARTIFACT_DIR") {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(format!("{}/{}", dir, name), body);
    }
}

/// bob borrows 10 USDC from carol for `days`, carol funds, bob repays in full.
pub async fn borrow_fund_repay(w: &World, loan_id: u64, days: u32) -> Result<ExecutionFinalResult> {
    create_loan(w, &w.bob, w.carol.id(), 10 * USDC, days).await?.into_result()?;
    ft_transfer_call(&w.carol, &w.usdc, w.circle.id(), 10 * USDC, fund_msg(loan_id), RECOMMENDED_TGAS).await?;
    ft_transfer_call(&w.bob, &w.usdc, w.circle.id(), 10 * USDC, repay_msg(loan_id), RECOMMENDED_TGAS).await
}
