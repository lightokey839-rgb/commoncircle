//! Fails if the near-workspaces sandbox cannot start on this machine.

#[tokio::test]
async fn sandbox_starts_and_creates_an_account() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let account = worker.dev_create_account().await?;
    assert!(account.id().as_str().len() > 0);
    Ok(())
}
