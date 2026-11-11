//! On-chain passport card art (interface 1.1.0).
//!
//! A deterministic, square (512x512) SVG built from the circle's theme (name
//! tag, tagline, colours, pattern, optional raster emblem chosen by the
//! circle's admin) and the member's display tier, status and on-time / late
//! counts. No personal data: the member's account id never appears. All text
//! is XML-escaped. Everything sits at least 40 px inside the edge, so wallets
//! that crop to a square or round the corners do not cut content.

use crate::themes::{emblem_mime, hex};
use crate::types::{CardPattern, DisplayTier, EffectiveStatus, StoredTheme};

pub struct CardInput {
    pub circle_id: u64,
    pub circle_name: String,
    pub theme: StoredTheme,
    pub tier: DisplayTier,
    pub status: EffectiveStatus,
    pub on_time: u32,
    pub late: u32,
    pub perks_paused: bool,
}

const FONT: &str = "Helvetica, Arial, sans-serif";
const GOLD: &str = "#F1C453";
const STEWARD: &str = "#F4A259";

pub fn xml_escape(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            '\'' => o.push_str("&apos;"),
            c if c.is_control() => {}
            c => o.push(c),
        }
    }
    o
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut t: String = s.chars().take(max - 1).collect();
        t.push('…');
        t
    }
}

fn shade(c: [u8; 3], num: u16, den: u16) -> [u8; 3] {
    let f = |v: u8| ((v as u16 * num) / den).min(255) as u8;
    [f(c[0]), f(c[1]), f(c[2])]
}

fn tier_label(t: DisplayTier) -> &'static str {
    match t {
        DisplayTier::Member => "MEMBER",
        DisplayTier::Trusted => "TRUSTED",
        DisplayTier::Steward => "STEWARD",
    }
}

fn status_chip(s: EffectiveStatus) -> (&'static str, &'static str) {
    match s {
        EffectiveStatus::Active => ("ACTIVE", "#2A9D8F"),
        EffectiveStatus::Suspended => ("SUSPENDED", "#B5651D"),
        EffectiveStatus::Revoked => ("REVOKED", "#6C757D"),
        EffectiveStatus::Expired => ("EXPIRED", "#6C757D"),
    }
}

fn pattern_defs(p: CardPattern, accent: &str) -> String {
    match p {
        CardPattern::Dots => format!(
            "<pattern id=\"pat\" width=\"22\" height=\"22\" patternUnits=\"userSpaceOnUse\"><circle cx=\"4\" cy=\"4\" r=\"2.2\" fill=\"{a}\"/></pattern>",
            a = accent
        ),
        CardPattern::Grid => format!(
            "<pattern id=\"pat\" width=\"32\" height=\"32\" patternUnits=\"userSpaceOnUse\"><path d=\"M32 0H0V32\" fill=\"none\" stroke=\"{a}\" stroke-width=\"1.2\"/></pattern>",
            a = accent
        ),
        CardPattern::Waves => format!(
            "<pattern id=\"pat\" width=\"48\" height=\"24\" patternUnits=\"userSpaceOnUse\"><path d=\"M0 12 Q12 2 24 12 T48 12\" fill=\"none\" stroke=\"{a}\" stroke-width=\"2\"/></pattern>",
            a = accent
        ),
        CardPattern::Rays | CardPattern::None => String::new(),
    }
}

fn pattern_layer(p: CardPattern, accent: &str) -> String {
    match p {
        CardPattern::Dots | CardPattern::Grid | CardPattern::Waves => {
            "<rect width=\"512\" height=\"512\" rx=\"44\" fill=\"url(#pat)\" opacity=\"0.22\"/>".to_string()
        }
        CardPattern::Rays => {
            let mut g = format!("<g opacity=\"0.13\" stroke=\"{}\" stroke-width=\"14\">", accent);
            for i in 0..12 {
                g.push_str(&format!(
                    "<line x1=\"256\" y1=\"262\" x2=\"256\" y2=\"-120\" transform=\"rotate({} 256 262)\"/>",
                    i * 30
                ));
            }
            g.push_str("</g>");
            g
        }
        CardPattern::None => String::new(),
    }
}

/// cos/sin x 1000 for the ten star vertices (-90 deg + 36 deg steps).
/// Integer table: the contract uses no floating point anywhere.
const STAR: [(i32, i32); 10] = [
    (0, -1000), (588, -809), (951, -309), (951, 309), (588, 809),
    (0, 1000), (-588, 809), (-951, 309), (-951, -309), (-588, -809),
];

