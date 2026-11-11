//! README checks table: each test is named after one row of the v3 README
//! checks. Rows not implemented yet stay red (todo!) until their gate.
//! Contract rows run in the sandbox; see tests/common/mod.rs for the harness.

mod common;

use anyhow::Result;
use common::*;
use serde_json::json;

#[test]
fn request_circle_messages_without_a_passport() {
    todo!("Gate 1: server access check and on-chain passport gate")
}

#[tokio::test]
async fn create_a_loan_naming_a_non_member() -> Result<()> {
    let w = world().await?;
    members(&w).await?;
    let stranger = w.worker.dev_create_account().await?;
    let r = create_loan(&w, &w.bob, stranger.id(), 10 * USDC, 2).await?;
    assert!(format!("{:?}", r.into_result()).contains("E11_LENDER_NO_PASSPORT"));
    let r = create_loan(&w, &stranger, w.carol.id(), 10 * USDC, 2).await?;
    assert!(format!("{:?}", r.into_result()).contains("E10_NO_PASSPORT"));
    assert_circle_holds_zero(&w).await
}

#[tokio::test]
async fn fund_a_loan_from_an_account_that_is_not_the_named_lender() -> Result<()> {
    let w = world().await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    create_loan(&w, &w.bob, w.carol.id(), 10 * USDC, 2).await?.into_result()?;
    mint(&w.usdc, w.founder.id(), 10 * USDC).await?;
    let r = ft_transfer_call(&w.founder, &w.usdc, w.circle.id(), 10 * USDC, fund_msg(1), RECOMMENDED_TGAS).await?;
    assert_eq!(refund_reason(&r).as_deref(), Some("E12_NOT_NAMED_LENDER"));
    assert_eq!(balance(&w.usdc, w.founder.id()).await?, 10 * USDC);
    assert_eq!(loan_state(&w, 1).await?, "Open");
    assert_circle_holds_zero(&w).await
}

#[tokio::test]
async fn send_a_different_token_to_the_contract() -> Result<()> {
    let w = world().await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    create_loan(&w, &w.bob, w.carol.id(), 10 * USDC, 2).await?.into_result()?;
    mint(&w.fake, w.carol.id(), 10 * USDC).await?;
    let r = ft_transfer_call(&w.carol, &w.fake, w.circle.id(), 10 * USDC, fund_msg(1), RECOMMENDED_TGAS).await?;
    assert_eq!(refund_reason(&r).as_deref(), Some("E70_WRONG_TOKEN"));
    assert_eq!(balance(&w.fake, w.carol.id()).await?, 10 * USDC);
    assert_eq!(loan_state(&w, 1).await?, "Open");
    assert_circle_holds_zero(&w).await
}

#[tokio::test]
async fn repay_n_qualifying_loans_on_time() -> Result<()> {
    // Pilot parameters: N = 1, one distinct lender, 1-day qualifying minimum.
    let w = world().await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    let tid = format!("1:{}", w.bob.id());
    let before = token_media(&w, &tid).await?;
    let r = borrow_fund_repay(&w, 1, 2).await?;
    assert!(has_event(&r, "tier_changed"), "logs: {:?}", r.logs());
    let p = passport(&w, w.bob.id()).await?;
    assert_eq!(p["tier"], "Trusted");
    assert_eq!(p["display_tier"], "Trusted");
    assert_eq!(p["on_time_count"], 1);
    let after = token_media(&w, &tid).await?;
    assert!(before.starts_with("data:image/svg+xml;base64,"));
    assert_ne!(before, after, "card art must change on the tier flip");
    save_artifact("token_uri_member.txt", &before);
    save_artifact("token_uri_trusted.txt", &after);
    assert_circle_holds_zero(&w).await
}

