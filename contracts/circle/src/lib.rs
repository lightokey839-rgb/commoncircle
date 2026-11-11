//! CommonCircle `circle` contract.
//!
//! Interface: docs/CIRCLE_INTERFACE.md 1.0.0. Events: docs/EVENTS.md.
//! Invariants (AGENTS.md, Gate 1 rules):
//! - integer base units only; U128/U64 strings in JSON; no floats;
//! - every duration is a parameter (init floors + per-circle params);
//! - no owner, no admin over the contract, no upgrade path;
//! - transfer-driven state commits only in `#[private]` callbacks;
//! - the contract holds zero USDC at rest: funding and repayment are forwarded in
//!   the same receipt chain, and every rejected or failed transfer is returned
//!   to the sender as the unused amount.

use near_sdk::json_types::{U128, U64};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
};

pub mod art;
mod circles;
pub mod events;
mod invites;
pub mod themes;
mod loans;
pub mod types;
mod views;

#[cfg(test)]
mod tests;

pub use types::*;

pub const INTERFACE_VERSION: &str = "1.1.1";
pub const MAX_PAGE: u32 = 50;
pub const NS_PER_SEC: u64 = 1_000_000_000;
pub const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

/// Gas reserved for the `ft_transfer` that forwards funds (to borrower or lender).
pub const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
/// Gas reserved for `on_fund_forwarded` / `on_repay_forwarded`.
pub const GAS_CALLBACK: Gas = Gas::from_tgas(25);
/// `ft_on_transfer` rejects (panics, so USDC refunds) below this prepaid gas:
/// forward (15) + callback (25) + 30 Tgas for its own execution, which pays
/// the send/exec fees of the two receipts it creates (55 was measured too low
/// in the mocked VM: GasExceeded while scheduling).
pub const MIN_GAS_FT_ON_TRANSFER: Gas = Gas::from_tgas(70);
/// What clients should attach to `ft_transfer_call` on USDC.
pub const RECOMMENDED_FT_TRANSFER_CALL_TGAS: u64 = 150;

/// Extra bytes charged at `create_loan` so that callbacks (which add
/// `funded_at`, `due_at`, `repaid_at`, and possibly one lender on the borrower's
/// passport) never need storage the contract has not been paid for. This is
/// part of the "no stuck Funding/Repaying state" argument in docs/EVENTS.md.
pub const LOAN_GROWTH_RESERVE_BYTES: u64 = 256;
/// Upper bounds returned by `storage_costs()` (bytes). Excess is refunded.
pub const CIRCLE_STORAGE_BOUND_BYTES: u64 = 2_000;
pub const INVITE_STORAGE_BOUND_BYTES: u64 = 400;
pub const PASSPORT_STORAGE_BOUND_BYTES: u64 = 900;
pub const LOAN_STORAGE_BOUND_BYTES: u64 = 1_200;
/// Upper bound for one stored theme (12 KiB emblem + colours, tagline, key).
pub const THEME_STORAGE_BOUND_BYTES: u64 = 12_800;

/// Bounds that keep per-passport vectors small.
pub const MAX_TRUSTED_THRESHOLD: u32 = 50;
pub const MAX_STEWARDS: usize = 20;
pub const MAX_NAME_LEN: usize = 64;

pub const RECOVERY_ENABLED: bool = false;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
pub enum StorageKey {
    Circles,
    Loans,
    Passports,
    CircleMembers,
    CircleLoans,
    BorrowerLoanCount,
    BorrowerLoans,
    LenderLoanCount,
    LenderLoans,
    OwnerTokenCount,
    OwnerTokens,
    AllTokens,
    Invites,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub(crate) usdc_id: AccountId,
    pub(crate) vault_id: AccountId,
    pub(crate) hard_loan_cap: u128,
    pub(crate) floors: Floors,
    pub(crate) circles: Vector<Circle>,
    pub(crate) loans: Vector<Loan>,
    pub(crate) passports: LookupMap<(u64, AccountId), Passport>,
    pub(crate) circle_members: LookupMap<(u64, u32), AccountId>,
    pub(crate) circle_loans: LookupMap<(u64, u32), u64>,
    pub(crate) borrower_loan_count: LookupMap<AccountId, u32>,
    pub(crate) borrower_loans: LookupMap<(AccountId, u32), u64>,
    pub(crate) lender_loan_count: LookupMap<AccountId, u32>,
    pub(crate) lender_loans: LookupMap<(AccountId, u32), u64>,
    pub(crate) owner_token_count: LookupMap<AccountId, u32>,
    pub(crate) owner_tokens: LookupMap<(AccountId, u32), u64>,
    pub(crate) all_tokens: Vector<(u64, AccountId)>,
    pub(crate) invites: LookupMap<String, Invite>,
}

