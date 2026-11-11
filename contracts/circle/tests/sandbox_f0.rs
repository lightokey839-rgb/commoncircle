//! Phase 1B sandbox scenarios (F0 core loop and refund proofs).
//! Every scenario ends by asserting the circle contract holds zero tokens.

mod common;

use anyhow::Result;
use common::*;
use near_workspaces::types::NearToken;
use serde_json::json;

#[tokio::test]
async fn f0_fund_then_full_repay_on_time() -> Result<()> {
    let w = world().await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    create_loan(&w, &w.bob, w.carol.id(), 10 * USDC, 2).await?.into_result()?;

    let r = ft_transfer_call(&w.carol, &w.usdc, w.circle.id(), 10 * USDC, fund_msg(1), RECOMMENDED_TGAS).await?;
    assert!(has_event(&r, "loan_funded"), "logs: {:?}", r.logs());
    assert_eq!(loan_state(&w, 1).await?, "Funded");
    assert_eq!(balance(&w.usdc, w.bob.id()).await?, 10 * USDC);
    assert_eq!(balance(&w.usdc, w.carol.id()).await?, 90 * USDC);
    assert_circle_holds_zero(&w).await?;

    let r = ft_transfer_call(&w.bob, &w.usdc, w.circle.id(), 10 * USDC, repay_msg(1), RECOMMENDED_TGAS).await?;
    assert!(has_event(&r, "loan_repaid"), "logs: {:?}", r.logs());
    assert!(has_event(&r, "tier_changed"));
    let l = loan(&w, 1).await?;
    assert_eq!(l["state"], "Repaid");
    assert_eq!(l["repaid_on_time"], true);
    assert_eq!(balance(&w.usdc, w.carol.id()).await?, 100 * USDC);
    let p: serde_json::Value = w
        .circle
        .view("passport_for")
        .args_json(json!({ "circle_id": "1", "account_id": w.bob.id() }))
        .await?
        .json()?;
    assert_eq!(p["tier"], "Trusted");
    assert_circle_holds_zero(&w).await
}

#[tokio::test]
async fn f0_partial_repay_then_overpay_returns_excess() -> Result<()> {
    let w = world().await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    create_loan(&w, &w.bob, w.carol.id(), 10 * USDC, 2).await?.into_result()?;
    ft_transfer_call(&w.carol, &w.usdc, w.circle.id(), 10 * USDC, fund_msg(1), RECOMMENDED_TGAS).await?;

    let r = ft_transfer_call(&w.bob, &w.usdc, w.circle.id(), 4 * USDC, repay_msg(1), RECOMMENDED_TGAS).await?;
    assert!(has_event(&r, "loan_repayment"));
    let l = loan(&w, 1).await?;
    assert_eq!(l["state"], "Funded");
    assert_eq!(l["outstanding"], (6 * USDC).to_string());
    assert_circle_holds_zero(&w).await?;

    mint(&w.usdc, w.bob.id(), 5 * USDC).await?; // bob now holds 6 + 5 = 11
    ft_transfer_call(&w.bob, &w.usdc, w.circle.id(), 9 * USDC, repay_msg(1), RECOMMENDED_TGAS).await?;
    assert_eq!(loan_state(&w, 1).await?, "Repaid");
    assert_eq!(balance(&w.usdc, w.carol.id()).await?, 100 * USDC);
    assert_eq!(balance(&w.usdc, w.bob.id()).await?, 5 * USDC, "3 USDC excess must come back");
    assert_circle_holds_zero(&w).await
}

#[tokio::test]
async fn f0_wrong_amount_is_refunded() -> Result<()> {
    let w = world().await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    create_loan(&w, &w.bob, w.carol.id(), 10 * USDC, 2).await?.into_result()?;
    let r = ft_transfer_call(&w.carol, &w.usdc, w.circle.id(), 10 * USDC - 1, fund_msg(1), RECOMMENDED_TGAS).await?;
    assert_eq!(refund_reason(&r).as_deref(), Some("E72_WRONG_AMOUNT"));
    assert_eq!(balance(&w.usdc, w.carol.id()).await?, 100 * USDC);
    assert_eq!(loan_state(&w, 1).await?, "Open");
    assert_circle_holds_zero(&w).await
}

