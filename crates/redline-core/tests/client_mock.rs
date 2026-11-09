//! Client behaviour against a mock server: auth header, paging, retries and
//! error mapping.

use std::time::Duration;

use redline_core::models::IssueChanges;
use redline_core::{Client, Error, IssueQuery};
use serde_json::json;
use wiremock::matchers::{body_json, header, method, path, query_param};
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
