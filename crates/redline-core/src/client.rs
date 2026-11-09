//! A small, polite client for Redmine's REST API.
//!
//! - Authenticates with the signed-in person's API key in the
//!   `X-Redmine-API-Key` header.
//! - Sends at most [`MAX_PARALLEL_REQUESTS`] requests at once, so a small
//!   self-hosted server isn't flooded.
//! - Retries 429 and 503 answers a few times, honouring `Retry-After`.
//! - Pages through lists in Redmine's maximum page size of 100.

use std::sync::Arc;
use std::time::Duration;

use reqwest::{Method, RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::Semaphore;
use url::Url;

use crate::error::{Error, Result};
use crate::models::*;

/// Redmine's largest page size.
pub const PAGE_SIZE: u32 = 100;

/// How many requests Redline sends to one server at the same time.
pub const MAX_PARALLEL_REQUESTS: usize = 4;

const MAX_ATTEMPTS: u32 = 4;
const MAX_RETRY_WAIT: Duration = Duration::from_secs(10);

/// One page of a list, with Redmine's total count.
#[derive(Debug, Clone, PartialEq)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total_count: u64,
    pub offset: u64,
}

/// Filters for listing issues. Everything is optional; the defaults list
/// every issue (open and closed) the user can see, oldest change first.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct IssueQuery {
    pub project_id: Option<u64>,
    /// Only issues updated at or after this time (ISO 8601, UTC).
    pub updated_since: Option<String>,
    /// Only these issue ids.
    pub issue_ids: Vec<u64>,
    /// Extra includes, for example `relations` or `attachments`.
    pub include: Vec<&'static str>,
    /// Only issues the signed-in user watches.
    pub watched_by_me: bool,
    pub offset: u64,
    pub limit: Option<u32>,
}

/// Filters for listing time entries. Everything is optional.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TimeQuery {
    /// A project and, as Redmine does, its sub-projects.
    pub project_id: Option<u64>,
    pub issue_id: Option<u64>,
    pub user_id: Option<u64>,
    /// First day, YYYY-MM-DD.
    pub from: Option<String>,
    /// Last day, YYYY-MM-DD.
    pub to: Option<String>,
}

/// Talks to one Redmine server as one user.
#[derive(Clone)]
pub struct Client {
    base: Url,
    api_key: String,
    http: reqwest::Client,
    gate: Arc<Semaphore>,
    retry_unit: Duration,
}

impl std::fmt::Debug for Client {
    // Never print the API key.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Client")
            .field("base", &self.base.as_str())
            .finish()
    }
}

