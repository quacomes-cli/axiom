use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileResult {
    pub content: String,
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditResult {
    pub path: String,
    pub diff: String,
    pub added: usize,
    pub removed: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub file: String,
    pub line: u64,
    pub text: String,
}

const MAX_FILE_SIZE: u64 = 1_500_000;
const MAX_ENTRIES: usize = 500;
const MAX_SEARCH_MATCHES: usize = 200;
const MAX_GLOB_RESULTS: usize = 500;

fn is_within(base: &Path, target: &Path) -> bool {
    let Ok(base_canon) = fs::canonicalize(base) else {
        return false;
    };
    let Ok(target_canon) = fs::canonicalize(target) else {
        return false;
    };
    target_canon.starts_with(&base_canon)
}

/// Check if a potentially non-existent path would be within the project root.
/// Walks up from the target until it finds an existing ancestor, canonicalizes
/// that, then checks the remaining components don't escape.
fn is_within_safe(base: &Path, target: &Path) -> bool {
    let Ok(base_canon) = fs::canonicalize(base) else {
        return false;
    };

    // If target already exists, use normal canonicalize
    if let Ok(target_canon) = fs::canonicalize(target) {
        return target_canon.starts_with(&base_canon);
    }

    // Walk up to find an existing ancestor
    let mut existing = target.to_path_buf();
    let mut remaining = Vec::new();
    loop {
        if existing.exists() {
            break;
        }
        if let Some(name) = existing.file_name() {
            remaining.push(name.to_os_string());
        } else {
            return false;
        }
        if !existing.pop() {
            return false;
        }
    }

    let Ok(existing_canon) = fs::canonicalize(&existing) else {
        return false;
    };

    // Rebuild the full canonical path
    let mut full = existing_canon;
    for comp in remaining.iter().rev() {
        let s = comp.to_string_lossy();
        // Block path traversal components
        if s == ".." || s == "." {
            return false;
        }
        full.push(comp);
    }

    full.starts_with(&base_canon)
}

pub fn read_dir(path: &str, max_depth: u32, project_root: &str) -> Result<Vec<FileEntry>, String> {
    let raw = PathBuf::from(path);
    let root = PathBuf::from(project_root);
    let dir = if raw.is_relative() {
        root.join(&raw)
    } else {
        raw
    };

    if !dir.exists() {
        return Err(format!("Dizin bulunamadı: {}", path));
    }
    if !is_within(&root, &dir) {
        return Err("Proje dizini dışına erişim engellendi".into());
    }

    let mut entries = Vec::new();
    collect_entries(&dir, max_depth, 0, &mut entries);
    Ok(entries)
}

fn collect_entries(dir: &Path, max_depth: u32, current_depth: u32, out: &mut Vec<FileEntry>) {
    if current_depth > max_depth || out.len() >= MAX_ENTRIES {
        return;
    }

    let Ok(rd) = fs::read_dir(dir) else { return };

    let mut items: Vec<_> = rd.filter_map(|e| e.ok()).collect();
    items.sort_by(|a, b| {
        let a_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let b_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        b_dir.cmp(&a_dir).then(a.file_name().cmp(&b.file_name()))
    });

    for entry in items {
        if out.len() >= MAX_ENTRIES {
            break;
        }

        let name = entry.file_name().to_string_lossy().to_string();

        if name.starts_with('.')
            || name == "node_modules"
            || name == "target"
            || name == "__pycache__"
            || name == "dist"
            || name == "build"
        {
            continue;
        }

        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let size_bytes = if !is_dir {
            entry.metadata().ok().map(|m| m.len())
        } else {
            None
        };

        out.push(FileEntry {
            name: name.clone(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir,
            size_bytes,
        });

        if is_dir {
            collect_entries(&entry.path(), max_depth, current_depth + 1, out);
        }
    }
}

pub fn read_file(
    path: &str,
    project_root: &str,
    offset: Option<u32>,
    limit: Option<u32>,
) -> Result<ReadFileResult, String> {
    let raw = PathBuf::from(path);
    let root = PathBuf::from(project_root);
    let file_path = if raw.is_relative() {
        root.join(&raw)
    } else {
        raw
    };

    if !file_path.exists() {
        return Err(format!("Dosya bulunamadı: {}", file_path.display()));
    }
    if !is_within(&root, &file_path) {
        return Err("Proje dizini dışına erişim engellendi".into());
    }

    let meta = fs::metadata(&file_path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_FILE_SIZE {
        return Err(format!(
            "Dosya çok büyük: {} bayt (limit: {} bayt)",
            meta.len(),
            MAX_FILE_SIZE
        ));
    }

    let full = fs::read_to_string(&file_path).map_err(|e| format!("Dosya okunamadı: {}", e))?;

    // Opsiyonel satır aralığı (1-tabanlı offset)
    let content = if offset.is_some() || limit.is_some() {
        let start = offset.unwrap_or(1).max(1) as usize - 1;
        let lines: Vec<&str> = full.lines().collect();
        let end = match limit {
            Some(l) => (start + l as usize).min(lines.len()),
            None => lines.len(),
        };
        if start >= lines.len() {
            String::new()
        } else {
            lines[start..end].join("\n")
        }
    } else {
        full
    };

    Ok(ReadFileResult {
        content,
        path: file_path.to_string_lossy().to_string(),
        size_bytes: meta.len(),
    })
}

fn resolve_in_root(path: &str, project_root: &str) -> PathBuf {
    let raw = PathBuf::from(path);
    let root = PathBuf::from(project_root);
    if raw.is_relative() {
        root.join(&raw)
    } else {
        raw
    }
}

/// String-replace düzenleme: `old_string`'i `new_string` ile değiştirir.
pub fn apply_edit(
    path: &str,
    old_string: &str,
    new_string: &str,
    replace_all: bool,
    project_root: &str,
) -> Result<EditResult, String> {
    let root = PathBuf::from(project_root);
    let file_path = resolve_in_root(path, project_root);

    if !file_path.exists() {
        return Err(format!("Dosya bulunamadı: {}", file_path.display()));
    }
    if !is_within(&root, &file_path) {
        return Err("Proje dizini dışına erişim engellendi".into());
    }

    let original = fs::read_to_string(&file_path).map_err(|e| format!("Dosya okunamadı: {}", e))?;

    let occurrences = original.matches(old_string).count();
    if occurrences == 0 {
        return Err("Düzenlenecek metin (OLD) dosyada bulunamadı. Birebir eşleşme gerekir.".into());
    }
    if occurrences > 1 && !replace_all {
        return Err(format!(
            "OLD metni {occurrences} kez geçiyor; belirsiz. Daha fazla bağlam ekle veya 'all: true' kullan."
        ));
    }

    let updated = if replace_all {
        original.replace(old_string, new_string)
    } else {
        original.replacen(old_string, new_string, 1)
    };

    fs::write(&file_path, &updated).map_err(|e| format!("Dosya yazılamadı: {}", e))?;

    // Unified diff üret
    let mut added = 0usize;
    let mut removed = 0usize;
    let mut diff = String::new();
    for change in similar::TextDiff::from_lines(&original, &updated).iter_all_changes() {
        let sign = match change.tag() {
            similar::ChangeTag::Insert => {
                added += 1;
                "+"
            }
            similar::ChangeTag::Delete => {
                removed += 1;
                "-"
            }
            similar::ChangeTag::Equal => " ",
        };
        if sign != " " {
            diff.push_str(sign);
            diff.push_str(change.value().trim_end_matches('\n'));
            diff.push('\n');
        }
    }

    Ok(EditResult {
        path: file_path.to_string_lossy().to_string(),
        diff,
        added,
        removed,
    })
}

/// Dosya veya dizini siler (dizinler özyinelemeli).
pub fn delete_path(path: &str, project_root: &str) -> Result<(), String> {
    let root = PathBuf::from(project_root);
    let target = resolve_in_root(path, project_root);

    if !target.exists() {
        return Err(format!("Bulunamadı: {}", target.display()));
    }
    if !is_within(&root, &target) {
        return Err("Proje dizini dışına silme engellendi".into());
    }
    // Proje kökünün kendisini silmeyi engelle
    if let (Ok(t), Ok(r)) = (fs::canonicalize(&target), fs::canonicalize(&root)) {
        if t == r {
            return Err("Proje kök dizini silinemez".into());
        }
    }

    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| format!("Dizin silinemedi: {}", e))?;
    } else {
        fs::remove_file(&target).map_err(|e| format!("Dosya silinemedi: {}", e))?;
    }
    Ok(())
}

/// Dosya/dizini taşır veya yeniden adlandırır.
pub fn rename_path(from: &str, to: &str, project_root: &str) -> Result<(), String> {
    let root = PathBuf::from(project_root);
    let from_path = resolve_in_root(from, project_root);
    let to_path = resolve_in_root(to, project_root);

    if !from_path.exists() {
        return Err(format!("Kaynak bulunamadı: {}", from_path.display()));
    }
    if !is_within(&root, &from_path) || !is_within_safe(&root, &to_path) {
        return Err("Proje dizini dışına taşıma engellendi".into());
    }

    if let Some(parent) = to_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Hedef dizin oluşturulamadı: {}", e))?;
        }
    }

    fs::rename(&from_path, &to_path).map_err(|e| format!("Taşınamadı: {}", e))?;
    Ok(())
}

