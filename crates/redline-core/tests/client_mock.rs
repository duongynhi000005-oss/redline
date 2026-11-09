//! Client behaviour against a mock server: auth header, paging, retries and
//! error mapping.

use std::time::Duration;

use redline_core::models::{IssueChanges, SearchKind, SearchScope};
use redline_core::{Client, ConnectionOptions, Error, Header, IssueQuery, RequestLimits};
use serde_json::json;
use wiremock::matchers::{body_bytes, body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn client(server: &MockServer) -> Client {
    Client::new(&server.uri(), "test-key")
        .unwrap()
        .with_retry_unit(Duration::from_millis(1))
        .with_limits(RequestLimits::unlimited())
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
        .respond_with(
            ResponseTemplate::new(401)
                .insert_header("WWW-Authenticate", r#"Basic realm="Redmine API""#),
        )
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
        .expect(7)
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
    let ids: Vec<u64> = (1..=3).collect();
    Mock::given(path("/issues.json"))
        .respond_with(move |r: &wiremock::Request| issue_list(&ids, r))
        .mount(&server)
        .await;
    let syncer = Syncer::new(client(&server), Store::in_memory().unwrap());
    let report = syncer.sync_issues().await.unwrap();
    assert!(report.initial);
    assert!(!report.remaining);
    assert_eq!(report.changed, vec![3, 2, 1], "newest first");

    // The next delta asks from a minute before the newest change.
    server.reset().await;
    Mock::given(path("/issues.json"))
        .and(query_param("updated_on", ">=2026-11-01T23:59:02Z"))
        .and(query_param("sort", "updated_on,id"))
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
        .search("release notes", 25, 25, &SearchScope::default())
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

#[tokio::test]
async fn reads_saves_and_deletes_wiki_pages() {
    use redline_core::models::WikiPageChanges;

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/projects/1/wiki/index.json"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"wiki_pages": [
                {"title": "Wiki", "version": 3},
                {"title": "Release_checklist", "parent": {"title": "Wiki"}, "version": 1}
            ]})),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/projects/1/wiki.json"))
        .and(query_param("include", "attachments"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"wiki_page": {
                "title": "Wiki", "text": "# Web", "version": 3, "author": {"id": 5, "name": "Dana"},
                "attachments": [{"id": 9, "filename": "map.png"}]
            }})),
        )
        .mount(&server)
        .await;
    // A title with a space and a version, escaped as path segments.
    Mock::given(method("GET"))
        .and(path("/projects/1/wiki/Q&A%20notes/2.json"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(json!({"wiki_page": {
                "title": "Q&A notes", "text": "old", "version": 2, "comments": "typo"
            }})),
        )
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/projects/1/wiki/Release_checklist.json"))
        .and(body_json(json!({"wiki_page": {
            "text": "Ship it", "comments": "Steps", "version": 1, "parent_title": "Wiki"
        }})))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/projects/1/wiki/Stale.json"))
        .respond_with(ResponseTemplate::new(409))
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/projects/1/wiki/Wiki.json"))
        .and(query_param("todo", "nullify"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    let c = client(&server);
    let index = c.wiki_index(1).await.unwrap();
    assert_eq!(index.len(), 2);
    assert_eq!(index[1].parent.as_ref().unwrap().title, "Wiki");
    assert_eq!(index[1].text, None);

    let start = c.wiki_page(1, None, None).await.unwrap();
    assert_eq!(start.text.as_deref(), Some("# Web"));
    assert_eq!(start.attachments[0].filename, "map.png");

    let old = c.wiki_page(1, Some("Q&A notes"), Some(2)).await.unwrap();
    assert_eq!(old.comments.as_deref(), Some("typo"));

    c.save_wiki_page(
        1,
        "Release_checklist",
        &WikiPageChanges {
            text: "Ship it".into(),
            comments: Some("Steps".into()),
            version: Some(1),
            parent_title: Some("Wiki".into()),
        },
    )
    .await
    .unwrap();

    let stale = c
        .save_wiki_page(1, "Stale", &WikiPageChanges::default())
        .await
        .unwrap_err();
    assert!(
        matches!(&stale, Error::Rejected(m) if m[0].contains("while you were editing")),
        "{stale:?}"
    );

    c.delete_wiki_page(1, "Wiki", false).await.unwrap();
}

#[tokio::test]
async fn reads_posts_and_deletes_news() {
    use redline_core::models::NewsChanges;

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/news.json"))
        .and(query_param("offset", "0"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "news": [{"id": 2, "project": {"id": 1, "name": "Web"}, "title": "Out", "summary": "Now"}],
            "total_count": 1, "offset": 0, "limit": 100
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/projects/1/news.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "news": [], "total_count": 0, "offset": 0, "limit": 100
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/news/2.json"))
        .and(query_param("include", "comments,attachments"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"news": {
            "id": 2, "project": {"id": 1, "name": "Web"}, "title": "Out",
            "description": "**Done**", "author": {"id": 5, "name": "Dana"},
            "comments": [{"id": 1, "author": {"id": 6, "name": "Sam"}, "content": "Nice"}],
            "attachments": []
        }})))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/projects/1/news.json"))
        .and(body_json(
            json!({"news": {"title": "Hi", "description": "Body"}}),
        ))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PUT"))
        .and(path("/news/2.json"))
        .and(body_json(json!({"news": {"summary": "Short"}})))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/news/2.json"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    let c = client(&server);
    let all = c.news(None, 0).await.unwrap();
    assert_eq!(all.total_count, 1);
    assert_eq!(all.items[0].project.name, "Web");
    assert!(c.news(Some(1), 0).await.unwrap().items.is_empty());

    let post = c.news_item(2).await.unwrap();
    assert_eq!(post.comments[0].content, "Nice");
    assert_eq!(post.description.as_deref(), Some("**Done**"));

    c.create_news(
        1,
        &NewsChanges {
            title: Some("Hi".into()),
            description: Some("Body".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    c.update_news(
        2,
        &NewsChanges {
            summary: Some("Short".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    c.delete_news(2).await.unwrap();
}

#[tokio::test]
async fn lists_and_adds_project_files() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/projects/1/files.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"files": [
            {"id": 20, "filename": "notes.txt", "filesize": 41, "downloads": 3,
             "version": {"id": 2, "name": "Sprint 2"}},
            {"id": 21, "filename": "colors.txt"}
        ]})))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/projects/1/files.json"))
        .and(body_json(json!({"file": {
            "token": "7.abc", "filename": "a.pdf", "version_id": 2, "description": "Spec"
        }})))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/projects/1/files.json"))
        .and(body_json(
            json!({"file": {"token": "8.def", "filename": "b.pdf"}}),
        ))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    let c = client(&server);
    let files = c.files(1).await.unwrap();
    assert_eq!(files[0].version.as_ref().unwrap().name, "Sprint 2");
    assert_eq!(files[0].downloads, 3);
    assert_eq!(files[1].version, None);
    c.add_file(1, "7.abc", "a.pdf", Some(2), Some("Spec"))
        .await
        .unwrap();
    // An empty description isn't sent.
    c.add_file(1, "8.def", "b.pdf", None, Some(""))
        .await
        .unwrap();
}

#[tokio::test]
async fn reads_journals_for_the_feed_only_where_the_cache_is_behind() {
    use redline_core::{Store, Syncer};

    let server = MockServer::start().await;
    // #2 changed since its journals were cached; #3 is gone.
    let mut fresh = issue(2);
    fresh["journals"] = json!([{"id": 20, "notes": "New comment", "created_on": "2026-11-02T00:00:00Z", "details": []}]);
    Mock::given(path("/issues/2.json"))
        .and(query_param("include", "journals"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"issue": fresh})))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(path("/issues/3.json"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    Mock::given(path("/issues/1.json"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;
    let store = Store::in_memory().unwrap();
    let issues: Vec<redline_core::models::Issue> = (1..=3)
        .map(|id| serde_json::from_value(issue(id)).unwrap())
        .collect();
    store.upsert_issues(&issues).unwrap();
    let old: Vec<redline_core::models::Journal> = serde_json::from_value(
        json!([{"id": 10, "notes": "Cached", "created_on": "2026-11-01T00:00:00Z", "details": []}]),
    )
    .unwrap();
    store.set_journals(1, "2026-11-02T00:00:00Z", &old).unwrap();
    store.set_journals(2, "2026-11-01T00:00:00Z", &old).unwrap();

    let syncer = Syncer::new(client(&server), store.clone());
    let mut found = syncer.issue_journals(&[1, 2, 3, 99]).await.unwrap();
    found.sort_by_key(|j| j.issue_id);
    assert_eq!(found.len(), 2);
    assert_eq!(found[0].journals[0].notes.as_deref(), Some("Cached"));
    assert_eq!(found[1].journals[0].notes.as_deref(), Some("New comment"));
    // Now cached, so the next feed doesn't ask again.
    assert_eq!(store.journals(2).unwrap().unwrap().1[0].id, 20);
}

#[tokio::test]
async fn reads_the_commits_linked_to_an_issue() {
    let server = MockServer::start().await;
    let mut detailed = issue(5);
    detailed["changesets"] = json!([{
        "revision": "4f1c2a9",
        "user": {"id": 3, "name": "Dana Lee"},
        "comments": "Fix the board drag, refs #5",
        "committed_on": "2026-11-03T10:00:00Z"
    }]);
    Mock::given(path("/issues/5.json"))
        .and(query_param("include", "changesets"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"issue": detailed})))
        .mount(&server)
        .await;
    let found = client(&server).issue(5, &["changesets"]).await.unwrap();
    let commits = found.changesets.unwrap();
    assert_eq!(commits[0].revision, "4f1c2a9");
    assert_eq!(commits[0].user.as_ref().unwrap().name, "Dana Lee");
}

#[tokio::test]
async fn searches_one_project_for_some_kinds() {
    let server = MockServer::start().await;
    Mock::given(path("/projects/1/search.json"))
        .and(query_param("q", "board"))
        .and(query_param("documents", "1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "results": [
                {"id": 3, "title": "Document: Board view spec", "type": "document", "url": "http://x/documents/3"}
            ],
            "total_count": 1, "offset": 0, "limit": 25
        })))
        .mount(&server)
        .await;
    // Where documents aren't open to the user, Redmine searches everything.
    Mock::given(path("/projects/2/search.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "results": [
                {"id": 9, "title": "Bug #9 (New): Board flickers", "type": "issue", "url": "http://x/issues/9"}
            ],
            "total_count": 40, "offset": 0, "limit": 25
        })))
        .mount(&server)
        .await;
    let c = client(&server);
    let scope = |id| SearchScope {
        project_id: Some(id),
        kinds: vec![SearchKind::Documents],
    };
    let found = c.search("board", 0, 25, &scope(1)).await.unwrap();
    assert_eq!(found.items[0].kind, "document");
    assert_eq!(found.total_count, 1);
    let none = c.search("board", 0, 25, &scope(2)).await.unwrap();
    assert!(none.items.is_empty());
    assert_eq!(none.total_count, 0);
}

