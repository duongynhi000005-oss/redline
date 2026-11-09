//! Client behaviour against a mock server: auth header, paging, retries and
//! error mapping.

use std::time::Duration;

use redline_core::models::IssueChanges;
use redline_core::{Client, Error, IssueQuery};
use serde_json::json;
use wiremock::matchers::{body_bytes, body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn client(server: &MockServer) -> Client {
    Client::new(&server.uri(), "test-key")
        .unwrap()
        .with_retry_unit(Duration::from_millis(1))
}

fn issue(id: u64) -> serde_json::Value {
    json!({
        "id": id,
        "project": {"id": 1, "name": "Web"},
        "tracker": {"id": 1, "name": "Bug"},
        "status": {"id": 1, "name": "New", "is_closed": false},
        "priority": {"id": 2, "name": "Normal"},
        "subject": format!("Issue {id}"),
        "created_on": "2026-11-01T00:00:00Z",
        "updated_on": "2026-11-02T00:00:00Z"
    })
}

#[tokio::test]
async fn sends_the_api_key_and_reads_the_current_user() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/current.json"))
        .and(header("X-Redmine-API-Key", "test-key"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "user": {"id": 5, "login": "dev", "firstname": "Dana", "lastname": "Developer"}
        })))
        .expect(1)
        .mount(&server)
        .await;

    let user = client(&server).current_user().await.unwrap();
    assert_eq!(user.id, 5);
    assert_eq!(user.display_name(), "Dana Developer");
}

#[tokio::test]
async fn explains_sign_in_failures() {
    let server = MockServer::start().await;
    Mock::given(path("/users/current.json"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    assert!(matches!(
        client(&server).current_user().await,
        Err(Error::Unauthorized)
    ));

    let server = MockServer::start().await;
    Mock::given(path("/users/current.json"))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;
    assert!(matches!(
        client(&server).current_user().await,
        Err(Error::RestApiDisabled)
    ));

    // A web page instead of JSON means the address isn't a Redmine.
    let server = MockServer::start().await;
    Mock::given(path("/users/current.json"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/html")
                .set_body_string("<html>hello</html>"),
        )
        .mount(&server)
        .await;
    assert!(matches!(
        client(&server).current_user().await,
        Err(Error::NotRedmine)
    ));
}

#[tokio::test]
async fn keeps_a_sub_path_in_the_server_address() {
    let server = MockServer::start().await;
    Mock::given(path("/redmine/users/current.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"user": {"id": 1}})))
        .expect(1)
        .mount(&server)
        .await;
    let client = Client::new(&format!("{}/redmine", server.uri()), "k").unwrap();
    assert_eq!(client.current_user().await.unwrap().id, 1);
}

#[tokio::test]
async fn pages_through_lists_in_hundreds() {
    let server = MockServer::start().await;
    let project =
        |id: u64| json!({"id": id, "name": format!("P{id}"), "identifier": format!("p{id}")});
    Mock::given(path("/projects.json"))
        .and(query_param("offset", "0"))
        .and(query_param("limit", "100"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "projects": (1..=100).map(project).collect::<Vec<_>>(),
            "total_count": 150, "offset": 0, "limit": 100
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(path("/projects.json"))
        .and(query_param("offset", "100"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "projects": (101..=150).map(project).collect::<Vec<_>>(),
            "total_count": 150, "offset": 100, "limit": 100
        })))
        .expect(1)
        .mount(&server)
        .await;

    let projects = client(&server).projects().await.unwrap();
    assert_eq!(projects.len(), 150);
    assert_eq!(projects.last().unwrap().identifier, "p150");
}

#[tokio::test]
async fn asks_for_changed_issues_since_a_cursor() {
    let server = MockServer::start().await;
    Mock::given(path("/issues.json"))
        .and(query_param("status_id", "*"))
        .and(query_param("sort", "updated_on,id"))
        .and(query_param("updated_on", ">=2026-11-01T00:00:00Z"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "issues": [issue(1), issue(2)], "total_count": 2, "offset": 0, "limit": 100
        })))
        .expect(1)
        .mount(&server)
        .await;

    let page = client(&server)
        .issues(&IssueQuery {
            updated_since: Some("2026-11-01T00:00:00Z".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(page.total_count, 2);
    assert_eq!(page.items[1].subject, "Issue 2");
}

#[tokio::test]
async fn retries_when_the_server_is_busy() {
    let server = MockServer::start().await;
    Mock::given(path("/trackers.json"))
        .respond_with(ResponseTemplate::new(503))
        .up_to_n_times(2)
        .mount(&server)
        .await;
    Mock::given(path("/trackers.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "trackers": [{"id": 1, "name": "Bug"}]
        })))
        .mount(&server)
        .await;

    let trackers = client(&server).trackers().await.unwrap();
    assert_eq!(trackers[0].name, "Bug");
}

#[tokio::test]
async fn gives_up_after_repeated_429s() {
    let server = MockServer::start().await;
    Mock::given(path("/trackers.json"))
        .respond_with(ResponseTemplate::new(429))
        .expect(4)
        .mount(&server)
        .await;
    assert!(matches!(client(&server).trackers().await, Err(Error::Busy)));
}

#[tokio::test]
async fn updates_send_only_changed_fields_and_surface_redmine_errors() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/issues/7.json"))
        .and(body_json(json!({"issue": {"status_id": 3}})))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/issues/8.json"))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({
            "errors": ["Status is not included in the list"]
        })))
        .mount(&server)
        .await;

    let client = client(&server);
    let change = IssueChanges {
        status_id: Some(3),
        ..Default::default()
    };
    client.update_issue(7, &change).await.unwrap();

    let err = client.update_issue(8, &change).await.unwrap_err();
    assert_eq!(
        err.to_string(),
        "Redmine refused the change: Status is not included in the list"
    );
}

