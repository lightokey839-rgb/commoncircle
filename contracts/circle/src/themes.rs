//! Per-circle passport themes (interface 1.1.0, deviation D-008).
//!
//! A theme is stored under its own raw storage key, outside `Circle`, so the
//! stored layout of circles created before themes existed is unchanged and the
//! code can be redeployed in place on testnet.

use near_sdk::borsh;
use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use near_sdk::{env, near};

use crate::*;

/// Largest emblem image accepted, in bytes. Keeps one token's metadata small
/// enough for 50-token enumeration views.
pub const MAX_EMBLEM_BYTES: usize = 12 * 1024;
pub const MAX_TAGLINE_LEN: usize = 32;

fn theme_key(circle_id: u64) -> Vec<u8> {
    let mut k = b"theme:".to_vec();
    k.extend_from_slice(&circle_id.to_le_bytes());
    k
}

pub(crate) fn load_theme(circle_id: u64) -> Option<StoredTheme> {
    env::storage_read(&theme_key(circle_id)).and_then(|b| borsh::from_slice(&b).ok())
}

fn store_theme(circle_id: u64, theme: &StoredTheme) {
    let bytes = borsh::to_vec(theme).unwrap_or_else(|_| env::panic_str("E04_BAD_PARAMS: theme"));
    env::storage_write(&theme_key(circle_id), &bytes);
}

fn bad(m: &str) -> ! {
    env::panic_str(&format!("E04_BAD_PARAMS: {}", m))
}

fn parse_hex(field: &str, v: &Option<String>, default: [u8; 3]) -> [u8; 3] {
    let Some(s) = v else { return default };
    let h = s.strip_prefix('#').unwrap_or_else(|| bad(&format!("{} must be #RRGGBB", field)));
    if h.len() != 6 || !h.bytes().all(|c| c.is_ascii_hexdigit()) {
        bad(&format!("{} must be #RRGGBB", field));
    }
    let n = u32::from_str_radix(h, 16).unwrap_or_else(|_| bad(field));
    [(n >> 16) as u8, (n >> 8) as u8, n as u8]
}

/// MIME type from magic bytes. Only raster formats; never SVG.
pub fn emblem_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

pub(crate) fn validate_theme(input: CircleThemeInput) -> StoredTheme {
    let d = StoredTheme::default();
    let tagline = input.tagline.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    if let Some(t) = &tagline {
        if t.chars().count() > MAX_TAGLINE_LEN || t.chars().any(|c| c.is_control()) {
            bad("tagline must be 1..32 printable characters");
        }
    }
    let emblem = input.emblem.map(|e| e.0);
    if let Some(e) = &emblem {
        if e.is_empty() || e.len() > MAX_EMBLEM_BYTES {
            bad("emblem must be 1..12288 bytes");
        }
        if emblem_mime(e).is_none() {
            bad("emblem must be a PNG, JPEG, GIF or WebP image");
        }
    }
    StoredTheme {
        tagline,
        background: parse_hex("background", &input.background, d.background),
        accent: parse_hex("accent", &input.accent, d.accent),
        text: parse_hex("text", &input.text, d.text),
        pattern: input.pattern.unwrap_or(d.pattern),
        emblem,
    }
}

pub fn hex(c: [u8; 3]) -> String {
    format!("#{:02X}{:02X}{:02X}", c[0], c[1], c[2])
}

pub(crate) fn theme_view(stored: Option<&StoredTheme>) -> CircleThemeView {
    let custom = stored.is_some();
    let d = StoredTheme::default();
    let t = stored.unwrap_or(&d);
    CircleThemeView {
        tagline: t.tagline.clone(),
        background: hex(t.background),
        accent: hex(t.accent),
        text: hex(t.text),
        pattern: t.pattern,
        emblem_mime: t.emblem.as_deref().and_then(emblem_mime).map(String::from),
        emblem_bytes: t.emblem.as_ref().map(|e| e.len() as u32).unwrap_or(0),
        custom,
    }
}

impl Contract {
    /// Store a validated theme and emit `circle_theme_set`. Storage is charged
    /// by the caller of the public method.
    pub(crate) fn apply_theme(&mut self, circle_id: u64, input: CircleThemeInput) {
        let theme = validate_theme(input);
        store_theme(circle_id, &theme);
        let v = theme_view(Some(&theme));
        events::emit(
            "circle_theme_set",
            json!({
                "circle_id": circle_id.to_string(),
                "by": env::predecessor_account_id(),
                "tagline": v.tagline,
                "background": v.background,
                "accent": v.accent,
                "text": v.text,
                "pattern": v.pattern,
                "emblem_mime": v.emblem_mime,
                "emblem_bytes": v.emblem_bytes,
            }),
        );
    }
}

#[near]
impl Contract {
    /// Replace the circle's passport theme. Circle admin only (the founder
    /// until `attach_dao`, then the DAO). Caller pays any added storage; the
    /// excess deposit is refunded; freed bytes are not refunded.
    #[payable]
    pub fn set_circle_theme(&mut self, circle_id: U64, theme: CircleThemeInput) {
        let initial = env::storage_usage();
        let cid = circle_id.0;
        self.assert_admin(cid);
        self.apply_theme(cid, theme);
        charge_storage(initial, 0);
    }
}
