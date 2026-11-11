//! Unit tests (mocked VM). Cross-contract money paths are proven again in the
//! sandbox tests under `tests/`; these cover every state transition and gate.

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, Gas, NearToken, PromiseOrValue, PromiseResult};

const USDC: &str = "usdc.near";
const VAULT: &str = "vault.near";
const CIRCLE: &str = "circle.near";
const DAY: u64 = 10; // seconds per "day" in these tests
const SEC: u64 = 1_000_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

struct Env {
    now_ns: u64,
}

impl Env {
    fn ctx(&self, predecessor: &str, deposit: NearToken, gas_tgas: u64) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc(CIRCLE))
            .predecessor_account_id(acc(predecessor))
            .signer_account_id(acc(predecessor))
            .attached_deposit(deposit)
            .prepaid_gas(Gas::from_tgas(gas_tgas))
            .block_timestamp(self.now_ns)
            .account_balance(NearToken::from_near(1000));
        b
    }
    fn call(&self, who: &str, deposit: NearToken) {
        testing_env!(self.ctx(who, deposit, 300).build());
    }
    fn callback(&self, result: PromiseResult) {
        testing_env!(
            self.ctx(CIRCLE, NearToken::from_yoctonear(0), 300).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![result]
        );
    }
}

fn big() -> NearToken {
    NearToken::from_near(1)
}

fn params() -> CircleParams {
    CircleParams {
        min_amount: U128(1_000_000),
        member_max_amount: U128(20_000_000),
        trusted_max_amount: U128(50_000_000),
        max_duration_days: 30,
        day_length_sec: U64(DAY),
        funding_window_sec: U64(100),
        qualifying_min_amount: U128(1_000_000),
        qualifying_min_days: 1,
        trusted_threshold: 1,
        min_distinct_lenders: 1,
        recovery_lock_sec: U64(0),
        writeoff_grace_sec: U64(30),
    }
}

fn floors_zero() -> Floors {
    Floors {
        funding_window_sec: U64(0),
        qualifying_duration_sec: U64(0),
        recovery_lock_sec: U64(0),
        day_length_sec: U64(0),
    }
}

fn setup() -> (Contract, Env) {
    let e = Env { now_ns: 1_000 * SEC };
    e.call(CIRCLE, NearToken::from_yoctonear(0));
    let mut c = Contract::new(acc(USDC), acc(VAULT), U128(50_000_000), floors_zero());
    e.call("founder.near", big());
    let cid = c.create_circle("Pilot".into(), params());
    assert_eq!(cid.0, 1);
    (c, e)
}

fn invite_key(seed: u8) -> (SigningKey, String) {
    let sk = SigningKey::from_bytes(&[seed; 32]);
    let pk = format!("ed25519:{}", bs58::encode(sk.verifying_key().to_bytes()).into_string());
    (sk, pk)
}

fn join(c: &mut Contract, e: &Env, inviter: &str, who: &str, seed: u8) {
    let (sk, pk) = invite_key(seed);
    e.call(inviter, big());
    c.register_invite(U64(1), pk.clone(), U64(e.now_ns + 1_000 * SEC), Some(acc(who)));
    let msg = invites::invite_message(&acc(CIRCLE), 1, &acc(who), &pk);
    let sig = sk.sign(&msg).to_bytes().to_vec();
    e.call(who, big());
    c.redeem_invite(U64(1), pk, Base64VecU8(sig));
}

fn fund_msg(id: u64) -> String {
    format!("{{\"action\":\"fund\",\"loan_id\":\"{}\"}}", id)
}

fn repay_msg(id: u64) -> String {
    format!("{{\"action\":\"repay\",\"loan_id\":\"{}\"}}", id)
}

fn value(r: PromiseOrValue<U128>) -> Option<u128> {
    match r {
        PromiseOrValue::Value(v) => Some(v.0),
        PromiseOrValue::Promise(_) => None,
    }
}

/// founder + bob + carol joined; bob borrows 10 USDC from carol for 2 days.
fn with_loan() -> (Contract, Env) {
    let (mut c, e) = setup();
    join(&mut c, &e, "founder.near", "bob.near", 1);
    join(&mut c, &e, "founder.near", "carol.near", 2);
    e.call("bob.near", big());
    let id = c.create_loan(U64(1), acc("carol.near"), U128(10_000_000), 2);
    assert_eq!(id.0, 1);
    (c, e)
}