#[near]
impl Contract {
    /// One-time init by the contract account itself (deploy batch).
    #[init]
    #[private]
    pub fn new(usdc_id: AccountId, vault_id: AccountId, hard_loan_cap: U128, floors: Floors) -> Self {
        require!(hard_loan_cap.0 > 0, "E04_BAD_PARAMS: hard_loan_cap must be > 0");
        Self {
            usdc_id,
            vault_id,
            hard_loan_cap: hard_loan_cap.0,
            floors,
            circles: Vector::new(StorageKey::Circles),
            loans: Vector::new(StorageKey::Loans),
            passports: LookupMap::new(StorageKey::Passports),
            circle_members: LookupMap::new(StorageKey::CircleMembers),
            circle_loans: LookupMap::new(StorageKey::CircleLoans),
            borrower_loan_count: LookupMap::new(StorageKey::BorrowerLoanCount),
            borrower_loans: LookupMap::new(StorageKey::BorrowerLoans),
            lender_loan_count: LookupMap::new(StorageKey::LenderLoanCount),
            lender_loans: LookupMap::new(StorageKey::LenderLoans),
            owner_token_count: LookupMap::new(StorageKey::OwnerTokenCount),
            owner_tokens: LookupMap::new(StorageKey::OwnerTokens),
            all_tokens: Vector::new(StorageKey::AllTokens),
            invites: LookupMap::new(StorageKey::Invites),
        }
    }

    // Recovery is cut until everything else in 1B-1E is green (Gate 1 rule).
    // The methods exist so the interface is frozen; they always fail.

    #[payable]
    pub fn start_recovery(&mut self, circle_id: U64, new_account_id: AccountId) {
        let _ = (circle_id, new_account_id);
        env::panic_str("E50_RECOVERY_DISABLED: recovery is not available in this deployment");
    }

    #[payable]
    pub fn cancel_recovery(&mut self, circle_id: U64) {
        let _ = circle_id;
        env::panic_str("E50_RECOVERY_DISABLED: recovery is not available in this deployment");
    }

    #[payable]
    pub fn complete_recovery(&mut self, circle_id: U64, old_account_id: AccountId) -> String {
        let _ = (circle_id, old_account_id);
        env::panic_str("E50_RECOVERY_DISABLED: recovery is not available in this deployment");
    }
}

// ------------------------------------------------------------ internals

pub(crate) fn now() -> u64 {
    env::block_timestamp()
}

pub(crate) fn secs_to_ns(sec: u64) -> u64 {
    sec.checked_mul(NS_PER_SEC)
        .unwrap_or_else(|| env::panic_str("E04_BAD_PARAMS: duration overflows"))
}

/// Text shown on cards and in wallets must be plain: no control characters and
/// no invisible or direction-changing format characters (zero-width, bidi
/// overrides and isolates, BOM), which could be used to spoof another name.
pub(crate) fn is_plain_text(s: &str) -> bool {
    !s.chars().any(|c| {
        c.is_control()
            || matches!(c, '؜' | '​'..='‏' | '‪'..='‮' | '⁠'..='⁩' | '﻿')
    })
}

pub(crate) fn token_id(circle_id: u64, owner: &AccountId) -> String {
    format!("{}:{}", circle_id, owner)
}

pub(crate) fn parse_token_id(token_id: &str) -> Option<(u64, AccountId)> {
    let (cid, owner) = token_id.split_once(':')?;
    let cid: u64 = cid.parse().ok()?;
    let owner: AccountId = owner.parse().ok()?;
    Some((cid, owner))
}

pub(crate) fn page(from_index: Option<u32>, limit: Option<u32>) -> (u32, u32) {
    let from = from_index.unwrap_or(0);
    let limit = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE);
    (from, limit)
}

