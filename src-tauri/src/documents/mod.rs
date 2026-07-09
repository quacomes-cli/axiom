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
    Ok(truncate_chars(content, MAX_TEXT_CHARS))
}

fn truncate_chars(content: String, max: usize) -> String {
    if content.len() <= max {
        return content;
    }
    let mut truncated = String::with_capacity(max + 50);
    for (i, ch) in content.chars().enumerate() {
        if i >= max {
            break;
        }
        truncated.push(ch);
    }
    truncated.push_str("\n\n[... İçerik çok uzun olduğu için kısaltıldı]");
    truncated
}

/// Kütüphane indeksi (RAG) için parse: sohbet ekinden farklı olarak zengin
/// formatlar da desteklenir (pdf/docx/pptx/xlsx/epub/html/rtf) ve limit çok
/// daha geniştir (uzun belgeler parçalanarak indekslendiği için 50K kırpması
/// anlamsız olurdu). Resimler indekslenmez.
pub fn parse_for_index(file_path: &str) -> Result<ParsedDocument, String> {
    const MAX_INDEX_CHARS: usize = 400_000;
    let path = Path::new(file_path);
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let rich: Option<(String, String)> = match ext.as_str() {
        "pdf" => Some((
            "application/pdf".into(),
            pdf_extract::extract_text(path).map_err(|e| format!("PDF metni çıkarılamadı: {e}"))?,
        )),
        "docx" => Some((
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document".into(),
            extract_docx(path)?,
        )),
        "pptx" => Some((
            "application/vnd.openxmlformats-officedocument.presentationml.presentation".into(),
            extract_pptx(path)?,
        )),
        "xlsx" | "xls" | "ods" => Some(("application/vnd.ms-excel".into(), extract_sheet(path)?)),
        "epub" => Some(("application/epub+zip".into(), extract_epub(path)?)),
        "html" | "htm" => Some((
            "text/html".into(),
            strip_html(&std::fs::read_to_string(path).map_err(|e| format!("Dosya okunamadı: {e}"))?),
        )),
        "rtf" => Some((
            "application/rtf".into(),
            strip_rtf(&std::fs::read_to_string(path).map_err(|e| format!("Dosya okunamadı: {e}"))?),
        )),
        _ => None,
    };

    if let Some((mime_type, text)) = rich {
        let metadata =
            std::fs::metadata(path).map_err(|e| format!("Dosya bilgisi okunamadı: {e}"))?;
        if text.trim().is_empty() {
            return Err("Belgeden metin çıkarılamadı (boş ya da yalnızca görsel içerik).".into());
        }
        return Ok(ParsedDocument {
            filename: path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            mime_type,
            extracted_text: truncate_chars(text, MAX_INDEX_CHARS),
            size_bytes: metadata.len(),
            base64_data: None,
        });
    }

    let mut doc = parse_file(file_path)?;
    if doc.base64_data.is_some() {
        return Err("Resim dosyaları kütüphaneye indekslenemez.".into());
    }
    // parse_file 50K kırpar — indeks için dosyayı geniş limitle yeniden oku.
    if let Ok(full) = std::fs::read_to_string(path) {
        doc.extracted_text = truncate_chars(full, MAX_INDEX_CHARS);
    }
    Ok(doc)
}

// ---- Zengin format çıkarıcıları (kütüphane indeksi) ---------------------------
// docx/pptx/epub aslında ZIP+XML — quick-xml gibi ek bağımlılık yerine metin
// node'ları regex ile süpürülür (indeks amaçlı düz metin için fazlasıyla yeterli).

/// ZIP arşivinden tek bir dosyayı string olarak okur.
fn zip_entry(path: &Path, name: &str) -> Result<Option<String>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Dosya açılamadı: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Arşiv okunamadı: {e}"))?;
    if let Ok(mut entry) = archive.by_name(name) {
        use std::io::Read;
        let mut s = String::new();
        entry
            .read_to_string(&mut s)
            .map_err(|e| format!("Arşiv girdisi okunamadı: {e}"))?;
        return Ok(Some(s));
    }
    Ok(None)
}

fn zip_entry_names(path: &Path) -> Result<Vec<String>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Dosya açılamadı: {e}"))?;
    let archive = zip::ZipArchive::new(file).map_err(|e| format!("Arşiv okunamadı: {e}"))?;
    Ok(archive.file_names().map(|s| s.to_string()).collect())
}

fn decode_xml_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