#[tokio::test]
async fn sends_a_change_again_when_redmine_hit_a_conflict() {
    let server = MockServer::start().await;
    // A conflict at first, then the change goes through.
    Mock::given(method("PUT"))
        .and(path("/issues/9.json"))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({ "errors": [] })))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/issues/9.json"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    // Conflicts every time.
    Mock::given(method("PUT"))
        .and(path("/issues/10.json"))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({ "errors": [] })))
        .expect(3)
        .mount(&server)
        .await;

    let client = client(&server);
    let change = IssueChanges {
        status_id: Some(4),
        ..Default::default()
    };
    client.update_issue(9, &change).await.unwrap();
    let err = client.update_issue(10, &change).await.unwrap_err();
    assert_eq!(
        err.to_string(),
        "Redmine refused the change because the issue changed at the same moment. Try again."
    );
}

#[tokio::test]
async fn sync_pages_and_moves_the_cursor_forward() {
    use redline_core::{Store, Syncer};

    let server = MockServer::start().await;
    let mut late = issue(3);
    late["updated_on"] = json!("2026-11-05T10:00:00Z");
    Mock::given(path("/issues.json"))
        .and(query_param("offset", "0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "issues": [issue(1), issue(2)], "total_count": 3, "offset": 0, "limit": 2
        })))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(path("/issues.json"))
        .and(query_param("offset", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "issues": [late], "total_count": 3, "offset": 2, "limit": 2
        })))
        .mount(&server)
        .await;
    let syncer = Syncer::new(client(&server), Store::in_memory().unwrap());
    let report = syncer.sync_issues().await.unwrap();
    assert!(report.initial);
    assert_eq!(report.changed, vec![1, 2, 3]);

    // The next delta asks from a minute before the newest change.
    server.reset().await;
    Mock::given(path("/issues.json"))
        .and(query_param("updated_on", ">=2026-11-05T09:59:00Z"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "issues": [], "total_count": 0, "offset": 0, "limit": 100
        })))
        .expect(1)
        .mount(&server)
        .await;
    let report = syncer.sync_issues().await.unwrap();
    assert!(!report.initial);
    assert!(report.changed.is_empty());
}

