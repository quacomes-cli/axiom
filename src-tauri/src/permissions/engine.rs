//! The permission engine. Holds the active config behind a lock and answers
//! `Decision` queries for every system action Axiom might take.

use std::path::{Path, PathBuf};
use std::sync::RwLock;

use super::error::Result;
use super::model::{Decision, PermissionConfig, PermissionLevel, PermissionQuery, ScopedRule};
use super::store;

pub struct PermissionEngine {
    config: RwLock<PermissionConfig>,
    config_path: PathBuf,
}

impl PermissionEngine {
    /// Loads the engine from `config_path`, falling back to whitelist-first
    /// defaults (and writing them) when no file exists yet.
    pub fn load(config_path: PathBuf) -> Self {
        let config = store::load_or_default(&config_path);
        Self {
            config: RwLock::new(config),
            config_path,
        }
    }

    /// A snapshot of the current config (for the Settings UI).
    pub fn snapshot(&self) -> PermissionConfig {
        self.config
            .read()
            .expect("permission lock poisoned")
            .clone()
    }

    /// Replaces the config and persists it.
    pub fn replace(&self, next: PermissionConfig) -> Result<()> {
        store::save(&self.config_path, &next)?;
        *self.config.write().expect("permission lock poisoned") = next;
        Ok(())
    }

    /// Uniform dispatch used by the agent's tools.
    pub fn check(&self, query: &PermissionQuery) -> Decision {
        use PermissionQuery::*;
        match query {
            FsRead { path } => self.check_fs_read(Path::new(path)),
            FsWrite { path } => self.check_fs_write(Path::new(path)),
            FsDelete { path } => self.check_fs_delete(Path::new(path)),
            FsWatch { path } => self.check_fs_watch(Path::new(path)),
            ProcessLaunch { exe } => self.check_process_launch(exe),
            ProcessKill => self.check_process_kill(),
            ProcessList => self.check_process_list(),
            NetworkOutbound { host } => self.check_network_outbound(host),
            NetworkLocalhost => self.check_network_localhost(),
            ShellExecute { command } => self.check_shell_execute(command),
            ScreenCapture => self.check_screen_capture(),
            ScreenContinuousWatch => self.check_screen_continuous_watch(),
        }
    }

    // ---- Filesystem ------------------------------------------------------

    pub fn check_fs_read(&self, path: &Path) -> Decision {
        let cfg = self.config.read().expect("lock");
        scoped_decision(&cfg.filesystem.read, path, "Dosya okuma")
    }

    pub fn check_fs_write(&self, path: &Path) -> Decision {
        let cfg = self.config.read().expect("lock");
        scoped_decision(&cfg.filesystem.write, path, "Dosya yazma")
    }

    pub fn check_fs_delete(&self, _path: &Path) -> Decision {
        let cfg = self.config.read().expect("lock");
        level_decision(cfg.filesystem.delete, "Dosya silme")
    }

    pub fn check_fs_watch(&self, path: &Path) -> Decision {
        let cfg = self.config.read().expect("lock");
        scoped_decision(&cfg.filesystem.watch, path, "Dosya izleme")
    }

    // ---- Process ---------------------------------------------------------

    pub fn check_process_launch(&self, exe: &str) -> Decision {
        let cfg = self.config.read().expect("lock");
        let p = &cfg.process;
        if p.launch == PermissionLevel::Blocked {
            return Decision::deny("Uygulama başlatma engelli");
        }
        if !p.launch_whitelist.is_empty()
            && !p
                .launch_whitelist
                .iter()
                .any(|w| exe.eq_ignore_ascii_case(w) || exe.contains(w.as_str()))
        {
            return Decision::deny(format!("'{exe}' başlatma whitelist'inde değil"));
        }
        level_decision(p.launch, "Uygulama başlatma")
    }

    pub fn check_process_kill(&self) -> Decision {
        let cfg = self.config.read().expect("lock");
        level_decision(cfg.process.kill, "Süreç sonlandırma")
    }

    pub fn check_process_list(&self) -> Decision {
        let cfg = self.config.read().expect("lock");
        level_decision(cfg.process.list, "Süreç listeleme")
    }

    // ---- Network ---------------------------------------------------------

    pub fn check_network_outbound(&self, host: &str) -> Decision {
        let cfg = self.config.read().expect("lock");
        let n = &cfg.network;
        let h = host.to_ascii_lowercase();
        if n.blocked_domains.iter().any(|d| {
            h == d.to_ascii_lowercase() || h.ends_with(&format!(".{}", d.to_ascii_lowercase()))
        }) {
            return Decision::deny(format!("'{host}' engelli alan adları listesinde"));
        }
        level_decision(n.outbound, "Dış ağ bağlantısı")
    }

