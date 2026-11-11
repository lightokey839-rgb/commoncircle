//! F0 loan loop: create, cancel, fund and repay through `ft_on_transfer`.
//!
//! Money path: USDC arrives with `ft_transfer_call`, is forwarded in the same
//! receipt chain with `ft_transfer`, and the private callback commits state.
//! Any rejection returns the full amount as unused, so the token refunds the
//! sender and the circle's USDC balance stays zero at rest.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{env, ext_contract, near, require, AccountId, PromiseOrValue, PromiseResult};

use crate::*;

#[allow(dead_code)]
#[ext_contract(ext_ft)]
pub trait ExtFungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[allow(deprecated)]
fn forward_succeeded() -> bool {
    env::promise_results_count() == 1 && matches!(env::promise_result(0), PromiseResult::Successful(_))
}

#[near]
impl Contract {
    /// Borrower locks the terms on-chain and pays storage (plus a fixed growth
    /// reserve, see `LOAN_GROWTH_RESERVE_BYTES`).
    #[payable]
    pub fn create_loan(&mut self, circle_id: U64, lender_id: AccountId, amount: U128, duration_days: u32) -> U64 {
        let initial = env::storage_usage();
        let cid = circle_id.0;
        let t = now();
        let circle = self.circle(cid).clone();
        let borrower = env::predecessor_account_id();
        require!(borrower != lender_id, "E13_SELF_LOAN: you cannot lend to yourself");

        let mut bp = self
            .passport(cid, &borrower)
            .cloned()
            .unwrap_or_else(|| env::panic_str("E10_NO_PASSPORT: you need a passport in this circle"));
        require!(
            Self::effective_status(&bp, t) == EffectiveStatus::Active,
            "E10_NO_PASSPORT: your passport is not active"
        );

        let is_treasury = circle.treasury_id.as_ref() == Some(&lender_id);
        if is_treasury {
            require!(
                self.treasury_rules_hold(cid, &borrower, t),
                "E19_TREASURY_RULES: treasury loans need a Trusted, non-steward borrower and at least 2 stewards"
            );
        } else {
            require!(
                self.is_active(cid, &lender_id, t),
                "E11_LENDER_NO_PASSPORT: the lender needs an active passport in this circle"
            );
        }

        let tier = self.effective_tier(&bp, t);
        let p = &circle.params;
        let cap = match tier {
            Tier::Trusted => p.trusted_max_amount.0,
            Tier::Member => p.member_max_amount.0,
        }
        .min(self.hard_loan_cap);
        require!(
            amount.0 >= p.min_amount.0 && amount.0 <= cap,
            "E14_AMOUNT_OUT_OF_RANGE: the amount is outside this circle's limits"
        );
        require!(
            duration_days >= 1 && duration_days <= p.max_duration_days,
            "E15_DURATION_OUT_OF_RANGE: the loan length is outside this circle's limits"
        );

        bp.open_loans
            .retain(|id| self.try_loan(*id).is_some_and(|l| !l.is_closed(t)));
        let limit = if tier == Tier::Trusted { 2 } else { 1 };
        require!(
            (bp.open_loans.len() as u32) < limit,
            "E16_OPEN_LOAN_LIMIT: you already have the most open loans your tier allows"
        );

        let duration_sec = (duration_days as u64)
            .checked_mul(p.day_length_sec.0)
            .unwrap_or_else(|| env::panic_str("E15_DURATION_OUT_OF_RANGE: overflow"));
        let duration_ns = secs_to_ns(duration_sec);
        let funding_deadline = t.saturating_add(secs_to_ns(p.funding_window_sec.0));
        let loan_id = self.loans.len() as u64 + 1;
        self.loans.push(Loan {
            circle_id: cid,
            borrower_id: borrower.clone(),
            lender_id: lender_id.clone(),
            lender_is_treasury: is_treasury,
            principal: amount.0,
            repaid: 0,
            duration_days,
            duration_ns,
            created_at: t,
            funding_deadline,
            funded_at: None,
            due_at: None,
            repaid_at: None,
            stage: LoanStage::Open,
            written_off: false,
            cancelled_by_borrower: false,
            funded_via: None,
            repaid_on_time: None,
            qualifying: None,
            flag_cleared: false,
        });
        bp.open_loans.push(loan_id);
        self.passports.insert((cid, borrower.clone()), bp);
        self.index_loan(loan_id, cid, &borrower, &lender_id);

        events::emit(
            "loan_created",
            json!({
                "loan_id": loan_id.to_string(),
                "circle_id": cid.to_string(),
                "borrower_id": borrower,
                "lender_id": lender_id,
                "lender_is_treasury": is_treasury,
                "principal": amount,
                "duration_days": duration_days,
                "duration_sec": duration_sec.to_string(),
                "funding_deadline": funding_deadline.to_string(),
            }),
        );
        self.flush_all();
        charge_storage(initial, LOAN_GROWTH_RESERVE_BYTES);
        U64(loan_id)
    }