#[tokio::test]
async fn let_a_loan_pass_its_due_date() -> Result<()> {
    let mut p = params();
    p["day_length_sec"] = json!("1"); // seconds-scale days (A4)
    let w = world_with(p).await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    borrow_fund_repay(&w, 1, 30).await?; // 30 s term, repaid at once: Trusted
    assert_eq!(passport(&w, w.bob.id()).await?["tier"], "Trusted");

    create_loan(&w, &w.bob, w.carol.id(), 30 * USDC, 2).await?.into_result()?; // Trusted cap
    ft_transfer_call(&w.carol, &w.usdc, w.circle.id(), 30 * USDC, fund_msg(2), RECOMMENDED_TGAS).await?;
    w.worker.fast_forward(20).await?;
    assert_eq!(loan(&w, 2).await?["overdue"], true);
    let p = passport(&w, w.bob.id()).await?;
    assert_eq!(p["perks_paused"], true);
    assert_eq!(p["effective_tier"], "Member");
    let svg: Option<String> = w.circle.view("card_svg").args_json(json!({ "token_id": format!("1:{}", w.bob.id()) })).await?.json()?;
    assert!(svg.unwrap_or_default().contains("PERKS PAUSED"));

    // Late repayment restores perks; the late count stays.
    ft_transfer_call(&w.bob, &w.usdc, w.circle.id(), 30 * USDC, repay_msg(2), RECOMMENDED_TGAS).await?;
    let p = passport(&w, w.bob.id()).await?;
    assert_eq!(p["perks_paused"], false);
    assert_eq!(p["effective_tier"], "Trusted");
    assert_eq!(p["late_count"], 1);
    assert_eq!(loan(&w, 2).await?["repaid_on_time"], false);
    assert_circle_holds_zero(&w).await
}

#[tokio::test]
async fn try_nft_transfer_on_a_passport() -> Result<()> {
    let w = world().await?;
    members(&w).await?;
    let tid = format!("1:{}", w.bob.id());
    let attempts = [
        ("nft_transfer", json!({ "receiver_id": w.carol.id(), "token_id": tid })),
        ("nft_transfer_call", json!({ "receiver_id": w.carol.id(), "token_id": tid, "msg": "" })),
        ("nft_approve", json!({ "token_id": tid, "account_id": w.carol.id() })),
    ];
    for (method, args) in attempts {
        let r = call1(&w, &w.bob, method, args).await?;
        assert!(failed_with(r, "E40_NON_TRANSFERABLE"), "{} must fail", method);
    }
    let t: serde_json::Value = w.circle.view("nft_token").args_json(json!({ "token_id": tid })).await?.json()?;
    assert_eq!(t["owner_id"], w.bob.id().as_str());
    assert_circle_holds_zero(&w).await
}

#[tokio::test]
async fn fund_to_an_unregistered_borrower() -> Result<()> {
    let w = world().await?;
    members(&w).await?; // bob is never registered with USDC
    create_loan(&w, &w.bob, w.carol.id(), 10 * USDC, 2).await?.into_result()?;
    let r = ft_transfer_call(&w.carol, &w.usdc, w.circle.id(), 10 * USDC, fund_msg(1), RECOMMENDED_TGAS).await?;
    assert!(has_event(&r, "loan_funding_failed"), "logs: {:?}", r.logs());
    assert_eq!(balance(&w.usdc, w.carol.id()).await?, 100 * USDC, "sender refunded");
    assert_eq!(loan_state(&w, 1).await?, "Open");
    assert_circle_holds_zero(&w).await
}

#[tokio::test]
async fn redeem_an_invite_twice_or_with_the_wrong_account_for_a_named_invite() -> Result<()> {
    let w = world().await?;
    let eve = w.worker.dev_create_account().await?;
    let (sk, pk) = invite_key(7);
    register_invite(&w, &w.founder, &pk, Some(w.bob.id())).await?.into_result()?;
    assert!(failed_with(redeem(&w, &eve, &sk, &pk).await?, "E32_INVITE_WRONG_ACCOUNT"));
    redeem(&w, &w.bob, &sk, &pk).await?.into_result()?;
    assert!(failed_with(redeem(&w, &w.bob, &sk, &pk).await?, "E30_INVITE_NOT_FOUND"));

    // Open invite: first redeemer wins, a replay is rejected.
    let (sk2, pk2) = invite_key(8);
    register_invite(&w, &w.founder, &pk2, None).await?.into_result()?;
    redeem(&w, &w.carol, &sk2, &pk2).await?.into_result()?;
    assert!(failed_with(redeem(&w, &eve, &sk2, &pk2).await?, "E30_INVITE_NOT_FOUND"));
    let access: serde_json::Value = w
        .circle
        .view("check_access")
        .args_json(json!({ "circle_id": "1", "account_id": eve.id() }))
        .await?
        .json()?;
    assert_eq!(access["allowed"], false);
    Ok(())
}