#[tokio::test]
async fn f0_lapsed_window_cancels_and_refunds() -> Result<()> {
    let mut p = params();
    p["funding_window_sec"] = json!("2");
    let w = world_with(p).await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    create_loan(&w, &w.bob, w.carol.id(), 10 * USDC, 2).await?.into_result()?;
    w.worker.fast_forward(30).await?;
    let l = loan(&w, 1).await?;
    assert_eq!(l["state"], "Cancelled");
    assert_eq!(l["cancel_reason"], "Lapsed");
    let r = ft_transfer_call(&w.carol, &w.usdc, w.circle.id(), 10 * USDC, fund_msg(1), RECOMMENDED_TGAS).await?;
    assert_eq!(refund_reason(&r).as_deref(), Some("E18_WINDOW_LAPSED"));
    assert_eq!(balance(&w.usdc, w.carol.id()).await?, 100 * USDC);
    assert_circle_holds_zero(&w).await
}

#[tokio::test]
async fn f0_double_fund_is_refunded() -> Result<()> {
    let w = world().await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    mint(&w.usdc, w.vault.id(), 10 * USDC).await?;
    create_loan(&w, &w.bob, w.carol.id(), 10 * USDC, 2).await?.into_result()?;

    // Race: the named lender and the vault (naming the lender) fund at once.
    let vault_msg = json!({ "action": "fund", "loan_id": "1", "lender_id": w.carol.id() });
    let (a, b) = tokio::join!(
        ft_transfer_call(&w.carol, &w.usdc, w.circle.id(), 10 * USDC, fund_msg(1), RECOMMENDED_TGAS),
        ft_transfer_call(&w.vault, &w.usdc, w.circle.id(), 10 * USDC, vault_msg, RECOMMENDED_TGAS),
    );
    let (a, b) = (a?, b?);
    let funded = [has_event(&a, "loan_funded"), has_event(&b, "loan_funded")];
    assert_eq!(funded.iter().filter(|x| **x).count(), 1, "exactly one funding must win");
    let paid = (100 * USDC - balance(&w.usdc, w.carol.id()).await?) + (10 * USDC - balance(&w.usdc, w.vault.id()).await?);
    assert_eq!(paid, 10 * USDC, "only one principal leaves the funders");
    assert_eq!(balance(&w.usdc, w.bob.id()).await?, 10 * USDC);
    assert_circle_holds_zero(&w).await?;

    // Sequential double fund after Funded.
    let r = ft_transfer_call(&w.carol, &w.usdc, w.circle.id(), 10 * USDC, fund_msg(1), RECOMMENDED_TGAS).await?;
    assert_eq!(refund_reason(&r).as_deref(), Some("E17_WRONG_STATE"));
    assert_circle_holds_zero(&w).await
}

#[tokio::test]
async fn f0_low_gas_fails_early_and_is_refunded() -> Result<()> {
    let w = world().await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    create_loan(&w, &w.bob, w.carol.id(), 10 * USDC, 2).await?.into_result()?;
    let r = ft_transfer_call(&w.carol, &w.usdc, w.circle.id(), 10 * USDC, fund_msg(1), 60).await?;
    let failed = r.receipt_failures().iter().any(|f| format!("{:?}", f).contains("E60_LOW_GAS"));
    assert!(failed, "expected E60_LOW_GAS, got {:?}", r.receipt_failures());
    assert_eq!(balance(&w.usdc, w.carol.id()).await?, 100 * USDC);
    assert_eq!(loan_state(&w, 1).await?, "Open");
    assert_circle_holds_zero(&w).await
}