/// XML gövdesinden `<tag ...>metin</tag>` node metinlerini toplar; paragraf
/// kapanışlarında satır sonu düşer.
fn collect_xml_text(xml: &str, text_tag: &str, para_close: &str) -> String {
    let re = regex::Regex::new(&format!(
        r"<{t}(?:\s[^>]*)?>([^<]*)</{t}>|(</{p}>)",
        t = regex::escape(text_tag),
        p = regex::escape(para_close),
    ))
    .expect("statik regex");
    let mut out = String::new();
    for cap in re.captures_iter(xml) {
        if let Some(text) = cap.get(1) {
            out.push_str(&decode_xml_entities(text.as_str()));
        } else {
            out.push('\n');
        }
    }
    out
}

/// Word (.docx): word/document.xml içindeki <w:t> node'ları.
fn extract_docx(path: &Path) -> Result<String, String> {
    let xml = zip_entry(path, "word/document.xml")?
        .ok_or("docx içinde document.xml bulunamadı")?;
    Ok(collect_xml_text(&xml, "w:t", "w:p"))
}

/// PowerPoint (.pptx): ppt/slides/slideN.xml dosyalarındaki <a:t> node'ları.
fn extract_pptx(path: &Path) -> Result<String, String> {
    let mut slides: Vec<String> = zip_entry_names(path)?
        .into_iter()
        .filter(|n| n.starts_with("ppt/slides/slide") && n.ends_with(".xml"))
        .collect();
    // slide1, slide2, ... doğal sıra (slide10, slide1'den sonra gelsin).
    slides.sort_by_key(|n| {
        n.trim_start_matches("ppt/slides/slide")
            .trim_end_matches(".xml")
            .parse::<u32>()
            .unwrap_or(0)
    });
    let mut out = String::new();
    for name in slides {
        if let Some(xml) = zip_entry(path, &name)? {
            out.push_str(&collect_xml_text(&xml, "a:t", "a:p"));
            out.push_str("\n\n");
        }
    }
    Ok(out)
}

/// Excel (.xlsx/.xls/.ods): tüm sayfalardaki hücreler satır satır (calamine).
fn extract_sheet(path: &Path) -> Result<String, String> {
    use calamine::{open_workbook_auto, Reader};
    let mut workbook =
        open_workbook_auto(path).map_err(|e| format!("Tablo dosyası açılamadı: {e}"))?;
    let mut out = String::new();
    let sheet_names = workbook.sheet_names().to_vec();
    for name in sheet_names {
        if let Ok(range) = workbook.worksheet_range(&name) {
            out.push_str(&format!("# {name}\n"));
            for row in range.rows() {
                let line = row
                    .iter()
                    .map(|c| c.to_string())
                    .filter(|s| !s.trim().is_empty())
                    .collect::<Vec<_>>()
                    .join(" | ");
                if !line.is_empty() {
                    out.push_str(&line);
                    out.push('\n');
                }
            }
            out.push('\n');
        }
    }
    Ok(out)
}

/// EPUB: arşivdeki (x)html bölümleri sırayla, tag'ler süpürülerek.
fn extract_epub(path: &Path) -> Result<String, String> {
    let mut chapters: Vec<String> = zip_entry_names(path)?
        .into_iter()
        .filter(|n| n.ends_with(".xhtml") || n.ends_with(".html") || n.ends_with(".htm"))
        .collect();
    chapters.sort();
    let mut out = String::new();
    for name in chapters {
        if let Some(html) = zip_entry(path, &name)? {
            out.push_str(&strip_html(&html));
            out.push_str("\n\n");
        }
    }
    Ok(out)
}

/// HTML → düz metin (scraper zaten bağımlılıklarda; script/style atlanır).
fn strip_html(html: &str) -> String {
    let doc = scraper::Html::parse_document(html);
    let skip = scraper::Selector::parse("script, style").expect("statik selector");
    let skipped: std::collections::HashSet<_> = doc
        .select(&skip)
        .flat_map(|el| el.text().map(|t| t.as_ptr()))
        .collect();
    doc.root_element()
        .text()
        .filter(|t| !skipped.contains(&t.as_ptr()))
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// RTF → kaba düz metin: kontrol kelimeleri ve gruplar süpürülür.
fn strip_rtf(rtf: &str) -> String {
    let re = regex::Regex::new(r"\\[a-zA-Z]+-?\d*\s?|[{}]|\\'[0-9a-fA-F]{2}").expect("statik regex");
    re.replace_all(rtf, " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