/// A Redmine issue list sorted by `updated_on`, as the sync reads it, served
/// a page at a time from `offset` and `limit`, newest first when asked. All
/// the issues are open, so asking for closed ones finds none.
fn issue_list(ids: &[u64], request: &wiremock::Request) -> ResponseTemplate {
    let text = |name: &str| {
        request
            .url
            .query_pairs()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.into_owned())
    };
    if text("status_id").as_deref() == Some("closed") {
        return ResponseTemplate::new(200).set_body_json(json!({
            "issues": [], "total_count": 0, "offset": 0, "limit": 100
        }));
    }
    let newest_first = text("sort").is_some_and(|s| s.starts_with("updated_on:desc"));
    let param = |name: &str| {
        request
            .url
            .query_pairs()
            .find(|(k, _)| k == name)
            .and_then(|(_, v)| v.parse::<usize>().ok())
    };
    let offset = param("offset").unwrap_or(0);
    let limit = param("limit").unwrap_or(25);
    let mut listed: Vec<(usize, u64)> = ids.iter().copied().enumerate().collect();
    if newest_first {
        listed.reverse();
    }
    let page: Vec<_> = listed
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(|(position, id)| {
            let mut i = issue(id);
            // Each place in the list a second later than the one before.
            i["updated_on"] = json!(format!(
                "2026-11-02T{:02}:{:02}:{:02}Z",
                position / 3600,
                position / 60 % 60,
                position % 60
            ));
            i
        })
        .collect();
    ResponseTemplate::new(200).set_body_json(json!({
        "issues": page, "total_count": ids.len(), "offset": offset, "limit": limit
    }))
}

