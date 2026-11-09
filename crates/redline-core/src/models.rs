//! Redmine REST API objects, as Redmine sends them.
//!
//! Field names follow Redmine's JSON. Everything a server might leave out
//! (older versions, disabled modules, missing permissions) is optional, so one
//! set of types works with any Redmine.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A reference to another object: `{"id": 1, "name": "Web"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Named {
    pub id: u64,
    #[serde(default)]
    pub name: String,
}

/// A parent issue reference: `{"id": 12}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdRef {
    pub id: u64,
}

/// The signed-in user, from `/users/current.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct User {
    pub id: u64,
    #[serde(default)]
    pub login: String,
    #[serde(default)]
    pub firstname: String,
    #[serde(default)]
    pub lastname: String,
    #[serde(default)]
    pub mail: Option<String>,
    #[serde(default)]
    pub admin: bool,
    #[serde(default)]
    pub created_on: Option<String>,
    /// Shown to admins and to the user themselves.
    #[serde(default)]
    pub last_login_on: Option<String>,
    /// The user's own memberships, including roles from groups, with
    /// `include=memberships`. Tells Redline what the user may do where.
    #[serde(default)]
    pub memberships: Vec<UserMembership>,
}

/// One project the signed-in user belongs to, and their roles there.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserMembership {
    pub project: Named,
    #[serde(default)]
    pub roles: Vec<Named>,
}

/// A role and its permissions, from `/roles/:id.json`. Any user may read
/// these; Redline uses them to offer only what Redmine will allow.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Role {
    pub id: u64,
    pub name: String,
    #[serde(default)]
    pub permissions: Vec<String>,
}

impl User {
    /// The display name Redmine would show, "First Last", or the login.
    pub fn display_name(&self) -> String {
        let name = format!("{} {}", self.firstname, self.lastname);
        let name = name.trim();
        if name.is_empty() {
            self.login.clone()
        } else {
            name.to_owned()
        }
    }
}

/// An issue status, from `/issue_statuses.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IssueStatus {
    pub id: u64,
    pub name: String,
    #[serde(default)]
    pub is_closed: bool,
}

/// A tracker (Redline shows it as the issue type), from `/trackers.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tracker {
    pub id: u64,
    pub name: String,
    #[serde(default)]
    pub default_status: Option<Named>,
    /// The standard fields the tracker uses, like `category_id` or
    /// `estimated_hours`. Missing from older servers, where every field is on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled_standard_fields: Option<Vec<String>>,
}

/// An issue priority, from `/enumerations/issue_priorities.json`, in the
/// server's order (lowest first on a default install).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IssuePriority {
    pub id: u64,
    pub name: String,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default = "default_true")]
    pub active: bool,
}

/// A kind of work time can be logged as, like Design or Development.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TimeEntryActivity {
    pub id: u64,
    pub name: String,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default = "default_true")]
    pub active: bool,
}

/// Time someone logged, on an issue or on a project.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TimeEntry {
    pub id: u64,
    pub project: Named,
    #[serde(default)]
    pub issue: Option<IssueRef>,
    pub user: Named,
    pub activity: Named,
    pub hours: f64,
    #[serde(default)]
    pub comments: Option<String>,
    /// The day the time was spent, YYYY-MM-DD.
    pub spent_on: String,
    #[serde(default)]
    pub created_on: Option<String>,
    #[serde(default)]
    pub updated_on: Option<String>,
}

/// An issue a time entry belongs to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IssueRef {
    pub id: u64,
}

/// Fields to set when logging or changing time. Only `Some` fields are sent.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TimeEntryChanges {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spent_on: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hours: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comments: Option<String>,
}

/// Fields to set when creating or changing a version. Only `Some` fields are
/// sent; an empty string clears a date or text field.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct VersionChanges {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// "open", "locked" or "closed".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sharing: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wiki_page_title: Option<String>,
}

/// Fields to set when creating or changing a project (a team). Only `Some`
/// fields are sent; an empty string clears a text field.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ProjectChanges {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Set once, when the project is created.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identifier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_public: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<u64>,
    /// Whether a new sub-project takes its parent's members.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inherit_members: Option<bool>,
}

fn default_true() -> bool {
    true
}

