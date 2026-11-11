//! Read-only views (interface section 6) and the non-transferable NEP-171
//! surface (transfers and approvals always fail).

use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, AccountId};

use crate::art::{data_uri, render_card_svg, CardInput};
use crate::*;

#[near]
impl Contract {
    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            interface_version: INTERFACE_VERSION.to_string(),
            usdc_id: self.usdc_id.clone(),
            vault_id: self.vault_id.clone(),
            hard_loan_cap: U128(self.hard_loan_cap),
            floors: self.floors.clone(),
            gas: GasView {
                min_ft_on_transfer: U64(MIN_GAS_FT_ON_TRANSFER.as_tgas()),
                recommended_ft_transfer_call: U64(RECOMMENDED_FT_TRANSFER_CALL_TGAS),
            },
            features: FeaturesView { recovery: RECOVERY_ENABLED },
        }
    }

    pub fn storage_costs(&self) -> StorageCostsView {
        let byte = env::storage_byte_cost().as_yoctonear();
        StorageCostsView {
            create_circle: U128(byte * (CIRCLE_STORAGE_BOUND_BYTES + PASSPORT_STORAGE_BOUND_BYTES) as u128),
            register_invite: U128(byte * INVITE_STORAGE_BOUND_BYTES as u128),
            redeem_invite: U128(byte * PASSPORT_STORAGE_BOUND_BYTES as u128),
            create_loan: U128(byte * (LOAN_STORAGE_BOUND_BYTES + LOAN_GROWTH_RESERVE_BYTES) as u128),
        }
    }

    pub fn get_circle(&self, circle_id: U64) -> Option<CircleView> {
        let cid = circle_id.0;
        let c = self.try_circle(cid)?;
        let t = now();
        let stewards = self.active_steward_count(cid, c, t);
        Some(CircleView {
            circle_id,
            name: c.name.clone(),
            founder_id: c.founder_id.clone(),
            admin_id: c.admin_id.clone(),
            treasury_id: c.treasury_id.clone(),
            dao_attached: c.treasury_id.is_some(),
            created_at: U64(c.created_at),
            params: c.params.clone(),
            member_count: c.member_count,
            steward_count: stewards,
            loan_count: c.loan_count,
            treasury_lending_enabled: c.treasury_id.is_some() && stewards >= 2,
        })
    }

    pub fn get_loan(&self, loan_id: U64) -> Option<LoanView> {
        self.try_loan(loan_id.0).map(|l| loan_view(loan_id.0, l, now()))
    }

    pub fn loans_by_borrower(&self, account_id: AccountId, from_index: Option<u32>, limit: Option<u32>) -> Vec<LoanView> {
        let total = self.borrower_loan_count.get(&account_id).copied().unwrap_or(0);
        let (from, limit) = page(from_index, limit);
        let t = now();
        (from..total.min(from.saturating_add(limit)))
            .filter_map(|i| self.borrower_loans.get(&(account_id.clone(), i)).copied())
            .filter_map(|id| self.try_loan(id).map(|l| loan_view(id, l, t)))
            .collect()
    }

    pub fn loans_by_lender(&self, account_id: AccountId, from_index: Option<u32>, limit: Option<u32>) -> Vec<LoanView> {
        let total = self.lender_loan_count.get(&account_id).copied().unwrap_or(0);
        let (from, limit) = page(from_index, limit);
        let t = now();
        (from..total.min(from.saturating_add(limit)))
            .filter_map(|i| self.lender_loans.get(&(account_id.clone(), i)).copied())
            .filter_map(|id| self.try_loan(id).map(|l| loan_view(id, l, t)))
            .collect()
    }

    pub fn loans_in_circle(&self, circle_id: U64, from_index: Option<u32>, limit: Option<u32>) -> Vec<LoanView> {
        let cid = circle_id.0;
        let total = self.try_circle(cid).map(|c| c.loan_count).unwrap_or(0);
        let (from, limit) = page(from_index, limit);
        let t = now();
        (from..total.min(from.saturating_add(limit)))
            .filter_map(|i| self.circle_loans.get(&(cid, i)).copied())
            .filter_map(|id| self.try_loan(id).map(|l| loan_view(id, l, t)))
            .collect()
    }

    pub fn passport_for(&self, circle_id: U64, account_id: AccountId) -> Option<PassportView> {
        self.passport_view(circle_id.0, &account_id, now())
    }

    pub fn passports_in_circle(&self, circle_id: U64, from_index: Option<u32>, limit: Option<u32>) -> Vec<PassportView> {
        let cid = circle_id.0;
        let total = self.try_circle(cid).map(|c| c.member_count).unwrap_or(0);
        let (from, limit) = page(from_index, limit);
        let t = now();
        (from..total.min(from.saturating_add(limit)))
            .filter_map(|i| self.circle_members.get(&(cid, i)).cloned())
            .filter_map(|a| self.passport_view(cid, &a, t))
            .collect()
    }

    pub fn check_access(&self, circle_id: U64, account_id: AccountId) -> AccessView {
        let cid = circle_id.0;
        if self.try_circle(cid).is_none() {
            return AccessView { allowed: false, reason: AccessReason::NoCircle, token_id: None, display_tier: None };
        }
        let t = now();
        match self.passport(cid, &account_id) {
            None => AccessView { allowed: false, reason: AccessReason::NoPassport, token_id: None, display_tier: None },
            Some(p) => {
                let reason = match Self::effective_status(p, t) {
                    EffectiveStatus::Active => AccessReason::Active,
                    EffectiveStatus::Suspended => AccessReason::Suspended,
                    EffectiveStatus::Revoked => AccessReason::Revoked,
                    EffectiveStatus::Expired => AccessReason::Expired,
                };
                AccessView {
                    allowed: reason == AccessReason::Active,
                    reason,
                    token_id: Some(token_id(cid, &account_id)),
                    display_tier: Some(display_tier(p)),
                }
            }
        }
    }

    pub fn get_invite(&self, invite_public_key: String) -> Option<InviteView> {
        // Accept any formatting the PublicKey parser accepts; store key is canonical.
        let key = invite_public_key
            .parse::<near_sdk::PublicKey>()
            .map(|pk| String::from(&pk))
            .unwrap_or(invite_public_key);
        let inv = self.invites.get(&key)?;
        Some(InviteView {
            circle_id: U64(inv.circle_id),
            invite_public_key: key,
            inviter_id: inv.inviter_id.clone(),
            invitee_id: inv.invitee_id.clone(),
            expires_at: U64(inv.expires_at),
            expired: now() >= inv.expires_at,
        })
    }

    pub fn card_svg(&self, token_id: String) -> Option<String> {
        let (cid, owner) = parse_token_id(&token_id)?;
        let p = self.passport(cid, &owner)?;
        Some(render_card_svg(&self.card_input(cid, p, now())))
    }

    // ---------------------------------------------------- NEP-171/177/181

    pub fn nft_token(&self, token_id: String) -> Option<Token> {
        let (cid, owner) = parse_token_id(&token_id)?;
        self.token(cid, &owner)
    }

    pub fn nft_metadata(&self) -> NftContractMetadata {
        NftContractMetadata {
            spec: "nft-2.0.0".to_string(),
            name: "CommonCircle Passport".to_string(),
            symbol: "CCPASS".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }

    pub fn nft_total_supply(&self) -> U128 {
        U128(self.all_tokens.len() as u128)
    }

    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        let from = from_index.map(|f| f.0.min(u32::MAX as u128) as u32);
        let (from, limit) = page(from, limit.map(|l| l.min(MAX_PAGE as u64) as u32));
        let total = self.all_tokens.len();
        (from..total.min(from.saturating_add(limit)))
            .filter_map(|i| self.all_tokens.get(i).cloned())
            .filter_map(|(cid, owner)| self.token(cid, &owner))
            .collect()
    }

    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(self.owner_token_count.get(&account_id).copied().unwrap_or(0) as u128)
    }

    pub fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        let total = self.owner_token_count.get(&account_id).copied().unwrap_or(0);
        let from = from_index.map(|f| f.0.min(u32::MAX as u128) as u32);
        let (from, limit) = page(from, limit.map(|l| l.min(MAX_PAGE as u64) as u32));
        (from..total.min(from.saturating_add(limit)))
            .filter_map(|i| self.owner_tokens.get(&(account_id.clone(), i)).copied())
            .filter_map(|cid| self.token(cid, &account_id))
            .collect()
    }

    #[payable]
    pub fn nft_transfer(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>) {
        let _ = (receiver_id, token_id, approval_id, memo);
        env::panic_str("E40_NON_TRANSFERABLE: passports cannot be transferred");
    }

    #[payable]
    pub fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> bool {
        let _ = (receiver_id, token_id, approval_id, memo, msg);
        env::panic_str("E40_NON_TRANSFERABLE: passports cannot be transferred");
    }

    #[payable]
    pub fn nft_approve(&mut self, token_id: String, account_id: AccountId, msg: Option<String>) {
        let _ = (token_id, account_id, msg);
        env::panic_str("E40_NON_TRANSFERABLE: passports cannot be approved");
    }

    #[payable]
    pub fn nft_revoke(&mut self, token_id: String, account_id: AccountId) {
        let _ = (token_id, account_id);
        env::panic_str("E40_NON_TRANSFERABLE: passports cannot be approved");
    }

    #[payable]
    pub fn nft_revoke_all(&mut self, token_id: String) {
        let _ = token_id;
        env::panic_str("E40_NON_TRANSFERABLE: passports cannot be approved");
    }

    pub fn nft_is_approved(&self, token_id: String, approved_account_id: AccountId, approval_id: Option<u64>) -> bool {
        let _ = (token_id, approved_account_id, approval_id);
        false
    }
}

