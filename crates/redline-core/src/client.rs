//! A small, polite client for Redmine's REST API.
//!
//! - Authenticates with the signed-in person's API key in the
//!   `X-Redmine-API-Key` header, plus any username and custom headers the
//!   server's proxy needs (see [`ConnectionOptions`]).
//! - Follows redirects only within the same server, so the key and headers
//!   never go to another host.
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

use crate::connection::ConnectionOptions;
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
        Self::with_options(server, api_key, &ConnectionOptions::default())
    }

    /// A client that also sends `options`' username and custom headers on
    /// every request. Fails with [`Error::InvalidHeader`] if one can't be
    /// sent.
    pub fn with_options(server: &str, api_key: &str, options: &ConnectionOptions) -> Result<Self> {
        let base = normalize_server_url(server)?;
        let headers = options.header_map()?;
        let http = reqwest::Client::builder()
            .user_agent(concat!("Redline/", env!("CARGO_PKG_VERSION")))
            .default_headers(headers)
            .redirect(same_origin_redirects())
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

    /// Checks that Redmine still accepts the API key, with the smallest
    /// request that can tell. Redmine treats a key it doesn't know (revoked,
    /// regenerated, or its user locked) as an anonymous visitor: lists answer
    /// 200 with only public data, often nothing, so a sync alone can't tell.
    /// Only the current-user endpoint refuses with 401.
    pub async fn check_key(&self) -> Result<()> {
        match self.get::<Value>("users/current.json", &[]).await {
            Ok(_) => Ok(()),
            Err(Error::NotFound) => Err(Error::NotRedmine),
            Err(Error::Forbidden) => Err(Error::RestApiDisabled),
            Err(e) => Err(e),
        }
    }

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

    /// Another user, with what Redmine shows of them to this user: names
    /// always, the email unless they hide it. Users who share no project
    /// with this user aren't found.
    pub async fn user(&self, id: u64) -> Result<User> {
        take(self.get(&format!("users/{id}.json"), &[]).await?, "user")
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

    /// Creates a project, such as a sub-team. Needs "Add subprojects" in the
    /// parent, or "Create project" for a top-level one.
    pub async fn create_project(&self, fields: &ProjectChanges) -> Result<Project> {
        let body = self
            .send_json(Method::POST, "projects.json", &json!({ "project": fields }))
            .await?;
        take(body, "project")
    }

    /// Changes a project's name, description, homepage or visibility. Needs
    /// "Edit project".
    pub async fn update_project(&self, id: u64, changes: &ProjectChanges) -> Result<()> {
        self.send_json(
            Method::PUT,
            &format!("projects/{id}.json"),
            &json!({ "project": changes }),
        )
        .await?;
        Ok(())
    }

    /// Closes a project and its sub-projects (read-only in Redmine), or
    /// reopens them. Needs "Close / reopen the project".
    pub async fn set_project_closed(&self, id: u64, closed: bool) -> Result<()> {
        let action = if closed { "close" } else { "reopen" };
        let url = self.url(&format!("projects/{id}/{action}.json"))?;
        self.send(|| self.http.put(url.clone())).await?;
        Ok(())
    }

    /// Deletes a project with everything in it. Needs "Delete project".
    pub async fn delete_project(&self, id: u64) -> Result<()> {
        let url = self.url(&format!("projects/{id}.json"))?;
        self.send(|| self.http.delete(url.clone())).await?;
        Ok(())
    }

    /// Deletes a version. Redmine refuses while issues still use it.
    pub async fn delete_version(&self, id: u64) -> Result<()> {
        let url = self.url(&format!("versions/{id}.json"))?;
        self.send(|| self.http.delete(url.clone())).await?;
        Ok(())
    }

    // ----- Wiki ----------------------------------------------------------

    /// Every page of a project's wiki, without their text.
    pub async fn wiki_index(&self, project_id: u64) -> Result<Vec<WikiPage>> {
        take(
            self.get(&format!("projects/{project_id}/wiki/index.json"), &[])
                .await?,
            "wiki_pages",
        )
    }

    /// One wiki page with its text and attachments: its latest version, or
    /// an older one (which needs "View wiki history"). With no title, the
    /// wiki's start page.
    pub async fn wiki_page(
        &self,
        project_id: u64,
        title: Option<&str>,
        version: Option<u64>,
    ) -> Result<WikiPage> {
        let url = match title {
            Some(title) => self.wiki_url(project_id, title, version)?,
            None => self.url(&format!("projects/{project_id}/wiki.json"))?,
        };
        let response = self
            .send(|| {
                self.http
                    .get(url.clone())
                    .query(&[("include", "attachments")])
            })
            .await?;
        take(decode(response).await?, "wiki_page")
    }

    /// Saves a wiki page, creating it when the title is new.
    pub async fn save_wiki_page(
        &self,
        project_id: u64,
        title: &str,
        changes: &WikiPageChanges,
    ) -> Result<()> {
        let url = self.wiki_url(project_id, title, None)?;
        let body = json!({ "wiki_page": changes });
        match self.send(|| self.http.put(url.clone()).json(&body)).await {
            Ok(_) => Ok(()),
            // Redmine answers 409 when the page changed since `version`.
            Err(Error::Http(409)) => Err(Error::Rejected(vec![
                "Someone else saved this page while you were editing it. Copy your text, reload the page and edit it again.".into(),
            ])),
            Err(e) => Err(e),
        }
    }

    /// Deletes a wiki page. Its sub-pages are deleted with it, or move up
    /// to the top of the wiki.
    pub async fn delete_wiki_page(
        &self,
        project_id: u64,
        title: &str,
        with_children: bool,
    ) -> Result<()> {
        let url = self.wiki_url(project_id, title, None)?;
        let todo = if with_children { "destroy" } else { "nullify" };
        self.send(|| self.http.delete(url.clone()).query(&[("todo", todo)]))
            .await?;
        Ok(())
    }

    /// `projects/:id/wiki/:title.json`, or `…/:title/:version.json`, with the
    /// title escaped as one path segment.
    fn wiki_url(&self, project_id: u64, title: &str, version: Option<u64>) -> Result<Url> {
        let mut url = self.url(&format!("projects/{project_id}/wiki/"))?;
        {
            let mut path = url
                .path_segments_mut()
                .map_err(|_| Error::InvalidUrl(self.base.to_string()))?;
            path.pop_if_empty();
            match version {
                Some(v) => {
                    path.push(title).push(&format!("{v}.json"));
                }
                None => {
                    path.push(&format!("{title}.json"));
                }
            }
        }
        Ok(url)
    }

    // ----- News ----------------------------------------------------------

    /// One page of news, newest first: a project's, or across every project
    /// the user can see.
    pub async fn news(&self, project_id: Option<u64>, offset: u64) -> Result<Page<News>> {
        let path = match project_id {
            Some(id) => format!("projects/{id}/news.json"),
            None => "news.json".to_string(),
        };
        let body: Value = self
            .get(
                &path,
                &[
                    ("offset", offset.to_string()),
                    ("limit", PAGE_SIZE.to_string()),
                ],
            )
            .await?;
        page(body, "news")
    }

    /// One news post with its comments and attachments.
    pub async fn news_item(&self, id: u64) -> Result<News> {
        take(
            self.get(
                &format!("news/{id}.json"),
                &[("include", "comments,attachments".into())],
            )
            .await?,
            "news",
        )
    }

    /// Posts news in a project. Needs "Manage news". Redmine answers with no
    /// body, so the new post is found by reading the project's news again.
    pub async fn create_news(&self, project_id: u64, changes: &NewsChanges) -> Result<()> {
        self.send_json(
            Method::POST,
            &format!("projects/{project_id}/news.json"),
            &json!({ "news": changes }),
        )
        .await?;
        Ok(())
    }

    /// Changes a news post. Needs "Manage news".
    pub async fn update_news(&self, id: u64, changes: &NewsChanges) -> Result<()> {
        self.send_json(
            Method::PUT,
            &format!("news/{id}.json"),
            &json!({ "news": changes }),
        )
        .await?;
        Ok(())
    }

    /// Deletes a news post. Needs "Manage news".
    pub async fn delete_news(&self, id: u64) -> Result<()> {
        let url = self.url(&format!("news/{id}.json"))?;
        self.send(|| self.http.delete(url.clone())).await?;
        Ok(())
    }

    // ----- Files ---------------------------------------------------------

    /// The files in a project's Files area, the project's own and its
    /// versions'.
    pub async fn files(&self, project_id: u64) -> Result<Vec<ProjectFile>> {
        take(
            self.get(&format!("projects/{project_id}/files.json"), &[])
                .await?,
            "files",
        )
    }

    /// Adds an uploaded file (see [`Client::upload`]) to a project's Files,
    /// under one of its versions or the whole project. Needs "Manage files".
    pub async fn add_file(
        &self,
        project_id: u64,
        token: &str,
        filename: &str,
        version_id: Option<u64>,
        description: Option<&str>,
    ) -> Result<()> {
        let mut file = json!({ "token": token, "filename": filename });
        if let Some(v) = version_id {
            file["version_id"] = json!(v);
        }
        if let Some(d) = description.filter(|d| !d.is_empty()) {
            file["description"] = json!(d);
        }
        self.send_json(
            Method::POST,
            &format!("projects/{project_id}/files.json"),
            &json!({ "file": file }),
        )
        .await?;
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
    ///
    /// When two changes land at once, for example on sub-issues of the same
    /// parent, Redmine may find the parent changed under it and answer 422
    /// with no messages. The change sent never names a version, so sending it
    /// again is safe; it's tried twice more before giving up.
    pub async fn update_issue(&self, id: u64, changes: &IssueChanges) -> Result<()> {
        let body = json!({ "issue": changes });
        let path = format!("issues/{id}.json");
        let mut attempt = 0u32;
        loop {
            match self.send_json(Method::PUT, &path, &body).await {
                Err(Error::Rejected(messages)) if messages.is_empty() && attempt < 2 => {
                    attempt += 1;
                    tokio::time::sleep(self.retry_unit * attempt).await;
                }
                other => return other.map(|_| ()),
            }
        }
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

    /// The saved issue queries the user can see.
    pub async fn queries(&self) -> Result<Vec<Query>> {
        self.get_all("queries.json", "queries", &[]).await
    }

    /// One page of the issues a saved query finds, in the query's own order.
    /// The query sets the filters, status and sort; a project query needs
    /// its project.
    pub async fn query_issues(
        &self,
        query_id: u64,
        project_id: Option<u64>,
        offset: u64,
    ) -> Result<Page<Issue>> {
        let mut params: Vec<(&str, String)> = vec![
            ("query_id", query_id.to_string()),
            ("offset", offset.to_string()),
            ("limit", PAGE_SIZE.to_string()),
        ];
        if let Some(project_id) = project_id {
            params.push(("project_id", project_id.to_string()));
        }
        let body: Value = self.get("issues.json", &params).await?;
        page(body, "issues")
    }

    /// One page of what Redmine search finds for the text, newest first:
    /// issues, wiki pages, news, documents, forum messages, changesets and
    /// projects, as far as the user may see them. A scope narrows it to one
    /// project and to some kinds.
    ///
    /// Redmine searches every kind when none of the asked kinds is open to
    /// the user, so hits of other kinds are dropped here, and the total then
    /// counts only what was kept.
    pub async fn search(
        &self,
        text: &str,
        offset: u64,
        limit: u32,
        scope: &SearchScope,
    ) -> Result<Page<SearchResult>> {
        let mut query = vec![
            ("q", text.to_string()),
            ("offset", offset.to_string()),
            ("limit", limit.to_string()),
        ];
        for kind in &scope.kinds {
            query.push((kind.param(), "1".into()));
        }
        let path = match scope.project_id {
            Some(id) => format!("projects/{id}/search.json"),
            None => "search.json".into(),
        };
        let body: Value = self.get(&path, &query).await?;
        let mut page: Page<SearchResult> = page(body, "results")?;
        if !scope.kinds.is_empty() {
            let before = page.items.len();
            page.items
                .retain(|r| scope.kinds.iter().any(|k| k.matches(&r.kind)));
            if page.items.len() != before {
                page.total_count = offset + page.items.len() as u64;
            }
        }
        Ok(page)
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

/// Follows up to 10 redirects that stay on the same scheme, host and port.
/// A redirect elsewhere (a single sign-on page, say) stops there and its
/// answer is treated like any other, so the key never leaves the server.
fn same_origin_redirects() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        let same = attempt
            .previous()
            .first()
            .is_some_and(|first| first.origin() == attempt.url().origin());
        if attempt.previous().len() >= 10 || !same {
            attempt.stop()
        } else {
            attempt.follow()
        }
    })
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
        // Redmine answers a wrong key with an empty JSON 401, or asks for its
        // own realm. A proxy asks for another realm or sends a web page.
        StatusCode::UNAUTHORIZED => {
            let challenge = response
                .headers()
                .get(reqwest::header::WWW_AUTHENTICATE)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);
            let from_redmine = match challenge {
                Some(c) => c.contains("Redmine"),
                None => !looks_like_html(response).await,
            };
            if from_redmine {
                Error::Unauthorized
            } else {
                Error::Refused(401)
            }
        }
        // Redmine answers 403 with an empty or JSON body. A page of HTML is
        // a proxy's.
        StatusCode::FORBIDDEN => {
            if looks_like_html(response).await {
                Error::Refused(403)
            } else {
                Error::Forbidden
            }
        }
        StatusCode::PROXY_AUTHENTICATION_REQUIRED => Error::Refused(407),
        // A redirect to another host, which Redline doesn't follow: usually
        // a single sign-on page in front of Redmine.
        s if s.is_redirection() => Error::Refused(s.as_u16()),
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

async fn looks_like_html(response: Response) -> bool {
    let html_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("html"));
    let text = response.text().await.unwrap_or_default();
    let body = text.trim_start();
    !body.is_empty() && (html_type || body.starts_with('<'))
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
