//! Redline's core: everything that talks to Redmine or keeps local state.
//!
//! This crate has no UI or Tauri dependency, so it can be unit-tested and run
//! against a real Redmine on any platform. The desktop shell in `src-tauri/`
//! wraps it in Tauri commands and events.

pub mod client;
pub mod connection;
pub mod error;
pub mod mentions;
pub mod models;
pub mod pacer;
pub mod store;
pub mod sync;

pub use client::{Client, IssueQuery, Page, TimeQuery};
pub use connection::{ConnectionOptions, Header};
pub use error::{Error, Result};
pub use pacer::{Pacer, Priority, RequestLimits};
pub use store::{Metadata, Store};
pub use sync::{IssueDetails, NewFile, SyncProgress, SyncReport, Syncer, projects_needing_details};

/// The Redline version, shared by the core and the app.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