fn display_tier(p: &Passport) -> DisplayTier {
    if p.steward {
        DisplayTier::Steward
    } else if p.tier == Tier::Trusted {
        DisplayTier::Trusted
    } else {
        DisplayTier::Member
    }
}

pub(crate) fn loan_view(id: u64, l: &Loan, t: u64) -> LoanView {
    let lapsed = l.is_lapsed(t);
    let state = match l.stage {
        LoanStage::Open if lapsed => LoanStateView::Cancelled,
        LoanStage::Open => LoanStateView::Open,
        LoanStage::Funding => LoanStateView::Funding,
        LoanStage::Funded if l.written_off => LoanStateView::WrittenOff,
        LoanStage::Funded => LoanStateView::Funded,
        LoanStage::Repaying => LoanStateView::Repaying,
        LoanStage::Repaid => LoanStateView::Repaid,
        LoanStage::Cancelled => LoanStateView::Cancelled,
    };
    let cancel_reason = if l.stage == LoanStage::Cancelled && l.cancelled_by_borrower {
        Some(CancelReason::Borrower)
    } else if lapsed {
        Some(CancelReason::Lapsed)
    } else {
        None
    };
    LoanView {
        loan_id: U64(id),
        circle_id: U64(l.circle_id),
        borrower_id: l.borrower_id.clone(),
        lender_id: l.lender_id.clone(),
        lender_is_treasury: l.lender_is_treasury,
        principal: U128(l.principal),
        total_repaid: U128(l.repaid),
        outstanding: U128(l.principal - l.repaid),
        duration_days: l.duration_days,
        duration_sec: U64(l.duration_ns / NS_PER_SEC),
        created_at: U64(l.created_at),
        funding_deadline: U64(l.funding_deadline),
        funded_at: l.funded_at.map(U64),
        due_at: l.due_at.map(U64),
        repaid_at: l.repaid_at.map(U64),
        state,
        cancel_reason,
        funded_via: l.funded_via,
        overdue: l.is_overdue(t),
        repaid_on_time: l.repaid_on_time,
        qualifying: l.qualifying,
        flag_cleared: l.flag_cleared,
    }
}

