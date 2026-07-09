//! Persistence for the permission config — a single JSON file in the app's
//! config directory.

use std::fs;
use std::path::Path;

use super::error::Result;
use super::model::{PermissionConfig, PermissionLevel};

/// Reads the config from disk. On any error (missing file, corrupt JSON) it
/// falls back to whitelist-first defaults and attempts to write them back so
/// the file exists for the user to inspect.
pub fn load_or_default(path: &Path) -> PermissionConfig {
    match fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str(&raw) {
            Ok(cfg) => migrate(path, cfg),
            Err(e) => {
                eprintln!("permission config parse failed ({e}); using defaults");
                let cfg = PermissionConfig::default();
                let _ = save(path, &cfg);
                cfg
            }
        },
        Err(_) => {
            let cfg = PermissionConfig::default();
            let _ = save(path, &cfg);
            cfg
        }
    }
}

/// Tek seferlik varsayılan yumuşatması (2026-07): kullanıcı fs.read kuralına
/// hiç dokunmamışsa (eski varsayılan Confirm + [~/Documents, ~/Downloads] aynen
/// duruyorsa) yeni varsayılana yükselt — ev dizini içinde okuma İZİNLİ, ev dışı
/// engine gereği yine Confirm. Kullanıcının elle değiştirdiği config'e dokunulmaz.
fn migrate(path: &Path, mut cfg: PermissionConfig) -> PermissionConfig {
    let read = &cfg.filesystem.read;
    let untouched_old_default = read.level == PermissionLevel::Confirm
        && read.paths == ["~/Documents".to_string(), "~/Downloads".to_string()];
    if untouched_old_default {
        cfg.filesystem.read.level = PermissionLevel::Allowed;
        cfg.filesystem.read.paths = vec!["~".to_string()];
        let _ = save(path, &cfg);
        eprintln!("permission config migrated: fs.read -> Allowed within home");
    }
    cfg
}

/// Writes the config as pretty JSON, creating parent directories as needed.
pub fn save(path: &Path, config: &PermissionConfig) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(config)?;
    fs::write(path, json)?;
    Ok(())
}