#[tokio::test]
async fn f0_revoked_passport_mid_loan_stays_payable() -> Result<()> {
    let w = world().await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    create_loan(&w, &w.bob, w.carol.id(), 10 * USDC, 2).await?.into_result()?;
    ft_transfer_call(&w.carol, &w.usdc, w.circle.id(), 10 * USDC, fund_msg(1), RECOMMENDED_TGAS).await?;
    w.founder
        .call(w.circle.id(), "set_passport_status")
        .args_json(json!({ "circle_id": "1", "account_id": w.bob.id(), "status": "Revoked" }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;
    let access: serde_json::Value = w
        .circle
        .view("check_access")
        .args_json(json!({ "circle_id": "1", "account_id": w.bob.id() }))
        .await?
        .json()?;
    assert_eq!(access["allowed"], false);
    assert_eq!(access["reason"], "Revoked");
    ft_transfer_call(&w.bob, &w.usdc, w.circle.id(), 10 * USDC, repay_msg(1), RECOMMENDED_TGAS).await?;
    assert_eq!(loan_state(&w, 1).await?, "Repaid");
    assert_eq!(balance(&w.usdc, w.carol.id()).await?, 100 * USDC);
    assert_circle_holds_zero(&w).await
}

#[tokio::test]
async fn f0_non_member_borrower_is_rejected() -> Result<()> {
    let w = world().await?;
    members(&w).await?;
    let stranger = w.worker.dev_create_account().await?;
    let r = create_loan(&w, &stranger, w.carol.id(), 10 * USDC, 2).await?;
    assert!(format!("{:?}", r.into_result()).contains("E10_NO_PASSPORT"));
    assert_circle_holds_zero(&w).await
}

// ------------------------------------------------ A3: repay-path refunds

#[tokio::test]
async fn a3_repay_forward_fails_when_lender_unregistered() -> Result<()> {
    let w = world().await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    create_loan(&w, &w.bob, w.carol.id(), 10 * USDC, 2).await?.into_result()?;
    ft_transfer_call(&w.carol, &w.usdc, w.circle.id(), 10 * USDC, fund_msg(1), RECOMMENDED_TGAS).await?;
    // Lender leaves the token (force burns her remaining 90).
    w.carol
        .call(w.usdc.id(), "storage_unregister")
        .args_json(json!({ "force": true }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;
    let r = ft_transfer_call(&w.bob, &w.usdc, w.circle.id(), 10 * USDC, repay_msg(1), RECOMMENDED_TGAS).await?;
    assert!(has_event(&r, "loan_repayment_failed"), "logs: {:?}", r.logs());
    assert_eq!(balance(&w.usdc, w.bob.id()).await?, 10 * USDC, "repayer refunded in full");
    let l = loan(&w, 1).await?;
    assert_eq!(l["state"], "Funded");
    assert_eq!(l["total_repaid"], "0");
    assert_circle_holds_zero(&w).await
}

#[tokio::test]
async fn a3_repay_with_wrong_token_wrong_state_or_wrong_caller_is_refunded() -> Result<()> {
    let w = world().await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    create_loan(&w, &w.bob, w.carol.id(), 10 * USDC, 2).await?.into_result()?;

    // Repay while Open (wrong state).
    mint(&w.usdc, w.founder.id(), 5 * USDC).await?;
    let r = ft_transfer_call(&w.founder, &w.usdc, w.circle.id(), 5 * USDC, repay_msg(1), RECOMMENDED_TGAS).await?;
    assert_eq!(refund_reason(&r).as_deref(), Some("E17_WRONG_STATE"));
    assert_eq!(balance(&w.usdc, w.founder.id()).await?, 5 * USDC);

    ft_transfer_call(&w.carol, &w.usdc, w.circle.id(), 10 * USDC, fund_msg(1), RECOMMENDED_TGAS).await?;

    // Wrong token.
    mint(&w.fake, w.bob.id(), 10 * USDC).await?;
    let r = ft_transfer_call(&w.bob, &w.fake, w.circle.id(), 10 * USDC, repay_msg(1), RECOMMENDED_TGAS).await?;
    assert_eq!(refund_reason(&r).as_deref(), Some("E70_WRONG_TOKEN"));
    assert_eq!(balance(&w.fake, w.bob.id()).await?, 10 * USDC);

    // Wrong caller: an account calls ft_on_transfer directly; nothing moves.
    let r = w
        .bob
        .call(w.circle.id(), "ft_on_transfer")
        .args_json(json!({ "sender_id": w.bob.id(), "amount": (10 * USDC).to_string(), "msg": repay_msg(1).to_string() }))
        .max_gas()
        .transact()
        .await?;
    assert_eq!(refund_reason(&r).as_deref(), Some("E70_WRONG_TOKEN"));

    // Private callbacks cannot be called from outside.
    let r = w
        .bob
        .call(w.circle.id(), "on_repay_forwarded")
        .args_json(json!({ "loan_id": "1", "applied": (10 * USDC).to_string(), "received": (10 * USDC).to_string() }))
        .max_gas()
        .transact()
        .await?;
    assert!(r.is_failure(), "private callback must reject outside callers");

    let l = loan(&w, 1).await?;
    assert_eq!(l["state"], "Funded");
    assert_eq!(l["total_repaid"], "0");
    assert_circle_holds_zero(&w).await
}

#[tokio::test]
async fn storage_deposit_excess_is_refunded() -> Result<()> {
    let w = world().await?;
    let before = w.bob.view_account().await?.balance;
    w.bob
        .call(w.circle.id(), "create_circle")
        .args_json(json!({ "name": "Refund check", "params": params() }))
        .deposit(NearToken::from_near(1))
        .transact()
        .await?
        .into_result()?;
    let after = w.bob.view_account().await?.balance;
    let spent = before.as_yoctonear() - after.as_yoctonear();
    // Storage for a circle + passport is well under 0.05 NEAR; the rest of the
    // 1 NEAR deposit must come back.
    assert!(spent < NearToken::from_millinear(50).as_yoctonear(), "spent {} yocto", spent);
    Ok(())
}

/// Gas actually burnt by the receipts that carry a given event.
fn gas_for_event(r: &near_workspaces::result::ExecutionFinalResult, event: &str) -> u64 {
    r.receipt_outcomes()
        .iter()
        .filter(|o| o.logs.iter().any(|l| l.contains(&format!("\"event\":\"{}\"", event))))
        .map(|o| o.gas_burnt.as_gas())
        .max()
        .unwrap_or(0)
}

/// Evidence for docs/EVENTS.md "cannot stay stuck": the private callbacks must
/// fit inside their reserved static gas (GAS_CALLBACK = 25 Tgas), and
/// ft_on_transfer must fit its own 30 Tgas budget.
#[tokio::test]
async fn gas_measurements_fit_reserved_budgets() -> Result<()> {
    const TGAS: u64 = 1_000_000_000_000;
    let w = world().await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    create_loan(&w, &w.bob, w.carol.id(), 10 * USDC, 2).await?.into_result()?;

    let fund = ft_transfer_call(&w.carol, &w.usdc, w.circle.id(), 10 * USDC, fund_msg(1), RECOMMENDED_TGAS).await?;
    let on_transfer_fund = gas_for_event(&fund, "loan_funding_started");
    let on_fund_cb = gas_for_event(&fund, "loan_funded");

    let partial = ft_transfer_call(&w.bob, &w.usdc, w.circle.id(), 4 * USDC, repay_msg(1), RECOMMENDED_TGAS).await?;
    let on_repay_partial_cb = gas_for_event(&partial, "loan_repayment");

    let full = ft_transfer_call(&w.bob, &w.usdc, w.circle.id(), 6 * USDC, repay_msg(1), RECOMMENDED_TGAS).await?;
    let on_transfer_repay = gas_for_event(&full, "loan_repayment_started");
    let on_repay_full_cb = gas_for_event(&full, "loan_repaid"); // includes tier_changed

    // Failed forward path (unregistered borrower).
    let w2 = world().await?;
    members(&w2).await?;
    create_loan(&w2, &w2.bob, w2.carol.id(), 10 * USDC, 2).await?.into_result()?;
    let failed = ft_transfer_call(&w2.carol, &w2.usdc, w2.circle.id(), 10 * USDC, fund_msg(1), RECOMMENDED_TGAS).await?;
    let on_fund_failed_cb = gas_for_event(&failed, "loan_funding_failed");

    let report = format!(
        "{{\"unit\":\"gas\",\"ft_on_transfer_fund\":{},\"ft_on_transfer_repay\":{},\"on_fund_forwarded_ok\":{},\"on_fund_forwarded_failed\":{},\"on_repay_forwarded_partial\":{},\"on_repay_forwarded_full_with_tier_flip\":{},\"budget_callback\":{},\"budget_ft_on_transfer_own\":{}}}",
        on_transfer_fund, on_transfer_repay, on_fund_cb, on_fund_failed_cb, on_repay_partial_cb, on_repay_full_cb, 25 * TGAS, 30 * TGAS
    );
    save_artifact("gas_measurements.json", &report);

    for (name, g) in [
        ("on_fund_forwarded ok", on_fund_cb),
        ("on_fund_forwarded failed", on_fund_failed_cb),
        ("on_repay_forwarded partial", on_repay_partial_cb),
        ("on_repay_forwarded full", on_repay_full_cb),
    ] {
        assert!(g > 0, "{}: no receipt found", name);
        assert!(g < 25 * TGAS, "{} burnt {} gas, over the 25 Tgas reserve", name, g);
    }
    for (name, g) in [("ft_on_transfer fund", on_transfer_fund), ("ft_on_transfer repay", on_transfer_repay)] {
        assert!(g > 0, "{}: no receipt found", name);
        assert!(g < 30 * TGAS, "{} burnt {} gas, over its 30 Tgas own budget", name, g);
    }
    assert_circle_holds_zero(&w).await?;
    assert_circle_holds_zero(&w2).await
}