#[tokio::test]
async fn first_sync_reads_the_newest_issues_first_then_the_rest() {
    use redline_core::{Store, Syncer};

    let server = MockServer::start().await;
    let ids: Vec<u64> = (1..=450).collect();
    let served = ids.clone();
    Mock::given(path("/issues.json"))
        .respond_with(move |r: &wiremock::Request| issue_list(&served, r))
        .mount(&server)
        .await;

    let syncer = Syncer::new(client(&server), Store::in_memory().unwrap());

    // One step with no older pages: just the newest hundred.
    let report = syncer.sync_issues_paced(0, |_| {}).await.unwrap();
    assert!(report.initial);
    assert!(report.remaining);
    assert_eq!(report.changed, (351..=450).rev().collect::<Vec<u64>>());

    // The rest, a page at a time: open issues newest first, overlapping by
    // 10, then closed ones (none here).
    let mut progress = Vec::new();
    let report = syncer
        .sync_older_issues(usize::MAX, |p| {
            progress.push((p.fetched, p.total, p.changed.len()))
        })
        .await
        .unwrap();
    assert!(!report.remaining);
    let mut changed = report.changed.clone();
    changed.sort_unstable();
    assert_eq!(changed, (1..=350).collect::<Vec<u64>>(), "each issue once");
    assert_eq!(syncer.store().count_issues().unwrap(), 450);
    assert_eq!(
        progress,
        vec![
            (100, 450, 0),
            (190, 450, 90),
            (280, 450, 90),
            (370, 450, 90),
            (450, 450, 80),
            (450, 450, 0)
        ]
    );

    // Done: the next sync is a delta.
    let report = syncer.sync_issues().await.unwrap();
    assert!(!report.initial);
    assert!(!report.remaining);
}