#[tokio::test]
async fn adds_and_removes_relations_and_refreshes_both_issues() {
    use redline_core::models::NewRelation;
    use redline_core::{Store, Syncer};

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/issues/1/relations.json"))
        .and(body_json(json!({"relation": {"issue_to_id": 2, "relation_type": "blocks"}})))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "relation": {"id": 7, "issue_id": 1, "issue_to_id": 2, "relation_type": "blocks", "delay": null}
        })))
        .expect(1)
        .mount(&server)
        .await;
    let relation =
        json!({"id": 7, "issue_id": 1, "issue_to_id": 2, "relation_type": "blocks", "delay": null});
    let mut one = issue(1);
    one["relations"] = json!([relation]);
    let mut two = issue(2);
    two["relations"] = json!([relation]);
    Mock::given(method("GET"))
        .and(path("/issues.json"))
        .and(query_param("issue_id", "1,2"))
        .and(query_param("include", "relations"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "issues": [one, two], "total_count": 2, "offset": 0, "limit": 100
        })))
        .up_to_n_times(1)
        .mount(&server)
        .await;

    let syncer = Syncer::new(client(&server), Store::in_memory().unwrap());
    let (created, changed) = syncer
        .add_relation(
            1,
            &NewRelation {
                issue_to_id: 2,
                relation_type: "blocks".into(),
                delay: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(created.id, 7);
    assert_eq!(changed, vec![1, 2]);
    assert_eq!(
        syncer
            .store()
            .issue(2)
            .unwrap()
            .unwrap()
            .relations
            .unwrap()
            .len(),
        1
    );

    Mock::given(method("DELETE"))
        .and(path("/relations/7.json"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    let mut one = issue(1);
    one["relations"] = json!([]);
    let mut two = issue(2);
    two["relations"] = json!([]);
    Mock::given(method("GET"))
        .and(path("/issues.json"))
        .and(query_param("issue_id", "1,2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "issues": [one, two], "total_count": 2, "offset": 0, "limit": 100
        })))
        .mount(&server)
        .await;
    let changed = syncer.remove_relation(&created).await.unwrap();
    assert_eq!(changed, vec![1, 2]);
    assert_eq!(
        syncer.store().issue(1).unwrap().unwrap().relations,
        Some(vec![])
    );
}

#[tokio::test]
async fn finds_mentions_in_descriptions_and_comments_but_not_lookalikes() {
    use redline_core::{Store, Syncer};

    let server = MockServer::start().await;
    // Search matches loosely: #12 also finds #123.
    Mock::given(path("/search.json"))
        .and(query_param("q", "#12"))
        .and(query_param("issues", "1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "results": [
                {"id": 20, "title": "Bug #20 (New): A", "type": "issue", "description": "Seen while testing #12."},
                {"id": 21, "title": "Bug #21 (New): B", "type": "issue", "description": "Nothing here"},
                {"id": 22, "title": "Bug #22 (New): C", "type": "issue-closed", "description": "Duplicate of #123"}
            ],
            "total_count": 3, "offset": 0, "limit": 100
        })))
        .mount(&server)
        .await;
    for (id, note) in [(21, "Blocked by #12, see there."), (22, "Moved to #1234")] {
        let mut detailed = issue(id);
        detailed["journals"] = json!([{"id": id * 10, "notes": note, "created_on": "2026-11-02T00:00:00Z", "details": []}]);
        Mock::given(path(format!("/issues/{id}.json")))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"issue": detailed})))
            .mount(&server)
            .await;
    }
    let store = Store::in_memory().unwrap();
    // A cached issue search didn't return still counts.
    let mut cached: redline_core::models::Issue = serde_json::from_value(issue(30)).unwrap();
    cached.description = Some("Follow-up to ##12".into());
    store.upsert_issues(&[cached]).unwrap();

    let syncer = Syncer::new(client(&server), store);
    let mut found = syncer.mentions_of(12).await.unwrap();
    found.sort();
    assert_eq!(found, vec![20, 21, 30]);
}

