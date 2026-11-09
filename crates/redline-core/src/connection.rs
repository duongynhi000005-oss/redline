//! Extra things some servers need on every request: a username header and
//! custom headers, for a reverse proxy or gateway in front of Redmine.
//!
//! Redmine itself needs only the API key. Some organisations put a proxy in
//! front of it that also wants, for example, `X-Redmine-Username` or an
//! access token. These options add those headers to every request Redline
//! sends to that server, and nowhere else.

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::pacer::RequestLimits;

/// The header the Username field is sent as.
pub const USERNAME_HEADER: &str = "X-Redmine-Username";

/// The most custom headers one server can have.
pub const MAX_HEADERS: usize = 20;

/// Headers Redline sets itself, or that only the HTTP library may set.
const RESERVED: &[&str] = &[
    "x-redmine-api-key",
    "accept",
    "accept-encoding",
    "connection",
    "content-length",
    "content-type",
    "host",
    "te",
    "transfer-encoding",
    "upgrade",
    "user-agent",
];

/// One custom header.
#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Header {
    pub name: String,
    pub value: String,
}

impl std::fmt::Debug for Header {
    // Header values are often secrets: never print them.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Header").field("name", &self.name).finish()
    }
}

/// A server's username, custom headers and request limits. Empty by
/// default.
#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectionOptions {
    /// Sent as [`USERNAME_HEADER`] when set.
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub headers: Vec<Header>,
    /// How hard Redline may use the server. `None` uses the defaults.
    #[serde(default)]
    pub limits: Option<RequestLimits>,
}

impl std::fmt::Debug for ConnectionOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectionOptions")
            .field("username", &self.username.as_ref().map(|_| "…"))
            .field("headers", &self.headers)
            .field("limits", &self.limits)
            .finish()
    }
}

impl ConnectionOptions {
    pub fn is_empty(&self) -> bool {
        self.username.is_none() && self.headers.is_empty() && self.limits.is_none()
    }

    /// The limits to pace requests by: the saved ones, or the defaults.
    pub fn request_limits(&self) -> RequestLimits {
        self.limits.unwrap_or_default().clamped()
    }

    /// Trims names and values, drops a blank username and rows left fully
    /// blank, so what's saved is what's sent.
    pub fn normalized(&self) -> Self {
        let username = self
            .username
            .as_deref()
            .map(str::trim)
            .filter(|u| !u.is_empty())
            .map(str::to_owned);
        let headers = self
            .headers
            .iter()
            .map(|h| Header {
                name: h.name.trim().to_owned(),
                value: h.value.trim().to_owned(),
            })
            .filter(|h| !(h.name.is_empty() && h.value.is_empty()))
            .collect();
        // Limits the same as the defaults aren't worth saving: a later
        // release may pick better defaults.
        let limits = self
            .limits
            .map(RequestLimits::clamped)
            .filter(|l| *l != RequestLimits::default());
        Self {
            username,
            headers,
            limits,
        }
    }

    /// Checks the options and builds the headers to send. Values are marked
    /// sensitive so the HTTP library never logs them.
    pub fn header_map(&self) -> Result<HeaderMap> {
        let options = self.normalized();
        if options.headers.len() > MAX_HEADERS {
            return Err(Error::InvalidHeader(format!(
                "Redline can send at most {MAX_HEADERS} custom headers."
            )));
        }
        let mut map = HeaderMap::new();
        if let Some(username) = &options.username {
            let value = header_value(username, "The username")?;
            map.insert(HeaderName::from_static("x-redmine-username"), value);
        }
        for header in &options.headers {
            let name = header_name(&header.name)?;
            if map.contains_key(&name) {
                return Err(Error::InvalidHeader(if name == "x-redmine-username" {
                    format!(
                        "{USERNAME_HEADER} is already sent from the Username field. Remove one of them."
                    )
                } else {
                    format!("{} is listed twice.", header.name)
                }));
            }
            if header.value.is_empty() {
                return Err(Error::InvalidHeader(format!(
                    "Give {} a value.",
                    header.name
                )));
            }
            let value = header_value(&header.value, &format!("The value of {}", header.name))?;
            map.insert(name, value);
        }
        Ok(map)
    }
}