    /// Borrower cancels an Open loan inside its funding window.
    #[payable]
    pub fn cancel_loan(&mut self, loan_id: U64) {
        assert_one_yocto();
        let lid = loan_id.0;
        let mut loan = self.loan(lid);
        require!(
            env::predecessor_account_id() == loan.borrower_id,
            "E20_NOT_BORROWER: only the borrower can do this"
        );
        require!(loan.stage == LoanStage::Open, "E17_WRONG_STATE: only an Open loan can be cancelled");
        require!(
            !loan.is_lapsed(now()),
            "E18_WINDOW_LAPSED: the funding window has closed; the loan is already cancelled"
        );
        loan.stage = LoanStage::Cancelled;
        loan.cancelled_by_borrower = true;
        let cid = loan.circle_id;
        let borrower = loan.borrower_id.clone();
        self.put_loan(lid, loan);
        let key = (cid, borrower);
        if let Some(mut p) = self.passports.get(&key).cloned() {
            p.open_loans.retain(|id| *id != lid);
            self.passports.insert(key, p);
        }
        events::emit(
            "loan_cancelled",
            json!({ "loan_id": lid.to_string(), "circle_id": cid.to_string(), "reason": "Borrower" }),
        );
    }

    /// NEP-141 receiver. Only the pinned USDC contract is accepted.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        // Fail early (panic => the token refunds in full) if the forward and
        // its callback could not both be paid for.
        require!(
            env::prepaid_gas() >= MIN_GAS_FT_ON_TRANSFER,
            "E60_LOW_GAS: not enough gas attached; the transfer is refunded"
        );
        if env::predecessor_account_id() != self.usdc_id {
            return self.reject(&sender_id, amount, "E70_WRONG_TOKEN", None);
        }
        let parsed: TransferMsg = match near_sdk::serde_json::from_str(&msg) {
            Ok(m) => m,
            Err(_) => return self.reject(&sender_id, amount, "E71_BAD_MSG", None),
        };
        match parsed {
            TransferMsg::Fund { loan_id, lender_id } => self.fund(sender_id, amount, loan_id.0, lender_id),
            TransferMsg::Repay { loan_id } => self.repay(sender_id, amount, loan_id.0),
        }
    }

    /// Commits funding only if the forward to the borrower succeeded.
    /// Returns the unused amount (0 on success, everything on failure).
    #[private]
    pub fn on_fund_forwarded(&mut self, loan_id: U64, amount: U128) -> U128 {
        let ok = forward_succeeded();
        let lid = loan_id.0;
        let mut loan = match self.try_loan(lid) {
            Some(l) if l.stage == LoanStage::Funding => l.clone(),
            _ => return if ok { U128(0) } else { amount },
        };
        let cid = loan.circle_id;
        if ok {
            let t = now();
            loan.stage = LoanStage::Funded;
            loan.funded_at = Some(t);
            let due = t.saturating_add(loan.duration_ns);
            loan.due_at = Some(due);
            let data = json!({
                "loan_id": lid.to_string(),
                "circle_id": cid.to_string(),
                "borrower_id": loan.borrower_id,
                "lender_id": loan.lender_id,
                "amount": amount,
                "funded_via": loan.funded_via,
                "funded_at": t.to_string(),
                "due_at": due.to_string(),
            });
            self.put_loan(lid, loan);
            events::emit("loan_funded", data);
            U128(0)
        } else {
            loan.stage = LoanStage::Open;
            loan.funded_via = None;
            self.put_loan(lid, loan);
            events::emit(
                "loan_funding_failed",
                json!({
                    "loan_id": lid.to_string(),
                    "circle_id": cid.to_string(),
                    "amount": amount,
                    "reason": "forward_failed",
                }),
            );
            amount
        }
    }

    /// Commits a repayment only if the forward to the lender succeeded.
    /// Returns the unused amount (excess on success, everything on failure).
    #[private]
    pub fn on_repay_forwarded(&mut self, loan_id: U64, applied: U128, received: U128) -> U128 {
        let ok = forward_succeeded();
        let lid = loan_id.0;
        let excess = U128(received.0.saturating_sub(applied.0));
        let mut loan = match self.try_loan(lid) {
            Some(l) if l.stage == LoanStage::Repaying => l.clone(),
            _ => return if ok { excess } else { received },
        };
        let cid = loan.circle_id;
        if !ok {
            loan.stage = LoanStage::Funded;
            self.put_loan(lid, loan);
            events::emit(
                "loan_repayment_failed",
                json!({
                    "loan_id": lid.to_string(),
                    "circle_id": cid.to_string(),
                    "amount": received,
                    "reason": "forward_failed",
                }),
            );
            return received;
        }
        loan.repaid = loan.repaid.saturating_add(applied.0).min(loan.principal);
        let t = now();
        if loan.repaid >= loan.principal {
            loan.stage = LoanStage::Repaid;
            loan.repaid_at = Some(t);
            let on_time = !loan.written_off && loan.due_at.is_some_and(|d| t <= d);
            let params = self.circle(cid).params.clone();
            let qualifying = on_time
                && loan.principal >= params.qualifying_min_amount.0
                && loan.duration_days >= params.qualifying_min_days;
            loan.repaid_on_time = Some(on_time);
            loan.qualifying = Some(qualifying);
            let borrower = loan.borrower_id.clone();
            let lender = loan.lender_id.clone();
            let flag_cleared = loan.flag_cleared;
            let data = json!({
                "loan_id": lid.to_string(),
                "circle_id": cid.to_string(),
                "borrower_id": borrower,
                "lender_id": lender,
                "applied": applied,
                "total_repaid": U128(loan.repaid),
                "repaid_at": t.to_string(),
                "on_time": on_time,
                "qualifying": qualifying,
                "excess_returned": excess,
            });
            self.put_loan(lid, loan);
            events::emit("loan_repaid", data);
            self.record_repayment(cid, &borrower, &lender, lid, on_time, qualifying, flag_cleared, &params);
        } else {
            loan.stage = LoanStage::Funded;
            let data = json!({
                "loan_id": lid.to_string(),
                "circle_id": cid.to_string(),
                "applied": applied,
                "total_repaid": U128(loan.repaid),
                "outstanding": U128(loan.principal - loan.repaid),
            });
            self.put_loan(lid, loan);
            events::emit("loan_repayment", data);
        }
        excess
    }
}

