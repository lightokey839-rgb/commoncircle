//! Circle creation, DAO bootstrap and admin-only methods.

use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId};

use crate::*;

#[near]
impl Contract {
    /// Create a circle. The caller becomes founder and admin and receives a
    /// Member passport. Caller pays storage (excess refunded).
    #[payable]
    pub fn create_circle(&mut self, name: String, params: CircleParams) -> U64 {
        let initial = env::storage_usage();
        let founder = env::predecessor_account_id();
        let params = self.validate_params(&name, params);
        let circle_id = self.circles.len() as u64 + 1;
        self.circles.push(Circle {
            name: name.clone(),
            founder_id: founder.clone(),
            admin_id: founder.clone(),
            treasury_id: None,
            created_at: now(),
            params: params.clone(),
            member_count: 0,
            loan_count: 0,
            stewards: Vec::new(),
        });
        events::emit(
            "circle_created",
            json!({
                "circle_id": circle_id.to_string(),
                "founder_id": founder,
                "name": name,
                "params": params,
            }),
        );
        let tid = self.mint_passport(circle_id, &founder, None);
        events::emit(
            "invite_redeemed",
            json!({
                "circle_id": circle_id.to_string(),
                "account_id": founder,
                "token_id": tid,
                "inviter_id": null,
                "invite_public_key": null,
            }),
        );
        charge_storage(initial, 0);
        U64(circle_id)
    }

    /// One-time: hand admin and treasury to the circle DAO. Founder powers end.
    #[payable]
    pub fn attach_dao(&mut self, circle_id: U64, dao_id: AccountId) {
        assert_one_yocto();
        let cid = circle_id.0;
        let circle = self.circle(cid).clone();
        let caller = env::predecessor_account_id();
        require!(
            circle.treasury_id.is_none() && circle.admin_id == circle.founder_id,
            "E06_DAO_ALREADY_ATTACHED: this circle already has its DAO"
        );
        require!(caller == circle.founder_id, "E05_NOT_ADMIN: only the founder can attach the DAO");
        require!(
            self.passport(cid, &dao_id).is_none(),
            "E04_BAD_PARAMS: the DAO account cannot hold a passport in this circle"
        );
        let idx = self.circle_index(cid);
        let c = self.circles.get_mut(idx).unwrap();
        c.admin_id = dao_id.clone();
        c.treasury_id = Some(dao_id.clone());
        events::emit(
            "dao_attached",
            json!({ "circle_id": cid.to_string(), "dao_id": dao_id, "previous_admin_id": caller }),
        );
    }

    #[payable]
    pub fn set_steward(&mut self, circle_id: U64, account_id: AccountId, steward: bool) {
        assert_one_yocto();
        let cid = circle_id.0;
        self.assert_admin(cid);
        let t = now();
        let key = (cid, account_id.clone());
        let mut p = self
            .passports
            .get(&key)
            .cloned()
            .unwrap_or_else(|| env::panic_str("E01_NOT_FOUND: passport"));
        if steward {
            require!(
                Self::effective_status(&p, t) == EffectiveStatus::Active,
                "E10_NO_PASSPORT: a steward needs an active passport"
            );
        }
        p.steward = steward;
        self.passports.insert(key, p);
        let idx = self.circle_index(cid);
        let c = self.circles.get_mut(idx).unwrap();
        let present = c.stewards.iter().any(|s| s == &account_id);
        if steward && !present {
            require!(c.stewards.len() < MAX_STEWARDS, "E04_BAD_PARAMS: too many stewards");
            c.stewards.push(account_id.clone());
        } else if !steward && present {
            c.stewards.retain(|s| s != &account_id);
        }
        events::emit(
            "steward_set",
            json!({ "circle_id": cid.to_string(), "account_id": account_id, "steward": steward }),
        );
    }

    #[payable]
    pub fn set_passport_status(&mut self, circle_id: U64, account_id: AccountId, status: PassportStatus) {
        assert_one_yocto();
        let cid = circle_id.0;
        self.assert_admin(cid);
        let key = (cid, account_id.clone());
        let mut p = self
            .passports
            .get(&key)
            .cloned()
            .unwrap_or_else(|| env::panic_str("E01_NOT_FOUND: passport"));
        require!(
            p.status != PassportStatus::Revoked,
            "E17_WRONG_STATE: a revoked passport cannot change status"
        );
        let previous = p.status;
        p.status = status;
        self.passports.insert(key, p);
        events::emit(
            "passport_status_changed",
            json!({
                "circle_id": cid.to_string(),
                "account_id": account_id,
                "token_id": token_id(cid, &account_id),
                "previous": previous,
                "status": status,
            }),
        );
    }

    #[payable]
    pub fn set_passport_expiry(&mut self, circle_id: U64, account_id: AccountId, expires_at: Option<U64>) {
        assert_one_yocto();
        let cid = circle_id.0;
        self.assert_admin(cid);
        let key = (cid, account_id.clone());
        let mut p = self
            .passports
            .get(&key)
            .cloned()
            .unwrap_or_else(|| env::panic_str("E01_NOT_FOUND: passport"));
        p.expires_at = expires_at.map(|e| e.0);
        self.passports.insert(key, p);
        events::emit(
            "passport_expiry_set",
            json!({
                "circle_id": cid.to_string(),
                "account_id": account_id,
                "expires_at": expires_at,
            }),
        );
    }

