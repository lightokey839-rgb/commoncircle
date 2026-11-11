//! Gate 1 red-team tests. Each test is named after the attack it tries.
//! Tests named `..._known_issue` assert a CURRENT, accepted limitation, so a
//! later fix must flip them. D-009 fixed and flipped: storage charging, the
//! DAO passport, and invisible characters in names. Results are also written to $ARTIFACT_DIR.

mod common;

use anyhow::Result;
use common::*;
use near_workspaces::types::NearToken;
use serde_json::json;

/// C4: one account creates 50 circles with maximum-size emblems. Do the NFT
/// enumeration views that wallets and indexers call still answer?
#[tokio::test]
async fn rt_nft_enumeration_with_50_max_size_emblems() -> Result<()> {
    let w = world().await?;
    let mut emblem = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    emblem.resize(12 * 1024, 0xA5);
    let b64 = common::base64_engine::encode(&emblem);
    let deposit = storage_cost(&w, "create_circle").await?;
    let attacker = w.worker.dev_create_account().await?;
    for i in 0..50 {
        attacker
            .call(w.circle.id(), "create_circle")
            .args_json(json!({ "name": format!("Spam {}", i), "params": params(), "theme": { "emblem": b64 } }))
            .deposit(NearToken::from_yoctonear(deposit))
            .max_gas()
            .transact()
            .await?
            .into_result()?;
    }
    let mut report = Vec::new();
    for limit in [1u32, 10, 25, 50] {
        let r = w
            .circle
            .view("nft_tokens_for_owner")
            .args_json(json!({ "account_id": attacker.id(), "limit": limit }))
            .await;
        report.push(match r {
            Ok(v) => format!("{{\"view\":\"nft_tokens_for_owner\",\"limit\":{},\"ok\":true,\"bytes\":{}}}", limit, v.result.len()),
            Err(e) => format!(
                "{{\"view\":\"nft_tokens_for_owner\",\"limit\":{},\"ok\":false,\"error\":{:?}}}",
                limit,
                format!("{:?}", e).chars().take(240).collect::<String>()
            ),
        });
    }
    let r = w.circle.view("nft_tokens").args_json(json!({ "from_index": "1", "limit": 50 })).await;
    report.push(match r {
        Ok(v) => format!("{{\"view\":\"nft_tokens\",\"limit\":50,\"ok\":true,\"bytes\":{}}}", v.result.len()),
        Err(e) => format!(
            "{{\"view\":\"nft_tokens\",\"limit\":50,\"ok\":false,\"error\":{:?}}}",
            format!("{:?}", e).chars().take(240).collect::<String>()
        ),
    });
    save_artifact("redteam_enumeration.json", &format!("[{}]", report.join(",")));
    Ok(())
}

/// B3 (lead 2, fixed in D-009): after attach_dao the DAO account must not be
/// able to take a passport, make itself a steward, or count toward the
/// 2-steward rule.
#[tokio::test]
async fn rt_dao_cannot_take_a_passport_or_count_as_steward() -> Result<()> {
    let w = world().await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    borrow_fund_repay(&w, 1, 2).await?; // bob is Trusted
    let dao = w.worker.dev_create_account().await?;
    call1(&w, &w.founder, "set_steward", json!({ "circle_id": "1", "account_id": w.founder.id(), "steward": true }))
        .await?
        .into_result()?;
    call1(&w, &w.founder, "attach_dao", json!({ "circle_id": "1", "dao_id": dao.id() })).await?.into_result()?;

    let (sk, pk) = invite_key(21);
    let registered = register_invite(&w, &w.bob, &pk, Some(dao.id())).await?.is_success();
    let redeem_result = redeem(&w, &dao, &sk, &pk).await?;
    let redeemed = redeem_result.is_success();
    assert!(failed_with(redeem_result, "E37_TREASURY_NO_PASSPORT"));
    let self_steward = redeemed
        && call1(&w, &dao, "set_steward", json!({ "circle_id": "1", "account_id": dao.id(), "steward": true }))
            .await?
            .is_success();
    let c: serde_json::Value = w.circle.view("get_circle").args_json(json!({ "circle_id": "1" })).await?.json()?;
    let treasury_loan = create_loan(&w, &w.bob, dao.id(), 10 * USDC, 2).await?.is_success();
    save_artifact(
        "redteam_dao_passport.json",
        &format!(
            "{{\"invite_registered_for_dao\":{},\"dao_redeemed_passport\":{},\"dao_made_itself_steward\":{},\"steward_count\":{},\"treasury_lending_enabled\":{},\"treasury_loan_created_with_one_human_steward\":{}}}",
            registered, redeemed, self_steward, c["steward_count"], c["treasury_lending_enabled"], treasury_loan
        ),
    );
    assert!(registered, "an invite naming the DAO can be registered, but not redeemed");
    assert!(!redeemed && !self_steward, "the DAO must not hold a passport");
    assert_eq!(c["steward_count"], 1);
    assert!(!treasury_loan, "one human steward must not unlock treasury lending");
    Ok(())
}

