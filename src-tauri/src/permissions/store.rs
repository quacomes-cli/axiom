//! Persistence for the permission config — a single JSON file in the app's
//! config directory.

use std::fs;
use std::path::Path;

use super::error::Result;
use super::model::PermissionConfig;

/// Reads the config from disk. On any error (missing file, corrupt JSON) it
/// falls back to whitelist-first defaults and attempts to write them back so
/// the file exists for the user to inspect.
pub fn load_or_default(path: &Path) -> PermissionConfig {
    match fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str(&raw) {
            Ok(cfg) => cfg,
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

/// Writes the config as pretty JSON, creating parent directories as needed.
pub fn save(path: &Path, config: &PermissionConfig) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(config)?;
    fs::write(path, json)?;
    Ok(())
}