fn state(c: &Contract, id: u64) -> LoanStateView {
    c.get_loan(U64(id)).unwrap().state
}

fn fund_ok(c: &mut Contract, e: &Env) {
    e.call(USDC, NearToken::from_yoctonear(0));
    let r = c.ft_on_transfer(acc("carol.near"), U128(10_000_000), fund_msg(1));
    assert!(value(r).is_none(), "funding must forward");
    assert_eq!(state(c, 1), LoanStateView::Funding);
    e.callback(PromiseResult::Successful(vec![]));
    assert_eq!(c.on_fund_forwarded(U64(1), U128(10_000_000)).0, 0);
    assert_eq!(state(c, 1), LoanStateView::Funded);
}

// ------------------------------------------------------------ circles

#[test]
fn founder_gets_member_passport_and_is_admin() {
    let (c, _e) = setup();
    let v = c.get_circle(U64(1)).unwrap();
    assert_eq!(v.admin_id, acc("founder.near"));
    assert_eq!(v.member_count, 1);
    let p = c.passport_for(U64(1), acc("founder.near")).unwrap();
    assert_eq!(p.tier, Tier::Member);
    assert_eq!(p.token_id, "1:founder.near");
}

#[test]
#[should_panic(expected = "E04_BAD_PARAMS")]
fn day_length_below_mainnet_floor_is_rejected() {
    let e = Env { now_ns: SEC };
    e.call(CIRCLE, NearToken::from_yoctonear(0));
    let mut f = floors_zero();
    f.day_length_sec = U64(86_400);
    let mut c = Contract::new(acc(USDC), acc(VAULT), U128(50_000_000), f);
    e.call("founder.near", big());
    c.create_circle("x".into(), params()); // DAY = 10 s < 86400
}

#[test]
#[should_panic(expected = "E04_BAD_PARAMS")]
fn circle_cap_above_hard_cap_is_rejected() {
    let e = Env { now_ns: SEC };
    e.call(CIRCLE, NearToken::from_yoctonear(0));
    let mut c = Contract::new(acc(USDC), acc(VAULT), U128(50_000_000), floors_zero());
    let mut p = params();
    p.trusted_max_amount = U128(50_000_001);
    e.call("founder.near", big());
    c.create_circle("x".into(), p);
}

#[test]
fn min_distinct_lenders_is_clamped_to_threshold() {
    let e = Env { now_ns: SEC };
    e.call(CIRCLE, NearToken::from_yoctonear(0));
    let mut c = Contract::new(acc(USDC), acc(VAULT), U128(50_000_000), floors_zero());
    let mut p = params();
    p.min_distinct_lenders = 2; // pilot N = 1
    e.call("founder.near", big());
    c.create_circle("x".into(), p);
    assert_eq!(c.get_circle(U64(1)).unwrap().params.min_distinct_lenders, 1);
}

// ------------------------------------------------------------ invites

#[test]
fn invite_register_and_redeem_mints_passport() {
    let (mut c, e) = setup();
    join(&mut c, &e, "founder.near", "bob.near", 1);
    let p = c.passport_for(U64(1), acc("bob.near")).unwrap();
    assert_eq!(p.invited_by, Some(acc("founder.near")));
    assert!(c.check_access(U64(1), acc("bob.near")).allowed);
    assert_eq!(c.nft_supply_for_owner(acc("bob.near")).0, 1);
}

#[test]
#[should_panic(expected = "E30_INVITE_NOT_FOUND")]
fn invite_replay_is_rejected() {
    let (mut c, e) = setup();
    let (sk, pk) = invite_key(1);
    e.call("founder.near", big());
    c.register_invite(U64(1), pk.clone(), U64(e.now_ns + 1_000 * SEC), None);
    let sig = sk.sign(&invites::invite_message(&acc(CIRCLE), 1, &acc("bob.near"), &pk)).to_bytes().to_vec();
    e.call("bob.near", big());
    c.redeem_invite(U64(1), pk.clone(), Base64VecU8(sig));
    let sig2 = sk.sign(&invites::invite_message(&acc(CIRCLE), 1, &acc("eve.near"), &pk)).to_bytes().to_vec();
    e.call("eve.near", big());
    c.redeem_invite(U64(1), pk, Base64VecU8(sig2));
}

