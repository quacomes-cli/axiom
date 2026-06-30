//! Permission data model — the serializable config the user edits in Settings,
//! plus the decision type the engine returns for any action.
//!
//! Design principle: whitelist-first. The `Default` impl denies or gates
//! everything; the user explicitly opens what they want.

use serde::{Deserialize, Serialize};

/// How an action is treated when requested.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionLevel {
    /// Runs without asking.
    Allowed,
    /// Runs only after the user confirms each time.
    Confirm,
    /// Never runs.
    Blocked,
}

/// A rule that is additionally scoped to a set of filesystem roots.
/// An action only passes if its path lies under one of `paths`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopedRule {
    pub level: PermissionLevel,
    /// Allowed roots. Supports a leading `~` for the home directory.
    #[serde(default)]
    pub paths: Vec<String>,
}

impl ScopedRule {
    fn new(level: PermissionLevel, paths: &[&str]) -> Self {
        Self {
            level,
            paths: paths.iter().map(|s| s.to_string()).collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilesystemPermissions {
    pub read: ScopedRule,
    pub write: ScopedRule,
    pub delete: PermissionLevel,
    pub watch: ScopedRule,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessPermissions {
    pub launch: PermissionLevel,
    /// Only these executables may be launched (by name or full path).
    #[serde(default)]
    pub launch_whitelist: Vec<String>,
    pub kill: PermissionLevel,
    pub list: PermissionLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkPermissions {
    pub outbound: PermissionLevel,
    pub localhost: PermissionLevel,
    #[serde(default)]
    pub blocked_domains: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardPermissions {
    pub read: PermissionLevel,
    pub write: PermissionLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellPermissions {
    pub execute: PermissionLevel,
    /// Substrings that, if present in a command, hard-block it.
    #[serde(default)]
    pub blocked_commands: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenPermissions {
    pub capture: PermissionLevel,
    pub continuous_watch: PermissionLevel,
}

/// The full permission configuration, persisted to disk and edited in the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionConfig {
    pub filesystem: FilesystemPermissions,
    pub process: ProcessPermissions,
    pub network: NetworkPermissions,
    pub clipboard: ClipboardPermissions,
    pub shell: ShellPermissions,
    pub screen: ScreenPermissions,
}

impl Default for PermissionConfig {
    fn default() -> Self {
        use PermissionLevel::*;
        Self {
            filesystem: FilesystemPermissions {
                read: ScopedRule::new(Confirm, &["~/Documents", "~/Downloads"]),
                write: ScopedRule::new(Confirm, &["~/Documents/axiom-out"]),
                delete: Blocked,
                watch: ScopedRule::new(Confirm, &[]),
            },
            process: ProcessPermissions {
                launch: Confirm,
                launch_whitelist: vec![],
                kill: Confirm,
                list: Allowed,
            },
            network: NetworkPermissions {
                outbound: Confirm,
                localhost: Allowed,
                blocked_domains: vec![],
            },
            clipboard: ClipboardPermissions {
                read: Confirm,
                write: Confirm,
            },
            shell: ShellPermissions {
                execute: Confirm,
                blocked_commands: vec![
                    "rm -rf".into(),
                    "format".into(),
                    "mkfs".into(),
                    ":(){:|:&};:".into(),
                ],
            },
            screen: ScreenPermissions {
                capture: Confirm,
                continuous_watch: Blocked,
            },
        }
    }
}

/// The engine's verdict for a requested action.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Decision {
    /// Proceed without prompting.
    Allow,
    /// Proceed only after explicit user confirmation.
    Confirm,
    /// Reject. `reason` is a human-readable explanation.
    Deny { reason: String },
}

impl Decision {
    pub fn deny(reason: impl Into<String>) -> Self {
        Decision::Deny {
            reason: reason.into(),
        }
    }
}

/// A request to evaluate a single action against the active config. This is the
/// uniform entry point the agent's tools use before performing any system call.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum PermissionQuery {
    FsRead { path: String },
    FsWrite { path: String },
    FsDelete { path: String },
    FsWatch { path: String },
    ProcessLaunch { exe: String },
    ProcessKill,
    ProcessList,
    NetworkOutbound { host: String },
    NetworkLocalhost,
    ShellExecute { command: String },
    ScreenCapture,
    ScreenContinuousWatch,
}