/// İçerik araması (regex), .gitignore-duyarlı.
pub fn search_files(
    query: &str,
    path: Option<&str>,
    project_root: &str,
    case_sensitive: bool,
) -> Result<Vec<SearchMatch>, String> {
    use ignore::WalkBuilder;

    let root = PathBuf::from(project_root);
    let search_root = match path {
        Some(p) => resolve_in_root(p, project_root),
        None => root.clone(),
    };
    if !is_within(&root, &search_root) {
        return Err("Proje dizini dışında arama engellendi".into());
    }

    let re = regex::RegexBuilder::new(query)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| format!("Geçersiz regex: {e}"))?;

    let mut matches = Vec::new();

    for result in WalkBuilder::new(&search_root).hidden(false).build() {
        if matches.len() >= MAX_SEARCH_MATCHES {
            break;
        }
        let Ok(entry) = result else { continue };
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let p = entry.path();
        let Ok(meta) = p.metadata() else { continue };
        if meta.len() > MAX_FILE_SIZE {
            continue;
        }
        let Ok(content) = fs::read_to_string(p) else {
            continue; // binari/okunamayan dosyaları atla
        };
        let rel = p.strip_prefix(&root).unwrap_or(p);
        for (idx, line) in content.lines().enumerate() {
            if matches.len() >= MAX_SEARCH_MATCHES {
                break;
            }
            if re.is_match(line) {
                let text = if line.len() > 300 {
                    format!("{}…", &line[..300])
                } else {
                    line.to_string()
                };
                matches.push(SearchMatch {
                    file: rel.to_string_lossy().replace('\\', "/"),
                    line: (idx + 1) as u64,
                    text,
                });
            }
        }
    }

    Ok(matches)
}

