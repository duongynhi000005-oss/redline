//! Redline's core: everything that talks to Redmine or keeps local state.
//!
//! This crate has no UI or Tauri dependency, so it can be unit-tested and run
//! against a real Redmine on any platform. The desktop shell in `src-tauri/`
//! wraps it in Tauri commands and events.

pub mod client;
pub mod error;
pub mod models;

pub use client::{Client, IssueQuery, Page};
pub use error::{Error, Result};

/// The Redline version, shared by the core and the app.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