#[tokio::test]
async fn an_issue_edited_during_the_first_sync_skips_no_other_issue() {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    use redline_core::{Store, Syncer};

    let server = MockServer::start().await;
    let edited = Arc::new(AtomicBool::new(false));
    let seen = edited.clone();
    Mock::given(path("/issues.json"))
        .respond_with(move |r: &wiremock::Request| {
            // Issue 5 is edited right after the first page is read: it moves
            // to the end, and every issue after it moves back one place.
            let mut ids: Vec<u64> = (1..=300).collect();
            if seen.swap(true, Ordering::SeqCst) {
                ids.retain(|&id| id != 5);
                ids.push(5);
            }
            issue_list(&ids, r)
        })
        .mount(&server)
        .await;

    let syncer = Syncer::new(client(&server), Store::in_memory().unwrap());
    syncer.sync_issues().await.unwrap();
    assert!(edited.load(Ordering::SeqCst));
    let mut cached = syncer.store().issue_ids().unwrap();
    cached.sort_unstable();
    assert_eq!(cached, (1..=300).collect::<Vec<u64>>());
}

#[tokio::test]
async fn a_sync_that_fails_part_way_resumes_from_what_it_read() {
    use redline_core::{Store, Syncer};

    let server = MockServer::start().await;
    let ids: Vec<u64> = (1..=300).collect();
    let served = ids.clone();
    Mock::given(path("/issues.json"))
        .and(query_param("status_id", "open"))
        .and(query_param("offset", "180"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    Mock::given(path("/issues.json"))
        .respond_with(move |r: &wiremock::Request| issue_list(&served, r))
        .mount(&server)
        .await;

    let syncer = Syncer::new(client(&server), Store::in_memory().unwrap());
    let err = syncer.sync_issues().await;
    assert!(err.is_err());
    assert_eq!(
        syncer.store().count_issues().unwrap(),
        190,
        "the pages before the failure are cached"
    );

    // The next sync asks for changes, then carries on from the page that
    // failed instead of starting over.
    server.reset().await;
    Mock::given(path("/issues.json"))
        .and(wiremock::matchers::query_param_contains("updated_on", ">="))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "issues": [], "total_count": 0, "offset": 0, "limit": 100
        })))
        .mount(&server)
        .await;
    let served = ids.clone();
    Mock::given(path("/issues.json"))
        .respond_with(move |r: &wiremock::Request| issue_list(&served, r))
        .mount(&server)
        .await;
    let report = syncer.sync_issues().await.unwrap();
    assert!(report.initial, "still the first sync");
    assert!(!report.remaining);
    let asked: Vec<String> = server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .map(|r| {
            let q: std::collections::BTreeMap<_, _> = r.url.query_pairs().collect();
            format!(
                "{} {}",
                q.get("status_id")
                    .map(|v| v.to_string())
                    .unwrap_or_default(),
                q.get("offset").map(|v| v.to_string()).unwrap_or_default()
            )
        })
        .collect();
    assert_eq!(asked, vec!["* 0", "open 180", "open 270", "closed 0"]);
    assert_eq!(syncer.store().count_issues().unwrap(), 300);
}