#[test]
#[should_panic(expected = "E31_INVITE_EXPIRED")]
fn expired_invite_is_rejected() {
    let (mut c, mut e) = setup();
    let (sk, pk) = invite_key(1);
    e.call("founder.near", big());
    c.register_invite(U64(1), pk.clone(), U64(e.now_ns + 5 * SEC), None);
    e.now_ns += 6 * SEC;
    let sig = sk.sign(&invites::invite_message(&acc(CIRCLE), 1, &acc("bob.near"), &pk)).to_bytes().to_vec();
    e.call("bob.near", big());
    c.redeem_invite(U64(1), pk, Base64VecU8(sig));
}

#[test]
#[should_panic(expected = "E32_INVITE_WRONG_ACCOUNT")]
fn named_invite_wrong_account_is_rejected() {
    let (mut c, e) = setup();
    let (sk, pk) = invite_key(1);
    e.call("founder.near", big());
    c.register_invite(U64(1), pk.clone(), U64(e.now_ns + 1_000 * SEC), Some(acc("bob.near")));
    let sig = sk.sign(&invites::invite_message(&acc(CIRCLE), 1, &acc("eve.near"), &pk)).to_bytes().to_vec();
    e.call("eve.near", big());
    c.redeem_invite(U64(1), pk, Base64VecU8(sig));
}

#[test]
#[should_panic(expected = "E33_INVITE_BAD_SIGNATURE")]
fn signature_for_another_contract_is_rejected() {
    let (mut c, e) = setup();
    let (sk, pk) = invite_key(1);
    e.call("founder.near", big());
    c.register_invite(U64(1), pk.clone(), U64(e.now_ns + 1_000 * SEC), None);
    let sig = sk
        .sign(&invites::invite_message(&acc("other-circle.near"), 1, &acc("bob.near"), &pk))
        .to_bytes()
        .to_vec();
    e.call("bob.near", big());
    c.redeem_invite(U64(1), pk, Base64VecU8(sig));
}

#[test]
#[should_panic(expected = "E34_NOT_INVITER")]
fn member_cannot_invite() {
    let (mut c, e) = setup();
    join(&mut c, &e, "founder.near", "bob.near", 1);
    let (_, pk) = invite_key(9);
    e.call("bob.near", big());
    c.register_invite(U64(1), pk, U64(e.now_ns + 1_000 * SEC), None);
}

#[test]
#[should_panic(expected = "E34_NOT_INVITER")]
fn founder_cannot_invite_after_attach_dao_unless_trusted() {
    let (mut c, e) = setup();
    e.call("founder.near", NearToken::from_yoctonear(1));
    c.attach_dao(U64(1), acc("dao.near"));
    let (_, pk) = invite_key(9);
    e.call("founder.near", big());
    c.register_invite(U64(1), pk, U64(e.now_ns + 1_000 * SEC), None);
}

// ------------------------------------------------------------ loans

#[test]
#[should_panic(expected = "E11_LENDER_NO_PASSPORT")]
fn create_a_loan_naming_a_non_member_lender() {
    let (mut c, e) = setup();
    join(&mut c, &e, "founder.near", "bob.near", 1);
    e.call("bob.near", big());
    c.create_loan(U64(1), acc("stranger.near"), U128(10_000_000), 2);
}

#[test]
#[should_panic(expected = "E10_NO_PASSPORT")]
fn non_member_borrower_is_rejected() {
    let (mut c, e) = setup();
    e.call("stranger.near", big());
    c.create_loan(U64(1), acc("founder.near"), U128(10_000_000), 2);
}

#[test]
#[should_panic(expected = "E14_AMOUNT_OUT_OF_RANGE")]
fn member_cap_is_enforced() {
    let (mut c, e) = setup();
    join(&mut c, &e, "founder.near", "bob.near", 1);
    e.call("bob.near", big());
    c.create_loan(U64(1), acc("founder.near"), U128(20_000_001), 2);
}

