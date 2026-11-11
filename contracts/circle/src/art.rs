//! On-chain passport card art. Deterministic SVG from circle id, display tier,
//! status and the on-time / late counts. No personal data (no account id).

use crate::types::{DisplayTier, EffectiveStatus};

pub struct CardInput {
    pub circle_id: u64,
    pub tier: DisplayTier,
    pub status: EffectiveStatus,
    pub on_time: u32,
    pub late: u32,
    pub perks_paused: bool,
}

fn tier_label(t: DisplayTier) -> &'static str {
    match t {
        DisplayTier::Member => "MEMBER",
        DisplayTier::Trusted => "TRUSTED",
        DisplayTier::Steward => "STEWARD",
    }
}

fn status_label(s: EffectiveStatus) -> &'static str {
    match s {
        EffectiveStatus::Active => "ACTIVE",
        EffectiveStatus::Suspended => "SUSPENDED",
        EffectiveStatus::Revoked => "REVOKED",
        EffectiveStatus::Expired => "EXPIRED",
    }
}

/// (background, accent) per tier; greyed out when not active.
fn palette(t: DisplayTier, s: EffectiveStatus) -> (&'static str, &'static str) {
    if s != EffectiveStatus::Active {
        return ("#3a3a3a", "#9a9a9a");
    }
    match t {
        DisplayTier::Member => ("#1d3557", "#a8dadc"),
        DisplayTier::Trusted => ("#2a6f4e", "#f1c453"),
        DisplayTier::Steward => ("#5b2a86", "#f4a259"),
    }
}

pub fn render_card_svg(c: &CardInput) -> String {
    let (bg, accent) = palette(c.tier, c.status);
    let rings = match c.tier {
        DisplayTier::Member => 1,
        DisplayTier::Trusted => 2,
        DisplayTier::Steward => 3,
    };
    let mut circles = String::new();
    for i in 0..rings {
        let r = 46 + i * 14;
        circles.push_str(&format!(
            "<circle cx=\"200\" cy=\"150\" r=\"{}\" fill=\"none\" stroke=\"{}\" stroke-width=\"6\"/>",
            r, accent
        ));
    }
    let paused = if c.perks_paused {
        "<text x=\"200\" y=\"262\" font-size=\"14\" text-anchor=\"middle\" fill=\"#ffb4a2\">OVERDUE - PERKS PAUSED</text>"
    } else {
        ""
    };
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"400\" height=\"300\" viewBox=\"0 0 400 300\">\
<rect width=\"400\" height=\"300\" rx=\"24\" fill=\"{bg}\"/>\
{circles}\
<text x=\"24\" y=\"40\" font-family=\"monospace\" font-size=\"16\" fill=\"{accent}\">COMMONCIRCLE #{cid}</text>\
<text x=\"200\" y=\"158\" font-family=\"monospace\" font-size=\"22\" text-anchor=\"middle\" fill=\"#ffffff\">{tier}</text>\
<text x=\"24\" y=\"236\" font-family=\"monospace\" font-size=\"14\" fill=\"#ffffff\">ON TIME {on} / LATE {late}</text>\
<text x=\"376\" y=\"236\" font-family=\"monospace\" font-size=\"14\" text-anchor=\"end\" fill=\"{accent}\">{status}</text>\
{paused}</svg>",
        bg = bg,
        accent = accent,
        circles = circles,
        cid = c.circle_id,
        tier = tier_label(c.tier),
        on = c.on_time,
        late = c.late,
        status = status_label(c.status),
        paused = paused,
    )
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 with padding (RFC 4648).
pub fn base64(input: &[u8]) -> String {
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { B64[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[n as usize & 63] as char } else { '=' });
    }
    out
}

pub fn data_uri(svg: &str) -> String {
    format!("data:image/svg+xml;base64,{}", base64(svg.as_bytes()))
}