#[tokio::test]
async fn a_key_redmine_stopped_accepting_keeps_the_cache() {
    use redline_core::{Store, Syncer};

    let server = MockServer::start().await;
    Mock::given(path("/issues.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "issues": [issue(1), issue(2)], "total_count": 2, "offset": 0, "limit": 100
        })))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    let syncer = Syncer::new(client(&server), Store::in_memory().unwrap());
    syncer.sync_issues().await.unwrap();

    // Redmine treats a revoked key as anonymous: lists come back empty with
    // a 200, and only the current user says the key is refused.
    server.reset().await;
    Mock::given(path("/issues.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "issues": [], "total_count": 0, "offset": 0, "limit": 100
        })))
        .mount(&server)
        .await;
    Mock::given(path("/users/current.json"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    assert!(matches!(syncer.check_key().await, Err(Error::Unauthorized)));
    assert!(matches!(
        syncer.prune_deleted().await,
        Err(Error::Unauthorized)
    ));
    assert_eq!(syncer.store().issue_ids().unwrap(), vec![1, 2]);

    // With a key Redmine accepts, an empty answer really means deleted.
    server.reset().await;
    Mock::given(path("/issues.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "issues": [issue(1)], "total_count": 1, "offset": 0, "limit": 100
        })))
        .mount(&server)
        .await;
    Mock::given(path("/users/current.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "user": {"id": 5, "login": "dev", "firstname": "Dana", "lastname": "Developer"}
        })))
        .mount(&server)
        .await;
    assert_eq!(syncer.prune_deleted().await.unwrap(), vec![2]);
    assert_eq!(syncer.store().issue_ids().unwrap(), vec![1]);
}

fn proxied(server: &MockServer) -> Client {
    Client::with_options(
        &server.uri(),
        "test-key",
        &ConnectionOptions {
            username: Some("dana".into()),
            headers: vec![Header {
                name: "X-Gateway-Token".into(),
                value: "tok".into(),
            }],
            ..Default::default()
        },
    )
    .unwrap()
    .with_retry_unit(Duration::from_millis(1))
}

#[tokio::test]
async fn sends_the_username_and_custom_headers_with_the_api_key() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/users/current.json"))
        .and(header("X-Redmine-API-Key", "test-key"))
        .and(header("X-Redmine-Username", "dana"))
        .and(header("X-Gateway-Token", "tok"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "user": {"id": 5, "login": "dev", "firstname": "Dana", "lastname": "Developer"}
        })))
        .expect(1)
        .mount(&server)
        .await;
    // Uploads and downloads carry them too.
    Mock::given(method("POST"))
        .and(path("/uploads.json"))
        .and(header("X-Redmine-Username", "dana"))
        .and(header("X-Gateway-Token", "tok"))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({"upload": {"token": "t1"}})))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/attachments/download/7"))
        .and(header("X-Redmine-Username", "dana"))
        .and(header("X-Gateway-Token", "tok"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(b"png".to_vec()))
        .expect(1)
        .mount(&server)
        .await;

    let client = proxied(&server);
    assert_eq!(client.current_user().await.unwrap().id, 5);
    assert_eq!(client.upload("a.png", b"png".to_vec()).await.unwrap(), "t1");
    assert_eq!(client.download_attachment(7).await.unwrap(), b"png");
}

