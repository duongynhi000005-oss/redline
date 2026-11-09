//! The signed-in account: which server, which user, and where the API key
//! lives.
//!
//! The account (server address and user, no secrets) is a small JSON file in
//! the app's config folder. The API key is kept in the OS keychain: the
//! macOS Keychain or the Windows Credential Manager. So are the server's
//! username and custom headers, if it has any, in a second entry.

use std::path::{Path, PathBuf};

use redline_core::ConnectionOptions;
use serde::{Deserialize, Serialize};

const KEYCHAIN_SERVICE: &str = "io.github.odonckers.redline";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    /// Normalized server URL, ending in `/`.
    pub server_url: String,
    pub user_id: u64,
    pub login: String,
    pub name: String,
}

impl Account {
    /// The keychain entry name for this account's API key.
    fn keychain_user(&self) -> String {
        format!("{}#{}", self.server_url, self.user_id)
    }

    /// A file-system-safe name, unique per server and user, for the cache.
    pub fn cache_file_name(&self) -> String {
        let slug: String = self
            .server_url
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_end_matches('/')
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect();
        format!("{slug}-user{}.sqlite", self.user_id)
    }

    pub fn save_key(&self, api_key: &str) -> Result<(), String> {
        keyring::Entry::new(KEYCHAIN_SERVICE, &self.keychain_user())
            .and_then(|e| e.set_password(api_key))
            .map_err(|e| format!("Couldn't save the API key to the keychain: {e}"))
    }

    pub fn load_key(&self) -> Result<String, String> {
        keyring::Entry::new(KEYCHAIN_SERVICE, &self.keychain_user())
            .and_then(|e| e.get_password())
            .map_err(|e| format!("Couldn't read the API key from the keychain: {e}"))
    }

    pub fn delete_key(&self) {
        if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, &self.keychain_user()) {
            let _ = entry.delete_credential();
        }
        self.delete_connection();
    }

    /// The keychain entry name for this account's username and headers.
    fn connection_keychain_user(&self) -> String {
        format!("{}#connection", self.keychain_user())
    }

    /// Saves the username and custom headers, or removes the entry when
    /// there are none.
    pub fn save_connection(&self, options: &ConnectionOptions) -> Result<(), String> {
        if options.is_empty() {
            self.delete_connection();
            return Ok(());
        }
        let json = serde_json::to_string(options).map_err(|e| e.to_string())?;
        keyring::Entry::new(KEYCHAIN_SERVICE, &self.connection_keychain_user())
            .and_then(|e| e.set_password(&json))
            .map_err(|e| format!("Couldn't save the server's headers to the keychain: {e}"))
    }

    /// The username and custom headers. None saved means none.
    pub fn load_connection(&self) -> Result<ConnectionOptions, String> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &self.connection_keychain_user())
            .map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(json) => serde_json::from_str(&json)
                .map_err(|_| "The server's saved headers couldn't be read.".to_owned()),
            Err(keyring::Error::NoEntry) => Ok(ConnectionOptions::default()),
            Err(e) => Err(format!(
                "Couldn't read the server's headers from the keychain: {e}"
            )),
        }
    }

    fn delete_connection(&self) {
        if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, &self.connection_keychain_user()) {
            let _ = entry.delete_credential();
        }
    }
}

pub fn account_file(config_dir: &Path) -> PathBuf {
    config_dir.join("account.json")
}

pub fn load(config_dir: &Path) -> Option<Account> {
    let text = std::fs::read_to_string(account_file(config_dir)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn save(config_dir: &Path, account: &Account) -> Result<(), String> {
    std::fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(account).map_err(|e| e.to_string())?;
    std::fs::write(account_file(config_dir), json).map_err(|e| e.to_string())
}

pub fn forget(config_dir: &Path) {
    let _ = std::fs::remove_file(account_file(config_dir));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_file_names_are_safe_and_distinct() {
        let a = Account {
            server_url: "https://example.com/redmine/".into(),
            user_id: 5,
            login: "dev".into(),
            name: "Dana".into(),
        };
        assert_eq!(a.cache_file_name(), "example-com-redmine-user5.sqlite");
        let b = Account {
            user_id: 6,
            ..a.clone()
        };
        assert_ne!(a.cache_file_name(), b.cache_file_name());
    }

    #[test]
    fn saves_and_loads_the_account_without_secrets() {
        let dir = std::env::temp_dir().join(format!("redline-test-{}", std::process::id()));
        let account = Account {
            server_url: "http://localhost:3000/".into(),
            user_id: 1,
            login: "dev".into(),
            name: "Dana Developer".into(),
        };
        save(&dir, &account).unwrap();
        assert_eq!(load(&dir), Some(account));
        forget(&dir);
        assert_eq!(load(&dir), None);
        let _ = std::fs::remove_dir_all(dir);
    }
}
