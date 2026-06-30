use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedDocument {
    pub filename: String,
    pub mime_type: String,
    pub extracted_text: String,
    pub size_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base64_data: Option<String>,
}

const MAX_TEXT_CHARS: usize = 50_000;

pub fn parse_file(file_path: &str) -> Result<ParsedDocument, String> {
    let path = Path::new(file_path);

    if !path.exists() {
        return Err(format!("Dosya bulunamadı: {file_path}"));
    }

    let metadata = std::fs::metadata(path).map_err(|e| format!("Dosya bilgisi okunamadı: {e}"))?;
    let size_bytes = metadata.len();

    let filename = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let is_image = matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp");

    if is_image {
        let mime_type = match ext.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "bmp" => "image/bmp",
            _ => "application/octet-stream",
        };

        const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
        if size_bytes > MAX_IMAGE_BYTES {
            return Err("Resim dosyası çok büyük (maksimum 20 MB).".into());
        }

        let bytes = std::fs::read(path).map_err(|e| format!("Dosya okunamadı: {e}"))?;
        let b64 = BASE64.encode(&bytes);

        let extracted_text = format!("[Resim: {filename}]");
        return Ok(ParsedDocument {
            filename,
            mime_type: mime_type.into(),
            extracted_text,
            size_bytes,
            base64_data: Some(b64),
        });
    }

    let (mime_type, extracted_text) = match ext.as_str() {
        "txt" | "log" => ("text/plain".into(), read_text(path)?),
        "md" => ("text/markdown".into(), read_text(path)?),
        "json" => ("application/json".into(), read_text(path)?),
        "csv" => ("text/csv".into(), read_text(path)?),
        "xml" => ("application/xml".into(), read_text(path)?),
        "yaml" | "yml" => ("text/yaml".into(), read_text(path)?),
        "toml" => ("text/toml".into(), read_text(path)?),
        "html" | "htm" => ("text/html".into(), read_text(path)?),
        "css" => ("text/css".into(), read_text(path)?),
        "js" | "jsx" | "mjs" => ("text/javascript".into(), read_text(path)?),
        "ts" | "tsx" | "mts" => ("text/typescript".into(), read_text(path)?),
        "py" => ("text/x-python".into(), read_text(path)?),
        "rs" => ("text/x-rust".into(), read_text(path)?),
        "go" => ("text/x-go".into(), read_text(path)?),
        "java" => ("text/x-java".into(), read_text(path)?),
        "c" | "h" => ("text/x-c".into(), read_text(path)?),
        "cpp" | "hpp" | "cc" => ("text/x-c++".into(), read_text(path)?),
        "sql" => ("text/x-sql".into(), read_text(path)?),
        "sh" | "bash" | "zsh" => ("text/x-shellscript".into(), read_text(path)?),
        "ps1" => ("text/x-powershell".into(), read_text(path)?),
        _ => {
            match read_text(path) {
                Ok(text) => ("text/plain".into(), text),
                Err(_) => {
                    return Err(format!(
                        "Desteklenmeyen dosya formatı: .{ext} — Yalnızca metin tabanlı dosyalar desteklenmektedir."
                    ));
                }
            }
        }
    };

    Ok(ParsedDocument {
        filename,
        mime_type,
        extracted_text,
        size_bytes,
        base64_data: None,
    })
}

fn read_text(path: &Path) -> Result<String, String> {
    let content = std::fs::read_to_string(path).map_err(|e| format!("Dosya okunamadı: {e}"))?;

    if content.len() > MAX_TEXT_CHARS {
        let mut truncated = String::with_capacity(MAX_TEXT_CHARS + 50);
        for (i, ch) in content.chars().enumerate() {
            if i >= MAX_TEXT_CHARS {
                break;
            }
            truncated.push(ch);
        }
        truncated.push_str("\n\n[... İçerik çok uzun olduğu için kısaltıldı]");
        Ok(truncated)
    } else {
        Ok(content)
    }
}