impl Client {
    /// A client for the Redmine at `server` (for example
    /// `https://redmine.example.com` or `https://example.com/redmine`).
    pub fn new(server: &str, api_key: &str) -> Result<Self> {
        let base = normalize_server_url(server)?;
        let http = reqwest::Client::builder()
            .user_agent(concat!("Redline/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|e| Error::Network(e.to_string()))?;
        Ok(Self {
            base,
            api_key: api_key.trim().to_owned(),
            http,
            gate: Arc::new(Semaphore::new(MAX_PARALLEL_REQUESTS)),
            retry_unit: Duration::from_millis(500),
        })
    }

    /// The server's base URL, always ending in `/`.
    pub fn server_url(&self) -> &Url {
        &self.base
    }

    /// Shortens retry waits, for tests.
    #[doc(hidden)]
    pub fn with_retry_unit(mut self, unit: Duration) -> Self {
        self.retry_unit = unit;
        self
    }

    // ----- Account -------------------------------------------------------

    /// The user the API key belongs to. Use this to check a server address
    /// and key when signing in: its errors say what's wrong in plain words.
    pub async fn current_user(&self) -> Result<User> {
        match self
            .get::<Value>("users/current.json", &[("include", "memberships".into())])
            .await
        {
            Ok(body) => take(body, "user"),
            Err(Error::NotFound) => Err(Error::NotRedmine),
            Err(Error::Forbidden) => Err(Error::RestApiDisabled),
            Err(e) => Err(e),
        }
    }

    // ----- Metadata ------------------------------------------------------

    /// Every project the user can see, with its trackers, categories,
    /// enabled modules and issue custom fields.
    pub async fn projects(&self) -> Result<Vec<Project>> {
        self.get_all(
            "projects.json",
            "projects",
            &[(
                "include",
                "trackers,issue_categories,enabled_modules,issue_custom_fields".into(),
            )],
        )
        .await
    }

    pub async fn issue_statuses(&self) -> Result<Vec<IssueStatus>> {
        take(
            self.get("issue_statuses.json", &[]).await?,
            "issue_statuses",
        )
    }

    pub async fn trackers(&self) -> Result<Vec<Tracker>> {
        take(self.get("trackers.json", &[]).await?, "trackers")
    }

    pub async fn issue_priorities(&self) -> Result<Vec<IssuePriority>> {
        take(
            self.get("enumerations/issue_priorities.json", &[]).await?,
            "issue_priorities",
        )
    }

    /// The kinds of work time can be logged as. Any user may read them.
    pub async fn time_entry_activities(&self) -> Result<Vec<TimeEntryActivity>> {
        take(
            self.get("enumerations/time_entry_activities.json", &[])
                .await?,
            "time_entry_activities",
        )
    }

    /// Time entries matching `query`, newest day first, every page.
    pub async fn time_entries(&self, query: &TimeQuery) -> Result<Vec<TimeEntry>> {
        let mut params = Vec::new();
        if let Some(id) = query.project_id {
            params.push(("project_id", id.to_string()));
        }
        if let Some(id) = query.issue_id {
            params.push(("issue_id", id.to_string()));
        }
        if let Some(id) = query.user_id {
            params.push(("user_id", id.to_string()));
        }
        if let Some(from) = &query.from {
            params.push(("from", from.clone()));
        }
        if let Some(to) = &query.to {
            params.push(("to", to.clone()));
        }
        self.get_all("time_entries.json", "time_entries", &params)
            .await
    }

    pub async fn time_entry(&self, id: u64) -> Result<TimeEntry> {
        take(
            self.get(&format!("time_entries/{id}.json"), &[]).await?,
            "time_entry",
        )
    }

    /// Logs time and returns the entry as Redmine stored it.
    pub async fn create_time_entry(&self, entry: &TimeEntryChanges) -> Result<TimeEntry> {
        let body = self
            .send_json(
                Method::POST,
                "time_entries.json",
                &json!({ "time_entry": entry }),
            )
            .await?;
        take(body, "time_entry")
    }

    pub async fn update_time_entry(&self, id: u64, changes: &TimeEntryChanges) -> Result<()> {
        self.send_json(
            Method::PUT,
            &format!("time_entries/{id}.json"),
            &json!({ "time_entry": changes }),
        )
        .await?;
        Ok(())
    }

    pub async fn delete_time_entry(&self, id: u64) -> Result<()> {
        let url = self.url(&format!("time_entries/{id}.json"))?;
        self.send(|| self.http.delete(url.clone())).await?;
        Ok(())
    }

    pub async fn version(&self, id: u64) -> Result<Version> {
        take(
            self.get(&format!("versions/{id}.json"), &[]).await?,
            "version",
        )
    }

    /// Creates a version in a project and returns it as Redmine stored it.
    pub async fn create_version(
        &self,
        project_id: u64,
        changes: &VersionChanges,
    ) -> Result<Version> {
        let body = self
            .send_json(
                Method::POST,
                &format!("projects/{project_id}/versions.json"),
                &json!({ "version": changes }),
            )
            .await?;
        take(body, "version")
    }

    pub async fn update_version(&self, id: u64, changes: &VersionChanges) -> Result<()> {
        self.send_json(
            Method::PUT,
            &format!("versions/{id}.json"),
            &json!({ "version": changes }),
        )
        .await?;
        Ok(())
    }

    /// Deletes a version. Redmine refuses while issues still use it.
    pub async fn delete_version(&self, id: u64) -> Result<()> {
        let url = self.url(&format!("versions/{id}.json"))?;
        self.send(|| self.http.delete(url.clone())).await?;
        Ok(())
    }

    /// The members of a project. This is how Redline knows who can be
    /// assigned, since listing all users needs an admin key.
    pub async fn memberships(&self, project_id: u64) -> Result<Vec<Membership>> {
        self.get_all(
            &format!("projects/{project_id}/memberships.json"),
            "memberships",
            &[],
        )
        .await
    }

    /// Every role, with its permissions. Roles the server won't describe
    /// are left out.
    pub async fn roles(&self) -> Result<Vec<Role>> {
        let named: Vec<Named> = take(self.get("roles.json", &[]).await?, "roles")?;
        let mut out = Vec::with_capacity(named.len());
        for role in named {
            match self
                .get::<Value>(&format!("roles/{}.json", role.id), &[])
                .await
            {
                Ok(body) => out.push(take(body, "role")?),
                Err(Error::NotFound | Error::Forbidden) => {}
                Err(e) => return Err(e),
            }
        }
        Ok(out)
    }

    /// A project's versions, including ones shared with it.
    pub async fn versions(&self, project_id: u64) -> Result<Vec<Version>> {
        take(
            self.get(&format!("projects/{project_id}/versions.json"), &[])
                .await?,
            "versions",
        )
    }

    /// Saved queries the user can see.
    pub async fn saved_queries(&self) -> Result<Vec<SavedQuery>> {
        self.get_all("queries.json", "queries", &[]).await
    }

    // ----- Issues --------------------------------------------------------

    /// One page of issues, sorted by last update (oldest first) so a sync can
    /// walk forward through changes.
    pub async fn issues(&self, query: &IssueQuery) -> Result<Page<Issue>> {
        let mut params: Vec<(&str, String)> = vec![
            ("status_id", "*".into()),
            ("sort", "updated_on,id".into()),
            ("offset", query.offset.to_string()),
            ("limit", query.limit.unwrap_or(PAGE_SIZE).to_string()),
        ];
        if let Some(project_id) = query.project_id {
            params.push(("project_id", project_id.to_string()));
        }
        if let Some(since) = &query.updated_since {
            params.push(("updated_on", format!(">={since}")));
        }
        if !query.issue_ids.is_empty() {
            let ids: Vec<String> = query.issue_ids.iter().map(u64::to_string).collect();
            params.push(("issue_id", ids.join(",")));
        }
        if !query.include.is_empty() {
            params.push(("include", query.include.join(",")));
        }
        if query.watched_by_me {
            params.push(("watcher_id", "me".into()));
        }
        let body: Value = self.get("issues.json", &params).await?;
        page(body, "issues")
    }

    /// One issue with the given extras, for example
    /// `["journals", "watchers", "children", "allowed_statuses"]`.
    pub async fn issue(&self, id: u64, include: &[&str]) -> Result<Issue> {
        let params: Vec<(&str, String)> = if include.is_empty() {
            Vec::new()
        } else {
            vec![("include", include.join(","))]
        };
        take(
            self.get(&format!("issues/{id}.json"), &params).await?,
            "issue",
        )
    }

    /// Changes an issue. Only the fields set in `changes` are sent.
    pub async fn update_issue(&self, id: u64, changes: &IssueChanges) -> Result<()> {
        self.send_json(
            Method::PUT,
            &format!("issues/{id}.json"),
            &json!({ "issue": changes }),
        )
        .await?;
        Ok(())
    }

    /// Deletes an issue with its sub-issues and the time logged on them.
    /// Needs the "Delete issues" permission.
    pub async fn delete_issue(&self, id: u64) -> Result<()> {
        let url = self.url(&format!("issues/{id}.json"))?;
        self.send(|| self.http.delete(url.clone())).await?;
        Ok(())
    }

    /// Changes a comment's text (Redmine 5.0+). Empty text removes the
    /// comment, and the whole entry when it changed nothing else. Needs
    /// "Edit notes", or "Edit own notes" for the user's own.
    pub async fn update_journal(&self, id: u64, notes: &str) -> Result<()> {
        self.send_json(
            Method::PUT,
            &format!("journals/{id}.json"),
            &json!({ "journal": { "notes": notes } }),
        )
        .await?;
        Ok(())
    }

    /// Creates an issue and returns it as Redmine stored it.
    pub async fn create_issue(&self, fields: &IssueChanges) -> Result<Issue> {
        let body = self
            .send_json(Method::POST, "issues.json", &json!({ "issue": fields }))
            .await?;
        take(body, "issue")
    }

    /// Relates `issue_id` to another issue and returns the relation.
    pub async fn create_relation(&self, issue_id: u64, relation: &NewRelation) -> Result<Relation> {
        let body = self
            .send_json(
                Method::POST,
                &format!("issues/{issue_id}/relations.json"),
                &json!({ "relation": relation }),
            )
            .await?;
        take(body, "relation")
    }

    /// Removes a relation (from both issues).
    pub async fn delete_relation(&self, relation_id: u64) -> Result<()> {
        let url = self.url(&format!("relations/{relation_id}.json"))?;
        self.send(|| self.http.delete(url.clone())).await?;
        Ok(())
    }

    /// Adds a watcher to an issue. Needs the "Add watchers" permission,
    /// even for the user's own subscription.
    pub async fn add_watcher(&self, issue_id: u64, user_id: u64) -> Result<()> {
        self.send_json(
            Method::POST,
            &format!("issues/{issue_id}/watchers.json"),
            &json!({ "user_id": user_id }),
        )
        .await?;
        Ok(())
    }

    /// Removes a watcher from an issue. Needs the "Delete watchers" permission.
    pub async fn remove_watcher(&self, issue_id: u64, user_id: u64) -> Result<()> {
        let url = self.url(&format!("issues/{issue_id}/watchers/{user_id}.json"))?;
        self.send(|| self.http.delete(url.clone())).await?;
        Ok(())
    }

    /// Uploads a file and returns the token to attach it with
    /// [`IssueChanges::uploads`](crate::models::IssueChanges).
    pub async fn upload(&self, filename: &str, bytes: Vec<u8>) -> Result<String> {
        let url = self.url("uploads.json")?;
        let response = self
            .send(|| {
                self.http
                    .post(url.clone())
                    .query(&[("filename", filename)])
                    .header("Content-Type", "application/octet-stream")
                    .body(bytes.clone())
            })
            .await?;
        let body: Value = decode(response).await?;
        body.get("upload")
            .and_then(|u| u.get("token"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or(Error::NotRedmine)
    }

    /// Downloads an attachment's content. Always asks the signed-in server,
    /// whatever host its `content_url` names, so the key goes nowhere else.
    pub async fn download_attachment(&self, attachment_id: u64) -> Result<Vec<u8>> {
        let url = self.url(&format!("attachments/download/{attachment_id}"))?;
        let response = self.send(|| self.http.get(url.clone())).await?;
        let bytes = response
            .bytes()
            .await
            .map_err(|e| Error::Network(e.to_string()))?;
        Ok(bytes.to_vec())
    }

    /// Deletes an attachment. Needs the right to edit the issue.
    pub async fn delete_attachment(&self, attachment_id: u64) -> Result<()> {
        let url = self.url(&format!("attachments/{attachment_id}.json"))?;
        self.send(|| self.http.delete(url.clone())).await?;
        Ok(())
    }

    /// Searches issue subjects, descriptions and comments, newest first.
    /// Returns at most one page (100 hits).
    pub async fn search_issues(&self, query: &str) -> Result<Vec<SearchResult>> {
        let body: Value = self
            .get(
                "search.json",
                &[
                    ("q", query.to_string()),
                    ("issues", "1".into()),
                    ("limit", PAGE_SIZE.to_string()),
                ],
            )
            .await?;
        Ok(page(body, "results")?.items)
    }

    // ----- Plumbing ------------------------------------------------------

    fn url(&self, path: &str) -> Result<Url> {
        self.base
            .join(path.trim_start_matches('/'))
            .map_err(|e| Error::InvalidUrl(e.to_string()))
    }

    async fn get<T: DeserializeOwned>(&self, path: &str, query: &[(&str, String)]) -> Result<T> {
        let url = self.url(path)?;
        let response = self
            .send(|| self.http.get(url.clone()).query(query))
            .await?;
        decode(response).await
    }

    async fn get_all<T: DeserializeOwned>(
        &self,
        path: &str,
        key: &str,
        query: &[(&str, String)],
    ) -> Result<Vec<T>> {
        let mut items = Vec::new();
        let mut offset = 0u64;
        loop {
            let mut params = query.to_vec();
            params.push(("offset", offset.to_string()));
            params.push(("limit", PAGE_SIZE.to_string()));
            let body: Value = self.get(path, &params).await?;
            let page: Page<T> = page(body, key)?;
            let fetched = page.items.len() as u64;
            items.extend(page.items);
            offset += fetched;
            // Endpoints that don't page send no total_count; one page is all.
            if fetched == 0 || offset >= page.total_count {
                break;
            }
        }
        Ok(items)
    }

    async fn send_json(&self, method: Method, path: &str, body: &impl Serialize) -> Result<Value> {
        let url = self.url(path)?;
        let response = self
            .send(|| self.http.request(method.clone(), url.clone()).json(body))
            .await?;
        // PUT answers 204 No Content.
        if response.status() == StatusCode::NO_CONTENT {
            return Ok(Value::Null);
        }
        let text = response
            .text()
            .await
            .map_err(|e| Error::Network(e.to_string()))?;
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text).map_err(|_| Error::NotRedmine)
    }

    /// Sends a request built by `build`, with the API key, the concurrency
    /// limit and retries for 429 and 503. Maps error statuses to [`Error`].
    async fn send(&self, build: impl Fn() -> RequestBuilder) -> Result<Response> {
        let mut attempt = 0;
        loop {
            attempt += 1;
            let response = {
                let _permit = self
                    .gate
                    .acquire()
                    .await
                    .expect("semaphore is never closed");
                build()
                    .header("X-Redmine-API-Key", &self.api_key)
                    .header("Accept", "application/json")
                    .send()
                    .await
                    .map_err(network_error)?
            };
            let status = response.status();
            if status.is_success() {
                return Ok(response);
            }
            if matches!(
                status,
                StatusCode::TOO_MANY_REQUESTS | StatusCode::SERVICE_UNAVAILABLE
            ) {
                if attempt >= MAX_ATTEMPTS {
                    return Err(Error::Busy);
                }
                let wait = retry_after(&response)
                    .unwrap_or(self.retry_unit * 2u32.pow(attempt - 1))
                    .min(MAX_RETRY_WAIT);
                tokio::time::sleep(wait).await;
                continue;
            }
            return Err(status_error(response).await);
        }
    }
}

/// Accepts what people paste: missing scheme, trailing slashes, a link to a
/// page inside Redmine. Keeps a sub-path such as `/redmine`.
pub fn normalize_server_url(input: &str) -> Result<Url> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(Error::InvalidUrl("the address is empty".into()));
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_owned()
    } else {
        format!("https://{trimmed}")
    };
    let mut url = Url::parse(&with_scheme).map_err(|e| Error::InvalidUrl(e.to_string()))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(Error::InvalidUrl(trimmed.to_owned()));
    }
    url.set_query(None);
    url.set_fragment(None);
    // Drop well-known Redmine page paths someone might paste.
    let mut path = url.path().trim_end_matches('/').to_owned();
    for page in ["/my/page", "/my/account", "/login", "/projects", "/issues"] {
        if let Some(idx) = path.find(page) {
            path.truncate(idx);
            break;
        }
    }
    url.set_path(&format!("{path}/"));
    Ok(url)
}

