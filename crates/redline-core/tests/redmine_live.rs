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

#[tokio::test]
async fn syncs_into_a_local_cache() {
    use redline_core::{Store, Syncer};

    let client = live!();
    let syncer = Syncer::new(client.clone(), Store::in_memory().unwrap());

    let meta = syncer.sync_metadata().await.unwrap();
    assert_eq!(meta.user.as_ref().unwrap().login, "dev");
    assert!(meta.projects.iter().any(|p| p.identifier == "web"));
    assert!(!meta.memberships.is_empty());
    assert!(meta.versions.iter().any(|v| v.name == "Sprint 2"));
    assert_eq!(syncer.store().metadata().unwrap(), meta);

    let first = syncer.sync_issues().await.unwrap();
    assert!(first.initial);
    assert!(first.changed.len() >= 9);
    let cached = syncer.store().count_issues().unwrap();
    assert_eq!(cached as usize, first.changed.len());

    // Nothing changed on the server, so the next delta changes nothing.
    let second = syncer.sync_issues().await.unwrap();
    assert!(!second.initial);
    assert!(second.changed.is_empty(), "{:?}", second.changed);

    // An edit shows up in the next delta.
    let id = syncer.store().issues().unwrap().last().unwrap().id;
    client
        .update_issue(
            id,
            &redline_core::models::IssueChanges {
                notes: Some("Touched by the sync test".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let third = syncer.sync_issues().await.unwrap();
    assert!(third.changed.contains(&id), "{third:?}");

    let details = syncer.issue_details(id).await.unwrap();
    assert!(
        details
            .journals
            .iter()
            .any(|j| j.notes.as_deref() == Some("Touched by the sync test"))
    );
    assert!(syncer.cached_issue_details(id).unwrap().is_some());

    assert!(syncer.prune_deleted().await.unwrap().is_empty());
}

async fn issue_id(client: &Client, subject: &str) -> u64 {
    let page = client
        .issues(&IssueQuery {
            limit: Some(100),
            ..Default::default()
        })
        .await
        .unwrap();
    page.items
        .iter()
        .find(|i| i.subject == subject)
        .unwrap_or_else(|| panic!("seeded issue {subject:?}"))
        .id
}

#[tokio::test]
async fn adds_and_removes_a_relation() {
    use redline_core::models::NewRelation;
    use redline_core::{Store, Syncer};

    let client = live!();
    let from = issue_id(&client, "Empty columns can be hidden").await;
    let to = issue_id(&client, "Show blocked issues on cards").await;
    let syncer = Syncer::new(client, Store::in_memory().unwrap());
    let (relation, _) = syncer
        .add_relation(
            from,
            &NewRelation {
                issue_to_id: to,
                relation_type: "blocked".into(),
                delay: None,
            },
        )
        .await
        .unwrap();
    // Redmine stores an inverse type the other way round.
    assert_eq!(
        (
            relation.issue_id,
            relation.issue_to_id,
            relation.relation_type.as_str()
        ),
        (to, from, "blocks")
    );
    let on = |id: u64| {
        syncer
            .store()
            .issue(id)
            .unwrap()
            .unwrap()
            .relations
            .unwrap()
            .iter()
            .any(|r| r.id == relation.id)
    };
    assert!(on(from) && on(to));

    syncer.remove_relation(&relation).await.unwrap();
    assert!(!on(from) && !on(to));
}

#[tokio::test]
async fn finds_mentions_in_descriptions_and_comments() {
    use redline_core::{Store, Syncer};

    let client = live!();
    let drag = issue_id(&client, "Drag cards between columns").await;
    let keys = issue_id(&client, "Move cards with the keyboard").await;
    let overlap = issue_id(&client, "Fix overlapping cards on narrow windows").await;
    let syncer = Syncer::new(client, Store::in_memory().unwrap());

    // A description says "Seen while testing #drag".
    assert!(syncer.mentions_of(drag).await.unwrap().contains(&overlap));
    // A comment on the drag issue mentions the keyboard one.
    assert!(syncer.mentions_of(keys).await.unwrap().contains(&drag));
}

#[tokio::test]
async fn knows_what_the_role_allows_and_whether_the_user_watches() {
    use redline_core::{Store, Syncer};

    let client = live!();
    let id = issue_id(&client, "Show blocked issues on cards").await;
    let syncer = Syncer::new(client, Store::in_memory().unwrap());
    let meta = syncer.sync_metadata().await.unwrap();
    let me = meta.user.clone().unwrap();
    // A regular user can read their memberships and every role's permissions.
    assert!(!me.memberships.is_empty());
    let developer = meta.roles.iter().find(|r| r.name == "Developer").unwrap();
    assert!(developer.permissions.iter().any(|p| p == "view_issues"));

    // Redmine's default Developer role can't see or add watchers through the
    // API, but Redline still learns whether the user watches the issue.
    let details = syncer.issue_details(id).await.unwrap();
    assert!(details.watching.is_some());
    if !developer
        .permissions
        .iter()
        .any(|p| p == "add_issue_watchers")
    {
        assert!(matches!(
            syncer.set_watcher(id, me.id, true).await,
            Err(Error::Forbidden)
        ));
    }
}

#[tokio::test]
async fn attaches_downloads_and_deletes_a_file() {
    use redline_core::{NewFile, Store, Syncer};

    let client = live!();
    let id = issue_id(&client, "Show blocked issues on cards").await;
    let syncer = Syncer::new(client, Store::in_memory().unwrap());
    let name = format!("live-{}.txt", std::process::id());
    let details = syncer
        .attach_files(
            id,
            vec![NewFile {
                filename: name.clone(),
                content_type: Some("text/plain".into()),
                bytes: b"Attached by the live test".to_vec(),
            }],
            None,
        )
        .await
        .unwrap();
    let attachment = details
        .issue
        .attachments
        .unwrap_or_default()
        .into_iter()
        .find(|a| a.filename == name)
        .expect("the new attachment is on the issue");
    assert_eq!(attachment.filesize, 25);
    assert_eq!(
        syncer
            .client()
            .download_attachment(attachment.id)
            .await
            .unwrap(),
        b"Attached by the live test"
    );
    let details = syncer.delete_attachment(id, attachment.id).await.unwrap();
    assert!(
        !details
            .issue
            .attachments
            .unwrap_or_default()
            .iter()
            .any(|a| a.id == attachment.id)
    );
}

#[tokio::test]
async fn logs_changes_and_deletes_time() {
    use redline_core::models::TimeEntryChanges;
    use redline_core::{Store, Syncer, TimeQuery};

    let client = live!();
    let id = issue_id(&client, "Show blocked issues on cards").await;
    let syncer = Syncer::new(client, Store::in_memory().unwrap());
    let meta = syncer.sync_metadata().await.unwrap();
    let activity = meta
        .time_entry_activities
        .iter()
        .find(|a| a.is_default)
        .or(meta.time_entry_activities.first())
        .expect("the server has time entry activities")
        .id;
    let entry = syncer
        .log_time(&TimeEntryChanges {
            issue_id: Some(id),
            hours: Some(0.25),
            activity_id: Some(activity),
            comments: Some("Logged by the live test".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    // Redmine fills in today when no day is given.
    assert!(!entry.spent_on.is_empty());
    let listed = syncer
        .client()
        .time_entries(&TimeQuery {
            issue_id: Some(id),
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(listed.iter().any(|e| e.id == entry.id));
    let changed = syncer
        .update_time_entry(
            entry.id,
            &TimeEntryChanges {
                hours: Some(0.5),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(changed.hours, 0.5);
    assert!(
        syncer
            .store()
            .issue(id)
            .unwrap()
            .unwrap()
            .spent_hours
            .unwrap_or(0.0)
            >= 0.5
    );
    assert_eq!(syncer.delete_time_entry(entry.id).await.unwrap(), Some(id));
}

#[tokio::test]
async fn versions_follow_the_role() {
    use redline_core::models::VersionChanges;
    use redline_core::{Store, Syncer};

    let client = live!();
    let syncer = Syncer::new(client, Store::in_memory().unwrap());
    let meta = syncer.sync_metadata().await.unwrap();
    // Versions come with the metadata, wiki page and all.
    let web = meta
        .projects
        .iter()
        .find(|p| p.identifier == "web")
        .unwrap()
        .id;
    assert!(meta.versions.iter().any(|v| v.project.id == web));
    let me = meta.user.clone().unwrap();
    let roles: Vec<_> = me
        .memberships
        .iter()
        .filter(|m| m.project.id == web)
        .flat_map(|m| m.roles.iter().map(|r| r.id))
        .collect();
    let manages = meta
        .roles
        .iter()
        .filter(|r| roles.contains(&r.id))
        .any(|r| r.permissions.iter().any(|p| p == "manage_versions"));
    let created = syncer
        .create_version(
            web,
            &VersionChanges {
                name: Some(format!("Live test {}", std::process::id())),
                ..Default::default()
            },
        )
        .await;
    if !manages {
        // Redmine's default Developer role can't manage versions.
        assert!(matches!(created, Err(Error::Forbidden)));
        return;
    }
    let created = created.unwrap();
    let closed = syncer
        .update_version(
            created.id,
            &VersionChanges {
                status: Some("closed".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(closed.status, "closed");
    syncer.delete_version(created.id).await.unwrap();
}

#[tokio::test]
async fn sets_and_clears_category_estimate_and_done() {
    let client = live!();
    let projects = client.projects().await.unwrap();
    let web = projects.iter().find(|p| p.identifier == "web").unwrap();
    let frontend = web
        .issue_categories
        .iter()
        .find(|c| c.name == "Frontend")
        .expect("the seed adds categories");
    let trackers = client.trackers().await.unwrap();
    assert!(trackers.iter().all(|t| t.enabled_standard_fields.is_some()));

    let created = client
        .create_issue(&IssueChanges {
            project_id: Some(web.id),
            subject: Some("Fields from the live test".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    client
        .update_issue(
            created.id,
            &IssueChanges {
                category_id: Some(Some(frontend.id)),
                estimated_hours: Some(Some(2.5)),
                done_ratio: Some(40),
                start_date: Some(Some("2026-11-02".into())),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let set = client.issue(created.id, &[]).await.unwrap();
    assert_eq!(set.category.as_ref().map(|c| c.id), Some(frontend.id));
    assert_eq!(set.estimated_hours, Some(2.5));
    assert_eq!(set.done_ratio, Some(40));
    assert_eq!(set.start_date.as_deref(), Some("2026-11-02"));

    client
        .update_issue(
            created.id,
            &IssueChanges {
                category_id: Some(None),
                estimated_hours: Some(None),
                start_date: Some(None),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let cleared = client.issue(created.id, &[]).await.unwrap();
    assert!(cleared.category.is_none());
    assert_eq!(cleared.estimated_hours, None);
    assert_eq!(cleared.start_date, None);
}

#[tokio::test]
async fn edits_and_removes_a_comment_but_may_not_delete_the_issue() {
    let client = live!();
    let projects = client.projects().await.unwrap();
    let web = projects.iter().find(|p| p.identifier == "web").unwrap();
    let created = client
        .create_issue(&IssueChanges {
            project_id: Some(web.id),
            subject: Some("Comments from the live test".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    client
        .update_issue(
            created.id,
            &IssueChanges {
                notes: Some("First take".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let journal = client
        .issue(created.id, &["journals"])
        .await
        .unwrap()
        .journals
        .unwrap();
    let id = journal.last().unwrap().id;

    // The seed lets developers edit their own comments.
    client.update_journal(id, "Second take").await.unwrap();
    let journals = client
        .issue(created.id, &["journals"])
        .await
        .unwrap()
        .journals
        .unwrap();
    let edited = journals.iter().find(|j| j.id == id).unwrap();
    assert_eq!(edited.notes.as_deref(), Some("Second take"));
    assert!(edited.updated_on.is_some());

    // Emptied, a comment that changed nothing else goes away.
    client.update_journal(id, "").await.unwrap();
    let journals = client
        .issue(created.id, &["journals"])
        .await
        .unwrap()
        .journals
        .unwrap();
    assert!(journals.iter().all(|j| j.id != id));

    // Developers can't delete issues; the issue stays.
    let err = client.delete_issue(created.id).await.unwrap_err();
    assert!(matches!(err, Error::Forbidden), "{err:?}");
    assert!(client.issue(created.id, &[]).await.is_ok());
}

#[tokio::test]
async fn runs_saved_queries_and_searches_everything() {
    use redline_core::{Store, Syncer};

    let client = live!();
    let queries = client.queries().await.unwrap();
    let bugs = queries
        .iter()
        .find(|q| q.name == "Open bugs")
        .expect("public query");
    let mine = queries
        .iter()
        .find(|q| q.name == "Assigned to me, by due date")
        .expect("own query");
    assert!(bugs.is_public);
    assert!(bugs.project_id.is_some());
    assert!(mine.project_id.is_none());

    let syncer = Syncer::new(client.clone(), Store::in_memory().unwrap());
    let (found, _) = syncer.query_issues(bugs.id, bugs.project_id).await.unwrap();
    assert!(!found.items.is_empty());
    assert_eq!(found.total, found.items.len() as u64);
    for id in &found.items {
        let issue = syncer.store().issue(*id).unwrap().expect("cached");
        assert_ne!(issue.status.is_closed, Some(true));
        assert_eq!(issue.tracker.id, 1);
    }

    let (mine_found, _) = syncer.query_issues(mine.id, None).await.unwrap();
    let me = client.current_user().await.unwrap().id;
    for id in &mine_found.items {
        let issue = syncer.store().issue(*id).unwrap().unwrap();
        assert_eq!(issue.assigned_to.as_ref().map(|a| a.id), Some(me));
    }

    let results = syncer.search("board", 0).await.unwrap();
    assert!(results.items.iter().any(|r| r.kind.starts_with("issue")));
    assert!(results.total >= results.items.len() as u64);
}

#[tokio::test]
async fn reads_a_team_and_its_members() {
    let client = live!();
    let projects = client.projects().await.unwrap();
    let web = projects
        .iter()
        .find(|p| p.identifier == "web")
        .expect("web");
    assert_eq!(web.homepage.as_deref(), Some("https://example.com/web"));
    assert!(web.description.as_deref().unwrap_or("").contains("Redline"));
    assert_eq!(web.status, Some(1));
    assert!(web.created_on.is_some());

    let me = client.current_user().await.unwrap();
    let members = client.memberships(web.id).await.unwrap();
    let other = members
        .iter()
        .filter_map(|m| m.user.as_ref())
        .find(|u| u.id != me.id)
        .expect("a teammate");
    let them = client.user(other.id).await.unwrap();
    assert_eq!(them.id, other.id);
    assert_eq!(them.display_name(), other.name);
    assert!(them.created_on.is_some());
    // Admin-only fields stay hidden from a regular user.
    assert!(!them.admin);
}

#[tokio::test]
async fn a_developer_cannot_create_close_or_delete_teams() {
    use redline_core::models::ProjectChanges;

    let client = live!();
    let projects = client.projects().await.unwrap();
    let web = projects
        .iter()
        .find(|p| p.identifier == "web")
        .expect("web");
    let sub = client
        .create_project(&ProjectChanges {
            name: Some("Never made".into()),
            identifier: Some("never-made".into()),
            parent_id: Some(web.id),
            ..Default::default()
        })
        .await;
    assert!(matches!(sub, Err(Error::Forbidden)), "{sub:?}");
    let closed = client.set_project_closed(web.id, true).await;
    assert!(matches!(closed, Err(Error::Forbidden)), "{closed:?}");
    let deleted = client.delete_project(web.id).await;
    assert!(matches!(deleted, Err(Error::Forbidden)), "{deleted:?}");
    let after = client.projects().await.unwrap();
    assert_eq!(
        after.iter().find(|p| p.id == web.id).and_then(|p| p.status),
        Some(1)
    );
}

#[tokio::test]
async fn writes_reads_and_deletes_a_wiki_page() {
    use redline_core::models::WikiPageChanges;

    let client = live!();
    let projects = client.projects().await.unwrap();
    let web = projects
        .iter()
        .find(|p| p.identifier == "web")
        .expect("web");
    let title = "Live_test_page";
    // Clean up after an earlier run that stopped half way.
    let _ = client.delete_wiki_page(web.id, title, true).await;

    let start = client.wiki_page(web.id, None, None).await.unwrap();
    assert_eq!(start.title, "Wiki");

    let first = WikiPageChanges {
        text: "First".into(),
        parent_title: Some("Wiki".into()),
        ..Default::default()
    };
    client.save_wiki_page(web.id, title, &first).await.unwrap();
    let made = client.wiki_page(web.id, Some(title), None).await.unwrap();
    assert_eq!(made.version, 1);
    assert_eq!(made.parent.as_ref().map(|p| p.title.as_str()), Some("Wiki"));

    let second = WikiPageChanges {
        text: "Second".into(),
        comments: Some("Reworded".into()),
        version: Some(1),
        parent_title: None,
    };
    client.save_wiki_page(web.id, title, &second).await.unwrap();
    // Saving other text from the old version is a conflict. (The same
    // text again isn't: Redmine sees nothing to save.)
    let third = WikiPageChanges {
        text: "Third".into(),
        ..second.clone()
    };
    let stale = client.save_wiki_page(web.id, title, &third).await;
    assert!(matches!(stale, Err(Error::Rejected(_))), "{stale:?}");

    let latest = client.wiki_page(web.id, Some(title), None).await.unwrap();
    assert_eq!(latest.version, 2);
    assert_eq!(latest.text.as_deref(), Some("Second"));
    assert_eq!(latest.comments.as_deref(), Some("Reworded"));
    let old = client
        .wiki_page(web.id, Some(title), Some(1))
        .await
        .unwrap();
    assert_eq!(old.text.as_deref(), Some("First"));

    let index = client.wiki_index(web.id).await.unwrap();
    assert!(index.iter().any(|p| p.title == title));
    client.delete_wiki_page(web.id, title, false).await.unwrap();
    let gone = client.wiki_page(web.id, Some(title), None).await;
    assert!(matches!(gone, Err(Error::NotFound)), "{gone:?}");
}

#[tokio::test]
async fn reads_news_and_adds_and_deletes_a_file() {
    use redline_core::models::NewsChanges;

    let client = live!();
    let projects = client.projects().await.unwrap();
    let web = projects
        .iter()
        .find(|p| p.identifier == "web")
        .expect("web");

    let all = client.news(None, 0).await.unwrap();
    let post = all
        .items
        .iter()
        .find(|n| n.title == "Redline 0.1 is out")
        .expect("seeded news");
    let full = client.news_item(post.id).await.unwrap();
    assert_eq!(full.comments[0].content, "Works great on my Mac.");
    assert!(!client.news(Some(web.id), 0).await.unwrap().items.is_empty());
    // dev is a Developer, who can't manage news.
    let posted = client
        .create_news(
            web.id,
            &NewsChanges {
                title: Some("Nope".into()),
                description: Some("Nope".into()),
                ..Default::default()
            },
        )
        .await;
    assert!(matches!(posted, Err(Error::Forbidden)), "{posted:?}");

    let name = "live-test-file.txt";
    // Clean up after an earlier run that stopped half way.
    for f in client.files(web.id).await.unwrap() {
        if f.filename == name {
            let _ = client.delete_attachment(f.id).await;
        }
    }
    let files = client.files(web.id).await.unwrap();
    let sprint = files
        .iter()
        .find(|f| f.filename == "release-notes.txt")
        .and_then(|f| f.version.clone())
        .expect("seeded version file");
    let token = client.upload(name, b"hello".to_vec()).await.unwrap();
    client
        .add_file(
            web.id,
            &token,
            name,
            Some(sprint.id),
            Some("From the live test"),
        )
        .await
        .unwrap();
    let added = client
        .files(web.id)
        .await
        .unwrap()
        .into_iter()
        .find(|f| f.filename == name)
        .expect("added file");
    assert_eq!(added.version.as_ref().map(|v| v.id), Some(sprint.id));
    assert_eq!(added.description.as_deref(), Some("From the live test"));
    assert_eq!(
        client.download_attachment(added.id).await.unwrap(),
        b"hello"
    );
    client.delete_attachment(added.id).await.unwrap();
    assert!(
        !client
            .files(web.id)
            .await
            .unwrap()
            .iter()
            .any(|f| f.filename == name)
    );
}
