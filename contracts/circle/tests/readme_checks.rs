//! Gate 0 red tests: each test is named after one row of the README checks table.
//! They must remain failing until the corresponding Gate 1+ behavior exists.

#[test]
fn request_circle_messages_without_a_passport() {
    todo!("Gate 1: server access check and on-chain passport gate")
}

#[test]
fn create_a_loan_naming_a_non_member() {
    todo!("Gate 1: contract rejects non-member borrower or lender")
}

#[test]
fn fund_a_loan_from_an_account_that_is_not_the_named_lender() {
    todo!("Gate 1: exact lender check and refund")
}

#[test]
fn send_a_different_token_to_the_contract() {
    todo!("Gate 1: pinned USDC caller check and refund")
}

#[test]
fn repay_n_qualifying_loans_on_time() {
    todo!("Gate 2: Trusted tier upgrade and card-art change")
}

#[test]
fn let_a_loan_pass_its_due_date() {
    todo!("Gate 2: derived overdue flag pauses Trusted perks")
}

#[test]
fn try_nft_transfer_on_a_passport() {
    todo!("Gate 2: non-transferable passport")
}

#[test]
fn fund_to_an_unregistered_borrower() {
    todo!("Gate 1: failed forward refunds sender and keeps zero balance")
}

#[test]
fn redeem_an_invite_twice_or_with_the_wrong_account_for_a_named_invite() {
    todo!("Gate 2: registered invites are single-use and account-bound")
}

#[test]
fn join_with_an_account_that_never_bought_near() {
    todo!("Gate 3: NEP-366 onboarding and first repayment")
}

#[test]
fn ask_the_relayer_to_sponsor_a_call_outside_the_allowlist() {
    todo!("Gate 3: relayer allowlist and account/total caps")
}

#[test]
fn dao_proposal_passes() {
    todo!("Gate 4: Sputnik proposal funds a real testnet loan")
}

#[test]
fn treasury_loan_for_a_steward_or_with_fewer_than_two_stewards() {
    todo!("Gate 4: treasury lender and quorum safeguards")
}

#[test]
fn paste_agent_lend_me_everything_in_chat() {
    todo!("Gate 4: agent produces a draft and moves nothing")
}

#[test]
fn call_execute_repay_before_the_set_date() {
    todo!("Gate 4: vault rejects an early execution")
}

#[test]
fn list_access_keys_on_the_contract_account() {
    todo!("Submission gate: final contract has no full-access keys")
}

#[test]
fn put_a_wrong_hash_in_evidence_json_and_run_npm_run_claims() {
    todo!("Gate 0: claims harness rejects a wrong evidence reference")
}