fn header_name(name: &str) -> Result<HeaderName> {
    if name.is_empty() {
        return Err(Error::InvalidHeader(
            "A custom header needs a name.".to_owned(),
        ));
    }
    let parsed = HeaderName::from_bytes(name.as_bytes()).map_err(|_| {
        Error::InvalidHeader(format!(
            "\"{name}\" isn't a valid header name. Use letters, digits and dashes."
        ))
    })?;
    if parsed == "x-redmine-api-key" {
        return Err(Error::InvalidHeader(
            "Redline sends your API key itself. Put it in the API key field.".to_owned(),
        ));
    }
    if RESERVED.contains(&parsed.as_str()) {
        return Err(Error::InvalidHeader(format!(
            "Redline sets {name} itself, so it can't be a custom header."
        )));
    }
    Ok(parsed)
}

fn header_value(value: &str, what: &str) -> Result<HeaderValue> {
    let mut parsed = HeaderValue::from_str(value).map_err(|_| {
        Error::InvalidHeader(format!("{what} has characters that can't go in a header."))
    })?;
    parsed.set_sensitive(true);
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(name: &str, value: &str) -> Header {
        Header {
            name: name.into(),
            value: value.into(),
        }
    }

    #[test]
    fn sends_the_username_and_custom_headers() {
        let options = ConnectionOptions {
            username: Some("  dana ".into()),
            headers: vec![header(" X-Gateway-Token ", " abc "), header("", "")],
            ..Default::default()
        };
        let map = options.header_map().unwrap();
        assert_eq!(map.len(), 2);
        assert_eq!(map["x-redmine-username"], "dana");
        assert_eq!(map["x-gateway-token"], "abc");
        assert!(map["x-gateway-token"].is_sensitive());
    }

    #[test]
    fn empty_options_send_nothing() {
        let options = ConnectionOptions {
            username: Some("   ".into()),
            headers: vec![header(" ", "")],
            ..Default::default()
        };
        assert!(options.normalized().is_empty());
        assert!(options.header_map().unwrap().is_empty());
    }

    #[test]
    fn never_overrides_the_api_key() {
        let options = ConnectionOptions {
            username: None,
            headers: vec![header("x-redmine-api-key", "other")],
            ..Default::default()
        };
        let err = options.header_map().unwrap_err();
        assert_eq!(err.code(), "invalid_header");
        assert!(err.to_string().contains("API key field"));
    }

    #[test]
    fn rejects_headers_redline_sets_itself() {
        for name in ["Accept", "Host", "Content-Type", "User-Agent"] {
            let options = ConnectionOptions {
                username: None,
                headers: vec![header(name, "x")],
                ..Default::default()
            };
            assert!(options.header_map().is_err(), "{name}");
        }
    }

    #[test]
    fn rejects_bad_names_values_and_duplicates() {
        let cases = [
            vec![header("Has space", "x")],
            vec![header("X-Ok", "line\nbreak")],
            vec![header("X-Empty", "")],
            vec![header("", "orphan value")],
            vec![header("X-A", "1"), header("x-a", "2")],
        ];
        for headers in cases {
            let options = ConnectionOptions {
                username: None,
                headers: headers.clone(),
                ..Default::default()
            };
            assert!(options.header_map().is_err(), "{headers:?}");
        }
    }

    #[test]
    fn username_field_and_header_dont_both_send_it() {
        let options = ConnectionOptions {
            username: Some("dana".into()),
            headers: vec![header("X-Redmine-Username", "dana")],
            ..Default::default()
        };
        let err = options.header_map().unwrap_err();
        assert!(err.to_string().contains("Username field"));
    }

    #[test]
    fn keeps_only_limits_that_differ_from_the_defaults() {
        let options = ConnectionOptions {
            limits: Some(RequestLimits::default()),
            ..Default::default()
        };
        assert_eq!(options.normalized().limits, None);
        assert!(options.normalized().is_empty());

        let slow = ConnectionOptions {
            limits: Some(RequestLimits {
                at_once: 1,
                per_minute: 30,
            }),
            ..Default::default()
        };
        assert_eq!(slow.normalized().limits, slow.limits);
        assert_eq!(slow.request_limits().per_minute, 30);

        // Options saved before limits existed still load.
        let old: ConnectionOptions =
            serde_json::from_str(r#"{"username":"dana","headers":[]}"#).unwrap();
        assert_eq!(old.request_limits(), RequestLimits::default());
    }

    #[test]
    fn debug_output_hides_values() {
        let options = ConnectionOptions {
            username: Some("dana".into()),
            headers: vec![header("X-Token", "s3cret")],
            ..Default::default()
        };
        let text = format!("{options:?}");
        assert!(!text.contains("s3cret"));
        assert!(!text.contains("dana"));
        assert!(text.contains("X-Token"));
    }
}
