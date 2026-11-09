//! Errors from talking to Redmine, worded so the UI can show them as they are.

use thiserror::Error;

/// Something went wrong talking to a Redmine server.
#[derive(Debug, Error)]
pub enum Error {
    /// The server URL isn't a valid http(s) URL.
    #[error("That doesn't look like a web address: {0}")]
    InvalidUrl(String),

    /// A custom header or the username can't be sent as given.
    #[error("{0}")]
    InvalidHeader(String),

    /// The server couldn't be reached at all (DNS, TLS, connection refused,
    /// timeout).
    #[error("Couldn't reach the server: {0}")]
    Network(String),

    /// The server answered, but not like a Redmine REST API would (for example
    /// an HTML page, or a 404 for a core endpoint).
    #[error("The server answered, but not like Redmine. Check the address.")]
    NotRedmine,

    /// 401: the API key is wrong or was reset.
    #[error("Redmine didn't accept the API key.")]
    Unauthorized,

    /// 403 when signing in: Redmine's REST API is switched off.
    #[error(
        "This Redmine has its REST API turned off. A Redmine admin can turn it on in Administration, Settings, API."
    )]
    RestApiDisabled,

    /// 403: the key is fine but this user may not do this, or the REST API
    /// is turned off on the server.
    #[error("Redmine says you don't have permission for this.")]
    Forbidden,

    /// A 401, 403 or 407 that didn't come from Redmine, or a redirect to
    /// another host: usually a proxy or gateway in front of Redmine that
    /// wants something Redline didn't send.
    #[error(
        "The server didn't let the request through (HTTP {0}). If a proxy or gateway sits in front of Redmine, it may need a username or other headers."
    )]
    Refused(u16),

    /// 404 for a specific object (an issue that was deleted or hidden).
    #[error("Not found in Redmine.")]
    NotFound,

    /// 422: Redmine refused a change, with its own messages, for example a
    /// workflow rule or a required field. With no messages, someone changed
    /// the same issue at the same moment.
    #[error("{}", rejected_message(.0))]
    Rejected(Vec<String>),

    /// The server kept answering 429 or 503 after retries.
    #[error("The server is busy. Try again in a moment.")]
    Busy,

    /// Any other HTTP status.
    #[error("Redmine answered with HTTP {0}.")]
    Http(u16),

    /// The local cache couldn't be read or written.
    #[error("Redline's local cache had a problem: {0}")]
    Storage(String),

    /// The response body didn't match what Redline expects.
    #[error("Couldn't read Redmine's response: {0}")]
    Decode(String),
}

impl Error {
    /// A stable, machine-readable code the UI can switch on.
    pub fn code(&self) -> &'static str {
        match self {
            Error::InvalidUrl(_) => "invalid_url",
            Error::InvalidHeader(_) => "invalid_header",
            Error::Network(_) => "network",
            Error::NotRedmine => "not_redmine",
            Error::Unauthorized => "unauthorized",
            Error::RestApiDisabled => "rest_api_disabled",
            Error::Forbidden => "forbidden",
            Error::Refused(_) => "refused",
            Error::NotFound => "not_found",
            Error::Rejected(_) => "rejected",
            Error::Busy => "busy",
            Error::Http(_) => "http",
            Error::Storage(_) => "storage",
            Error::Decode(_) => "decode",
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;

fn rejected_message(messages: &[String]) -> String {
    if messages.is_empty() {
        "Redmine refused the change because the issue changed at the same moment. Try again."
            .to_owned()
    } else {
        format!("Redmine refused the change: {}", messages.join("; "))
    }
}