/// Five-point star centred at (cx, cy) with outer radius r.
fn star(cx: i32, cy: i32, r: i32, fill: &str) -> String {
    let mut pts = String::new();
    for (i, (c, s)) in STAR.iter().enumerate() {
        let rad = if i % 2 == 0 { r * 100 } else { r * 45 };
        pts.push_str(&format!("{},{} ", cx + rad * c / 100_000, cy + rad * s / 100_000));
    }
    format!("<polygon points=\"{}\" fill=\"{}\"/>", pts.trim_end(), fill)
}

/// Offsets of eight members on a circle of radius 62 (45 deg steps).
const RING: [(i32, i32); 8] = [(62, 0), (44, 44), (0, 62), (-44, 44), (-62, 0), (-44, -44), (0, -62), (44, -44)];

/// Built-in emblem: eight members around one, i.e. a circle of people.
fn default_emblem(accent: &str, text: &str) -> String {
    let mut g = String::new();
    for (dx, dy) in RING {
        g.push_str(&format!(
            "<circle cx=\"{}\" cy=\"{}\" r=\"15\" fill=\"{}\"/>",
            256 + dx,
            262 + dy,
            accent
        ));
    }
    g.push_str(&format!(
        "<circle cx=\"256\" cy=\"262\" r=\"26\" fill=\"{t}\"/><circle cx=\"256\" cy=\"262\" r=\"62\" fill=\"none\" stroke=\"{a}\" stroke-width=\"3\" stroke-dasharray=\"4 7\"/>",
        t = text,
        a = accent
    ));
    g
}

fn tier_frame(t: DisplayTier, accent: &str) -> String {
    match t {
        DisplayTier::Member => format!(
            "<circle cx=\"256\" cy=\"262\" r=\"112\" fill=\"none\" stroke=\"{}\" stroke-width=\"6\"/>",
            accent
        ),
        DisplayTier::Trusted => format!(
            "<circle cx=\"256\" cy=\"262\" r=\"112\" fill=\"none\" stroke=\"{g}\" stroke-width=\"7\"/><circle cx=\"256\" cy=\"262\" r=\"124\" fill=\"none\" stroke=\"{g}\" stroke-width=\"3\"/>{s1}{s2}{s3}",
            g = GOLD,
            s1 = star(216, 140, 11, GOLD),
            s2 = star(256, 128, 15, GOLD),
            s3 = star(296, 140, 11, GOLD),
        ),
        DisplayTier::Steward => format!(
            "<circle cx=\"256\" cy=\"262\" r=\"108\" fill=\"none\" stroke=\"{s}\" stroke-width=\"5\"/><circle cx=\"256\" cy=\"262\" r=\"118\" fill=\"none\" stroke=\"{g}\" stroke-width=\"6\"/><circle cx=\"256\" cy=\"262\" r=\"129\" fill=\"none\" stroke=\"{s}\" stroke-width=\"3\"/><path d=\"M222 146 L230 116 L244 134 L256 108 L268 134 L282 116 L290 146 Z\" fill=\"{g}\" stroke=\"{s}\" stroke-width=\"2\"/>",
            s = STEWARD,
            g = GOLD
        ),
    }
}