#[test]
#[should_panic(expected = "E16_OPEN_LOAN_LIMIT")]
fn member_has_one_open_loan() {
    let (mut c, e) = with_loan();
    e.call("bob.near", big());
    c.create_loan(U64(1), acc("founder.near"), U128(5_000_000), 2);
}

#[test]
fn lapsed_window_is_cancelled_without_cron_and_frees_the_slot() {
    let (mut c, mut e) = with_loan();
    e.now_ns += 101 * SEC;
    e.call("bob.near", big());
    let v = c.get_loan(U64(1)).unwrap();
    assert_eq!(v.state, LoanStateView::Cancelled);
    assert_eq!(v.cancel_reason, Some(CancelReason::Lapsed));
    // funding after lapse is refunded
    e.call(USDC, NearToken::from_yoctonear(0));
    assert_eq!(value(c.ft_on_transfer(acc("carol.near"), U128(10_000_000), fund_msg(1))), Some(10_000_000));
    // slot is free again
    e.call("bob.near", big());
    assert_eq!(c.create_loan(U64(1), acc("carol.near"), U128(5_000_000), 2).0, 2);
}

#[test]
fn cancel_while_open() {
    let (mut c, e) = with_loan();
    e.call("bob.near", NearToken::from_yoctonear(1));
    c.cancel_loan(U64(1));
    let v = c.get_loan(U64(1)).unwrap();
    assert_eq!(v.state, LoanStateView::Cancelled);
    assert_eq!(v.cancel_reason, Some(CancelReason::Borrower));
}

#[test]
fn wrong_token_wrong_lender_wrong_amount_bad_msg_are_refunded() {
    let (mut c, e) = with_loan();
    e.call("fake-usdc.near", NearToken::from_yoctonear(0));
    assert_eq!(value(c.ft_on_transfer(acc("carol.near"), U128(10_000_000), fund_msg(1))), Some(10_000_000));
    e.call(USDC, NearToken::from_yoctonear(0));
    assert_eq!(value(c.ft_on_transfer(acc("founder.near"), U128(10_000_000), fund_msg(1))), Some(10_000_000));
    assert_eq!(value(c.ft_on_transfer(acc("carol.near"), U128(9_999_999), fund_msg(1))), Some(9_999_999));
    assert_eq!(value(c.ft_on_transfer(acc("carol.near"), U128(10_000_000), "nope".into())), Some(10_000_000));
    assert_eq!(value(c.ft_on_transfer(acc("carol.near"), U128(10_000_000), fund_msg(99))), Some(10_000_000));
    // vault naming a different lender
    let m = "{\"action\":\"fund\",\"loan_id\":\"1\",\"lender_id\":\"founder.near\"}".to_string();
    assert_eq!(value(c.ft_on_transfer(acc(VAULT), U128(10_000_000), m)), Some(10_000_000));
    // repay on an Open loan
    assert_eq!(value(c.ft_on_transfer(acc("bob.near"), U128(1), repay_msg(1))), Some(1));
    assert_eq!(state(&c, 1), LoanStateView::Open);
}

#[test]
fn vault_naming_the_lender_can_fund() {
    let (mut c, e) = with_loan();
    e.call(USDC, NearToken::from_yoctonear(0));
    let m = "{\"action\":\"fund\",\"loan_id\":\"1\",\"lender_id\":\"carol.near\"}".to_string();
    assert!(value(c.ft_on_transfer(acc(VAULT), U128(10_000_000), m)).is_none());
    e.callback(PromiseResult::Successful(vec![]));
    c.on_fund_forwarded(U64(1), U128(10_000_000));
    assert_eq!(c.get_loan(U64(1)).unwrap().funded_via, Some(FundedVia::Vault));
}

#[test]
#[should_panic(expected = "E60_LOW_GAS")]
fn low_gas_fails_early() {
    let (mut c, e) = with_loan();
    testing_env!(e.ctx(USDC, NearToken::from_yoctonear(0), MIN_GAS_FT_ON_TRANSFER.as_tgas() - 1).build());
    c.ft_on_transfer(acc("carol.near"), U128(10_000_000), fund_msg(1));
}

