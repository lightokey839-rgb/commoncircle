//! On-chain invites (F1). The invite secret lives only in the link; the
//! contract stores the public key and verifies an ed25519 signature over a
//! canonical message (deviation D-001: tag + contract id for replay safety).

use near_sdk::json_types::{Base64VecU8, U64};
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId, CurveType, PublicKey};

use crate::*;

pub const INVITE_TAG: &str = "commoncircle-invite-v1";

/// The exact bytes the invitee signs. Fields joined by '\n', no trailing newline.
pub fn invite_message(contract_id: &AccountId, circle_id: u64, caller: &AccountId, invite_public_key: &str) -> Vec<u8> {
    format!(
        "{}\n{}\n{}\n{}\n{}",
        INVITE_TAG, contract_id, circle_id, caller, invite_public_key
    )
    .into_bytes()
}

fn parse_ed25519(key: &str) -> (String, [u8; 32]) {
    let pk: PublicKey = key
        .parse()
        .unwrap_or_else(|_| env::panic_str("E33_INVITE_BAD_SIGNATURE: invite key is not a valid public key"));
    require!(
        pk.curve_type() == CurveType::ED25519,
        "E33_INVITE_BAD_SIGNATURE: invite key must be ed25519"
    );
    let raw = pk.as_bytes();
    // First byte is the curve type; the remaining 32 bytes are the key.
    let bytes: [u8; 32] = raw[1..]
        .try_into()
        .unwrap_or_else(|_| env::panic_str("E33_INVITE_BAD_SIGNATURE: bad key length"));
    // Canonical string form, so the map key and signed message never differ
    // by formatting.
    (String::from(&pk), bytes)
}

#[near]
impl Contract {
    /// Register an invite. Founder (while still admin) or an effectively Trusted
    /// member with an Active passport. Inviter pays storage.
    #[payable]
    pub fn register_invite(
        &mut self,
        circle_id: U64,
        invite_public_key: String,
        expires_at: U64,
        invitee_id: Option<AccountId>,
    ) {
        let initial = env::storage_usage();
        let cid = circle_id.0;
        let t = now();
        let circle = self.circle(cid).clone();
        let inviter = env::predecessor_account_id();
        let passport = self
            .passport(cid, &inviter)
            .cloned()
            .unwrap_or_else(|| env::panic_str("E34_NOT_INVITER: only the founder or a Trusted member can invite"));
        require!(
            Self::effective_status(&passport, t) == EffectiveStatus::Active,
            "E34_NOT_INVITER: your passport is not active"
        );
        let founder_admin = inviter == circle.founder_id && circle.admin_id == circle.founder_id;
        require!(
            founder_admin || self.effective_tier(&passport, t) == Tier::Trusted,
            "E34_NOT_INVITER: only the founder or a Trusted member can invite"
        );
        require!(expires_at.0 > t, "E31_INVITE_EXPIRED: expiry must be in the future");
        let (key, _) = parse_ed25519(&invite_public_key);
        require!(
            !self.invites.contains_key(&key),
            "E36_INVITE_EXISTS: that invite key is already registered"
        );
        if let Some(invitee) = &invitee_id {
            require!(
                self.passport(cid, invitee).is_none(),
                "E35_ALREADY_MEMBER: the invitee already has a passport in this circle"
            );
        }
        self.invites.insert(
            key.clone(),
            Invite {
                circle_id: cid,
                inviter_id: inviter.clone(),
                invitee_id: invitee_id.clone(),
                expires_at: expires_at.0,
            },
        );
        events::emit(
            "invite_registered",
            json!({
                "circle_id": cid.to_string(),
                "inviter_id": inviter,
                "invitee_id": invitee_id,
                "invite_public_key": key,
                "expires_at": expires_at,
            }),
        );
        charge_storage(initial, 0);
    }

    /// Redeem an invite and mint a passport. Single use; named invites bind to
    /// one account. The redeemer pays passport storage.
    #[payable]
    pub fn redeem_invite(&mut self, circle_id: U64, invite_public_key: String, signature: Base64VecU8) -> String {
        let initial = env::storage_usage();
        let cid = circle_id.0;
        let t = now();
        let caller = env::predecessor_account_id();
        let (key, pk_bytes) = parse_ed25519(&invite_public_key);
        let invite = self
            .invites
            .get(&key)
            .cloned()
            .unwrap_or_else(|| env::panic_str("E30_INVITE_NOT_FOUND: this invite does not exist or was used"));
        require!(invite.circle_id == cid, "E30_INVITE_NOT_FOUND: this invite is for another circle");
        require!(t < invite.expires_at, "E31_INVITE_EXPIRED: this invite has expired");
        if let Some(named) = &invite.invitee_id {
            require!(named == &caller, "E32_INVITE_WRONG_ACCOUNT: this invite is for a different account");
        }
        let sig: [u8; 64] = signature
            .0
            .as_slice()
            .try_into()
            .unwrap_or_else(|_| env::panic_str("E33_INVITE_BAD_SIGNATURE: signature must be 64 bytes"));
        let msg = invite_message(&env::current_account_id(), cid, &caller, &key);
        require!(
            env::ed25519_verify(&sig, &msg, &pk_bytes),
            "E33_INVITE_BAD_SIGNATURE: the invite link is invalid"
        );
        // Inviter must still be founder or hold an Active passport.
        let circle = self.circle(cid).clone();
        let inviter_ok = invite.inviter_id == circle.founder_id && circle.admin_id == circle.founder_id
            || self.is_active(cid, &invite.inviter_id, t);
        require!(inviter_ok, "E34_NOT_INVITER: the inviter can no longer invite");

        let tid = self.mint_passport(cid, &caller, Some(invite.inviter_id.clone()));
        // Measure before deleting the invite so the redeemer pays the full
        // passport cost; the freed invite bytes stay with the contract.
        let after_mint = env::storage_usage();
        self.invites.remove(&key);
        events::emit(
            "invite_redeemed",
            json!({
                "circle_id": cid.to_string(),
                "account_id": caller,
                "token_id": tid,
                "inviter_id": invite.inviter_id,
                "invite_public_key": key,
            }),
        );
        charge_storage_upto(initial, after_mint);
        tid
    }
}

/// Like `charge_storage`, but measures growth only up to `measured_at`.
fn charge_storage_upto(initial: u64, measured_at: u64) {
    let used = measured_at.saturating_sub(initial);
    let cost = env::storage_byte_cost().saturating_mul(used as u128);
    let attached = env::attached_deposit();
    if attached < cost {
        env::panic_str(&format!("E02_DEPOSIT: attach at least {} yoctoNEAR", cost.as_yoctonear()));
    }
    let refund = attached.saturating_sub(cost);
    if !refund.is_zero() {
        near_sdk::Promise::new(env::predecessor_account_id()).transfer(refund).detach();
    }
}