    /// Clear a wrong overdue/late flag on one loan. If the loan was repaid late,
    /// the borrower's late count goes down by one.
    #[payable]
    pub fn clear_flag(&mut self, loan_id: U64) {
        assert_one_yocto();
        let lid = loan_id.0;
        let mut loan = self.loan(lid);
        self.assert_admin(loan.circle_id);
        require!(!loan.flag_cleared, "E17_WRONG_STATE: flag already cleared");
        let t = now();
        let was_late = loan.stage == LoanStage::Repaid && loan.repaid_on_time == Some(false);
        require!(
            was_late || loan.is_overdue(t),
            "E17_WRONG_STATE: this loan has no flag to clear"
        );
        loan.flag_cleared = true;
        let cid = loan.circle_id;
        let borrower = loan.borrower_id.clone();
        self.put_loan(lid, loan);
        if was_late {
            let key = (cid, borrower.clone());
            if let Some(mut p) = self.passports.get(&key).cloned() {
                p.late = p.late.saturating_sub(1);
                self.passports.insert(key, p);
            }
        }
        events::emit(
            "flag_cleared",
            json!({
                "loan_id": lid.to_string(),
                "circle_id": cid.to_string(),
                "borrower_id": borrower,
                "late_count_reduced": was_late,
            }),
        );
    }

    /// Treasury loans overdue by `writeoff_grace_sec` can be written off by the
    /// DAO. The loan stays payable; the borrower's overdue flag stays.
    #[payable]
    pub fn write_off_loan(&mut self, loan_id: U64) {
        assert_one_yocto();
        let lid = loan_id.0;
        let mut loan = self.loan(lid);
        let circle = self.assert_admin(loan.circle_id);
        require!(loan.lender_is_treasury, "E17_WRONG_STATE: only treasury loans can be written off");
        require!(
            loan.stage == LoanStage::Funded && !loan.written_off,
            "E17_WRONG_STATE: loan is not funded or already written off"
        );
        let grace = secs_to_ns(circle.params.writeoff_grace_sec.0);
        let due = loan.due_at.unwrap_or(u64::MAX);
        require!(
            now() >= due.saturating_add(grace),
            "E17_WRONG_STATE: the write-off grace period has not passed"
        );
        loan.written_off = true;
        let cid = loan.circle_id;
        self.put_loan(lid, loan);
        events::emit(
            "loan_written_off",
            json!({ "loan_id": lid.to_string(), "circle_id": cid.to_string() }),
        );
    }
}

impl Contract {
    fn validate_params(&self, name: &str, mut p: CircleParams) -> CircleParams {

        if name.is_empty() || name.chars().count() > MAX_NAME_LEN {
            bad("name must be 1..64 characters");
        }
        if p.min_amount.0 == 0 {
            bad("min_amount must be > 0");
        }
        if !(p.min_amount.0 <= p.member_max_amount.0
            && p.member_max_amount.0 <= p.trusted_max_amount.0
            && p.trusted_max_amount.0 <= self.hard_loan_cap)
        {
            bad("need min_amount <= member_max_amount <= trusted_max_amount <= hard_loan_cap");
        }
        if p.qualifying_min_amount.0 < p.min_amount.0 {
            bad("qualifying_min_amount must be >= min_amount");
        }
        if p.max_duration_days == 0 {
            bad("max_duration_days must be >= 1");
        }
        let day_floor = self.floors.day_length_sec.0.max(1);
        if p.day_length_sec.0 < day_floor {
            bad("day_length_sec is below the network floor");
        }
        if p.funding_window_sec.0 < self.floors.funding_window_sec.0 || p.funding_window_sec.0 == 0 {
            bad("funding_window_sec is below the network floor");
        }
        let qualifying_sec = (p.qualifying_min_days as u64)
            .checked_mul(p.day_length_sec.0)
            .unwrap_or_else(|| bad("qualifying duration overflows"));
        if qualifying_sec < self.floors.qualifying_duration_sec.0 {
            bad("qualifying duration is below the network floor");
        }
        if p.recovery_lock_sec.0 < self.floors.recovery_lock_sec.0 {
            bad("recovery_lock_sec is below the network floor");
        }
        if p.trusted_threshold == 0 || p.trusted_threshold > MAX_TRUSTED_THRESHOLD {
            bad("trusted_threshold must be 1..50");
        }
        if p.min_distinct_lenders == 0 {
            bad("min_distinct_lenders must be >= 1");
        }
        // Clamp: distinct lenders can never exceed the number of repayments.
        p.min_distinct_lenders = p.min_distinct_lenders.min(p.trusted_threshold);
        // Every duration must fit in ns arithmetic.
        let max_loan_sec = (p.max_duration_days as u64)
            .checked_mul(p.day_length_sec.0)
            .unwrap_or_else(|| bad("max duration overflows"));
        secs_to_ns(max_loan_sec);
        secs_to_ns(p.funding_window_sec.0);
        secs_to_ns(p.recovery_lock_sec.0);
        secs_to_ns(p.writeoff_grace_sec.0);
        p
    }
}

fn bad(m: &str) -> ! {
    env::panic_str(&format!("E04_BAD_PARAMS: {}", m))
}
