//! Permission Engine — the whitelist-first security core. Every system action
//! Axiom takes is gated through [`PermissionEngine`], which returns a
//! [`Decision`] (allow / confirm / deny) based on the user's config.

mod engine;
mod error;
mod model;
mod store;

pub use engine::PermissionEngine;
pub use model::{Decision, PermissionConfig, PermissionQuery};