fn network_error(e: reqwest::Error) -> Error {
    if e.is_decode() {
        Error::NotRedmine
    } else {
        Error::Network(e.without_url().to_string())
    }
}

fn retry_after(response: &Response) -> Option<Duration> {
    response
        .headers()
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
        .map(Duration::from_secs)
}

async fn status_error(response: Response) -> Error {
    match response.status() {
        StatusCode::UNAUTHORIZED => Error::Unauthorized,
        StatusCode::FORBIDDEN => Error::Forbidden,
        StatusCode::NOT_FOUND => Error::NotFound,
        StatusCode::UNPROCESSABLE_ENTITY => {
            let messages = response
                .json::<Value>()
                .await
                .ok()
                .and_then(|v| v.get("errors").cloned())
                .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok())
                .unwrap_or_default();
            Error::Rejected(messages)
        }
        other => Error::Http(other.as_u16()),
    }
}

async fn decode<T: DeserializeOwned>(response: Response) -> Result<T> {
    let is_json = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("json"));
    let text = response
        .text()
        .await
        .map_err(|e| Error::Network(e.to_string()))?;
    if !is_json && !text.trim_start().starts_with('{') {
        return Err(Error::NotRedmine);
    }
    serde_json::from_str(&text).map_err(|e| Error::Decode(e.to_string()))
}