#[tokio::test]
async fn subscribes_and_reads_back_whether_the_user_watches() {
    use redline_core::models::User;
    use redline_core::{Metadata, Store, Syncer};

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/issues/3/watchers.json"))
        .and(body_json(json!({"user_id": 5})))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    // This role may not see watchers, so the issue comes back without them…
    Mock::given(method("GET"))
        .and(path("/issues/3.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"issue": issue(3)})))
        .mount(&server)
        .await;
    // …and Redline asks whether the issue is among the ones the user watches.
    Mock::given(method("GET"))
        .and(path("/issues.json"))
        .and(query_param("watcher_id", "me"))
        .and(query_param("issue_id", "3"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "issues": [issue(3)], "total_count": 1, "offset": 0, "limit": 1
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/issues/3/watchers/9.json"))
        .respond_with(ResponseTemplate::new(403))
        .expect(1)
        .mount(&server)
        .await;

    let store = Store::in_memory().unwrap();
    store
        .replace_metadata(&Metadata {
            user: Some(User {
                id: 5,
                login: "dev".into(),
                firstname: "Dana".into(),
                lastname: "Developer".into(),
                mail: None,
                admin: false,
                created_on: None,
                last_login_on: None,
                memberships: Vec::new(),
            }),
            ..Default::default()
        })
        .unwrap();
    let syncer = Syncer::new(client(&server), store);
    let details = syncer.set_watcher(3, 5, true).await.unwrap();
    assert_eq!(details.watching, Some(true));
    // A role without "Delete watchers" is refused, and Redline says so.
    assert!(matches!(
        syncer.set_watcher(3, 9, false).await,
        Err(Error::Forbidden)
    ));
}

#[tokio::test]
async fn reads_roles_and_their_permissions() {
    let server = MockServer::start().await;
    Mock::given(path("/roles.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "roles": [{"id": 3, "name": "Manager"}, {"id": 4, "name": "Developer"}]
        })))
        .mount(&server)
        .await;
    Mock::given(path("/roles/3.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "role": {"id": 3, "name": "Manager", "permissions": ["view_issues", "add_issue_watchers"]}
        })))
        .mount(&server)
        .await;
    Mock::given(path("/roles/4.json"))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;
    let roles = client(&server).roles().await.unwrap();
    assert_eq!(roles.len(), 1);
    assert_eq!(
        roles[0].permissions,
        vec!["view_issues", "add_issue_watchers"]
    );
}

#[tokio::test]
async fn uploads_attaches_downloads_and_deletes_files() {
    use redline_core::{NewFile, Store, Syncer};

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/uploads.json"))
        .and(query_param("filename", "shot.png"))
        .and(header("Content-Type", "application/octet-stream"))
        .and(body_bytes(b"png bytes".to_vec()))
        .respond_with(
            ResponseTemplate::new(201)
                .set_body_json(json!({"upload": {"id": 7, "token": "7.abc"}})),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/issues/3.json"))
        .and(body_json(json!({"issue": {
            "notes": "Here it is",
            "uploads": [{"token": "7.abc", "filename": "shot.png", "content_type": "image/png"}]
        }})))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    let mut with_attachment = issue(3);
    with_attachment["attachments"] = json!([{
        "id": 7, "filename": "shot.png", "filesize": 9, "content_type": "image/png",
        "content_url": "https://elsewhere.example/attachments/download/7/shot.png"
    }]);
    Mock::given(method("GET"))
        .and(path("/issues/3.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"issue": with_attachment})))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/issues.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "issues": [], "total_count": 0, "offset": 0, "limit": 1
        })))
        .mount(&server)
        .await;
    // Downloads go to the signed-in server, not the host content_url names.
    Mock::given(method("GET"))
        .and(path("/attachments/download/7"))
        .and(header("X-Redmine-API-Key", "test-key"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(b"png bytes".to_vec()))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/attachments/7.json"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    let syncer = Syncer::new(client(&server), Store::in_memory().unwrap());
    let details = syncer
        .attach_files(
            3,
            vec![NewFile {
                filename: "shot.png".into(),
                content_type: Some("image/png".into()),
                bytes: b"png bytes".to_vec(),
            }],
            Some("Here it is".into()),
        )
        .await
        .unwrap();
    let attachments = details.issue.attachments.unwrap();
    assert_eq!(attachments[0].filename, "shot.png");
    assert_eq!(
        syncer.client().download_attachment(7).await.unwrap(),
        b"png bytes"
    );
    syncer.delete_attachment(3, 7).await.unwrap();
}