impl Contract {
    fn card_input(&self, cid: u64, p: &Passport, t: u64) -> CardInput {
        let overdue = self.overdue_count(p, t);
        CardInput {
            circle_id: cid,
            tier: display_tier(p),
            status: Self::effective_status(p, t),
            on_time: p.on_time,
            late: p.late,
            perks_paused: p.tier == Tier::Trusted && overdue > 0,
        }
    }

    pub(crate) fn passport_view(&self, cid: u64, owner: &AccountId, t: u64) -> Option<PassportView> {
        let p = self.passport(cid, owner)?;
        let overdue = self.overdue_count(p, t);
        Some(PassportView {
            token_id: token_id(cid, owner),
            circle_id: U64(cid),
            owner_id: owner.clone(),
            tier: p.tier,
            steward: p.steward,
            display_tier: display_tier(p),
            status: Self::effective_status(p, t),
            expires_at: p.expires_at.map(U64),
            joined_at: U64(p.joined_at),
            invited_by: p.invited_by.clone(),
            on_time_count: p.on_time,
            late_count: p.late,
            qualifying_count: p.qualifying,
            distinct_lenders: p.lenders.len() as u32,
            open_loans: self.open_count(p, t),
            overdue_loans: overdue,
            perks_paused: p.tier == Tier::Trusted && overdue > 0,
            effective_tier: self.effective_tier(p, t),
            recovery: None,
        })
    }

    pub(crate) fn token(&self, cid: u64, owner: &AccountId) -> Option<Token> {
        let p = self.passport(cid, owner)?;
        let t = now();
        let input = self.card_input(cid, p, t);
        let svg = render_card_svg(&input);
        let tier_text = match input.tier {
            DisplayTier::Member => "Member",
            DisplayTier::Trusted => "Trusted",
            DisplayTier::Steward => "Steward",
        };
        let status_text = match input.status {
            EffectiveStatus::Active => "active",
            EffectiveStatus::Suspended => "suspended",
            EffectiveStatus::Revoked => "revoked",
            EffectiveStatus::Expired => "expired",
        };
        Some(Token {
            token_id: token_id(cid, owner),
            owner_id: owner.clone(),
            metadata: Some(TokenMetadata {
                title: Some(format!("CommonCircle Passport #{}", cid)),
                description: Some(format!(
                    "Non-transferable CommonCircle membership passport. Tier: {}. Status: {}.",
                    tier_text, status_text
                )),
                media: Some(data_uri(&svg)),
                media_hash: None,
                copies: Some(1),
                issued_at: Some((p.joined_at / 1_000_000).to_string()),
                expires_at: p.expires_at.map(|e| (e / 1_000_000).to_string()),
                starts_at: None,
                updated_at: None,
                extra: None,
                reference: None,
                reference_hash: None,
            }),
            approved_account_ids: Some(std::collections::HashMap::new()),
        })
    }
}