#[test]
fn gas_at_minimum_is_accepted() {
    let (mut c, e) = with_loan();
    testing_env!(e.ctx(USDC, NearToken::from_yoctonear(0), MIN_GAS_FT_ON_TRANSFER.as_tgas()).build());
    assert!(value(c.ft_on_transfer(acc("carol.near"), U128(10_000_000), fund_msg(1))).is_none());
}

#[test]
fn double_fund_while_in_flight_is_refunded() {
    let (mut c, e) = with_loan();
    e.call(USDC, NearToken::from_yoctonear(0));
    assert!(value(c.ft_on_transfer(acc("carol.near"), U128(10_000_000), fund_msg(1))).is_none());
    assert_eq!(value(c.ft_on_transfer(acc("carol.near"), U128(10_000_000), fund_msg(1))), Some(10_000_000));
}

#[test]
fn failed_forward_reverts_to_open_and_returns_everything() {
    let (mut c, e) = with_loan();
    e.call(USDC, NearToken::from_yoctonear(0));
    c.ft_on_transfer(acc("carol.near"), U128(10_000_000), fund_msg(1));
    e.callback(PromiseResult::Failed);
    assert_eq!(c.on_fund_forwarded(U64(1), U128(10_000_000)).0, 10_000_000);
    let v = c.get_loan(U64(1)).unwrap();
    assert_eq!(v.state, LoanStateView::Open);
    assert_eq!(v.funded_via, None);
}

#[test]
fn funding_sets_due_at_from_funding_time() {
    let (mut c, mut e) = with_loan();
    e.now_ns += 7 * SEC;
    fund_ok(&mut c, &e);
    let v = c.get_loan(U64(1)).unwrap();
    assert_eq!(v.funded_at.unwrap().0, e.now_ns);
    assert_eq!(v.due_at.unwrap().0, e.now_ns + 2 * DAY * SEC);
}

#[test]
fn partial_then_full_on_time_repayment_upgrades_to_trusted() {
    let (mut c, e) = with_loan();
    fund_ok(&mut c, &e);
    let before = c.nft_token("1:bob.near".into()).unwrap().metadata.unwrap().media.unwrap();
    // partial
    e.call(USDC, NearToken::from_yoctonear(0));
    c.ft_on_transfer(acc("anyone.near"), U128(4_000_000), repay_msg(1));
    assert_eq!(state(&c, 1), LoanStateView::Repaying);
    e.callback(PromiseResult::Successful(vec![]));
    assert_eq!(c.on_repay_forwarded(U64(1), U128(4_000_000), U128(4_000_000)).0, 0);
    let v = c.get_loan(U64(1)).unwrap();
    assert_eq!(v.state, LoanStateView::Funded);
    assert_eq!(v.outstanding.0, 6_000_000);
    // overpay: 7 sent, 6 applied, 1 returned
    e.call(USDC, NearToken::from_yoctonear(0));
    c.ft_on_transfer(acc("bob.near"), U128(7_000_000), repay_msg(1));
    e.callback(PromiseResult::Successful(vec![]));
    assert_eq!(c.on_repay_forwarded(U64(1), U128(6_000_000), U128(7_000_000)).0, 1_000_000);
    let v = c.get_loan(U64(1)).unwrap();
    assert_eq!(v.state, LoanStateView::Repaid);
    assert_eq!(v.repaid_on_time, Some(true));
    let p = c.passport_for(U64(1), acc("bob.near")).unwrap();
    assert_eq!(p.tier, Tier::Trusted);
    assert_eq!(p.on_time_count, 1);
    assert_eq!(p.open_loans, 0);
    let after = c.nft_token("1:bob.near".into()).unwrap().metadata.unwrap().media.unwrap();
    assert_ne!(before, after, "card art must change on a tier flip");
}

#[test]
fn failed_repay_forward_returns_everything_and_stays_funded() {
    let (mut c, e) = with_loan();
    fund_ok(&mut c, &e);
    e.call(USDC, NearToken::from_yoctonear(0));
    c.ft_on_transfer(acc("bob.near"), U128(10_000_000), repay_msg(1));
    e.callback(PromiseResult::Failed);
    assert_eq!(c.on_repay_forwarded(U64(1), U128(10_000_000), U128(10_000_000)).0, 10_000_000);
    let v = c.get_loan(U64(1)).unwrap();
    assert_eq!(v.state, LoanStateView::Funded);
    assert_eq!(v.total_repaid.0, 0);
}

