//! CommonCircle circle-contract data model scaffold.
//!
//! Gate 0 intentionally contains no state-changing methods. The invariants in
//! this file are the shape that Gate 1 behavior must preserve:
//! - USDC amounts are integer base units (`u128` in storage; `U128` in JSON).
//! - durations are supplied in `DurationConfig`; no duration is hard-coded.
//! - the circle never stores loan principal at rest.
//! - transfer-driven state changes will be committed only from private callbacks.

use near_sdk::{AccountId, BorshStorageKey};
use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::serde_json::Value;

#[derive(BorshStorageKey, BorshSerialize)]
pub enum StorageKey {
    Circles,
    Passports,
    Loans,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct DurationConfig {
    pub funding_window_ns: u64,
    pub max_duration_ns: u64,
    pub trusted_min_duration_ns: u64,
    pub treasury_writeoff_grace_ns: u64,
    pub recovery_timelock_ns: u64,
    pub access_recheck_ns: u64,
    pub invite_expiry_ns: u64,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct AmountConfig {
    pub min_amount: U128,
    pub max_amount: U128,
    pub member_amount_cap: U128,
    pub trusted_amount_cap: U128,
    pub hackathon_loan_cap: U128,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct NetworkConfig {
    pub usdc_contract_id: AccountId,
    pub vault_account_id: AccountId,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct CircleConfig {
    pub network: NetworkConfig,
    pub durations: DurationConfig,
    pub amounts: AmountConfig,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub enum PassportTier {
    Member,
    Trusted,
    Steward,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct Passport {
    pub owner_id: AccountId,
    pub tier: PassportTier,
    pub active: bool,
    pub on_time_repayments: u32,
    pub late_repayments: u32,
    pub overdue_open_loans: u32,
    pub different_lenders: Vec<AccountId>,
    pub metadata: Value,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub enum LoanState {
    Open,
    Funding,
    Funded,
    Repaying,
    Repaid,
    Cancelled,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub enum PendingTransfer {
    Funding { amount: U128 },
    Repayment { amount: U128 },
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct Loan {
    pub loan_id: u64,
    pub circle_id: u64,
    pub borrower_id: AccountId,
    pub lender_id: AccountId,
    pub principal: U128,
    pub total_repaid: U128,
    pub duration_ns: u64,
    pub created_at_ns: u64,
    pub funded_at_ns: Option<u64>,
    pub due_at_ns: Option<u64>,
    pub state: LoanState,
    pub pending_transfer: Option<PendingTransfer>,
}

impl Loan {
    /// Overdue is derived from due_at and current time; it is not a stored state.
    pub fn is_overdue(&self, now_ns: u64) -> bool {
        matches!(self.state, LoanState::Funded | LoanState::Repaying)
            && self.due_at_ns.is_some_and(|due_at| now_ns > due_at)
            && self.total_repaid.0 < self.principal.0
    }
}
