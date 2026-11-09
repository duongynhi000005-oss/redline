//! Tests against a real Redmine, seeded by `dev/redmine/seed.sh`.
//!
//! Skipped unless both variables are set:
//!
//! ```sh
//! export REDLINE_TEST_REDMINE_URL=http://localhost:3000
//! export REDLINE_TEST_API_KEY=<key printed by seed.sh>
//! cargo test -p redline-core --test redmine_live
//! ```
//!
//! The key belongs to a regular, non-admin user, which is what Redline must
//! work with.

use redline_core::models::IssueChanges;
use redline_core::{Client, Error, IssueQuery};

fn live_client() -> Option<Client> {
    let url = std::env::var("REDLINE_TEST_REDMINE_URL").ok()?;
    let key = std::env::var("REDLINE_TEST_API_KEY").ok()?;
    Some(Client::new(&url, &key).expect("valid test server URL"))
}

macro_rules! live {
    () => {
        match live_client() {
            Some(c) => c,
            None => {
                eprintln!("skipped: REDLINE_TEST_REDMINE_URL and REDLINE_TEST_API_KEY not set");
                return;
            }
        }
    };
}

#[tokio::test]
async fn signs_in_as_a_regular_user() {
    let client = live!();
    let user = client.current_user().await.unwrap();
    assert_eq!(user.login, "dev");
    assert!(!user.admin);
}

#[tokio::test]
async fn rejects_a_wrong_key() {
    let Ok(url) = std::env::var("REDLINE_TEST_REDMINE_URL") else {
        return;
    };
    let client = Client::new(&url, "not-a-real-key").unwrap();
    assert!(matches!(
        client.current_user().await,
        Err(Error::Unauthorized)
    ));
}

#[tokio::test]
async fn reads_metadata_without_admin_rights() {
    let client = live!();
    let projects = client.projects().await.unwrap();
    let web = projects.iter().find(|p| p.identifier == "web").unwrap();
    assert!(!web.trackers.is_empty());
    assert!(web.issue_custom_fields.iter().any(|f| f.name == "Area"));
    assert!(
        projects
            .iter()
            .any(|p| p.parent.as_ref().map(|x| x.id) == Some(web.id))
    );

    let statuses = client.issue_statuses().await.unwrap();
    assert!(statuses.iter().any(|s| s.is_closed));
    assert!(!client.trackers().await.unwrap().is_empty());
    assert!(!client.issue_priorities().await.unwrap().is_empty());

    let members = client.memberships(web.id).await.unwrap();
    assert!(members.iter().any(|m| m.user.is_some()));

    let versions = client.versions(web.id).await.unwrap();
    assert!(versions.iter().any(|v| v.status == "open"));
    assert!(versions.iter().any(|v| v.status == "closed"));
}

#[tokio::test]
async fn lists_issues_and_reads_one_with_journals() {
    let client = live!();
    let page = client
        .issues(&IssueQuery {
            limit: Some(5),
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(page.total_count >= 9);
    assert_eq!(page.items.len(), 5);
    let sorted = page
        .items
        .windows(2)
        .all(|w| w[0].updated_on <= w[1].updated_on);
    assert!(sorted, "issues come oldest change first");

    let first = client
        .issues(&IssueQuery {
            limit: Some(1),
            ..Default::default()
        })
        .await
        .unwrap();
    let id = first.items[0].id;
    let issue = client
        .issue(id, &["journals", "watchers", "allowed_statuses"])
        .await
        .unwrap();
    assert!(issue.journals.is_some());
    assert!(issue.allowed_statuses.is_some());
}

#[tokio::test]
async fn edits_an_issue_and_reports_workflow_errors() {
    let client = live!();
    let projects = client.projects().await.unwrap();
    let web = projects.iter().find(|p| p.identifier == "web").unwrap();
    let created = client
        .create_issue(&IssueChanges {
            project_id: Some(web.id),
            subject: Some("Created by the live test".into()),
            description: Some("Body with #1 and @dev".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(created.subject, "Created by the live test");

    client
        .update_issue(
            created.id,
            &IssueChanges {
                notes: Some("A comment from the live test".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let after = client.issue(created.id, &["journals"]).await.unwrap();
    let journals = after.journals.unwrap();
    assert_eq!(
        journals.last().unwrap().notes.as_deref(),
        Some("A comment from the live test")
    );
    assert_eq!(after.description.as_deref(), Some("Body with #1 and @dev"));

    let err = client
        .update_issue(
            created.id,
            &IssueChanges {
                subject: Some(String::new()),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
    assert!(
        matches!(err, Error::Rejected(ref m) if !m.is_empty()),
        "{err:?}"
    );
}
