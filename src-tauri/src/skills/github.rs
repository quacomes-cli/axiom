use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Instant;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubSkillInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub stars: u64,
    pub url: String,
    pub topics: Vec<String>,
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillContent {
    pub prompt: String,
    pub source_file: String,
}

#[derive(Deserialize)]
struct GhSearchResponse {
    items: Vec<GhRepo>,
}

#[derive(Deserialize)]
struct GhRepo {
    full_name: String,
    name: String,
    description: Option<String>,
    stargazers_count: u64,
    html_url: String,
    topics: Vec<String>,
    owner: GhOwner,
}

#[derive(Deserialize)]
struct GhOwner {
    login: String,
    avatar_url: String,
}

struct CacheEntry {
    data: Vec<GitHubSkillInfo>,
    fetched_at: Instant,
}

static CACHE: Mutex<Option<CacheEntry>> = Mutex::new(None);
const CACHE_TTL_SECS: u64 = 300;

const CURATED_REPOS: &[(&str, &str)] = &[
    (
        "f/awesome-chatgpt-prompts",
        "Curated ChatGPT prompts collection",
    ),
    (
        "danielmiessler/fabric",
        "AI augmented human intelligence patterns",
    ),
    (
        "jujumilk3/leaked-system-prompts",
        "Collection of system prompts",
    ),
];

pub async fn discover(query: Option<String>) -> Result<Vec<GitHubSkillInfo>, String> {
    if query.is_none() {
        let cache = CACHE.lock().unwrap();
        if let Some(entry) = &*cache {
            if entry.fetched_at.elapsed().as_secs() < CACHE_TTL_SECS {
                return Ok(entry.data.clone());
            }
        }
        drop(cache);
    }

    let client = reqwest::Client::builder()
        .user_agent("Axiom-Desktop/0.1")
        .build()
        .map_err(|e| format!("HTTP client oluşturulamadı: {e}"))?;

    let mut results: Vec<GitHubSkillInfo> = Vec::new();

    if query.is_none() {
        for &(full_name, desc) in CURATED_REPOS {
            let parts: Vec<&str> = full_name.split('/').collect();
            if parts.len() == 2 {
                results.push(GitHubSkillInfo {
                    id: full_name.to_string(),
                    name: parts[1].to_string(),
                    description: desc.to_string(),
                    author: parts[0].to_string(),
                    stars: 0,
                    url: format!("https://github.com/{full_name}"),
                    topics: vec!["curated".to_string()],
                    avatar_url: format!("https://github.com/{}.png", parts[0]),
                });
            }
        }
    }

    let search_query = match &query {
        Some(q) => format!("{q} topic:system-prompt OR topic:ai-prompt"),
        None => "topic:system-prompt sort:stars".to_string(),
    };

    let url = format!(
        "https://api.github.com/search/repositories?q={}&sort=stars&per_page=20",
        urlencoding::encode(&search_query)
    );

    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => {
            if let Ok(data) = resp.json::<GhSearchResponse>().await {
                let existing_ids: std::collections::HashSet<String> =
                    results.iter().map(|r| r.id.clone()).collect();

                for repo in data.items {
                    let id = repo.full_name.clone();
                    if existing_ids.contains(&id) {
                        continue;
                    }
                    results.push(GitHubSkillInfo {
                        id,
                        name: repo.name,
                        description: repo.description.unwrap_or_default(),
                        author: repo.owner.login,
                        stars: repo.stargazers_count,
                        url: repo.html_url,
                        topics: repo.topics,
                        avatar_url: repo.owner.avatar_url,
                    });
                }
            }
        }
        _ => {
            if results.is_empty() {
                return Err("GitHub API'ye erişilemedi".to_string());
            }
        }
    }

    if query.is_none() {
        let mut cache = CACHE.lock().unwrap();
        *cache = Some(CacheEntry {
            data: results.clone(),
            fetched_at: Instant::now(),
        });
    }

    Ok(results)
}

pub async fn fetch_content(owner: &str, repo: &str) -> Result<SkillContent, String> {
    let client = reqwest::Client::builder()
        .user_agent("Axiom-Desktop/0.1")
        .build()
        .map_err(|e| format!("HTTP client oluşturulamadı: {e}"))?;

    let candidates = [
        "skill.md",
        "prompt.md",
        "system-prompt.md",
        "PROMPT.md",
        "README.md",
    ];

    for file in candidates {
        let url = format!("https://raw.githubusercontent.com/{owner}/{repo}/main/{file}");

        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(text) = resp.text().await {
                    let prompt = if file == "README.md" {
                        extract_prompt_from_readme(&text)
                    } else {
                        text
                    };
                    if !prompt.trim().is_empty() {
                        return Ok(SkillContent {
                            prompt,
                            source_file: file.to_string(),
                        });
                    }
                }
            }
            _ => continue,
        }
    }

    Err(format!(
        "'{owner}/{repo}' deposunda prompt dosyası bulunamadı"
    ))
}

fn extract_prompt_from_readme(text: &str) -> String {
    // Try to find a code block after "system prompt" heading
    let lower = text.to_lowercase();
    if let Some(idx) = lower.find("## system prompt") {
        let rest = &text[idx..];
        if let Some(start) = rest.find("```") {
            let after_fence = &rest[start + 3..];
            // Skip language identifier line
            let content_start = after_fence.find('\n').map(|i| i + 1).unwrap_or(0);
            let content = &after_fence[content_start..];
            if let Some(end) = content.find("```") {
                return content[..end].trim().to_string();
            }
        }
    }

    // Fallback: first code block
    if let Some(start) = text.find("```") {
        let after_fence = &text[start + 3..];
        let content_start = after_fence.find('\n').map(|i| i + 1).unwrap_or(0);
        let content = &after_fence[content_start..];
        if let Some(end) = content.find("```") {
            let block = content[..end].trim();
            if block.len() > 50 {
                return block.to_string();
            }
        }
    }

    // Last resort: use the full README (truncated)
    let truncated: String = text.chars().take(5000).collect();
    truncated
}