#[tokio::test]
async fn refuses_to_build_a_client_with_bad_headers() {
    let err = Client::with_options(
        "https://example.com",
        "k",
        &ConnectionOptions {
            username: None,
            headers: vec![Header {
                name: "X-Redmine-API-Key".into(),
                value: "other".into(),
            }],
            ..Default::default()
        },
    )
    .unwrap_err();
    assert!(matches!(err, Error::InvalidHeader(_)));
}

#[tokio::test]
async fn tells_a_proxy_refusal_from_a_wrong_key() {
    // A gateway's 401 asks for another realm, or is a web page.
    // Redmine's own answer to a wrong key: empty JSON, no challenge.
    let server = MockServer::start().await;
    Mock::given(path("/users/current.json"))
        .respond_with(ResponseTemplate::new(401).insert_header("Content-Type", "application/json"))
        .mount(&server)
        .await;
    assert!(matches!(
        client(&server).current_user().await,
        Err(Error::Unauthorized)
    ));

    let server = MockServer::start().await;
    Mock::given(path("/users/current.json"))
        .respond_with(ResponseTemplate::new(401).insert_header("WWW-Authenticate", "Bearer"))
        .mount(&server)
        .await;
    let err = client(&server).current_user().await.unwrap_err();
    assert!(matches!(err, Error::Refused(401)), "{err:?}");
    assert_eq!(err.code(), "refused");
    assert!(err.to_string().contains("HTTP 401"));

    let server = MockServer::start().await;
    Mock::given(path("/users/current.json"))
        .respond_with(
            ResponseTemplate::new(401)
                .insert_header("Content-Type", "text/html")
                .set_body_string("<html><body>Sign in</body></html>"),
        )
        .mount(&server)
        .await;
    assert!(matches!(
        client(&server).current_user().await,
        Err(Error::Refused(401))
    ));

    // A gateway's 403 is a web page; Redmine's is empty.
    let server = MockServer::start().await;
    Mock::given(path("/users/current.json"))
        .respond_with(
            ResponseTemplate::new(403)
                .insert_header("Content-Type", "text/html")
                .set_body_string("<html><body>Access denied</body></html>"),
        )
        .mount(&server)
        .await;
    assert!(matches!(
        client(&server).current_user().await,
        Err(Error::Refused(403))
    ));

    let server = MockServer::start().await;
    Mock::given(path("/users/current.json"))
        .respond_with(ResponseTemplate::new(407))
        .mount(&server)
        .await;
    assert!(matches!(
        client(&server).current_user().await,
        Err(Error::Refused(407))
    ));
}

#[tokio::test]
async fn never_follows_a_redirect_to_another_host() {
    let elsewhere = MockServer::start().await;
    Mock::given(path("/login"))
        .respond_with(ResponseTemplate::new(200).set_body_string("{}"))
        .expect(0)
        .mount(&elsewhere)
        .await;
    let server = MockServer::start().await;
    Mock::given(path("/users/current.json"))
        .respond_with(
            ResponseTemplate::new(302)
                .insert_header("Location", format!("{}/login", elsewhere.uri())),
        )
        .mount(&server)
        .await;
    // The redirect isn't followed, so nothing reaches the other host.
    let err = client(&server).current_user().await.unwrap_err();
    assert!(matches!(err, Error::Refused(302)), "{err:?}");
}

#[tokio::test]
async fn follows_a_redirect_on_the_same_server() {
    let server = MockServer::start().await;
    Mock::given(path("/users/current.json"))
        .respond_with(ResponseTemplate::new(301).insert_header(
            "Location",
            format!("{}/moved/users/current.json", server.uri()),
        ))
        .mount(&server)
        .await;
    Mock::given(path("/moved/users/current.json"))
        .and(header("X-Redmine-Username", "dana"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "user": {"id": 5, "login": "dev", "firstname": "Dana", "lastname": "Developer"}
        })))
        .mount(&server)
        .await;
    assert_eq!(proxied(&server).current_user().await.unwrap().id, 5);
}
