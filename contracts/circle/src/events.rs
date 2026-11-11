//! NEP-297 events. Schema: docs/EVENTS.md. Every state change emits exactly one
//! `commoncircle` event (plus the standard `nep171` mint event for passports).

use near_sdk::serde_json::{json, Value};
use near_sdk::{env, AccountId};

pub const STANDARD: &str = "commoncircle";
pub const VERSION: &str = "1.0.0";

fn log(standard: &str, version: &str, event: &str, data: Value) {
    let body = json!({
        "standard": standard,
        "version": version,
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{}", body));
}

/// Emit a `commoncircle` event.
pub fn emit(event: &str, data: Value) {
    log(STANDARD, VERSION, event, data);
}

/// Standard NEP-171 mint event, so explorers and wallets index passports.
pub fn nft_mint(owner: &AccountId, token_id: &str) {
    log(
        "nep171",
        "1.2.0",
        "nft_mint",
        json!({ "owner_id": owner, "token_ids": [token_id] }),
    );
}
