//! Gate 2 (Social Money): a real Sputnik DAO is the circle's treasury and lends
//! to a Trusted, non-steward member by passed proposal.
//!
//! The DAO code is `tests/fixtures/sputnikdao2_Ea8tHXFS.wasm`: the exact bytes
//! testnet serves for the global contract hash
//! `Ea8tHXFSQVszVwGASyzAfLq65DjcRDhkfab4FcPaRpgD` (`view_global_contract_code`,
//! read 2026-11-11). Each test checks the deployed code hash equals it, so the
//! fixture cannot drift. The policy is the one `contracts/scripts/testnet-dao.sh`
//! uses on testnet.
mod common;

use anyhow::Result;
use common::*;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract};
use serde_json::{json, Value};

const SPUTNIK_GLOBAL_HASH: &str = "Ea8tHXFSQVszVwGASyzAfLq65DjcRDhkfab4FcPaRpgD";
const BOND_YOCTO: u128 = 100_000_000_000_000_000_000_000; // 0.1 NEAR

fn sputnik_wasm() -> Result<Vec<u8>> {
    let path = std::env::var("SPUTNIK_WASM").unwrap_or_else(|_| "tests/fixtures/sputnikdao2_Ea8tHXFS.wasm".into());
    Ok(std::fs::read(path)?)
}

fn policy(council: &[&Account]) -> Value {
    let group: Vec<String> = council.iter().map(|a| a.id().to_string()).collect();
    json!({
        "roles": [
            { "name": "stewards", "kind": { "Group": group }, "permissions": ["*:*"], "vote_policy": {} },
            { "name": "members-may-ask", "kind": "Everyone",
              "permissions": ["transfer:AddProposal", "call:AddProposal"], "vote_policy": {} }
        ],
        "default_vote_policy": { "weight_kind": "RoleWeight", "quorum": "0", "threshold": [1, 2] },
        "proposal_bond": BOND_YOCTO.to_string(),
        "proposal_period": "3600000000000",
        "bounty_bond": BOND_YOCTO.to_string(),
        "bounty_forgiveness_period": "86400000000000"
    })
}

/// Circle 1 with bob Trusted (loan 1 repaid), founder + carol as stewards, a
/// Sputnik DAO (council = the stewards) attached as admin and treasury, holding 20 USDC.
async fn setup() -> Result<(World, Contract)> {
    let w = world().await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    borrow_fund_repay(&w, 1, 2).await?.into_result()?;
    assert_eq!(passport(&w, w.bob.id()).await?["tier"], "Trusted");

    for s in [&w.founder, &w.carol] {
        call1(&w, &w.founder, "set_steward", json!({ "circle_id": "1", "account_id": s.id(), "steward": true }))
            .await?
            .into_result()?;
    }

    let dao = w.worker.dev_deploy(&sputnik_wasm()?).await?;
    assert_eq!(
        dao.view_account().await?.code_hash.to_string(),
        SPUTNIK_GLOBAL_HASH,
        "fixture must be the testnet global Sputnik code"
    );
    dao.call("new")
        .args_json(json!({
            "config": { "name": "sandbox-treasury", "purpose": "CommonCircle sandbox", "metadata": "" },
            "policy": policy(&[&w.founder, &w.carol])
        }))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    call1(&w, &w.founder, "attach_dao", json!({ "circle_id": "1", "dao_id": dao.id() })).await?.into_result()?;
    mint(&w.usdc, dao.id(), 20 * USDC).await?;
    let c: Value = w.circle.view("get_circle").args_json(json!({ "circle_id": "1" })).await?.json()?;
    assert_eq!(c["treasury_id"], dao.id().to_string());
    assert_eq!(c["steward_count"], 2);
    Ok((w, dao))
}

async fn add_proposal(dao: &Contract, who: &Account, description: &str, kind: Value) -> Result<u64> {
    let r = who
        .call(dao.id(), "add_proposal")
        .args_json(json!({ "proposal": { "description": description, "kind": kind } }))
        .deposit(NearToken::from_yoctonear(BOND_YOCTO))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(r.json()?)
}

async fn proposal(dao: &Contract, id: u64) -> Result<Value> {
    Ok(dao.view("get_proposal").args_json(json!({ "id": id })).await?.json()?)
}

async fn approve(dao: &Contract, who: &Account, id: u64) -> Result<ExecutionFinalResult> {
    let kind = proposal(dao, id).await?["kind"].clone();
    Ok(who
        .call(dao.id(), "act_proposal")
        .args_json(json!({ "id": id, "action": "VoteApprove", "proposal": kind }))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?)
}

fn transfer_kind(w: &World, loan_id: u64, amount: u128) -> Value {
    json!({ "Transfer": {
        "token_id": w.usdc.id(), "receiver_id": w.circle.id(),
        "amount": amount.to_string(), "msg": fund_msg(loan_id).to_string()
    }})
}