/// A custom field that applies to a project's issues
/// (`include=issue_custom_fields` on a project).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectCustomField {
    pub id: u64,
    pub name: String,
}

/// A project (Redline shows top-level projects as teams).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub id: u64,
    pub name: String,
    pub identifier: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub parent: Option<Named>,
    /// 1 active, 5 closed, 9 archived.
    #[serde(default)]
    pub status: Option<u8>,
    #[serde(default)]
    pub is_public: Option<bool>,
    #[serde(default)]
    pub trackers: Vec<Named>,
    #[serde(default)]
    pub issue_categories: Vec<Named>,
    #[serde(default)]
    pub enabled_modules: Vec<Named>,
    #[serde(default)]
    pub issue_custom_fields: Vec<ProjectCustomField>,
    #[serde(default)]
    pub created_on: Option<String>,
    #[serde(default)]
    pub updated_on: Option<String>,
}

/// A project membership: a user or group and their roles.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Membership {
    pub id: u64,
    pub project: Named,
    #[serde(default)]
    pub user: Option<Named>,
    #[serde(default)]
    pub group: Option<Named>,
    #[serde(default)]
    pub roles: Vec<Named>,
}

/// A project version (Redline shows versions as cycles).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Version {
    pub id: u64,
    pub project: Named,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// "open", "locked" or "closed".
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub due_date: Option<String>,
    /// "none", "descendants", "hierarchy", "tree" or "system".
    #[serde(default)]
    pub sharing: Option<String>,
    /// The wiki page that describes the version, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wiki_page_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimated_hours: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spent_hours: Option<f64>,
    #[serde(default)]
    pub created_on: Option<String>,
    #[serde(default)]
    pub updated_on: Option<String>,
}

/// A custom field value on an issue. `value` is a string, an array of strings
/// for multi-value fields, or null.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CustomFieldValue {
    pub id: u64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub multiple: bool,
    #[serde(default)]
    pub value: Value,
}

impl CustomFieldValue {
    /// The value as a list of strings, whatever its shape.
    pub fn values(&self) -> Vec<String> {
        match &self.value {
            Value::Array(items) => items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .filter(|v| !v.is_empty())
                .collect(),
            Value::String(s) if !s.is_empty() => vec![s.clone()],
            _ => Vec::new(),
        }
    }
}

/// One changed property in a journal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JournalDetail {
    /// "attr", "cf", "attachment" or "relation".
    pub property: String,
    pub name: String,
    #[serde(default)]
    pub old_value: Option<String>,
    #[serde(default)]
    pub new_value: Option<String>,
}

/// A journal: a comment, a set of changes, or both.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Journal {
    pub id: u64,
    #[serde(default)]
    pub user: Option<Named>,
    #[serde(default)]
    pub notes: Option<String>,
    pub created_on: String,
    #[serde(default)]
    pub updated_on: Option<String>,
    #[serde(default)]
    pub private_notes: bool,
    #[serde(default)]
    pub details: Vec<JournalDetail>,
}

/// An issue status as it appears on an issue. `is_closed` is only sent by
/// newer servers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IssueStatusRef {
    pub id: u64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub is_closed: Option<bool>,
}

/// An attachment on an issue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Attachment {
    pub id: u64,
    pub filename: String,
    #[serde(default)]
    pub filesize: u64,
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub content_url: Option<String>,
    #[serde(default)]
    pub author: Option<Named>,
    #[serde(default)]
    pub created_on: Option<String>,
}

/// A file uploaded to Redmine, to attach with an issue change.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Upload {
    pub token: String,
    pub filename: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
}

/// A relation between two issues.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Relation {
    pub id: u64,
    pub issue_id: u64,
    pub issue_to_id: u64,
    pub relation_type: String,
    #[serde(default)]
    pub delay: Option<i64>,
}

/// A relation to create. Redmine shows it on both issues, and stores an
/// inverse type the other way round (`blocked` becomes the other's `blocks`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NewRelation {
    pub issue_to_id: u64,
    pub relation_type: String,
    /// Days between the two issues, for `precedes` and `follows`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay: Option<i64>,
}

/// The parent of a wiki page: `{"title": "Wiki"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WikiParent {
    pub title: String,
}