pub fn render_card_svg(c: &CardInput) -> String {
    let th = &c.theme;
    let bg = hex(th.background);
    let bg_dark = hex(shade(th.background, 11, 20));
    let accent = hex(th.accent);
    let text = hex(th.text);
    let active = c.status == EffectiveStatus::Active;

    let name = xml_escape(&truncate(&c.circle_name, 26));
    let name_size = match c.circle_name.chars().count() {
        0..=14 => 30,
        15..=20 => 25,
        _ => 21,
    };
    let tagline = th
        .tagline
        .as_deref()
        .map(|t| {
            format!(
                "<text x=\"256\" y=\"122\" text-anchor=\"middle\" font-family=\"{f}\" font-size=\"15\" letter-spacing=\"1.5\" fill=\"{a}\">{t}</text>",
                f = FONT,
                a = accent,
                t = xml_escape(&truncate(t, 32))
            )
        })
        .unwrap_or_default();

    let emblem = match th.emblem.as_deref().and_then(|e| emblem_mime(e).map(|m| (m, e))) {
        Some((mime, bytes)) => {
            let uri = format!("data:{};base64,{}", mime, base64(bytes));
            format!(
                "<image x=\"152\" y=\"158\" width=\"208\" height=\"208\" preserveAspectRatio=\"xMidYMid slice\" clip-path=\"url(#em)\" href=\"{u}\" xlink:href=\"{u}\"/>",
                u = uri
            )
        }
        None => default_emblem(&accent, &text),
    };

    let ribbon_color = match c.tier {
        DisplayTier::Member => accent.clone(),
        DisplayTier::Trusted => GOLD.to_string(),
        DisplayTier::Steward => STEWARD.to_string(),
    };
    let (status_text, status_color) = status_chip(c.status);
    let mono = if active { "" } else { " filter=\"url(#mono)\"" };

    let paused = if c.perks_paused {
        format!(
            "<g transform=\"rotate(-16 256 262)\"><rect x=\"40\" y=\"236\" width=\"432\" height=\"50\" rx=\"10\" fill=\"#E63946\" fill-opacity=\"0.92\"/><text x=\"256\" y=\"269\" text-anchor=\"middle\" font-family=\"{f}\" font-size=\"20\" font-weight=\"700\" letter-spacing=\"2\" fill=\"#FFFFFF\">OVERDUE - PERKS PAUSED</text></g>",
            f = FONT
        )
    } else {
        String::new()
    };

    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"512\" height=\"512\" viewBox=\"0 0 512 512\">\
<defs>\
<linearGradient id=\"bg\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"{bg}\"/><stop offset=\"1\" stop-color=\"{bgd}\"/></linearGradient>\
<radialGradient id=\"glow\" cx=\"0.5\" cy=\"0.5\" r=\"0.5\"><stop offset=\"0\" stop-color=\"{accent}\" stop-opacity=\"0.35\"/><stop offset=\"1\" stop-color=\"{accent}\" stop-opacity=\"0\"/></radialGradient>\
<clipPath id=\"em\"><circle cx=\"256\" cy=\"262\" r=\"104\"/></clipPath>\
<filter id=\"mono\"><feColorMatrix type=\"saturate\" values=\"0\"/></filter>\
{patdefs}\
</defs>\
<g{mono}>\
<rect width=\"512\" height=\"512\" rx=\"44\" fill=\"url(#bg)\"/>\
{patlayer}\
<rect x=\"14\" y=\"14\" width=\"484\" height=\"484\" rx=\"32\" fill=\"none\" stroke=\"{accent}\" stroke-opacity=\"0.45\" stroke-width=\"2\"/>\
<rect x=\"64\" y=\"40\" width=\"384\" height=\"56\" rx=\"28\" fill=\"{bgd}\" fill-opacity=\"0.8\" stroke=\"{accent}\" stroke-width=\"2\"/>\
<text x=\"256\" y=\"{ny}\" text-anchor=\"middle\" font-family=\"{f}\" font-size=\"{ns}\" font-weight=\"700\" fill=\"{text}\">{name}</text>\
{tagline}\
<circle cx=\"256\" cy=\"262\" r=\"150\" fill=\"url(#glow)\"/>\
<circle cx=\"256\" cy=\"262\" r=\"104\" fill=\"{bgd}\"/>\
{emblem}\
{frame}\
<rect x=\"166\" y=\"372\" width=\"180\" height=\"40\" rx=\"20\" fill=\"{ribbon}\"/>\
<text x=\"256\" y=\"399\" text-anchor=\"middle\" font-family=\"{f}\" font-size=\"19\" font-weight=\"800\" letter-spacing=\"3\" fill=\"{bgd}\">{tier}</text>\
<text x=\"56\" y=\"446\" font-family=\"{f}\" font-size=\"16\" font-weight=\"700\" fill=\"{text}\">ON TIME {on}</text>\
<text x=\"56\" y=\"470\" font-family=\"{f}\" font-size=\"15\" fill=\"{text}\" fill-opacity=\"0.8\">LATE {late}</text>\
<rect x=\"334\" y=\"432\" width=\"122\" height=\"32\" rx=\"16\" fill=\"{sc}\"/>\
<text x=\"395\" y=\"453\" text-anchor=\"middle\" font-family=\"{f}\" font-size=\"13\" font-weight=\"700\" letter-spacing=\"1\" fill=\"#FFFFFF\">{st}</text>\
<text x=\"456\" y=\"484\" text-anchor=\"end\" font-family=\"{f}\" font-size=\"11\" letter-spacing=\"1\" fill=\"{text}\" fill-opacity=\"0.6\">COMMONCIRCLE PASSPORT #{cid}</text>\
</g>\
{paused}\
</svg>",
        bg = bg,
        bgd = bg_dark,
        accent = accent,
        text = text,
        patdefs = pattern_defs(th.pattern, &accent),
        patlayer = pattern_layer(th.pattern, &accent),
        mono = mono,
        ny = 78 - (30 - name_size) / 3,
        ns = name_size,
        f = FONT,
        name = name,
        tagline = tagline,
        emblem = emblem,
        frame = tier_frame(c.tier, &accent),
        ribbon = ribbon_color,
        tier = tier_label(c.tier),
        on = c.on_time,
        late = c.late,
        sc = status_color,
        st = status_text,
        cid = c.circle_id,
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