#[test]
fn overdue_pauses_trusted_perks_and_late_repayment_restores_them() {
    let (mut c, mut e) = with_loan();
    fund_ok(&mut c, &e);
    e.call(USDC, NearToken::from_yoctonear(0));
    c.ft_on_transfer(acc("bob.near"), U128(10_000_000), repay_msg(1));
    e.callback(PromiseResult::Successful(vec![]));
    c.on_repay_forwarded(U64(1), U128(10_000_000), U128(10_000_000));
    // second loan as Trusted, then let it go overdue
    e.call("bob.near", big());
    c.create_loan(U64(1), acc("carol.near"), U128(30_000_000), 1);
    e.call(USDC, NearToken::from_yoctonear(0));
    c.ft_on_transfer(acc("carol.near"), U128(30_000_000), fund_msg(2));
    e.callback(PromiseResult::Successful(vec![]));
    c.on_fund_forwarded(U64(2), U128(30_000_000));
    e.now_ns += 2 * DAY * SEC;
    e.call("bob.near", big());
    let p = c.passport_for(U64(1), acc("bob.near")).unwrap();
    assert!(c.get_loan(U64(2)).unwrap().overdue);
    assert!(p.perks_paused);
    assert_eq!(p.effective_tier, Tier::Member);
    // late repayment restores perks, late count stays
    e.call(USDC, NearToken::from_yoctonear(0));
    c.ft_on_transfer(acc("bob.near"), U128(30_000_000), repay_msg(2));
    e.callback(PromiseResult::Successful(vec![]));
    c.on_repay_forwarded(U64(2), U128(30_000_000), U128(30_000_000));
    let p = c.passport_for(U64(1), acc("bob.near")).unwrap();
    assert!(!p.perks_paused);
    assert_eq!(p.effective_tier, Tier::Trusted);
    assert_eq!(p.late_count, 1);
    // admin clears the flag
    e.call("founder.near", NearToken::from_yoctonear(1));
    c.clear_flag(U64(2));
    assert_eq!(c.passport_for(U64(1), acc("bob.near")).unwrap().late_count, 0);
}

#[test]
fn revoked_borrower_loan_stays_payable_and_access_stops() {
    let (mut c, e) = with_loan();
    fund_ok(&mut c, &e);
    e.call("founder.near", NearToken::from_yoctonear(1));
    c.set_passport_status(U64(1), acc("bob.near"), PassportStatus::Revoked);
    assert!(!c.check_access(U64(1), acc("bob.near")).allowed);
    e.call(USDC, NearToken::from_yoctonear(0));
    assert!(value(c.ft_on_transfer(acc("bob.near"), U128(10_000_000), repay_msg(1))).is_none());
    e.callback(PromiseResult::Successful(vec![]));
    c.on_repay_forwarded(U64(1), U128(10_000_000), U128(10_000_000));
    assert_eq!(state(&c, 1), LoanStateView::Repaid);
}

#[test]
fn revoked_lender_cannot_fund() {
    let (mut c, e) = with_loan();
    e.call("founder.near", NearToken::from_yoctonear(1));
    c.set_passport_status(U64(1), acc("carol.near"), PassportStatus::Suspended);
    e.call(USDC, NearToken::from_yoctonear(0));
    assert_eq!(value(c.ft_on_transfer(acc("carol.near"), U128(10_000_000), fund_msg(1))), Some(10_000_000));
}

// ------------------------------------------------------------ passport NFT

#[test]
#[should_panic(expected = "E40_NON_TRANSFERABLE")]
fn try_nft_transfer_on_a_passport() {
    let (mut c, e) = setup();
    e.call("founder.near", NearToken::from_yoctonear(1));
    c.nft_transfer(acc("bob.near"), "1:founder.near".into(), None, None);
}

#[test]
#[should_panic(expected = "E40_NON_TRANSFERABLE")]
fn nft_approve_fails() {
    let (mut c, e) = setup();
    e.call("founder.near", NearToken::from_yoctonear(1));
    c.nft_approve("1:founder.near".into(), acc("bob.near"), None);
}