/// Takes `body[key]` and decodes it.
fn take<T: DeserializeOwned>(mut body: Value, key: &str) -> Result<T> {
    let value = body
        .get_mut(key)
        .map(Value::take)
        .ok_or(Error::NotRedmine)?;
    serde_json::from_value(value).map_err(|e| Error::Decode(e.to_string()))
}

fn page<T: DeserializeOwned>(body: Value, key: &str) -> Result<Page<T>> {
    let total_count = body.get("total_count").and_then(Value::as_u64);
    let offset = body.get("offset").and_then(Value::as_u64).unwrap_or(0);
    let items: Vec<T> = take(body, key)?;
    Ok(Page {
        total_count: total_count.unwrap_or(offset + items.len() as u64),
        offset,
        items,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_pasted_addresses() {
        let cases = [
            ("redmine.example.com", "https://redmine.example.com/"),
            (
                "https://redmine.example.com/",
                "https://redmine.example.com/",
            ),
            ("http://localhost:3000", "http://localhost:3000/"),
            (
                "https://example.com/redmine",
                "https://example.com/redmine/",
            ),
            (
                "https://example.com/redmine/issues/12?x=1#note-2",
                "https://example.com/redmine/",
            ),
            ("https://example.com/my/page", "https://example.com/"),
        ];
        for (input, expected) in cases {
            assert_eq!(
                normalize_server_url(input).unwrap().as_str(),
                expected,
                "{input}"
            );
        }
    }

    #[test]
    fn rejects_non_web_addresses() {
        assert!(normalize_server_url("").is_err());
        assert!(normalize_server_url("ftp://example.com").is_err());
    }

    #[test]
    fn debug_output_hides_the_key() {
        let client = Client::new("https://example.com", "secret-key").unwrap();
        assert!(!format!("{client:?}").contains("secret-key"));
    }
}