fn function_call_kind(w: &World, loan_id: u64, amount: u128) -> Value {
    let args = json!({ "receiver_id": w.circle.id(), "amount": amount.to_string(), "msg": fund_msg(loan_id).to_string() });
    json!({ "FunctionCall": {
        "receiver_id": w.usdc.id(),
        "actions": [{
            "method_name": "ft_transfer_call",
            "args": base64_engine::encode(args.to_string().as_bytes()),
            "deposit": "1",
            "gas": "150000000000000"
        }]
    }})
}

/// Treasury loan by a FunctionCall proposal with explicit 150 Tgas: the form
/// `docs/MSG_SCHEMA.md` gives as the fallback. Also proves the refusals.
#[tokio::test]
async fn sputnik_function_call_proposal_funds_a_treasury_loan() -> Result<()> {
    let (w, dao) = setup().await?;

    // A steward asks the treasury: refused at create_loan.
    assert!(failed_with(create_loan(&w, &w.carol, dao.id(), 5 * USDC, 2).await?, "E19_TREASURY_RULES"));
    // The DAO account cannot join the circle it treasures (D-009, E37) - covered in redteam.rs.

    // The Trusted, non-steward member asks: loan 2, then files the request as a proposal.
    create_loan(&w, &w.bob, dao.id(), 10 * USDC, 2).await?.into_result()?;
    let pid = add_proposal(&dao, &w.bob, "Treasury loan 2 to bob", function_call_kind(&w, 2, 10 * USDC)).await?;

    // One steward's vote is not enough (strict majority of 2).
    approve(&dao, &w.founder, pid).await?.into_result()?;
    assert_eq!(proposal(&dao, pid).await?["status"], "InProgress");
    assert_eq!(loan_state(&w, 2).await?, "Open");

    let bob_before = balance(&w.usdc, w.bob.id()).await?;
    let r = approve(&dao, &w.carol, pid).await?;
    save_artifact("sputnik_function_call_logs.txt", &format!("{:#?}", r.logs()));
    assert!(has_event(&r, "loan_funded"), "logs: {:?}", r.logs());
    assert_eq!(proposal(&dao, pid).await?["status"], "Approved");
    let l = loan(&w, 2).await?;
    assert_eq!(l["state"], "Funded");
    assert_eq!(l["funded_via"], "Treasury");
    assert_eq!(balance(&w.usdc, w.bob.id()).await? - bob_before, 10 * USDC);
    assert_eq!(balance(&w.usdc, dao.id()).await?, 10 * USDC);
    assert_circle_holds_zero(&w).await?;

    // Repayment goes back to the DAO treasury.
    let r = ft_transfer_call(&w.bob, &w.usdc, w.circle.id(), 10 * USDC, repay_msg(2), RECOMMENDED_TGAS).await?;
    assert!(has_event(&r, "loan_repaid"), "logs: {:?}", r.logs());
    assert_eq!(balance(&w.usdc, dao.id()).await?, 20 * USDC);
    assert_circle_holds_zero(&w).await
}

/// Treasury loan by a Transfer proposal with `msg` (v4 F2's first choice). Sputnik
/// attaches a static 10 Tgas to its `ft_transfer_call` (plus any share of unused
/// gas), which may not reach the circle's 70 Tgas minimum. Either outcome must be
/// clean: funded as a treasury loan, or nothing moved and the DAO keeps its USDC.
/// The artifact records which one happened; testnet measures the real gas.
#[tokio::test]
async fn sputnik_transfer_with_msg_funds_or_leaves_the_treasury_whole() -> Result<()> {
    let (w, dao) = setup().await?;
    create_loan(&w, &w.bob, dao.id(), 10 * USDC, 2).await?.into_result()?;
    let pid = add_proposal(&dao, &w.bob, "Treasury loan 2 to bob", transfer_kind(&w, 2, 10 * USDC)).await?;
    approve(&dao, &w.founder, pid).await?.into_result()?;
    let r = approve(&dao, &w.carol, pid).await?;

    let funded = has_event(&r, "loan_funded");
    let status = proposal(&dao, pid).await?["status"].clone();
    let dao_usdc = balance(&w.usdc, dao.id()).await?;
    let state = loan_state(&w, 2).await?;
    let failures: Vec<String> = r.receipt_failures().iter().map(|f| format!("{:?}", f)).collect();
    let report = json!({
        "funded": funded, "proposal_status": status, "loan_state": state, "dao_usdc": dao_usdc.to_string(),
        "refund_reason": refund_reason(&r), "receipt_failures": failures, "logs": r.logs()
    });
    save_artifact("sputnik_transfer_with_msg.json", &serde_json::to_string_pretty(&report)?);

    if funded {
        assert_eq!(state, "Funded");
        assert_eq!(loan(&w, 2).await?["funded_via"], "Treasury");
        assert_eq!(dao_usdc, 10 * USDC);
    } else {
        assert_ne!(state, "Funded");
        assert_eq!(dao_usdc, 20 * USDC, "a refused Transfer must leave the treasury whole");
    }
    assert_circle_holds_zero(&w).await
}