/// A (grief): the lender leaves the token so repayment cannot be delivered.
/// The borrower, who tried to pay on time, becomes overdue and later "late".
#[tokio::test]
async fn rt_lender_unregistering_makes_an_honest_borrower_late_known_issue() -> Result<()> {
    let mut p = params();
    p["day_length_sec"] = json!("1");
    let w = world_with(p).await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    create_loan(&w, &w.bob, w.carol.id(), 10 * USDC, 5).await?.into_result()?;
    ft_transfer_call(&w.carol, &w.usdc, w.circle.id(), 10 * USDC, fund_msg(1), RECOMMENDED_TGAS).await?;
    w.carol
        .call(w.usdc.id(), "storage_unregister")
        .args_json(json!({ "force": true }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?
        .into_result()?;
    let r = ft_transfer_call(&w.bob, &w.usdc, w.circle.id(), 10 * USDC, repay_msg(1), RECOMMENDED_TGAS).await?;
    assert!(has_event(&r, "loan_repayment_failed"));
    assert_eq!(balance(&w.usdc, w.bob.id()).await?, 10 * USDC, "borrower keeps the money, nothing lost");
    w.worker.fast_forward(30).await?;
    let overdue = loan(&w, 1).await?["overdue"] == true;
    register(&w.carol, &w.usdc, w.carol.id()).await?;
    ft_transfer_call(&w.bob, &w.usdc, w.circle.id(), 10 * USDC, repay_msg(1), RECOMMENDED_TGAS).await?;
    let late_before = passport(&w, w.bob.id()).await?["late_count"].clone();
    // Mitigation that exists today: the circle admin clears the wrong flag.
    call1(&w, &w.founder, "clear_flag", json!({ "loan_id": "1" })).await?.into_result()?;
    let late_after = passport(&w, w.bob.id()).await?["late_count"].clone();
    save_artifact(
        "redteam_lender_grief.json",
        &format!("{{\"overdue_after_blocked_repayment\":{},\"late_count_before_clear\":{},\"late_count_after_admin_clear\":{}}}", overdue, late_before, late_after),
    );
    assert!(overdue, "expected the known issue: borrower shown overdue");
    assert_eq!(late_before, 1);
    assert_eq!(late_after, 0, "admin clear_flag must repair the record");
    assert_circle_holds_zero(&w).await
}

/// C1/C2 (lead 3, fixed in D-009): bidi override, zero-width and newline
/// characters in a circle name or tagline are rejected.
#[tokio::test]
async fn rt_bidi_and_control_characters_in_circle_name() -> Result<()> {
    let w = world().await?;
    let deposit = storage_cost(&w, "create_circle").await?;
    let name = "\u{202E}sgoD ehT\u{200B}\nOfficial";
    let r = w
        .bob
        .call(w.circle.id(), "create_circle")
        .args_json(json!({ "name": name, "params": params() }))
        .deposit(NearToken::from_yoctonear(deposit))
        .max_gas()
        .transact()
        .await?;
    let accepted = r.is_success();
    assert!(!accepted, "names with invisible or direction-changing characters must be rejected");
    let t = w
        .bob
        .call(w.circle.id(), "create_circle")
        .args_json(json!({ "name": "Plain", "params": params(), "theme": { "tagline": "evil‮txet" } }))
        .deposit(NearToken::from_yoctonear(deposit))
        .max_gas()
        .transact()
        .await?;
    assert!(failed_with(t, "E04_BAD_PARAMS"), "tagline with a bidi override must be rejected");
    let mut bidi_in_svg = false;
    let mut newline_in_svg = false;
    let mut title = String::new();
    if accepted {
        let tid = format!("2:{}", w.bob.id());
        let svg: Option<String> = w.circle.view("card_svg").args_json(json!({ "token_id": tid })).await?.json()?;
        let svg = svg.unwrap_or_default();
        bidi_in_svg = svg.contains('\u{202E}');
        newline_in_svg = svg.contains("ehT\u{200B}\n");
        assert!(svg.matches("<svg").count() == 1 && svg.ends_with("</svg>"), "SVG structure intact");
        let t: serde_json::Value = w.circle.view("nft_token").args_json(json!({ "token_id": tid })).await?.json()?;
        title = t["metadata"]["title"].as_str().unwrap_or_default().escape_unicode().to_string();
    }
    save_artifact(
        "redteam_name_chars.json",
        &format!(
            "{{\"name_with_bidi_zero_width_newline_accepted\":{},\"bidi_override_reaches_svg\":{},\"newline_reaches_svg\":{},\"token_title_escaped\":{:?}}}",
            accepted, bidi_in_svg, newline_in_svg, title
        ),
    );
    Ok(())
}

/// C3: a tiny file that declares a 30000 x 30000 PNG (decompression-bomb
/// shape). The contract checks magic bytes only.
#[tokio::test]
async fn rt_png_with_huge_declared_dimensions_is_accepted_known_issue() -> Result<()> {
    let w = world().await?;
    let mut png = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    png.extend_from_slice(&[0, 0, 0, 13]);
    png.extend_from_slice(b"IHDR");
    png.extend_from_slice(&30000u32.to_be_bytes());
    png.extend_from_slice(&30000u32.to_be_bytes());
    png.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
    let r = w
        .founder
        .call(w.circle.id(), "set_circle_theme")
        .args_json(json!({ "circle_id": "1", "theme": { "emblem": common::base64_engine::encode(&png) } }))
        .deposit(NearToken::from_millinear(200))
        .max_gas()
        .transact()
        .await?;
    let accepted = r.is_success();
    save_artifact("redteam_png_dimensions.json", &format!("{{\"png_declaring_30000x30000_accepted\":{}}}", accepted));
    assert!(accepted, "expected the known issue: no dimension check on emblems");
    Ok(())
}

/// B5: someone who sees an invite signature (but not the secret) cannot use it
/// from another account, even for an open invite.
#[tokio::test]
async fn rt_invite_signature_cannot_be_replayed_by_another_account() -> Result<()> {
    let w = world().await?;
    let eve = w.worker.dev_create_account().await?;
    let (sk, pk) = invite_key(31);
    register_invite(&w, &w.founder, &pk, None).await?.into_result()?;
    let bobs_signature = invite_signature(&sk, w.circle.id(), 1, w.bob.id(), &pk);
    let cost = storage_cost(&w, "redeem_invite").await?;
    let r = eve
        .call(w.circle.id(), "redeem_invite")
        .args_json(json!({ "circle_id": "1", "invite_public_key": pk, "signature": bobs_signature }))
        .deposit(NearToken::from_yoctonear(cost))
        .max_gas()
        .transact()
        .await?;
    assert!(failed_with(r, "E33_INVITE_BAD_SIGNATURE"));
    redeem(&w, &w.bob, &sk, &pk).await?.into_result()?;
    Ok(())
}

/// A4: across a full lifecycle the contract's NEAR that is not locked for
/// storage must not go down (callers pay for every byte they add).
#[tokio::test]
async fn rt_contract_never_subsidises_storage() -> Result<()> {
    const BYTE: u128 = 10_000_000_000_000_000_000; // 1e19 yoctoNEAR per byte
    let w = world().await?;
    let free = |a: &near_workspaces::types::AccountDetails| a.balance.as_yoctonear() as i128 - (a.storage_usage as u128 * BYTE) as i128;
    let before = w.circle.view_account().await?;
    members(&w).await?;
    register(&w.bob, &w.usdc, w.bob.id()).await?;
    borrow_fund_repay(&w, 1, 2).await?;
    let dog = std::fs::read("tests/fixtures/dog_emblem.png")?;
    w.founder
        .call(w.circle.id(), "set_circle_theme")
        .args_json(json!({ "circle_id": "1", "theme": { "emblem": common::base64_engine::encode(&dog), "tagline": "x" } }))
        .deposit(NearToken::from_millinear(200))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let after = w.circle.view_account().await?;
    save_artifact(
        "redteam_storage_balance.json",
        &format!(
            "{{\"free_before\":\"{}\",\"free_after\":\"{}\",\"storage_bytes_before\":{},\"storage_bytes_after\":{}}}",
            free(&before), free(&after), before.storage_usage, after.storage_usage
        ),
    );
    assert!(free(&after) >= free(&before), "contract paid for someone's storage: {} -> {}", free(&before), free(&after));
    assert_circle_holds_zero(&w).await
}

/// A4 (fixed in D-009): a deposit below the real storage cost is rejected, so
/// nobody can make the contract pay for their circles, invites or loans.
#[tokio::test]
async fn rt_underpaid_storage_is_rejected() -> Result<()> {
    let w = world().await?;
    members(&w).await?;
    let r = w
        .bob
        .call(w.circle.id(), "create_circle")
        .args_json(json!({ "name": "Free rider", "params": params() }))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    assert!(failed_with(r, "E02_DEPOSIT"), "create_circle with 1 yocto must fail");
    let (_sk, pk) = invite_key(41);
    let r = w
        .founder
        .call(w.circle.id(), "register_invite")
        .args_json(json!({ "circle_id": "1", "invite_public_key": pk, "expires_at": (u64::MAX / 2).to_string(), "invitee_id": null }))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?;
    assert!(failed_with(r, "E02_DEPOSIT"), "register_invite with 1 yocto must fail");
    // Only the 256-byte reserve attached: not enough for the loan record itself.
    let r = w
        .bob
        .call(w.circle.id(), "create_loan")
        .args_json(json!({ "circle_id": "1", "lender_id": w.carol.id(), "amount": (10 * USDC).to_string(), "duration_days": 2 }))
        .deposit(NearToken::from_yoctonear(2_560_000_000_000_000_000_000))
        .max_gas()
        .transact()
        .await?;
    assert!(failed_with(r, "E02_DEPOSIT"), "create_loan paying only the reserve must fail");
    assert_eq!(loan(&w, 1).await?, serde_json::Value::Null, "no loan was created");
    Ok(())
}