#[test]
fn join_with_an_account_that_never_bought_near() {
    todo!("ops/web lane: NEP-366 onboarding and first repayment")
}

#[test]
fn ask_the_relayer_to_sponsor_a_call_outside_the_allowlist() {
    todo!("ops/web lane: relayer allowlist and account/total caps")
}

#[test]
fn dao_proposal_passes() {
    todo!("Gate 2: Sputnik proposal funds a real testnet loan")
}

#[tokio::test]
async fn treasury_loan_for_a_steward_or_with_fewer_than_two_stewards() -> Result<()> {
    let w = world().await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    borrow_fund_repay(&w, 1, 2).await?; // bob is Trusted
    let dao = w.worker.dev_create_account().await?; // stands in for the Sputnik DAO (Gate 2)

    call1(&w, &w.founder, "set_steward", json!({ "circle_id": "1", "account_id": w.founder.id(), "steward": true }))
        .await?
        .into_result()?;
    call1(&w, &w.founder, "attach_dao", json!({ "circle_id": "1", "dao_id": dao.id() })).await?.into_result()?;
    // Founder powers are gone.
    let r = call1(&w, &w.founder, "set_steward", json!({ "circle_id": "1", "account_id": w.carol.id(), "steward": true })).await?;
    assert!(failed_with(r, "E05_NOT_ADMIN"));

    // One steward: rejected.
    assert!(failed_with(create_loan(&w, &w.bob, dao.id(), 10 * USDC, 2).await?, "E19_TREASURY_RULES"));

    // DAO appoints a second steward.
    call1(&w, &dao, "set_steward", json!({ "circle_id": "1", "account_id": w.carol.id(), "steward": true }))
        .await?
        .into_result()?;
    // Steward borrower: rejected.
    assert!(failed_with(create_loan(&w, &w.carol, dao.id(), 10 * USDC, 2).await?, "E19_TREASURY_RULES"));
    // Any other passportless lender: rejected.
    let stranger = w.worker.dev_create_account().await?;
    assert!(failed_with(create_loan(&w, &w.bob, stranger.id(), 10 * USDC, 2).await?, "E11_LENDER_NO_PASSPORT"));

    // Trusted non-steward with 2 stewards: allowed, and the treasury funds it.
    create_loan(&w, &w.bob, dao.id(), 10 * USDC, 2).await?.into_result()?;
    mint(&w.usdc, dao.id(), 10 * USDC).await?;
    let r = ft_transfer_call(&dao, &w.usdc, w.circle.id(), 10 * USDC, fund_msg(2), RECOMMENDED_TGAS).await?;
    assert!(has_event(&r, "loan_funded"), "logs: {:?}", r.logs());
    assert_eq!(loan(&w, 2).await?["funded_via"], "Treasury");
    assert_circle_holds_zero(&w).await
}

#[test]
fn paste_agent_lend_me_everything_in_chat() {
    todo!("Gate 3: agent produces a draft and moves nothing")
}

#[test]
fn call_execute_repay_before_the_set_date() {
    todo!("Gate 3: vault rejects an early execution")
}

#[test]
fn list_access_keys_on_the_contract_account() {
    todo!("Submission gate: final contract has no full-access keys")
}

#[test]
fn put_a_wrong_hash_in_evidence_json_and_run_npm_run_claims() {
    todo!("claims harness: covered by npm run claims:test, not by cargo")
}