#[tokio::test]
async fn lists_logs_changes_and_deletes_time() {
    use redline_core::TimeQuery;
    use redline_core::models::TimeEntryChanges;
    use redline_core::{Store, Syncer};

    let entry = |hours: f64| {
        json!({"time_entry": {
            "id": 40, "project": {"id": 1, "name": "Web"}, "issue": {"id": 3},
            "user": {"id": 5, "name": "Dana"}, "activity": {"id": 9, "name": "Development"},
            "hours": hours, "comments": "Pairing", "spent_on": "2026-11-09"
        }})
    };
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/time_entries.json"))
        .and(query_param("project_id", "1"))
        .and(query_param("from", "2026-11-02"))
        .and(query_param("to", "2026-11-08"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "time_entries": [entry(1.5)["time_entry"]], "total_count": 1, "offset": 0, "limit": 100
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/time_entries.json"))
        .and(body_json(json!({"time_entry": {
            "issue_id": 3, "spent_on": "2026-11-09", "hours": 1.5, "activity_id": 9, "comments": "Pairing"
        }})))
        .respond_with(ResponseTemplate::new(201).set_body_json(entry(1.5)))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/time_entries/40.json"))
        .and(body_json(json!({"time_entry": {"hours": 2.0}})))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/time_entries/40.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(entry(2.0)))
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/time_entries/40.json"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    // Each change re-reads the issue for its spent time.
    let mut spent = issue(3);
    spent["spent_hours"] = json!(2.0);
    Mock::given(method("GET"))
        .and(path("/issues/3.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"issue": spent})))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/issues.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "issues": [], "total_count": 0, "offset": 0, "limit": 1
        })))
        .mount(&server)
        .await;

    let store = Store::in_memory().unwrap();
    let syncer = Syncer::new(client(&server), store.clone());
    let listed = syncer
        .client()
        .time_entries(&TimeQuery {
            project_id: Some(1),
            from: Some("2026-11-02".into()),
            to: Some("2026-11-08".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(listed[0].hours, 1.5);
    let logged = syncer
        .log_time(&TimeEntryChanges {
            issue_id: Some(3),
            spent_on: Some("2026-11-09".into()),
            hours: Some(1.5),
            activity_id: Some(9),
            comments: Some("Pairing".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(logged.activity.name, "Development");
    assert_eq!(store.issue(3).unwrap().unwrap().spent_hours, Some(2.0));
    let changed = syncer
        .update_time_entry(
            40,
            &TimeEntryChanges {
                hours: Some(2.0),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(changed.hours, 2.0);
    assert_eq!(syncer.delete_time_entry(40).await.unwrap(), Some(3));
}

#[tokio::test]
async fn creates_changes_and_deletes_versions() {
    use redline_core::models::VersionChanges;
    use redline_core::{Store, Syncer};

    let version = |status: &str| {
        json!({"version": {
            "id": 7, "project": {"id": 1, "name": "Web"}, "name": "Sprint 3", "description": "Board polish",
            "status": status, "due_date": "2026-11-30", "sharing": "none", "wiki_page_title": "Sprint_3",
            "estimated_hours": 20.0, "spent_hours": 4.5
        }})
    };
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/projects/1/versions.json"))
        .and(body_json(json!({"version": {
            "name": "Sprint 3", "description": "Board polish", "due_date": "2026-11-30", "sharing": "none"
        }})))
        .respond_with(ResponseTemplate::new(201).set_body_json(version("open")))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/versions/7.json"))
        .and(body_json(json!({"version": {"status": "closed"}})))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/versions/7.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(version("closed")))
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/versions/7.json"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    let store = Store::in_memory().unwrap();
    let syncer = Syncer::new(client(&server), store.clone());
    let created = syncer
        .create_version(
            1,
            &VersionChanges {
                name: Some("Sprint 3".into()),
                description: Some("Board polish".into()),
                due_date: Some("2026-11-30".into()),
                sharing: Some("none".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(created.wiki_page_title.as_deref(), Some("Sprint_3"));
    assert_eq!(created.spent_hours, Some(4.5));
    assert_eq!(store.metadata().unwrap().versions.len(), 1);

    let closed = syncer
        .update_version(
            7,
            &VersionChanges {
                status: Some("closed".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(closed.status, "closed");
    assert_eq!(store.metadata().unwrap().versions[0].status, "closed");

    syncer.delete_version(7).await.unwrap();
    assert!(store.metadata().unwrap().versions.is_empty());
}

#[tokio::test]
async fn deletes_an_issue_with_its_sub_issues_and_refreshes_its_neighbours() {
    use redline_core::models::Issue;
    use redline_core::{Store, Syncer};

    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/issues/1.json"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    // Redmine dropped the relation with the issue; the parent's totals are the same here.
    let mut four = issue(4);
    four["relations"] = json!([]);
    Mock::given(method("GET"))
        .and(path("/issues.json"))
        .and(query_param("issue_id", "5,4"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "issues": [four, issue(5)], "total_count": 2, "offset": 0, "limit": 100
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/journals/9.json"))
        .and(body_json(json!({"journal": {"notes": "Fixed typo"}})))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    let relation = json!({"id": 3, "issue_id": 4, "issue_to_id": 1, "relation_type": "relates", "delay": null});
    let mut cached = vec![issue(1), issue(2), issue(3), issue(4), issue(5)];
    cached[0]["parent"] = json!({"id": 5});
    cached[1]["parent"] = json!({"id": 1});
    cached[2]["parent"] = json!({"id": 2});
    cached[3]["relations"] = json!([relation]);
    let cached: Vec<Issue> = serde_json::from_value(json!(cached)).unwrap();
    let store = Store::in_memory().unwrap();
    store.upsert_issues(&cached).unwrap();

    let syncer = Syncer::new(client(&server), store.clone());
    let (removed, changed) = syncer.delete_issue(1).await.unwrap();
    assert_eq!(removed, vec![1, 2, 3]);
    assert_eq!(store.issue_ids().unwrap(), vec![4, 5]);
    assert_eq!(changed, vec![4]);
    assert_eq!(store.issue(4).unwrap().unwrap().relations, Some(vec![]));

    syncer
        .client()
        .update_journal(9, "Fixed typo")
        .await
        .unwrap();
}

#[tokio::test]
async fn runs_a_saved_query_in_its_own_order_and_caches_the_issues() {
    use redline_core::{Store, Syncer};

    let server = MockServer::start().await;
    Mock::given(path("/queries.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "queries": [
                {"id": 4, "name": "Open bugs", "is_public": true, "project_id": 1},
                {"id": 5, "name": "Mine", "is_public": false}
            ],
            "total_count": 2, "offset": 0, "limit": 25
        })))
        .mount(&server)
        .await;
    // The query sets status and sort, so Redline sends neither.
    Mock::given(path("/issues.json"))
        .and(query_param("query_id", "4"))
        .and(query_param("project_id", "1"))
        .and(query_param("offset", "0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "issues": [issue(9), issue(3)], "total_count": 3, "offset": 0, "limit": 2
        })))
        .mount(&server)
        .await;
    Mock::given(path("/issues.json"))
        .and(query_param("query_id", "4"))
        .and(query_param("offset", "2"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "issues": [issue(5)], "total_count": 3, "offset": 2, "limit": 2
        })))
        .mount(&server)
        .await;

    let queries = client(&server).queries().await.unwrap();
    assert_eq!(queries[0].name, "Open bugs");
    assert_eq!(queries[0].project_id, Some(1));
    assert_eq!(queries[1].project_id, None);

    let store = Store::in_memory().unwrap();
    let syncer = Syncer::new(client(&server), store.clone());
    let (found, changed) = syncer.query_issues(4, Some(1)).await.unwrap();
    assert_eq!(found.items, vec![9, 3, 5]);
    assert_eq!(found.total, 3);
    assert_eq!(changed.len(), 3);
    assert!(store.issue(5).unwrap().is_some());
    let requests = server.received_requests().await.unwrap();
    assert!(
        requests
            .iter()
            .filter(|r| r.url.path() == "/issues.json")
            .all(|r| !r.url.query().unwrap_or("").contains("status_id"))
    );
}

#[tokio::test]
async fn searches_everything_a_page_at_a_time() {
    let server = MockServer::start().await;
    Mock::given(path("/search.json"))
        .and(query_param("q", "release notes"))
        .and(query_param("offset", "25"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "results": [
                {"id": 2, "title": "Wiki: Release notes", "type": "wiki-page", "url": "http://x/projects/web/wiki/Release_notes", "description": "", "datetime": "2026-11-01T00:00:00Z"},
                {"id": 7, "title": "Feature #7 (New): Write release notes", "type": "issue", "url": "http://x/issues/7", "description": "", "datetime": "2026-11-02T00:00:00Z"}
            ],
            "total_count": 27, "offset": 25, "limit": 25
        })))
        .mount(&server)
        .await;
    let page = client(&server)
        .search("release notes", 25, 25)
        .await
        .unwrap();
    assert_eq!(page.total_count, 27);
    assert_eq!(page.items[0].kind, "wiki-page");
    assert_eq!(page.items[1].id, 7);
}

#[tokio::test]
async fn reads_another_user_and_what_redmine_shows_of_them() {
    let server = MockServer::start().await;
    Mock::given(path("/users/2.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "user": {"id": 2, "firstname": "Sam", "lastname": "Teammate", "created_on": "2026-04-14T09:00:00Z"}
        })))
        .mount(&server)
        .await;
    Mock::given(path("/users/9.json"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    let c = client(&server);
    let sam = c.user(2).await.unwrap();
    assert_eq!(sam.display_name(), "Sam Teammate");
    assert_eq!(sam.mail, None);
    assert_eq!(sam.login, "");
    assert!(matches!(c.user(9).await, Err(Error::NotFound)));
}

#[tokio::test]
async fn creates_closes_reopens_and_deletes_projects() {
    use redline_core::models::ProjectChanges;

    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/projects.json"))
        .and(body_json(json!({"project": {
            "name": "Design", "identifier": "web-design", "parent_id": 1, "inherit_members": true
        }})))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({
            "project": {"id": 3, "name": "Design", "identifier": "web-design", "parent": {"id": 1, "name": "Web"}, "status": 1}
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/projects/3.json"))
        .and(body_json(
            json!({"project": {"description": "", "is_public": false}}),
        ))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    for action in ["close", "reopen"] {
        Mock::given(method("PUT"))
            .and(path(format!("/projects/3/{action}.json")))
            .respond_with(ResponseTemplate::new(204))
            .expect(1)
            .mount(&server)
            .await;
    }
    Mock::given(method("DELETE"))
        .and(path("/projects/3.json"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    let c = client(&server);
    let made = c
        .create_project(&ProjectChanges {
            name: Some("Design".into()),
            identifier: Some("web-design".into()),
            parent_id: Some(1),
            inherit_members: Some(true),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(made.id, 3);
    assert_eq!(made.parent.unwrap().id, 1);
    c.update_project(
        3,
        &ProjectChanges {
            description: Some(String::new()),
            is_public: Some(false),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    c.set_project_closed(3, true).await.unwrap();
    c.set_project_closed(3, false).await.unwrap();
    c.delete_project(3).await.unwrap();
}