/// Glob deseniyle dosya yolları bulur, .gitignore-duyarlı.
pub fn glob_files(pattern: &str, project_root: &str) -> Result<Vec<String>, String> {
    use ignore::WalkBuilder;

    let root = PathBuf::from(project_root);
    let glob = globset::GlobBuilder::new(pattern)
        .literal_separator(false)
        .build()
        .map_err(|e| format!("Geçersiz glob: {e}"))?
        .compile_matcher();

    let mut results = Vec::new();
    for result in WalkBuilder::new(&root).hidden(false).build() {
        if results.len() >= MAX_GLOB_RESULTS {
            break;
        }
        let Ok(entry) = result else { continue };
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let p = entry.path();
        let rel = p.strip_prefix(&root).unwrap_or(p);
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if glob.is_match(rel_str.as_str()) || glob.is_match(p) {
            results.push(rel_str);
        }
    }
    Ok(results)
}

pub fn write_file(path: &str, content: &str, project_root: &str) -> Result<(), String> {
    let raw = PathBuf::from(path);
    let root = PathBuf::from(project_root);
    let file_path = if raw.is_relative() {
        root.join(&raw)
    } else {
        raw
    };

    // Use safe check that works for paths that don't exist yet
    if !is_within_safe(&root, &file_path) {
        return Err("Proje dizini dışına yazma engellendi".into());
    }

    // Create parent directories if needed
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Dizin oluşturulamadı: {}", e))?;
        }
    }

    fs::write(&file_path, content).map_err(|e| format!("Dosya yazılamadı: {}", e))?;
    Ok(())
}

pub fn create_dir(path: &str, project_root: &str) -> Result<(), String> {
    let raw = PathBuf::from(path);
    let root = PathBuf::from(project_root);
    let dir_path = if raw.is_relative() {
        root.join(&raw)
    } else {
        raw
    };

    if !is_within_safe(&root, &dir_path) {
        return Err("Proje dizini dışına dizin oluşturma engellendi".into());
    }

    fs::create_dir_all(&dir_path).map_err(|e| format!("Dizin oluşturulamadı: {}", e))?;

    Ok(())
}