/// A wiki page. The index (`/projects/:id/wiki/index.json`) leaves out the
/// text, author and comments; one page (`/projects/:id/wiki/:title.json`)
/// has them, and its attachments when asked.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WikiPage {
    /// Redmine's title, with underscores for spaces, like `Release_checklist`.
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<WikiParent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Starts at 1 and goes up with each saved edit.
    #[serde(default)]
    pub version: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<Named>,
    /// The comment saved with this version.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comments: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_on: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_on: Option<String>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}

/// What to save to a wiki page. Saving to a title that doesn't exist yet
/// creates the page.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct WikiPageChanges {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comments: Option<String>,
    /// The version the edit started from. Redmine refuses the save when the
    /// page has moved on since, so one edit doesn't silently undo another.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<u64>,
    /// The parent page's title; empty moves the page to the top. Changing it
    /// on an existing page needs "Rename wiki pages".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_title: Option<String>,
}

/// One hit from Redmine's search (`/search.json`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: u64,
    pub title: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub datetime: Option<String>,
}

/// A saved issue query (Redmine calls them custom queries) that the user can
/// see: their own, and public ones. A query that belongs to a project runs
/// in that project.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Query {
    pub id: u64,
    pub name: String,
    #[serde(default)]
    pub is_public: bool,
    #[serde(default)]
    pub project_id: Option<u64>,
}

/// One page of a list, as the UI reads it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Found<T> {
    pub items: Vec<T>,
    /// How many there are in all, which can be more than `items`.
    pub total: u64,
}

/// A Redmine issue. Lists include the core fields; a single issue can also
/// carry journals, watchers, children and allowed statuses when asked.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Issue {
    pub id: u64,
    pub project: Named,
    pub tracker: Named,
    pub status: IssueStatusRef,
    pub priority: Named,
    #[serde(default)]
    pub author: Option<Named>,
    #[serde(default)]
    pub assigned_to: Option<Named>,
    #[serde(default)]
    pub category: Option<Named>,
    #[serde(default)]
    pub fixed_version: Option<Named>,
    #[serde(default)]
    pub parent: Option<IdRef>,
    pub subject: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub done_ratio: Option<u8>,
    #[serde(default)]
    pub is_private: bool,
    #[serde(default)]
    pub estimated_hours: Option<f64>,
    /// Time logged on the issue itself; only for roles that may see time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spent_hours: Option<f64>,
    /// With its sub-issues.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_spent_hours: Option<f64>,
    #[serde(default)]
    pub custom_fields: Vec<CustomFieldValue>,
    pub created_on: String,
    pub updated_on: String,
    #[serde(default)]
    pub closed_on: Option<String>,
    #[serde(default)]
    pub journals: Option<Vec<Journal>>,
    #[serde(default)]
    pub watchers: Option<Vec<Named>>,
    #[serde(default)]
    pub children: Option<Vec<Value>>,
    #[serde(default)]
    pub attachments: Option<Vec<Attachment>>,
    #[serde(default)]
    pub relations: Option<Vec<Relation>>,
    #[serde(default)]
    pub allowed_statuses: Option<Vec<IssueStatusRef>>,
}

/// A saved issue query, from `/queries.json`. Redmine only exposes its id and
/// name, so Redline can run it but not read or edit its filters.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedQuery {
    pub id: u64,
    pub name: String,
    #[serde(default)]
    pub is_public: bool,
    #[serde(default)]
    pub project_id: Option<u64>,
}

/// Fields to set when creating or updating an issue. Only fields that are
/// `Some` are sent, so an update never overwrites what it didn't change.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct IssueChanges {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracker_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// `Some(None)` clears the assignee.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_clearable",
        deserialize_with = "deserialize_clearable"
    )]
    pub assigned_to_id: Option<Option<u64>>,
    /// `Some(None)` clears the version.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_clearable",
        deserialize_with = "deserialize_clearable"
    )]
    pub fixed_version_id: Option<Option<u64>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_clearable",
        deserialize_with = "deserialize_clearable"
    )]
    pub parent_issue_id: Option<Option<u64>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_clearable",
        deserialize_with = "deserialize_clearable"
    )]
    pub due_date: Option<Option<String>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_clearable",
        deserialize_with = "deserialize_clearable"
    )]
    pub start_date: Option<Option<String>>,
    /// `Some(None)` clears the category.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_clearable",
        deserialize_with = "deserialize_clearable"
    )]
    pub category_id: Option<Option<u64>>,
    /// `Some(None)` clears the estimate.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_clearable",
        deserialize_with = "deserialize_clearable"
    )]
    pub estimated_hours: Option<Option<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done_ratio: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_private: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_fields: Option<Vec<CustomFieldChange>>,
    /// A comment to add with the change.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_notes: Option<bool>,
    /// Files uploaded with [`crate::Client::upload`] to attach.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uploads: Option<Vec<Upload>>,
}