pub(crate) fn assert_one_yocto() {
    require!(
        env::attached_deposit() == ONE_YOCTO,
        "E03_ONE_YOCTO: attach exactly 1 yoctoNEAR"
    );
}

/// Charge the caller for storage added since `initial_usage` plus `reserve_bytes`,
/// refunding any excess deposit.
pub(crate) fn charge_storage(initial_usage: u64, reserve_bytes: u64) {
    let used = env::storage_usage().saturating_sub(initial_usage) + reserve_bytes;
    let cost = env::storage_byte_cost().saturating_mul(used as u128);
    let attached = env::attached_deposit();
    if attached < cost {
        env::panic_str(&format!(
            "E02_DEPOSIT: attach at least {} yoctoNEAR",
            cost.as_yoctonear()
        ));
    }
    let refund = attached.saturating_sub(cost);
    if !refund.is_zero() {
        Promise::new(env::predecessor_account_id()).transfer(refund).detach();
    }
}

impl Contract {
    /// near-sdk `store` collections cache writes and only flush them when the
    /// contract struct is dropped, AFTER the method body. Storage must
    /// therefore be flushed before `env::storage_usage()` is read, or the
    /// growth is invisible and the caller is charged nothing (D-009).
    pub(crate) fn flush_all(&mut self) {
        self.circles.flush();
        self.loans.flush();
        self.passports.flush();
        self.circle_members.flush();
        self.circle_loans.flush();
        self.borrower_loan_count.flush();
        self.borrower_loans.flush();
        self.lender_loan_count.flush();
        self.lender_loans.flush();
        self.owner_token_count.flush();
        self.owner_tokens.flush();
        self.all_tokens.flush();
        self.invites.flush();
    }

    pub(crate) fn circle_index(&self, circle_id: u64) -> u32 {
        if circle_id == 0 || circle_id > self.circles.len() as u64 {
            env::panic_str("E01_NOT_FOUND: circle");
        }
        (circle_id - 1) as u32
    }

    pub(crate) fn circle(&self, circle_id: u64) -> &Circle {
        let idx = self.circle_index(circle_id);
        self.circles.get(idx).unwrap_or_else(|| env::panic_str("E01_NOT_FOUND: circle"))
    }

    pub(crate) fn try_circle(&self, circle_id: u64) -> Option<&Circle> {
        if circle_id == 0 || circle_id > self.circles.len() as u64 {
            return None;
        }
        self.circles.get((circle_id - 1) as u32)
    }

    pub(crate) fn try_loan(&self, loan_id: u64) -> Option<&Loan> {
        if loan_id == 0 || loan_id > self.loans.len() as u64 {
            return None;
        }
        self.loans.get((loan_id - 1) as u32)
    }

    pub(crate) fn loan(&self, loan_id: u64) -> Loan {
        self.try_loan(loan_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("E01_NOT_FOUND: loan"))
    }

    pub(crate) fn put_loan(&mut self, loan_id: u64, loan: Loan) {
        self.loans.set((loan_id - 1) as u32, loan);
    }

    pub(crate) fn passport(&self, circle_id: u64, account: &AccountId) -> Option<&Passport> {
        self.passports.get(&(circle_id, account.clone()))
    }

    pub(crate) fn assert_admin(&self, circle_id: u64) -> Circle {
        let circle = self.circle(circle_id).clone();
        require!(
            env::predecessor_account_id() == circle.admin_id,
            "E05_NOT_ADMIN: only the circle admin can do this"
        );
        circle
    }

    pub(crate) fn effective_status(p: &Passport, now: u64) -> EffectiveStatus {
        match p.status {
            PassportStatus::Suspended => EffectiveStatus::Suspended,
            PassportStatus::Revoked => EffectiveStatus::Revoked,
            PassportStatus::Active => {
                if p.expires_at.is_some_and(|e| now >= e) {
                    EffectiveStatus::Expired
                } else {
                    EffectiveStatus::Active
                }
            }
        }
    }

    pub(crate) fn is_active(&self, circle_id: u64, account: &AccountId, now: u64) -> bool {
        self.passport(circle_id, account)
            .is_some_and(|p| Self::effective_status(p, now) == EffectiveStatus::Active)
    }

