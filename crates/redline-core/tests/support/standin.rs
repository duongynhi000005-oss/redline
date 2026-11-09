//! A stand-in for a large Redmine behind a rate limiter, for tests that
//! count how many requests Redline sends and how it copes with 429s.
//!
//! It serves just enough of Redmine's REST API for sign-in, metadata and
//! issue sync: projects, statuses, trackers, priorities, activities, roles,
//! queries, versions and memberships per project, and `issues.json` with the
//! filters, sort orders and paging Redline uses. In front of that sits a
//! token bucket: past it, the server answers 429, with or without
//! `Retry-After`.

#![allow(dead_code)]

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use wiremock::{MockServer, Request, Respond, ResponseTemplate};

/// How big the stand-in is and how strictly it limits.
#[derive(Debug, Clone)]
pub struct Config {
    pub projects: u64,
    pub issues: u64,
    /// Requests the bucket holds when full.
    pub burst: f64,
    /// Requests it lets through per second, once the burst is used.
    pub per_second: f64,
    /// Send `Retry-After` (whole seconds) with each 429.
    pub retry_after: bool,
}

/// What the stand-in saw.
#[derive(Debug, Default, Clone)]
pub struct Tally {
    /// Every request, answered or refused.
    pub requests: u64,
    /// Requests answered 429.
    pub limited: u64,
    /// Requests per endpoint kind ("issues", "versions", ...), answered or not.
    pub by_kind: BTreeMap<String, u64>,
    /// The most requests in flight at once.
    pub most_at_once: u64,
}

struct Bucket {
    tokens: f64,
    at: Instant,
}

struct Shared {
    config: Config,
    bucket: Mutex<Bucket>,
    tally: Mutex<Tally>,
    in_flight: Mutex<u64>,
}

#[derive(Clone)]
pub struct StandIn {
    shared: Arc<Shared>,
}

pub struct Running {
    pub server: MockServer,
    pub standin: StandIn,
}

impl StandIn {
    pub async fn start(config: Config) -> Running {
        let standin = StandIn {
            shared: Arc::new(Shared {
                bucket: Mutex::new(Bucket {
                    tokens: config.burst,
                    at: Instant::now(),
                }),
                config,
                tally: Mutex::new(Tally::default()),
                in_flight: Mutex::new(0),
            }),
        };
        let server = MockServer::start().await;
        wiremock::Mock::given(wiremock::matchers::any())
            .respond_with(standin.clone())
            .mount(&server)
            .await;
        Running { server, standin }
    }

    pub fn tally(&self) -> Tally {
        self.shared.tally.lock().unwrap().clone()
    }

    /// The newest issue id: issues are numbered in the order they last
    /// changed, so the highest ids are what someone opening Redline cares
    /// about first.
    pub fn newest(&self) -> u64 {
        self.shared.config.issues
    }