    pub fn check_network_localhost(&self) -> Decision {
        let cfg = self.config.read().expect("lock");
        level_decision(cfg.network.localhost, "Localhost bağlantısı")
    }

    // ---- Shell -----------------------------------------------------------

    pub fn check_shell_execute(&self, command: &str) -> Decision {
        let cfg = self.config.read().expect("lock");
        let s = &cfg.shell;
        let lower = command.to_ascii_lowercase();
        if let Some(hit) = s
            .blocked_commands
            .iter()
            .find(|b| lower.contains(&b.to_ascii_lowercase()))
        {
            return Decision::deny(format!("Komut engelli kalıp içeriyor: '{hit}'"));
        }
        level_decision(s.execute, "Kabuk komutu")
    }

    // ---- Screen ----------------------------------------------------------

    pub fn check_screen_capture(&self) -> Decision {
        let cfg = self.config.read().expect("lock");
        level_decision(cfg.screen.capture, "Ekran yakalama")
    }

    pub fn check_screen_continuous_watch(&self) -> Decision {
        let cfg = self.config.read().expect("lock");
        level_decision(cfg.screen.continuous_watch, "Sürekli ekran izleme")
    }
}

/// Maps a bare level to a decision.
fn level_decision(level: PermissionLevel, what: &str) -> Decision {
    match level {
        PermissionLevel::Allowed => Decision::Allow,
        PermissionLevel::Confirm => Decision::Confirm,
        PermissionLevel::Blocked => Decision::deny(format!("{what} engelli")),
    }
}

/// Maps a path-scoped rule to a decision, enforcing the allowed roots.
fn scoped_decision(rule: &ScopedRule, path: &Path, what: &str) -> Decision {
    if rule.level == PermissionLevel::Blocked {
        return Decision::deny(format!("{what} engelli"));
    }
    if !path_in_scope(path, &rule.paths) {
        return Decision::deny(format!(
            "{what} izinli dizinlerin dışında: {}",
            path.display()
        ));
    }
    level_decision(rule.level, what)
}

/// True if `path` lies under any of the (possibly `~`-prefixed) roots.
/// Matches on segment boundaries so `/docs` never satisfies a `/documents` root.
fn path_in_scope(path: &Path, roots: &[String]) -> bool {
    let target = normalize(path);
    roots.iter().any(|root| {
        let root = normalize(&expand_home(root));
        if root.is_empty() {
            return false;
        }
        target == root || target.starts_with(&format!("{root}/"))
    })
}

/// Expands a leading `~` to the user's home directory.
fn expand_home(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~") {
        if let Some(home) = dirs::home_dir() {
            let rest = rest.trim_start_matches(['/', '\\']);
            return home.join(rest);
        }
    }
    PathBuf::from(p)
}

/// Lowercases and unifies separators so prefix checks are robust on Windows.
fn normalize(p: &Path) -> String {
    p.to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase()
        .trim_end_matches('/')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roots(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn path_within_root_is_in_scope() {
        let r = roots(&["C:/Users/x/Documents"]);
        assert!(path_in_scope(Path::new("C:/Users/x/Documents/a.txt"), &r));
        assert!(path_in_scope(
            Path::new(r"C:\Users\x\Documents\sub\a.txt"),
            &r
        ));
    }

    #[test]
    fn sibling_prefix_is_not_in_scope() {
        // "Documents2" must not satisfy a "Documents" root.
        let r = roots(&["C:/Users/x/Documents"]);
        assert!(!path_in_scope(Path::new("C:/Users/x/Documents2/a.txt"), &r));
    }

    #[test]
    fn empty_roots_deny_everything() {
        assert!(!path_in_scope(Path::new("C:/anything"), &[]));
        assert!(!path_in_scope(Path::new("C:/anything"), &roots(&[""])));
    }

    #[test]
    fn blocked_scoped_rule_denies_even_in_scope() {
        let rule = ScopedRule {
            level: PermissionLevel::Blocked,
            paths: roots(&["C:/Users/x"]),
        };
        assert!(matches!(
            scoped_decision(&rule, Path::new("C:/Users/x/a.txt"), "x"),
            Decision::Deny { .. }
        ));
    }

    #[test]
    fn in_scope_confirm_rule_confirms() {
        let rule = ScopedRule {
            level: PermissionLevel::Confirm,
            paths: roots(&["C:/Users/x"]),
        };
        assert!(matches!(
            scoped_decision(&rule, Path::new("C:/Users/x/a.txt"), "x"),
            Decision::Confirm
        ));
    }

    #[test]
    fn out_of_scope_denies() {
        let rule = ScopedRule {
            level: PermissionLevel::Allowed,
            paths: roots(&["C:/Users/x"]),
        };
        assert!(matches!(
            scoped_decision(&rule, Path::new("C:/Windows/system32"), "x"),
            Decision::Deny { .. }
        ));
    }
}
