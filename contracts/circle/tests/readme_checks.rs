//! README checks table: each test is named after one row of the v3 README
//! checks. Rows not implemented yet stay red (todo!) until their gate.
//! Contract rows run in the sandbox; see tests/common/mod.rs for the harness.

mod common;

use anyhow::Result;
use common::*;

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

#[test]
fn repay_n_qualifying_loans_on_time() {
    todo!("Gate 1 phase 1C: Trusted tier upgrade and card-art change")
}

#[test]
fn let_a_loan_pass_its_due_date() {
    todo!("Gate 1 phase 1C: derived overdue flag pauses Trusted perks")
}

#[test]
fn try_nft_transfer_on_a_passport() {
    todo!("Gate 1 phase 1C: non-transferable passport")
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

#[test]
fn redeem_an_invite_twice_or_with_the_wrong_account_for_a_named_invite() {
    todo!("Gate 1 phase 1C: registered invites are single-use and account-bound")
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

#[test]
fn treasury_loan_for_a_steward_or_with_fewer_than_two_stewards() {
    todo!("Gate 1 phase 1D: treasury lender and steward-count safeguards")
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
