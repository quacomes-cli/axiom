pub mod currency;
pub mod weather;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

pub async fn duckduckgo_search(
    query: &str,
    max_results: usize,
) -> Result<Vec<SearchResult>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("HTTP client oluşturulamadı: {e}"))?;

    let resp = client
        .post("https://html.duckduckgo.com/html/")
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .header("Accept-Language", "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7")
        .header("Referer", "https://html.duckduckgo.com/")
        .header("Origin", "https://html.duckduckgo.com")
        .form(&[("q", query), ("kl", "tr-tr")])
        .send()
        .await
        .map_err(|e| format!("Arama isteği başarısız: {e}"))?;

    let status = resp.status();
    let html = resp
        .text()
        .await
        .map_err(|e| format!("Yanıt okunamadı: {e}"))?;

    if !status.is_success() {
        return Err(format!("DuckDuckGo HTTP {status}"));
    }

    let document = scraper::Html::parse_document(&html);

    let result_sel = scraper::Selector::parse(".result.results_links").unwrap();
    let title_sel = scraper::Selector::parse(".result__a").unwrap();
    let snippet_sel = scraper::Selector::parse(".result__snippet").unwrap();

    let mut results = Vec::new();

    for el in document.select(&result_sel) {
        if results.len() >= max_results {
            break;
        }

        let title_el = match el.select(&title_sel).next() {
            Some(e) => e,
            None => continue,
        };

        let title = title_el.text().collect::<String>().trim().to_string();
        if title.is_empty() {
            continue;
        }

        let raw_href = title_el
            .value()
            .attr("href")
            .unwrap_or_default()
            .to_string();

        let url = extract_url(&raw_href);
        if url.is_empty() {
            continue;
        }

        let snippet = el
            .select(&snippet_sel)
            .next()
            .map(|s| s.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        results.push(SearchResult {
            title,
            url,
            snippet,
        });
    }

    if results.is_empty() {
        let has_results = html.contains("result__a");
        if has_results {
            return Err("HTML parse edildi ama sonuç çıkarılamadı — selector uyumsuzluğu".into());
        }
        let len = html.len();
        return Err(format!(
            "DuckDuckGo boş sonuç döndü (HTML boyutu: {len} byte)"
        ));
    }

    Ok(results)
}

fn extract_url(href: &str) -> String {
    if href.starts_with("//duckduckgo.com/l/?uddg=") || href.starts_with("/l/?uddg=") {
        if let Some(encoded) = href.split("uddg=").nth(1) {
            let encoded = encoded.split('&').next().unwrap_or(encoded);
            return urlencoding::decode(encoded)
                .unwrap_or_default()
                .into_owned();
        }
    }
    if href.starts_with("http") {
        return href.to_string();
    }
    String::new()
}
