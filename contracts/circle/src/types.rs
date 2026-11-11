//! Storage and JSON types. JSON shapes match docs/CIRCLE_INTERFACE.md 1.0.0.

use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

/// Init-time floors (seconds). Immutable.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Floors {
    pub funding_window_sec: U64,
    pub qualifying_duration_sec: U64,
    pub recovery_lock_sec: U64,
    pub day_length_sec: U64,
}

/// Per-circle parameters, fixed at `create_circle`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CircleParams {
    pub min_amount: U128,
    pub member_max_amount: U128,
    pub trusted_max_amount: U128,
    pub max_duration_days: u32,
    pub day_length_sec: U64,
    pub funding_window_sec: U64,
    pub qualifying_min_amount: U128,
    pub qualifying_min_days: u32,
    pub trusted_threshold: u32,
    pub min_distinct_lenders: u32,
    pub recovery_lock_sec: U64,
    pub writeoff_grace_sec: U64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Circle {
    pub name: String,
    pub founder_id: AccountId,
    pub admin_id: AccountId,
    pub treasury_id: Option<AccountId>,
    pub created_at: u64,
    pub params: CircleParams,
    pub member_count: u32,
    pub loan_count: u32,
    /// Accounts whose passport carries the steward flag (kept small by the admin).
    pub stewards: Vec<AccountId>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tier {
    Member,
    Trusted,
}

/// Stored passport status. `Expired` is derived from `expires_at` and never stored.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PassportStatus {
    Active,
    Suspended,
    Revoked,
}

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EffectiveStatus {
    Active,
    Suspended,
    Revoked,
    Expired,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Passport {
    pub tier: Tier,
    pub steward: bool,
    pub status: PassportStatus,
    pub expires_at: Option<u64>,
    pub joined_at: u64,
    pub invited_by: Option<AccountId>,
    pub on_time: u32,
    pub late: u32,
    pub qualifying: u32,
    /// Distinct lenders of qualifying loans, capped at the circle's
    /// effective `min_distinct_lenders`, so it never grows unbounded.
    pub lenders: Vec<AccountId>,
    /// Loans where this member is borrower and that were not final when last
    /// pruned. At most a handful (open-loan limit is 2).
    pub open_loans: Vec<u64>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Invite {
    pub circle_id: u64,
    pub inviter_id: AccountId,
    pub invitee_id: Option<AccountId>,
    pub expires_at: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoanStage {
    Open,
    Funding,
    Funded,
    Repaying,
    Repaid,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FundedVia {
    Lender,
    Vault,
    Treasury,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Loan {
    pub circle_id: u64,
    pub borrower_id: AccountId,
    pub lender_id: AccountId,
    pub lender_is_treasury: bool,
    pub principal: u128,
    pub repaid: u128,
    pub duration_days: u32,
    pub duration_ns: u64,
    pub created_at: u64,
    pub funding_deadline: u64,
    pub funded_at: Option<u64>,
    pub due_at: Option<u64>,
    pub repaid_at: Option<u64>,
    pub stage: LoanStage,
    pub written_off: bool,
    pub cancelled_by_borrower: bool,
    pub funded_via: Option<FundedVia>,
    pub repaid_on_time: Option<bool>,
    pub qualifying: Option<bool>,
    pub flag_cleared: bool,
}

impl Loan {
    pub fn is_lapsed(&self, now: u64) -> bool {
        self.stage == LoanStage::Open && now > self.funding_deadline
    }

    /// Final for open-loan counting: repaid, cancelled, or lapsed.
    pub fn is_closed(&self, now: u64) -> bool {
        matches!(self.stage, LoanStage::Repaid | LoanStage::Cancelled) || self.is_lapsed(now)
    }

    /// Derived, never stored.
    pub fn is_overdue(&self, now: u64) -> bool {
        matches!(self.stage, LoanStage::Funded | LoanStage::Repaying)
            && self.repaid < self.principal
            && self.due_at.is_some_and(|due| now > due)
    }
}

/// `ft_transfer_call` msg. See docs/MSG_SCHEMA.md.
#[near(serializers = [json])]
#[serde(tag = "action", rename_all = "snake_case")]
#[derive(Clone, Debug)]
pub enum TransferMsg {
    Fund {
        loan_id: U64,
        lender_id: Option<AccountId>,
    },
    Repay {
        loan_id: U64,
    },
}

// ---------------------------------------------------------------- views

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct GasView {
    pub min_ft_on_transfer: U64,
    pub recommended_ft_transfer_call: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct FeaturesView {
    pub recovery: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ConfigView {
    pub interface_version: String,
    pub usdc_id: AccountId,
    pub vault_id: AccountId,
    pub hard_loan_cap: U128,
    pub floors: Floors,
    pub gas: GasView,
    pub features: FeaturesView,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct StorageCostsView {
    pub create_circle: U128,
    pub register_invite: U128,
    pub redeem_invite: U128,
    pub create_loan: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct CircleView {
    pub circle_id: U64,
    pub name: String,
    pub founder_id: AccountId,
    pub admin_id: AccountId,
    pub treasury_id: Option<AccountId>,
    pub dao_attached: bool,
    pub created_at: U64,
    pub params: CircleParams,
    pub member_count: u32,
    pub steward_count: u32,
    pub loan_count: u32,
    pub treasury_lending_enabled: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoanStateView {
    Open,
    Funding,
    Funded,
    Repaying,
    Repaid,
    Cancelled,
    WrittenOff,
}

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CancelReason {
    Borrower,
    Lapsed,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct LoanView {
    pub loan_id: U64,
    pub circle_id: U64,
    pub borrower_id: AccountId,
    pub lender_id: AccountId,
    pub lender_is_treasury: bool,
    pub principal: U128,
    pub total_repaid: U128,
    pub outstanding: U128,
    pub duration_days: u32,
    pub duration_sec: U64,
    pub created_at: U64,
    pub funding_deadline: U64,
    pub funded_at: Option<U64>,
    pub due_at: Option<U64>,
    pub repaid_at: Option<U64>,
    pub state: LoanStateView,
    pub cancel_reason: Option<CancelReason>,
    pub funded_via: Option<FundedVia>,
    pub overdue: bool,
    pub repaid_on_time: Option<bool>,
    pub qualifying: Option<bool>,
    pub flag_cleared: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DisplayTier {
    Member,
    Trusted,
    Steward,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct RecoveryView {
    pub new_account_id: AccountId,
    pub unlocks_at: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PassportView {
    pub token_id: String,
    pub circle_id: U64,
    pub owner_id: AccountId,
    pub tier: Tier,
    pub steward: bool,
    pub display_tier: DisplayTier,
    pub status: EffectiveStatus,
    pub expires_at: Option<U64>,
    pub joined_at: U64,
    pub invited_by: Option<AccountId>,
    pub on_time_count: u32,
    pub late_count: u32,
    pub qualifying_count: u32,
    pub distinct_lenders: u32,
    pub open_loans: u32,
    pub overdue_loans: u32,
    pub perks_paused: bool,
    pub effective_tier: Tier,
    pub recovery: Option<RecoveryView>,
}

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AccessReason {
    Active,
    NoPassport,
    Suspended,
    Revoked,
    Expired,
    NoCircle,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct AccessView {
    pub allowed: bool,
    pub reason: AccessReason,
    pub token_id: Option<String>,
    pub display_tier: Option<DisplayTier>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct InviteView {
    pub circle_id: U64,
    pub invite_public_key: String,
    pub inviter_id: AccountId,
    pub invitee_id: Option<AccountId>,
    pub expires_at: U64,
    pub expired: bool,
}

/// NEP-177 token metadata (all fields, nulls included).
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct TokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub media_hash: Option<String>,
    pub copies: Option<u64>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub starts_at: Option<String>,
    pub updated_at: Option<String>,
    pub extra: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

/// NEP-171 token.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Token {
    pub token_id: String,
    pub owner_id: AccountId,
    pub metadata: Option<TokenMetadata>,
    pub approved_account_ids: Option<std::collections::HashMap<AccountId, u64>>,
}

/// NEP-177 contract metadata.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct NftContractMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}