/// A custom field value to set. Use an array for multi-value fields.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CustomFieldChange {
    pub id: u64,
    pub value: Value,
}

/// A present `null` means "clear this field": `Some(None)`.
fn deserialize_clearable<'de, T, D>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

/// Redmine clears a field when it's sent as an empty string.
fn serialize_clearable<T, S>(value: &Option<Option<T>>, s: S) -> Result<S::Ok, S::Error>
where
    T: Serialize,
    S: serde::Serializer,
{
    match value {
        Some(Some(v)) => v.serialize(s),
        _ => s.serialize_str(""),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_an_issue_from_redmine_7() {
        let issue: Issue = serde_json::from_value(json!({
            "id": 9,
            "project": {"id": 2, "name": "Mobile"},
            "tracker": {"id": 1, "name": "Bug"},
            "status": {"id": 1, "name": "New", "is_closed": false},
            "priority": {"id": 1, "name": "Low"},
            "author": {"id": 6, "name": "Sam Teammate"},
            "subject": "Offline mode",
            "description": null,
            "start_date": null,
            "due_date": null,
            "done_ratio": 0,
            "is_private": false,
            "estimated_hours": null,
            "custom_fields": [
                {"id": 1, "name": "Area", "multiple": true, "value": ["UI", "Sync"]},
                {"id": 2, "name": "Size", "value": null}
            ],
            "created_on": "2026-11-09T03:35:32Z",
            "updated_on": "2026-11-09T03:35:32Z",
            "closed_on": null
        }))
        .unwrap();
        assert_eq!(issue.status.is_closed, Some(false));
        assert_eq!(issue.custom_fields[0].values(), vec!["UI", "Sync"]);
        assert!(issue.custom_fields[1].values().is_empty());
        assert!(issue.assigned_to.is_none());
    }

    #[test]
    fn parses_an_issue_from_an_older_server() {
        // Older servers send no is_closed on the status and no done_ratio.
        let issue: Issue = serde_json::from_value(json!({
            "id": 1,
            "project": {"id": 1, "name": "Web"},
            "tracker": {"id": 1, "name": "Bug"},
            "status": {"id": 1, "name": "New"},
            "priority": {"id": 2, "name": "Normal"},
            "subject": "Old",
            "created_on": "2019-01-01T00:00:00Z",
            "updated_on": "2019-01-01T00:00:00Z"
        }))
        .unwrap();
        assert_eq!(issue.status.is_closed, None);
    }

    #[test]
    fn changes_send_only_what_was_set() {
        let changes = IssueChanges {
            status_id: Some(2),
            assigned_to_id: Some(None),
            ..Default::default()
        };
        assert_eq!(
            serde_json::to_value(&changes).unwrap(),
            json!({"status_id": 2, "assigned_to_id": ""})
        );
    }

    #[test]
    fn changes_from_the_ui_distinguish_clear_from_unchanged() {
        let changes: IssueChanges =
            serde_json::from_value(json!({"assigned_to_id": null, "status_id": 3})).unwrap();
        assert_eq!(changes.assigned_to_id, Some(None));
        assert_eq!(changes.fixed_version_id, None);
        assert_eq!(changes.status_id, Some(3));
    }

    #[test]
    fn user_display_name_falls_back_to_login() {
        let mut user = User {
            id: 1,
            login: "dev".into(),
            firstname: String::new(),
            lastname: String::new(),
            mail: None,
            admin: false,
            created_on: None,
            last_login_on: None,
            memberships: Vec::new(),
        };
        assert_eq!(user.display_name(), "dev");
        user.firstname = "Dana".into();
        user.lastname = "Developer".into();
        assert_eq!(user.display_name(), "Dana Developer");
    }
}