#[test]
fn card_art_is_deterministic_and_has_no_account_id() {
    let (c, _e) = setup();
    let a = c.card_svg("1:founder.near".into()).unwrap();
    let b = c.card_svg("1:founder.near".into()).unwrap();
    assert_eq!(a, b);
    assert!(!a.contains("founder"));
    assert!(a.starts_with("<svg"));
}

#[test]
fn base64_matches_rfc4648_vectors() {
    assert_eq!(art::base64(b""), "");
    assert_eq!(art::base64(b"f"), "Zg==");
    assert_eq!(art::base64(b"fo"), "Zm8=");
    assert_eq!(art::base64(b"foo"), "Zm9v");
    assert_eq!(art::base64(b"foobar"), "Zm9vYmFy");
}

// ------------------------------------------------------------ treasury hooks

/// bob becomes Trusted; dao attached; returns (contract, env).
fn treasury_setup(stewards: &[&str]) -> (Contract, Env) {
    let (mut c, e) = with_loan();
    fund_ok(&mut c, &e);
    e.call(USDC, NearToken::from_yoctonear(0));
    c.ft_on_transfer(acc("bob.near"), U128(10_000_000), repay_msg(1));
    e.callback(PromiseResult::Successful(vec![]));
    c.on_repay_forwarded(U64(1), U128(10_000_000), U128(10_000_000));
    for s in stewards {
        e.call("founder.near", NearToken::from_yoctonear(1));
        c.set_steward(U64(1), acc(s), true);
    }
    e.call("founder.near", NearToken::from_yoctonear(1));
    c.attach_dao(U64(1), acc("dao.near"));
    (c, e)
}

#[test]
fn treasury_loan_with_two_stewards_works() {
    let (mut c, e) = treasury_setup(&["founder.near", "carol.near"]);
    e.call("bob.near", big());
    c.create_loan(U64(1), acc("dao.near"), U128(10_000_000), 2);
    e.call(USDC, NearToken::from_yoctonear(0));
    assert!(value(c.ft_on_transfer(acc("dao.near"), U128(10_000_000), fund_msg(2))).is_none());
}

#[test]
#[should_panic(expected = "E19_TREASURY_RULES")]
fn treasury_loan_with_one_steward_is_rejected() {
    let (mut c, e) = treasury_setup(&["founder.near"]);
    e.call("bob.near", big());
    c.create_loan(U64(1), acc("dao.near"), U128(10_000_000), 2);
}

#[test]
#[should_panic(expected = "E19_TREASURY_RULES")]
fn treasury_loan_for_a_steward_is_rejected() {
    let (mut c, e) = treasury_setup(&["founder.near", "carol.near", "bob.near"]);
    e.call("bob.near", big());
    c.create_loan(U64(1), acc("dao.near"), U128(10_000_000), 2);
}

#[test]
#[should_panic(expected = "E11_LENDER_NO_PASSPORT")]
fn other_passportless_lender_is_rejected() {
    let (mut c, e) = treasury_setup(&["founder.near", "carol.near"]);
    e.call("bob.near", big());
    c.create_loan(U64(1), acc("not-the-dao.near"), U128(10_000_000), 2);
}

#[test]
#[should_panic(expected = "E06_DAO_ALREADY_ATTACHED")]
fn attach_dao_is_one_time() {
    let (mut c, e) = setup();
    e.call("founder.near", NearToken::from_yoctonear(1));
    c.attach_dao(U64(1), acc("dao.near"));
    e.call("founder.near", NearToken::from_yoctonear(1));
    c.attach_dao(U64(1), acc("dao2.near"));
}

#[test]
#[should_panic(expected = "E05_NOT_ADMIN")]
fn founder_loses_admin_after_attach_dao() {
    let (mut c, e) = setup();
    e.call("founder.near", NearToken::from_yoctonear(1));
    c.attach_dao(U64(1), acc("dao.near"));
    e.call("founder.near", NearToken::from_yoctonear(1));
    c.set_steward(U64(1), acc("founder.near"), true);
}

#[test]
#[should_panic(expected = "E50_RECOVERY_DISABLED")]
fn recovery_is_disabled() {
    let (mut c, e) = setup();
    e.call("founder.near", NearToken::from_yoctonear(1));
    c.start_recovery(U64(1), acc("new.near"));
}