impl Contract {
    fn reject(&self, sender: &AccountId, amount: U128, code: &str, loan_id: Option<u64>) -> PromiseOrValue<U128> {
        events::emit(
            "transfer_refunded",
            json!({
                "token_id": env::predecessor_account_id(),
                "sender_id": sender,
                "amount": amount,
                "reason": code,
                "loan_id": loan_id.map(|l| l.to_string()),
            }),
        );
        PromiseOrValue::Value(amount)
    }

    fn fund(&mut self, sender: AccountId, amount: U128, lid: u64, named: Option<AccountId>) -> PromiseOrValue<U128> {
        let t = now();
        let mut loan = match self.try_loan(lid) {
            Some(l) => l.clone(),
            None => return self.reject(&sender, amount, "E01_NOT_FOUND", Some(lid)),
        };
        match loan.stage {
            LoanStage::Open => {}
            LoanStage::Funding | LoanStage::Repaying => {
                return self.reject(&sender, amount, "E73_IN_FLIGHT", Some(lid))
            }
            _ => return self.reject(&sender, amount, "E17_WRONG_STATE", Some(lid)),
        }
        if loan.is_lapsed(t) {
            return self.reject(&sender, amount, "E18_WINDOW_LAPSED", Some(lid));
        }
        if amount.0 != loan.principal {
            return self.reject(&sender, amount, "E72_WRONG_AMOUNT", Some(lid));
        }
        let names_lender = named.as_ref().is_none_or(|n| n == &loan.lender_id);
        let via = if loan.lender_is_treasury {
            if sender == loan.lender_id && names_lender {
                FundedVia::Treasury
            } else {
                return self.reject(&sender, amount, "E12_NOT_NAMED_LENDER", Some(lid));
            }
        } else if sender == loan.lender_id && names_lender {
            FundedVia::Lender
        } else if sender == self.vault_id && named.as_ref() == Some(&loan.lender_id) {
            FundedVia::Vault
        } else {
            return self.reject(&sender, amount, "E12_NOT_NAMED_LENDER", Some(lid));
        };
        let cid = loan.circle_id;
        if !self.is_active(cid, &loan.borrower_id, t) {
            return self.reject(&sender, amount, "E10_NO_PASSPORT", Some(lid));
        }
        if loan.lender_is_treasury {
            if !self.treasury_rules_hold(cid, &loan.borrower_id, t) {
                return self.reject(&sender, amount, "E19_TREASURY_RULES", Some(lid));
            }
        } else if !self.is_active(cid, &loan.lender_id, t) {
            return self.reject(&sender, amount, "E11_LENDER_NO_PASSPORT", Some(lid));
        }

        loan.stage = LoanStage::Funding;
        loan.funded_via = Some(via);
        let borrower = loan.borrower_id.clone();
        self.put_loan(lid, loan);
        events::emit(
            "loan_funding_started",
            json!({
                "loan_id": lid.to_string(),
                "circle_id": cid.to_string(),
                "sender_id": sender,
                "amount": amount,
                "funded_via": via,
            }),
        );
        ext_ft::ext(self.usdc_id.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(borrower, amount, Some(format!("CommonCircle loan {} funding", lid)))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_fund_forwarded(U64(lid), amount),
            )
            .into()
    }