    /// Overdue loans as borrower that have not had their flag cleared.
    pub(crate) fn overdue_count(&self, p: &Passport, now: u64) -> u32 {
        p.open_loans
            .iter()
            .filter_map(|id| self.try_loan(*id))
            .filter(|l| l.is_overdue(now) && !l.flag_cleared)
            .count() as u32
    }

    pub(crate) fn open_count(&self, p: &Passport, now: u64) -> u32 {
        p.open_loans
            .iter()
            .filter_map(|id| self.try_loan(*id))
            .filter(|l| !l.is_closed(now))
            .count() as u32
    }

    pub(crate) fn effective_tier(&self, p: &Passport, now: u64) -> Tier {
        if p.tier == Tier::Trusted && self.overdue_count(p, now) == 0 {
            Tier::Trusted
        } else {
            Tier::Member
        }
    }

    pub(crate) fn active_steward_count(&self, circle_id: u64, circle: &Circle, now: u64) -> u32 {
        circle
            .stewards
            .iter()
            .filter(|s| self.is_active(circle_id, s, now))
            .count() as u32
    }

    /// Treasury lending: DAO attached, >= 2 Active stewards, borrower effectively
    /// Trusted and not a steward.
    pub(crate) fn treasury_rules_hold(&self, circle_id: u64, borrower: &AccountId, now: u64) -> bool {
        let circle = match self.try_circle(circle_id) {
            Some(c) => c,
            None => return false,
        };
        if circle.treasury_id.is_none() || self.active_steward_count(circle_id, circle, now) < 2 {
            return false;
        }
        match self.passport(circle_id, borrower) {
            Some(p) => !p.steward && self.effective_tier(p, now) == Tier::Trusted,
            None => false,
        }
    }

    /// Mint a passport (no storage charging here; callers measure).
    pub(crate) fn mint_passport(
        &mut self,
        circle_id: u64,
        owner: &AccountId,
        invited_by: Option<AccountId>,
    ) -> String {
        require!(
            self.circle(circle_id).treasury_id.as_ref() != Some(owner),
            "E37_TREASURY_NO_PASSPORT: the circle treasury (DAO) account cannot hold a passport"
        );
        let key = (circle_id, owner.clone());
        require!(
            !self.passports.contains_key(&key),
            "E35_ALREADY_MEMBER: this account already has a passport in this circle"
        );
        let passport = Passport {
            tier: Tier::Member,
            steward: false,
            status: PassportStatus::Active,
            expires_at: None,
            joined_at: now(),
            invited_by,
            on_time: 0,
            late: 0,
            qualifying: 0,
            lenders: Vec::new(),
            open_loans: Vec::new(),
        };
        self.passports.insert(key, passport);

        let idx = self.circle_index(circle_id);
        let circle = self.circles.get_mut(idx).unwrap();
        let member_index = circle.member_count;
        circle.member_count += 1;
        self.circle_members.insert((circle_id, member_index), owner.clone());

        let owned = self.owner_token_count.get(owner).copied().unwrap_or(0);
        self.owner_tokens.insert((owner.clone(), owned), circle_id);
        self.owner_token_count.insert(owner.clone(), owned + 1);
        self.all_tokens.push((circle_id, owner.clone()));

        let tid = token_id(circle_id, owner);
        events::nft_mint(owner, &tid);
        tid
    }

    pub(crate) fn index_loan(&mut self, loan_id: u64, circle_id: u64, borrower: &AccountId, lender: &AccountId) {
        let idx = self.circle_index(circle_id);
        let circle = self.circles.get_mut(idx).unwrap();
        let ci = circle.loan_count;
        circle.loan_count += 1;
        self.circle_loans.insert((circle_id, ci), loan_id);

        let b = self.borrower_loan_count.get(borrower).copied().unwrap_or(0);
        self.borrower_loans.insert((borrower.clone(), b), loan_id);
        self.borrower_loan_count.insert(borrower.clone(), b + 1);

        let l = self.lender_loan_count.get(lender).copied().unwrap_or(0);
        self.lender_loans.insert((lender.clone(), l), loan_id);
        self.lender_loan_count.insert(lender.clone(), l + 1);
    }
}