    fn take_token(&self) -> Result<(), Duration> {
        let config = &self.shared.config;
        let mut bucket = self.shared.bucket.lock().unwrap();
        let now = Instant::now();
        let refill = now.duration_since(bucket.at).as_secs_f64() * config.per_second;
        bucket.tokens = (bucket.tokens + refill).min(config.burst);
        bucket.at = now;
        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            Ok(())
        } else {
            let missing = (1.0 - bucket.tokens) / config.per_second;
            Err(Duration::from_secs_f64(missing))
        }
    }

    fn answer(&self, request: &Request) -> ResponseTemplate {
        let config = &self.shared.config;
        let path = request.url.path().to_owned();
        let query: BTreeMap<String, String> = request
            .url
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        let offset: u64 = query
            .get("offset")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let limit: u64 = query
            .get("limit")
            .and_then(|v| v.parse().ok())
            .unwrap_or(25);
        let ok = |body: Value| ResponseTemplate::new(200).set_body_json(body);
        let paged = |key: &str, all: Vec<Value>| {
            let total = all.len();
            let items: Vec<Value> = all
                .into_iter()
                .skip(offset as usize)
                .take(limit as usize)
                .collect();
            ok(json!({ key: items, "total_count": total, "offset": offset, "limit": limit }))
        };
        let segments: Vec<&str> = path.trim_matches('/').split('/').collect();
        match segments.as_slice() {
            ["users", "current.json"] => ok(json!({"user": {
                "id": 5, "login": "dev", "firstname": "Dana", "lastname": "Developer",
                "memberships": (1..=5).map(|p| json!({
                    "project": {"id": p, "name": format!("Team {p}")},
                    "roles": [{"id": 4, "name": "Developer"}]
                })).collect::<Vec<_>>()
            }})),
            ["projects.json"] => paged(
                "projects",
                (1..=config.projects)
                    .map(|id| {
                        json!({
                            "id": id, "name": format!("Team {id}"), "identifier": format!("team-{id}"),
                            "enabled_modules": [{"id": id, "name": "issue_tracking"}]
                        })
                    })
                    .collect(),
            ),
            ["issue_statuses.json"] => ok(json!({"issue_statuses": [
                {"id": 1, "name": "New", "is_closed": false},
                {"id": 2, "name": "In Progress", "is_closed": false},
                {"id": 5, "name": "Closed", "is_closed": true}
            ]})),
            ["trackers.json"] => ok(json!({"trackers": [{"id": 1, "name": "Bug"}]})),
            ["enumerations", "issue_priorities.json"] => {
                ok(json!({"issue_priorities": [{"id": 2, "name": "Normal", "is_default": true}]}))
            }
            ["enumerations", "time_entry_activities.json"] => {
                ok(json!({"time_entry_activities": [{"id": 9, "name": "Development"}]}))
            }
            ["roles.json"] => ok(json!({"roles": [{"id": 4, "name": "Developer"}]})),
            ["roles", _] => ok(json!({"role": {
                "id": 4, "name": "Developer", "permissions": ["view_issues", "add_issues", "edit_issues"]
            }})),
            ["queries.json"] => paged("queries", vec![]),
            ["projects", id, "versions.json"] => {
                let id: u64 = id.parse().unwrap_or(0);
                ok(json!({"versions": [{
                    "id": id, "project": {"id": id, "name": format!("Team {id}")},
                    "name": format!("Sprint {id}"), "status": "open"
                }], "total_count": 1}))
            }
            ["projects", id, "memberships.json"] => {
                let id: u64 = id.parse().unwrap_or(0);
                paged(
                    "memberships",
                    vec![json!({
                        "id": id, "project": {"id": id, "name": format!("Team {id}")},
                        "user": {"id": 5, "name": "Dana Developer"},
                        "roles": [{"id": 4, "name": "Developer"}]
                    })],
                )
            }
            ["issues.json"] => paged("issues", self.issues(&query)),
            _ => ResponseTemplate::new(404),
        }
    }

    /// Issues matching Redline's filters, in the order asked for.
    fn issues(&self, query: &BTreeMap<String, String>) -> Vec<Value> {
        let config = &self.shared.config;
        let status = query.get("status_id").map(String::as_str).unwrap_or("open");
        let since = query
            .get("updated_on")
            .and_then(|v| v.strip_prefix(">="))
            .map(str::to_owned);
        let ids: Option<Vec<u64>> = query
            .get("issue_id")
            .map(|v| v.split(',').filter_map(|i| i.parse().ok()).collect());
        let mut found: Vec<u64> = (1..=config.issues)
            .filter(|&id| match status {
                "*" => true,
                "closed" => is_closed(id, config.issues),
                _ => !is_closed(id, config.issues),
            })
            .filter(|&id| {
                since
                    .as_deref()
                    .is_none_or(|s| updated_on(id).as_str() >= s)
            })
            .filter(|id| ids.as_ref().is_none_or(|ids| ids.contains(id)))
            .collect();
        if query
            .get("sort")
            .is_some_and(|s| s.starts_with("updated_on:desc"))
        {
            found.reverse();
        }
        found
            .into_iter()
            .map(|id| issue_json(id, config.issues, config.projects))
            .collect()
    }
}

impl Respond for StandIn {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let kind = kind_of(request.url.path());
        {
            let mut tally = self.shared.tally.lock().unwrap();
            tally.requests += 1;
            *tally.by_kind.entry(kind).or_default() += 1;
            let mut in_flight = self.shared.in_flight.lock().unwrap();
            *in_flight += 1;
            tally.most_at_once = tally.most_at_once.max(*in_flight);
        }
        let answer = match self.take_token() {
            Ok(()) => self.answer(request),
            Err(wait) => {
                self.shared.tally.lock().unwrap().limited += 1;
                let mut refused = ResponseTemplate::new(429);
                if self.shared.config.retry_after {
                    refused = refused.insert_header(
                        "Retry-After",
                        wait.as_secs_f64().ceil().max(1.0).to_string(),
                    );
                }
                refused
            }
        };
        *self.shared.in_flight.lock().unwrap() -= 1;
        answer
    }
}

fn kind_of(path: &str) -> String {
    let mut parts = path.trim_matches('/').rsplit('/');
    let last = parts.next().unwrap_or("").trim_end_matches(".json");
    if last.parse::<u64>().is_ok() {
        // roles/4.json counts as "role".
        parts.next().unwrap_or("").trim_end_matches('s').to_owned()
    } else {
        last.to_owned()
    }
}

/// Most old issues are closed; the newest fifth, and every tenth before
/// that, are open.
pub fn is_closed(id: u64, total: u64) -> bool {
    id <= total * 4 / 5 && id % 10 != 0
}

/// Issues are numbered in the order they last changed, ten minutes apart.
pub fn updated_on(id: u64) -> String {
    let at = chrono::DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z").unwrap()
        + chrono::Duration::minutes(10 * id as i64);
    at.with_timezone(&chrono::Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn issue_json(id: u64, total: u64, projects: u64) -> Value {
    let project = id % projects + 1;
    let (status_id, name, closed) = if is_closed(id, total) {
        (5, "Closed", true)
    } else {
        (1, "New", false)
    };
    json!({
        "id": id,
        "project": {"id": project, "name": format!("Team {project}")},
        "tracker": {"id": 1, "name": "Bug"},
        "status": {"id": status_id, "name": name, "is_closed": closed},
        "priority": {"id": 2, "name": "Normal"},
        "subject": format!("Issue {id}"),
        "created_on": "2026-01-01T00:00:00Z",
        "updated_on": updated_on(id),
        "relations": []
    })
}