    fn repay(&mut self, sender: AccountId, amount: U128, lid: u64) -> PromiseOrValue<U128> {
        let mut loan = match self.try_loan(lid) {
            Some(l) => l.clone(),
            None => return self.reject(&sender, amount, "E01_NOT_FOUND", Some(lid)),
        };
        match loan.stage {
            LoanStage::Funded => {}
            LoanStage::Funding | LoanStage::Repaying => {
                return self.reject(&sender, amount, "E73_IN_FLIGHT", Some(lid))
            }
            _ => return self.reject(&sender, amount, "E17_WRONG_STATE", Some(lid)),
        }
        let outstanding = loan.principal - loan.repaid;
        let applied = amount.0.min(outstanding);
        loan.stage = LoanStage::Repaying;
        let lender = loan.lender_id.clone();
        let cid = loan.circle_id;
        self.put_loan(lid, loan);
        events::emit(
            "loan_repayment_started",
            json!({
                "loan_id": lid.to_string(),
                "circle_id": cid.to_string(),
                "sender_id": sender,
                "amount": amount,
                "applied": U128(applied),
            }),
        );
        ext_ft::ext(self.usdc_id.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(lender, U128(applied), Some(format!("CommonCircle loan {} repayment", lid)))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_repay_forwarded(U64(lid), U128(applied), amount),
            )
            .into()
    }

    #[allow(clippy::too_many_arguments)]
    fn record_repayment(
        &mut self,
        cid: u64,
        borrower: &AccountId,
        lender: &AccountId,
        lid: u64,
        on_time: bool,
        qualifying: bool,
        flag_cleared: bool,
        params: &CircleParams,
    ) {
        let key = (cid, borrower.clone());
        let mut p = match self.passports.get(&key) {
            Some(p) => p.clone(),
            None => return,
        };
        p.open_loans.retain(|id| *id != lid);
        if on_time {
            p.on_time += 1;
        } else if !flag_cleared {
            p.late += 1;
        }
        let mut upgraded = false;
        if qualifying {
            p.qualifying += 1;
            if !p.lenders.contains(lender) && (p.lenders.len() as u32) < params.min_distinct_lenders {
                p.lenders.push(lender.clone());
            }
            if p.tier == Tier::Member
                && p.qualifying >= params.trusted_threshold
                && (p.lenders.len() as u32) >= params.min_distinct_lenders
            {
                p.tier = Tier::Trusted;
                upgraded = true;
            }
        }
        self.passports.insert(key, p);
        if upgraded {
            events::emit(
                "tier_changed",
                json!({
                    "circle_id": cid.to_string(),
                    "account_id": borrower,
                    "token_id": token_id(cid, borrower),
                    "from": "Member",
                    "to": "Trusted",
                    "loan_id": lid.to_string(),
                }),
            );
        }
    }
}
