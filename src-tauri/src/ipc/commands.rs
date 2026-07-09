//! Tauri IPC command handlers — the typed boundary the React frontend calls
//! through `src/lib/ipc.ts`.

use serde::Serialize;
use tauri::{Manager, State};

use crate::permissions::{Decision, PermissionConfig, PermissionEngine, PermissionQuery};
use crate::runtime::profiler::{self, HardwareProfile};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "Axiom".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[tauri::command]
pub fn hardware_profile() -> HardwareProfile {
    profiler::profile()
}

// ---- Permissions --------------------------------------------------------

/// Returns the current permission config for the Settings UI.
#[tauri::command]
pub fn permissions_get(engine: State<'_, PermissionEngine>) -> PermissionConfig {
    engine.snapshot()
}

/// Persists an updated permission config.
#[tauri::command]
pub fn permissions_set(
    engine: State<'_, PermissionEngine>,
    config: PermissionConfig,
) -> Result<(), String> {
    engine.replace(config).map_err(|e| e.to_string())
}

/// Evaluates a single action against the active config (allow / confirm / deny).
#[tauri::command]
pub fn permissions_check(engine: State<'_, PermissionEngine>, query: PermissionQuery) -> Decision {
    engine.check(&query)
}

// ---- Settings -------------------------------------------------------------

use crate::settings::AppSettings;
use crate::SettingsState;

#[tauri::command]
pub fn settings_get(state: State<'_, SettingsState>) -> AppSettings {
    state.settings.read().unwrap().clone()
}

#[tauri::command]
pub fn settings_set(state: State<'_, SettingsState>, settings: AppSettings) -> Result<(), String> {
    let mut current = state.settings.write().unwrap();
    *current = settings;
    crate::settings::save(&state.config_path, &current)
}

#[tauri::command]
pub fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    }
}

// ---- Models ---------------------------------------------------------------

use tauri::Emitter;

use crate::runtime::cloud::types::CloudProviderConfig;
use crate::runtime::ollama::lifecycle::{self, OllamaStatus};
use crate::runtime::provider::*;
use crate::runtime::registry::ModelRegistry;

#[tauri::command]
pub async fn models_list(registry: State<'_, ModelRegistry>) -> Result<Vec<ModelInfo>, String> {
    registry.list_all_models().await.map_err(|e| e.to_string())
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PullProgressEvent {
    model_id: String,
    status: String,
    completed: Option<u64>,
    total: Option<u64>,
}

#[tauri::command]
pub async fn models_pull(
    app: tauri::AppHandle,
    registry: State<'_, ModelRegistry>,
    provider: ProviderKind,
    model_id: String,
) -> Result<(), String> {
    let app_handle = app.clone();
    let mid = model_id.clone();
    registry
        .pull_model_stream(&provider, &model_id, move |status, completed, total| {
            let _ = app_handle.emit(
                "model-pull-progress",
                PullProgressEvent {
                    model_id: mid.clone(),
                    status,
                    completed,
                    total,
                },
            );
        })
        .await
        .map_err(|e| e.to_string())
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateProgressEvent {
    model_id: String,
    status: String,
    completed: Option<u64>,
    total: Option<u64>,
}

/// Quantizes (or otherwise derives) a new Ollama model `target_tag` from `source`,
/// streaming progress via the `model-create-progress` event.
#[tauri::command]
pub async fn models_quantize(
    app: tauri::AppHandle,
    registry: State<'_, ModelRegistry>,
    source: String,
    target_tag: String,
    quant_type: String,
) -> Result<(), String> {
    let app_handle = app.clone();
    let tid = target_tag.clone();
    registry
        .create_model_stream(
            &ProviderKind::Ollama,
            &target_tag,
            &source,
            Some(&quant_type),
            move |status, completed, total| {
                let _ = app_handle.emit(
                    "model-create-progress",
                    CreateProgressEvent {
                        model_id: tid.clone(),
                        status,
                        completed,
                        total,
                    },
                );
            },
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn models_delete(
    registry: State<'_, ModelRegistry>,
    provider: ProviderKind,
    model_id: String,
) -> Result<(), String> {
    registry
        .delete_model(&provider, &model_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn models_set_active(
    registry: State<'_, ModelRegistry>,
    settings_state: State<'_, SettingsState>,
    provider: ProviderKind,
    model_id: String,
) -> Result<(), String> {
    registry.set_active(provider.clone(), model_id.clone());

    let mut settings = settings_state.settings.write().unwrap();
    settings.model_config.active_model =
        Some(crate::runtime::registry::ActiveModelRef { provider, model_id });
    crate::settings::save(&settings_state.config_path, &settings)
}

#[tauri::command]
pub async fn models_chat(
    registry: State<'_, ModelRegistry>,
    req: InferenceRequest,
) -> Result<InferenceResponse, String> {
    registry.chat(req).await.map_err(|e| e.to_string())
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamTokenEvent {
    token: String,
    done: bool,
    chat_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    done_reason: Option<String>,
}

#[tauri::command]
pub async fn models_chat_stream(
    app: tauri::AppHandle,
    registry: State<'_, ModelRegistry>,
    req: InferenceRequest,
    chat_id: String,
) -> Result<(), String> {
    let app_handle = app.clone();
    let cid = chat_id.clone();

    registry
        .chat_stream(req, move |token, done, thinking, done_reason| {
            let _ = app_handle.emit(
                "chat-token",
                StreamTokenEvent {
                    token,
                    done,
                    chat_id: cid.clone(),
                    thinking,
                    done_reason,
                },
            );
        })
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ollama_status(registry: State<'_, ModelRegistry>) -> Result<bool, String> {
    Ok(registry.ollama_status().await)
}

#[tauri::command]
pub fn ollama_check() -> OllamaStatus {
    let mut status = lifecycle::check_installed();
    if status.installed {
        status.running = std::net::TcpStream::connect_timeout(
            &"127.0.0.1:11434".parse().unwrap(),
            std::time::Duration::from_secs(2),
        )
        .is_ok();
    }
    status
}

#[tauri::command]
pub fn ollama_start(registry: State<'_, ModelRegistry>) -> Result<(), String> {
    let opt = registry.get_optimization();
    let flash = opt.as_ref().map(|c| c.flash_attention).unwrap_or(false);
    let kv = opt.as_ref().and_then(|c| c.kv_cache_type.clone());
    lifecycle::start_serve(flash, kv.as_deref())
}

#[tauri::command]
pub fn ollama_restart(registry: State<'_, ModelRegistry>) -> Result<(), String> {
    lifecycle::stop_serve()?;
    std::thread::sleep(std::time::Duration::from_millis(500));
    let opt = registry.get_optimization();
    let flash = opt.as_ref().map(|c| c.flash_attention).unwrap_or(false);
    let kv = opt.as_ref().and_then(|c| c.kv_cache_type.clone());
    lifecycle::start_serve(flash, kv.as_deref())
}

#[tauri::command]
pub fn ollama_install() -> Result<(), String> {
    lifecycle::install_via_winget()
}

#[tauri::command]
pub fn cloud_providers_get(registry: State<'_, ModelRegistry>) -> Vec<CloudProviderConfig> {
    registry.get_cloud_configs()
}

#[tauri::command]
pub fn cloud_providers_set(
    registry: State<'_, ModelRegistry>,
    settings_state: State<'_, SettingsState>,
    configs: Vec<CloudProviderConfig>,
) -> Result<(), String> {
    registry.set_cloud_configs(configs.clone());

    let mut settings = settings_state.settings.write().unwrap();
    // Silinen provider'ların keyring kayıtları yetim kalmasın
    for old in &settings.model_config.cloud_providers {
        if !configs.iter().any(|c| c.name == old.name) {
            crate::settings::delete_provider_key(&old.name);
        }
    }
    settings.model_config.cloud_providers = configs;
    crate::settings::save(&settings_state.config_path, &settings)
}

// ---- Genel amaçlı sır saklama (keyring) ----------------------------------------
// Uygulama entegrasyonu token'ları (Telegram bot_token vb.) için: frontend
// bu sır değerlerini localStorage'a değil buraya yazar/okur.

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    crate::settings::store_secret(&key, &value)
}

#[tauri::command]
pub fn secret_get(key: String) -> Option<String> {
    crate::settings::read_secret(&key)
}

#[tauri::command]
pub fn secret_delete(key: String) {
    crate::settings::delete_secret(&key)
}

// ---- Web Search ---------------------------------------------------------------

use crate::search::SearchResult;

#[tauri::command]
pub async fn web_search(
    query: String,
    max_results: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    crate::search::duckduckgo_search(&query, max_results.unwrap_or(5)).await
}

// ---- Documents ----------------------------------------------------------------

use crate::documents::ParsedDocument;

#[tauri::command]
pub fn document_parse(file_path: String) -> Result<ParsedDocument, String> {
    crate::documents::parse_file(&file_path)
}

// ---- Skills -------------------------------------------------------------------

use crate::skills::github::{GitHubSkillInfo, SkillContent};

#[tauri::command]
pub async fn skills_discover(query: Option<String>) -> Result<Vec<GitHubSkillInfo>, String> {
    crate::skills::github::discover(query).await
}

#[tauri::command]
pub async fn skills_fetch_content(owner: String, repo: String) -> Result<SkillContent, String> {
    crate::skills::github::fetch_content(&owner, &repo).await
}

// ---- Filesystem & Shell -------------------------------------------------------

use crate::filesystem::{EditResult, FileEntry, ReadFileResult, SearchMatch};
use crate::shell::ShellOutput;

#[tauri::command]
pub fn fs_read_dir(
    path: String,
    max_depth: Option<u32>,
    project_root: String,
) -> Result<Vec<FileEntry>, String> {
    crate::filesystem::read_dir(&path, max_depth.unwrap_or(2), &project_root)
}

#[tauri::command]
pub fn fs_read_file(
    path: String,
    project_root: String,
    offset: Option<u32>,
    limit: Option<u32>,
) -> Result<ReadFileResult, String> {
    crate::filesystem::read_file(&path, &project_root, offset, limit)
}

#[tauri::command]
pub fn fs_write_file(path: String, content: String, project_root: String) -> Result<(), String> {
    crate::filesystem::write_file(&path, &content, &project_root)
}

#[tauri::command]
pub fn fs_create_dir(path: String, project_root: String) -> Result<(), String> {
    crate::filesystem::create_dir(&path, &project_root)
}

#[tauri::command]
pub fn fs_apply_edit(
    path: String,
    old_string: String,
    new_string: String,
    replace_all: Option<bool>,
    project_root: String,
) -> Result<EditResult, String> {
    crate::filesystem::apply_edit(
        &path,
        &old_string,
        &new_string,
        replace_all.unwrap_or(false),
        &project_root,
    )
}

#[tauri::command]
pub fn fs_delete_path(path: String, project_root: String) -> Result<(), String> {
    crate::filesystem::delete_path(&path, &project_root)
}

#[tauri::command]
pub fn fs_rename_path(from: String, to: String, project_root: String) -> Result<(), String> {
    crate::filesystem::rename_path(&from, &to, &project_root)
}

#[tauri::command]
pub fn fs_search(
    query: String,
    path: Option<String>,
    project_root: String,
    case_sensitive: Option<bool>,
) -> Result<Vec<SearchMatch>, String> {
    crate::filesystem::search_files(
        &query,
        path.as_deref(),
        &project_root,
        case_sensitive.unwrap_or(false),
    )
}

#[tauri::command]
pub fn fs_glob(pattern: String, project_root: String) -> Result<Vec<String>, String> {
    crate::filesystem::glob_files(&pattern, &project_root)
}

#[tauri::command]
pub fn shell_exec(command: String, cwd: Option<String>) -> Result<ShellOutput, String> {
    crate::shell::exec(&command, cwd.as_deref())
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellOutputEvent {
    exec_id: String,
    chunk: String,
    stream: String,
    done: bool,
    exit_code: Option<i32>,
}

#[tauri::command]
pub async fn shell_exec_stream(
    app: tauri::AppHandle,
    command: String,
    cwd: Option<String>,
    exec_id: String,
    timeout_secs: Option<u64>,
) -> Result<(), String> {
    let app_handle = app.clone();
    let eid = exec_id.clone();
    let timeout = timeout_secs.unwrap_or(120);

    let result = tokio::task::spawn_blocking(move || {
        let app2 = app_handle.clone();
        let eid2 = eid.clone();
        let code = crate::shell::exec_stream(&command, cwd.as_deref(), timeout, move |stream, line| {
            let _ = app2.emit(
                "shell-output",
                ShellOutputEvent {
                    exec_id: eid2.clone(),
                    chunk: line,
                    stream: stream.to_string(),
                    done: false,
                    exit_code: None,
                },
            );
        });
        (code, app_handle, eid)
    })
    .await
    .map_err(|e| format!("Task hatası: {e}"))?;

    let (code, app_handle, eid) = result;
    let exit_code = code.as_ref().ok().copied();
    let _ = app_handle.emit(
        "shell-output",
        ShellOutputEvent {
            exec_id: eid,
            chunk: String::new(),
            stream: "stdout".to_string(),
            done: true,
            exit_code,
        },
    );

    code.map(|_| ())
}

// ---- Weather & Currency -------------------------------------------------------

use crate::search::currency::CurrencyData;
use crate::search::weather::WeatherData;

#[tauri::command]
pub async fn weather_fetch(city: String) -> Result<WeatherData, String> {
    crate::search::weather::fetch_weather(&city).await
}

#[tauri::command]
pub async fn currency_fetch() -> Result<CurrencyData, String> {
    crate::search::currency::fetch_currency().await
}

// ---- Generic HTTP Fetch (Apps Hub) -------------------------------------------

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpFetchRequest {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<std::collections::HashMap<String, String>>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpFetchResponse {
    pub status: u16,
    pub body: String,
}

#[tauri::command]
pub async fn http_fetch(req: HttpFetchRequest) -> Result<HttpFetchResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client hatası: {e}"))?;

    let method = match req.method.as_deref().unwrap_or("GET") {
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        _ => reqwest::Method::GET,
    };

    let mut builder = client.request(method, &req.url);

    if let Some(headers) = &req.headers {
        for (k, v) in headers {
            builder = builder.header(k.as_str(), v.as_str());
        }
    }

    if let Some(body) = req.body {
        builder = builder.body(body);
    }

    let resp = builder.send().await.map_err(|e| format!("HTTP istek hatası: {e}"))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| format!("Yanıt okunamadı: {e}"))?;

    Ok(HttpFetchResponse { status, body })
}

// ---- OAuth Device Flow (GitHub) -----------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[tauri::command]
pub async fn oauth_device_start(client_id: String, scopes: String) -> Result<DeviceCodeResponse, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[("client_id", &client_id), ("scope", &scopes)])
        .send()
        .await
        .map_err(|e| format!("Device code isteği başarısız: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub HTTP {}: {}", status, body));
    }

    let data: serde_json::Value = resp.json().await.map_err(|e| format!("JSON parse hatası: {e}"))?;

    Ok(DeviceCodeResponse {
        device_code: data["device_code"].as_str().unwrap_or_default().to_string(),
        user_code: data["user_code"].as_str().unwrap_or_default().to_string(),
        verification_uri: data["verification_uri"].as_str().unwrap_or("https://github.com/login/device").to_string(),
        expires_in: data["expires_in"].as_u64().unwrap_or(900),
        interval: data["interval"].as_u64().unwrap_or(5),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePollResult {
    pub status: String,
    pub access_token: Option<String>,
}

#[tauri::command]
pub async fn oauth_device_poll(client_id: String, device_code: String) -> Result<DevicePollResult, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", &client_id),
            ("device_code", &device_code),
            ("grant_type", &"urn:ietf:params:oauth:grant-type:device_code".to_string()),
        ])
        .send()
        .await
        .map_err(|e| format!("Token poll hatası: {e}"))?;

    let data: serde_json::Value = resp.json().await.map_err(|e| format!("JSON parse hatası: {e}"))?;

    if let Some(token) = data["access_token"].as_str() {
        Ok(DevicePollResult {
            status: "success".to_string(),
            access_token: Some(token.to_string()),
        })
    } else {
        let error = data["error"].as_str().unwrap_or("unknown");
        Ok(DevicePollResult {
            status: error.to_string(),
            access_token: None,
        })
    }
}

// ---- OAuth Localhost Callback (Notion, Discord) --------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthCallbackResult {
    pub auth_url: String,
    pub port: u16,
}

#[tauri::command]
pub async fn oauth_localhost_start(
    app: tauri::AppHandle,
    provider: String,
    client_id: String,
    auth_url_base: String,
    scopes: String,
) -> Result<OAuthCallbackResult, String> {
    use std::io::{Read, Write};

    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Port dinlenemedi: {e}"))?;
    let port = listener.local_addr().unwrap().port();
    let redirect_uri = format!("http://localhost:{port}");

    let auth_url = format!(
        "{}?client_id={}&redirect_uri={}&scope={}&response_type=code",
        auth_url_base,
        urlencoding::encode(&client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&scopes),
    );

    let app_handle = app.clone();
    let provider_clone = provider.clone();

    std::thread::spawn(move || {
        listener.set_nonblocking(false).ok();
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = [0u8; 2048];
            if let Ok(n) = stream.read(&mut buf) {
                let request = String::from_utf8_lossy(&buf[..n]);
                let code = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .and_then(|path| {
                        path.split('?').nth(1)
                    })
                    .and_then(|qs| {
                        qs.split('&')
                            .find_map(|pair| {
                                let mut kv = pair.splitn(2, '=');
                                let key = kv.next()?;
                                let val = kv.next()?;
                                if key == "code" { Some(urlencoding::decode(val).unwrap_or_default().into_owned()) } else { None }
                            })
                    });

                let (title, subtitle, icon_color) = if code.is_some() {
                    ("Bağlantı Başarılı", "Hesabın bağlandı. Uygulamaya yönlendiriliyorsun...", "#a78bfa")
                } else {
                    ("Bağlantı Başarısız", "Yetkilendirme kodu alınamadı. Lütfen tekrar dene.", "#f87171")
                };

                let html = format!(r##"<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Axiom — {title}</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,{favicon_svg}">
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0d0d0f;font-family:Inter,-apple-system,system-ui,sans-serif;color:#e4e4e7}}
.card{{text-align:center;max-width:380px;padding:48px 32px}}
.logo{{width:48px;height:48px;margin:0 auto 28px}}
.logo svg{{width:100%;height:100%}}
h1{{font-size:20px;font-weight:600;margin-bottom:8px}}
p{{font-size:14px;color:#71717a;line-height:1.6;margin-bottom:32px}}
.badge{{display:inline-flex;align-items:center;gap:8px;padding:8px 20px;border-radius:12px;background:#18181b;border:1px solid #27272a;font-size:13px;color:#a1a1aa}}
.dot{{width:8px;height:8px;border-radius:50%;background:{icon_color}}}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 1500" fill="#ffffff">
      <path d="M944.113 495.395c-24.504 28.585-48.383 49.5-51.914 45.468-19.684-22.477 3.398-540.84-111.176-518.668-55.762 8.984-46.148 210.93-40.988 579.55C617.125 461.422 359.316 160.36 316.523 197.84c-34.262 30.012-15.999 63.43 137.25 259.344 77.91 99.414 141.5 186.672 139.778 195.192-.621 7.664-74.425-5.372-164.629-28.747C9.816 515 207.207 697.148 520.906 783.113l98.555 26.633C527.895 899.492 450.27 968.289 446.066 1018.164c-10.078 116.785 142.41 10.972 303.074-85.512l1.235 131.298c3.66 436.05 121.671 342.644 139.375 77.414 5.29-84.04 11.352-154.617 14.469-157.348 0 0 380.848 408.207 447.227 418.414l1.031-.902c137.801 18.84-25.395-154.684-355.875-532.988C1345.5 876 1398.063 880.965 1397.355 832.695c-.77-52.793-112.273-64.781-413.566-105.57l67.933-75.36c344.66-383.25 70.008-370.094-108.609-156.37z"/>
    </svg>
  </div>
  <h1>{title}</h1>
  <p>{subtitle}</p>
</div>
<script>setTimeout(function(){{window.close()}},1500)</script>
</body>
</html>"##,
                    title = title,
                    subtitle = subtitle,
                    icon_color = icon_color,
                    favicon_svg = urlencoding::encode(r#"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1500 1500' fill='%23a78bfa'><path d='M944 495c-25 29-48 50-52 46-20-23 3-541-111-519-56 9-46 211-41 580C617 461 359 160 317 198c-34 30-16 63 137 259 78 99 142 187 140 195-1 8-74-5-165-29C10 515 207 697 521 783l99 27c-91 90-169 159-173 209-10 117 142 11 303-86l1 131c4 436 122 343 140 78 5-84 11-155 14-158 0 0 381 408 447 418l1-1c138 19-25-154-356-533 349 7 401 11 401-37-1-53-112-65-414-106l68-75c345-383 70-370-109-156z'/></svg>"#),
                );

                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    html.len(),
                    html
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();

                #[derive(Clone, serde::Serialize)]
                #[serde(rename_all = "camelCase")]
                struct OAuthCodeEvent {
                    provider: String,
                    code: Option<String>,
                }

                let _ = app_handle.emit("oauth-callback", OAuthCodeEvent {
                    provider: provider_clone,
                    code,
                });

                if let Some(w) = app_handle.get_webview_window("main") {
                    let _ = w.set_focus();
                }
            }
        }
    });

    Ok(OAuthCallbackResult { auth_url, port })
}

// ---- Optimization ----

use crate::runtime::optimizer::{self, MemoryEstimate, OptimizationConfig, ProfilePreset};

#[tauri::command]
pub fn optimization_get(registry: State<'_, ModelRegistry>) -> Option<OptimizationConfig> {
    registry.get_optimization()
}

#[tauri::command]
pub fn optimization_set(
    registry: State<'_, ModelRegistry>,
    state: State<'_, SettingsState>,
    config: OptimizationConfig,
) -> Result<(), String> {
    registry.set_optimization(Some(config.clone()));

    let mut settings = state.settings.write().unwrap();
    settings.model_config.optimization = Some(config);
    crate::settings::save(&state.config_path, &settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn optimization_auto_detect(
    registry: State<'_, ModelRegistry>,
    preset: Option<String>,
    hw_override: Option<HardwareProfile>,
) -> Result<OptimizationConfig, String> {
    let hw = match hw_override {
        Some(h) => h,
        None => tokio::task::spawn_blocking(profiler::profile)
            .await
            .map_err(|e| format!("Profil oluşturulamadı: {e}"))?,
    };
    let models = registry
        .list_all_models()
        .await
        .map_err(|e| e.to_string())?;

    let active_ref = registry.get_active();
    let active_model = active_ref.as_ref().and_then(|a| {
        models.iter().find(|m| m.id == a.model_id)
    });

    let default_model = ModelInfo {
        id: "unknown".to_string(),
        provider: crate::runtime::provider::ProviderKind::Ollama,
        display_name: "Unknown".to_string(),
        size_bytes: None,
        quantization: None,
        parameter_count: Some("7B".to_string()),
        context_length: None,
        is_active: false,
        family: None,
        capabilities: None,
    };

    let model = active_model.unwrap_or(&default_model);

    let preset_enum = match preset.as_deref() {
        Some("hiz") => ProfilePreset::Hiz,
        Some("kalite") => ProfilePreset::Kalite,
        Some("ozel") => ProfilePreset::Ozel,
        _ => ProfilePreset::Denge,
    };

    Ok(optimizer::auto_configure_with_preset(&hw, model, &preset_enum))
}

// ---- Model Detail (Show + Memory Estimate) ----

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDetail {
    pub family: Option<String>,
    pub parameter_size: Option<String>,
    pub quantization_level: Option<String>,
    pub format: Option<String>,
    pub parent_model: Option<String>,
    pub context_length: Option<u64>,
    pub memory_estimate: MemoryEstimate,
}

#[tauri::command]
pub async fn model_show(
    registry: State<'_, ModelRegistry>,
    model_id: String,
) -> Result<ModelDetail, String> {
    let show = registry
        .show_model(&model_id)
        .await
        .map_err(|e| e.to_string())?;

    // Extract context length from model_info if available
    let ctx_length = show.model_info.as_ref().and_then(|info| {
        // Ollama stores it under various keys
        info.get("llama.context_length")
            .or_else(|| info.get("general.context_length"))
            .and_then(|v| v.as_u64())
    });

    let hw = tokio::task::spawn_blocking(profiler::profile)
        .await
        .map_err(|e| format!("Profil oluşturulamadı: {e}"))?;

    let estimate = optimizer::estimate_memory(
        &hw,
        show.details.parameter_size.as_deref(),
        show.details.quantization_level.as_deref(),
        ctx_length.unwrap_or(4096) as u32,
    );

    Ok(ModelDetail {
        family: show.details.family,
        parameter_size: show.details.parameter_size,
        quantization_level: show.details.quantization_level,
        format: show.details.format,
        parent_model: show.details.parent_model,
        context_length: ctx_length,
        memory_estimate: estimate,
    })
}

// ---- Ollama Library (remote catalog) ----------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryModel {
    pub id: String,
    pub description: String,
    pub pulls: String,
    pub updated: String,
    pub capabilities: Vec<String>,
    pub sizes: Vec<String>,
}

/// Ollama kütüphanesinden bir modelin tüm tag'lerini çeker (quantization için F16
/// kaynak tag'ini bulmaya yarar). Tam tag'ler döner, örn. "gemma3:12b-it-fp16".
/// `model` ad olabilir veya `:tag` içerebilir; taban alınır.
#[tauri::command]
pub async fn ollama_registry_tags(model: String) -> Result<Vec<String>, String> {
    let base = model.split(':').next().unwrap_or(&model).to_string();
    let url = format!("https://ollama.com/library/{base}/tags");

    let html = reqwest::get(&url)
        .await
        .map_err(|e| format!("Bağlantı hatası: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Okuma hatası: {e}"))?;

    let re = regex::Regex::new(&format!(r"{}:[A-Za-z0-9._-]+", regex::escape(&base)))
        .map_err(|e| format!("Regex hatası: {e}"))?;
    let mut tags: Vec<String> = re.find_iter(&html).map(|m| m.as_str().to_string()).collect();
    tags.sort();
    tags.dedup();

    if tags.is_empty() {
        return Err(format!(
            "'{base}' için tag bulunamadı. Özel/yerel bir model olabilir."
        ));
    }
    Ok(tags)
}

#[tauri::command]
pub async fn ollama_library() -> Result<Vec<LibraryModel>, String> {
    use scraper::{Html, Selector};

    let html = reqwest::get("https://ollama.com/library")
        .await
        .map_err(|e| format!("Bağlantı hatası: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Okuma hatası: {e}"))?;

    let doc = Html::parse_document(&html);
    let li_sel = Selector::parse("li[x-test-model]").unwrap();
    let title_sel = Selector::parse("div[x-test-model-title]").unwrap();
    let desc_sel = Selector::parse("p.text-neutral-800").unwrap();
    let cap_sel = Selector::parse("span[x-test-capability]").unwrap();
    let size_sel = Selector::parse("span[x-test-size]").unwrap();
    let pull_sel = Selector::parse("span[x-test-pull-count]").unwrap();
    let updated_sel = Selector::parse("span[x-test-updated]").unwrap();

    let mut models = Vec::new();

    for li in doc.select(&li_sel) {
        let id = li
            .select(&title_sel)
            .next()
            .and_then(|e| e.value().attr("title"))
            .unwrap_or("")
            .to_string();

        if id.is_empty() {
            continue;
        }

        let description = li
            .select(&desc_sel)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        let pulls = li
            .select(&pull_sel)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        let updated = li
            .select(&updated_sel)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string())
            .unwrap_or_default();

        let capabilities: Vec<String> = li
            .select(&cap_sel)
            .map(|e| e.text().collect::<String>().trim().to_string())
            .collect();

        let sizes: Vec<String> = li
            .select(&size_sel)
            .map(|e| e.text().collect::<String>().trim().to_string())
            .collect();

        models.push(LibraryModel {
            id,
            description,
            pulls,
            updated,
            capabilities,
            sizes,
        });
    }

    Ok(models)
}

#[tauri::command]
pub async fn memory_estimate(
    hw_override: Option<HardwareProfile>,
    param_count: Option<String>,
    quantization: Option<String>,
    context: Option<u32>,
) -> Result<MemoryEstimate, String> {
    let hw = match hw_override {
        Some(h) => h,
        None => tokio::task::spawn_blocking(profiler::profile)
            .await
            .map_err(|e| format!("Profil oluşturulamadı: {e}"))?,
    };

    Ok(optimizer::estimate_memory(
        &hw,
        param_count.as_deref(),
        quantization.as_deref(),
        context.unwrap_or(4096),
    ))
}

// ---- Alarm Audio Cache -------------------------------------------------------
// Not: alarm sesi frontend'e base64 data URL olarak DEĞİL, asset protokolü
// (convertFileSrc) üzerinden verilir — büyük dosyalar IPC'de kopyalanmasın.

async fn ensure_ytdlp(cache_dir: &std::path::Path) -> Result<std::path::PathBuf, String> {
    // Check PATH first
    if let Ok(output) = std::process::Command::new("yt-dlp").arg("--version").output() {
        if output.status.success() {
            return Ok(std::path::PathBuf::from("yt-dlp"));
        }
    }

    let bin_dir = cache_dir.join("bin");
    std::fs::create_dir_all(&bin_dir).map_err(|e| format!("bin dizini oluşturulamadı: {e}"))?;
    let exe_path = bin_dir.join("yt-dlp.exe");

    if exe_path.exists() {
        return Ok(exe_path);
    }

    let url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
    let bytes = reqwest::get(url)
        .await
        .map_err(|e| format!("yt-dlp indirilemedi: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("yt-dlp okunurken hata: {e}"))?;

    std::fs::write(&exe_path, &bytes)
        .map_err(|e| format!("yt-dlp yazılamadı: {e}"))?;

    Ok(exe_path)
}

async fn ensure_ffmpeg(cache_dir: &std::path::Path) -> Result<(), String> {
    // Check PATH first
    if let Ok(output) = std::process::Command::new("ffmpeg").arg("-version").output() {
        if output.status.success() {
            return Ok(());
        }
    }

    let bin_dir = cache_dir.join("bin");
    let ffmpeg_path = bin_dir.join("ffmpeg.exe");
    if ffmpeg_path.exists() {
        return Ok(());
    }

    // ffmpeg is needed for audio extraction — download essentials build
    let url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
    let bytes = reqwest::get(url)
        .await
        .map_err(|e| format!("ffmpeg indirilemedi: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("ffmpeg okunurken hata: {e}"))?;

    let tmp_zip = cache_dir.join("ffmpeg.zip");
    std::fs::write(&tmp_zip, &bytes).map_err(|e| format!("ffmpeg zip yazılamadı: {e}"))?;

    // Extract ffmpeg.exe from the zip
    let zip_path = tmp_zip.clone();
    let bin_dir_clone = bin_dir.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = std::fs::File::open(&zip_path).map_err(|e| format!("zip açılamadı: {e}"))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("zip okunamadı: {e}"))?;

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| format!("zip entry: {e}"))?;
            let name = entry.name().to_string();
            if name.ends_with("ffmpeg.exe") || name.ends_with("ffprobe.exe") {
                let fname = std::path::Path::new(&name)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string();
                let out_path = bin_dir_clone.join(&fname);
                let mut out_file = std::fs::File::create(&out_path)
                    .map_err(|e| format!("{fname} oluşturulamadı: {e}"))?;
                std::io::copy(&mut entry, &mut out_file)
                    .map_err(|e| format!("{fname} yazılamadı: {e}"))?;
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("extract task: {e}"))??;

    let _ = std::fs::remove_file(&tmp_zip);

    if !ffmpeg_path.exists() {
        return Err("ffmpeg.exe zip içinde bulunamadı".to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn cache_alarm_audio(
    app: tauri::AppHandle,
    source: String,
    url_or_path: String,
) -> Result<String, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Cache dizini alınamadı: {e}"))?;

    let sounds_dir = cache_dir.join("alarm_sounds");
    std::fs::create_dir_all(&sounds_dir)
        .map_err(|e| format!("Cache dizini oluşturulamadı: {e}"))?;

    match source.as_str() {
        "youtube" => {
            let ytdlp = ensure_ytdlp(&cache_dir).await?;
            ensure_ffmpeg(&cache_dir).await?;

            let out_path = sounds_dir.join("yt_alarm.mp3");
            let out_str = out_path.to_string_lossy().to_string();

            let _ = std::fs::remove_file(&out_path);

            // Add bin dir to PATH so yt-dlp can find ffmpeg
            let bin_dir = cache_dir.join("bin");
            let path_env = match std::env::var("PATH") {
                Ok(p) => format!("{};{p}", bin_dir.to_string_lossy()),
                Err(_) => bin_dir.to_string_lossy().to_string(),
            };

            let ytdlp_clone = ytdlp.clone();
            let url = url_or_path.clone();
            let out = out_str.clone();
            let output = tokio::task::spawn_blocking(move || {
                std::process::Command::new(&ytdlp_clone)
                    .env("PATH", &path_env)
                    .args([
                        "-x",
                        "--audio-format", "mp3",
                        "--audio-quality", "5",
                        "-o", &out,
                        "--no-playlist",
                        "--no-warnings",
                        &url,
                    ])
                    .output()
            })
            .await
            .map_err(|e| format!("Task hatası: {e}"))?
            .map_err(|e| format!("yt-dlp çalıştırılamadı: {e}"))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("yt-dlp hatası: {stderr}"));
            }

            if out_path.exists() {
                Ok(out_str)
            } else {
                // yt-dlp may append extra extension
                let found = std::fs::read_dir(&sounds_dir)
                    .map_err(|e| format!("Dizin okunamadı: {e}"))?
                    .filter_map(|e| e.ok())
                    .find(|e| e.file_name().to_string_lossy().starts_with("yt_alarm"));
                match found {
                    Some(entry) => {
                        std::fs::rename(entry.path(), &out_path)
                            .map_err(|e| format!("Dosya taşınamadı: {e}"))?;
                        Ok(out_str)
                    }
                    None => Err("yt-dlp çıktı dosyası bulunamadı".to_string()),
                }
            }
        }
        "local" => {
            let src = std::path::Path::new(&url_or_path);
            if !src.exists() {
                return Err(format!("Dosya bulunamadı: {url_or_path}"));
            }
            let ext = src
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("mp3");
            let dest = sounds_dir.join(format!("local_alarm.{ext}"));
            std::fs::copy(src, &dest)
                .map_err(|e| format!("Dosya kopyalanamadı: {e}"))?;
            Ok(dest.to_string_lossy().to_string())
        }
        _ => Err(format!("Geçersiz kaynak: {source}")),
    }
}

// ---- Audio / STT ----------------------------------------------------------

use crate::audio;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelStatus {
    pub name: String,
    pub installed: bool,
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTranscript {
    pub text: String,
    pub sample_count: usize,
    pub duration_ms: u64,
}

fn whisper_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir bulunamadı: {e}"))?;
    let out = dir.join("models").join("whisper");
    std::fs::create_dir_all(&out)
        .map_err(|e| format!("whisper dizini oluşturulamadı: {e}"))?;
    Ok(out)
}

#[tauri::command]
pub fn audio_start_recording(session_id: String) -> Result<(), String> {
    audio::start_recording(session_id).map_err(|e| e.to_string())
}

/// Sesli asistan modu: VAD'li kayıt. Konuşma başlangıcı/bitişi "voice-vad"
/// event'iyle frontend'e düşer ({sessionId, kind: "speech-start"|"segment-end"}).
#[tauri::command]
pub fn audio_start_recording_vad(
    app: tauri::AppHandle,
    session_id: String,
    silence_ms: Option<u64>,
    threshold: Option<f32>,
) -> Result<(), String> {
    let defaults = audio::VadConfig::default();
    let cfg = audio::VadConfig {
        silence_ms: silence_ms.unwrap_or(defaults.silence_ms),
        threshold: threshold.unwrap_or(defaults.threshold),
        max_segment_ms: defaults.max_segment_ms,
    };
    let sid = session_id.clone();
    audio::start_recording_with_vad(session_id, cfg, move |kind| {
        let _ = app.emit(
            "voice-vad",
            serde_json::json!({ "sessionId": sid.clone(), "kind": kind }),
        );
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn audio_cancel_recording(session_id: String) -> Result<(), String> {
    audio::cancel_recording(&session_id).map_err(|e| e.to_string())
}

/// Kayıt sürerken canlı (partial) transkript — sesli modda anlık yazım.
/// Ağır iş: async + spawn_blocking (UI thread'i kilitlenmesin).
#[tauri::command]
pub async fn audio_transcribe_snapshot(
    app: tauri::AppHandle,
    session_id: String,
    model_name: String,
    language: Option<String>,
) -> Result<String, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir bulunamadı: {e}"))?;
    let model = audio::model_path(&config_dir, &model_name);
    tauri::async_runtime::spawn_blocking(move || {
        audio::transcribe_snapshot(&session_id, &model, language.as_deref(), 12)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task hatası: {e}"))?
}

#[tauri::command]
pub fn audio_stop_and_transcribe(
    app: tauri::AppHandle,
    session_id: String,
    model_name: String,
    language: Option<String>,
) -> Result<AudioTranscript, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir bulunamadı: {e}"))?;
    let model = audio::model_path(&config_dir, &model_name);
    let lang = language.as_deref();
    let res = audio::stop_recording_and_transcribe(&session_id, &model, lang)
        .map_err(|e| e.to_string())?;
    Ok(AudioTranscript {
        text: res.text,
        sample_count: res.sample_count,
        duration_ms: res.duration_ms,
    })
}

// ---- Belge kütüphanesi (RAG, Faz 8) --------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocsIndexEvent {
    pub path: String,
    pub title: String,
    pub current: usize,
    pub total: usize,
    pub done: bool,
    pub error: Option<String>,
}

/// Dosyaları kütüphaneye ekler: parse → chunk → embed → SQLite.
/// İlerleme "docs-index-progress" event'iyle akar (UI kilitlenmez).
#[tauri::command]
pub async fn docs_add(
    app: tauri::AppHandle,
    registry: State<'_, ModelRegistry>,
    memory: State<'_, MemoryState>,
    paths: Vec<String>,
    embedding_model: String,
) -> Result<usize, String> {
    use tauri::Emitter;

    let total = paths.len();
    let mut added = 0usize;

    for (i, path) in paths.iter().enumerate() {
        let title = std::path::Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        let emit = |done: bool, error: Option<String>| {
            let _ = app.emit(
                "docs-index-progress",
                DocsIndexEvent {
                    path: path.clone(),
                    title: title.clone(),
                    current: i + 1,
                    total,
                    done,
                    error,
                },
            );
        };
        emit(false, None);

        // Parse (bloklayan) — ayrı thread'de.
        let p = path.clone();
        let parsed = match tauri::async_runtime::spawn_blocking(move || {
            crate::documents::parse_for_index(&p)
        })
        .await
        .map_err(|e| format!("task hatası: {e}"))?
        {
            Ok(d) => d,
            Err(e) => {
                emit(true, Some(e));
                continue;
            }
        };

        let chunks_text = crate::memory::chunk_text(&parsed.extracted_text, 1400, 200);
        if chunks_text.is_empty() {
            emit(true, Some("Belgeden metin çıkarılamadı".into()));
            continue;
        }

        // Her parçayı embed'le (yerel ollama).
        let mut chunks: Vec<(String, Vec<f32>)> = Vec::with_capacity(chunks_text.len());
        let mut failed = false;
        for text in chunks_text {
            match registry.embed_ollama(&embedding_model, &text).await {
                Ok(emb) => chunks.push((text, emb)),
                Err(e) => {
                    emit(true, Some(format!("Embedding hatası: {e}")));
                    failed = true;
                    break;
                }
            }
        }
        if failed {
            continue;
        }

        let id = uuid::Uuid::new_v4().to_string();
        if let Err(e) = memory.store.doc_insert(
            &id,
            path,
            &title,
            &parsed.mime_type,
            parsed.size_bytes as i64,
            &embedding_model,
            &chunks,
        ) {
            emit(true, Some(format!("Kayıt hatası: {e}")));
            continue;
        }
        added += 1;
        emit(true, None);
    }

    Ok(added)
}

#[tauri::command]
pub fn docs_list(memory: State<'_, MemoryState>) -> Result<Vec<crate::memory::DocMeta>, String> {
    memory.store.docs_list().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn docs_remove(memory: State<'_, MemoryState>, id: String) -> Result<(), String> {
    memory.store.doc_remove(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn docs_count(memory: State<'_, MemoryState>) -> Result<i64, String> {
    memory.store.docs_count().map_err(|e| e.to_string())
}

/// Kütüphanede hibrit arama (kosinüs + FTS bonusu).
#[tauri::command]
pub async fn docs_search(
    registry: State<'_, ModelRegistry>,
    memory: State<'_, MemoryState>,
    query: String,
    embedding_model: String,
    top_k: Option<usize>,
) -> Result<Vec<crate::memory::DocHit>, String> {
    let emb = registry
        .embed_ollama(&embedding_model, &query)
        .await
        .map_err(|e| e.to_string())?;
    memory
        .store
        .docs_search(&emb, &query, top_k.unwrap_or(5))
        .map_err(|e| e.to_string())
}

// ---- Crash / hata günlüğü (telemetri YOK — yalnızca yerel dosya) ---------------

pub fn logs_dir_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir bulunamadı: {e}"))?
        .join("logs");
    std::fs::create_dir_all(&dir).map_err(|e| format!("logs dizini oluşturulamadı: {e}"))?;
    Ok(dir)
}

pub fn append_log(app: &tauri::AppHandle, file: &str, line: &str) {
    if let Ok(dir) = logs_dir_path(app) {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let entry = format!("[{stamp}] {line}\n");
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join(file))
        {
            let _ = f.write_all(entry.as_bytes());
        }
    }
}

/// Frontend window.onerror / unhandledrejection buraya düşer.
#[tauri::command]
pub fn log_frontend_error(app: tauri::AppHandle, message: String) {
    // Tek satıra indirger; dosya şişmesin diye 2KB kırpılır.
    let line: String = message.replace(['\r', '\n'], " | ").chars().take(2048).collect();
    append_log(&app, "frontend.log", &line);
}

/// Hakkında → "logları aç" için dizin yolu.
#[tauri::command]
pub fn logs_dir(app: tauri::AppHandle) -> Result<String, String> {
    logs_dir_path(&app).map(|p| p.to_string_lossy().to_string())
}

// ---- Piper TTS (doğal sesler) ------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsStatus {
    pub piper_installed: bool,
    pub voice_installed: bool,
    pub voice: String,
}

#[tauri::command]
pub fn tts_status(app: tauri::AppHandle, voice: Option<String>) -> Result<TtsStatus, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir bulunamadı: {e}"))?;
    let voice = voice.unwrap_or_else(|| crate::tts::DEFAULT_VOICE.to_string());
    let (piper, model) = crate::tts::is_installed(&dir, &voice);
    Ok(TtsStatus {
        piper_installed: piper,
        voice_installed: model,
        voice,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsDownloadEvent {
    pub stage: String, // "piper" | "voice"
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub done: bool,
    pub error: Option<String>,
}

async fn download_to(
    app: &tauri::AppHandle,
    url: &str,
    target: &std::path::Path,
    stage: &str,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;
    use tokio::io::AsyncWriteExt;

    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("dizin oluşturulamadı: {e}"))?;
    }
    let tmp = target.with_extension("part");
    let resp = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("indirme başlatılamadı: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} ({url})", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| format!("dosya oluşturulamadı: {e}"))?;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("indirme hatası: {e}"))?;
        downloaded += bytes.len() as u64;
        file.write_all(&bytes).await.map_err(|e| e.to_string())?;
        if last.elapsed().as_millis() > 200 {
            let _ = app.emit(
                "tts-download-progress",
                TtsDownloadEvent {
                    stage: stage.to_string(),
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                    done: false,
                    error: None,
                },
            );
            last = std::time::Instant::now();
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    tokio::fs::rename(&tmp, target)
        .await
        .map_err(|e| format!("dosya taşınamadı: {e}"))?;
    Ok(())
}

/// Piper binary'sini (yoksa) + ses modelini indirir.
#[tauri::command]
pub async fn tts_download(app: tauri::AppHandle, voice: Option<String>) -> Result<(), String> {
    use tauri::Emitter;

    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir bulunamadı: {e}"))?;
    let voice = voice.unwrap_or_else(|| crate::tts::DEFAULT_VOICE.to_string());

    // 1) Piper binary (zip) — yoksa indir + aç.
    if !crate::tts::piper_exe(&dir).exists() {
        let zip_path = crate::tts::piper_dir(&dir).join("piper.zip");
        download_to(&app, crate::tts::piper_zip_url(), &zip_path, "piper").await?;

        let extract_dir = crate::tts::piper_dir(&dir);
        let zp = zip_path.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            let file = std::fs::File::open(&zp).map_err(|e| e.to_string())?;
            let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
            archive.extract(&extract_dir).map_err(|e| e.to_string())?;
            Ok(())
        })
        .await
        .map_err(|e| format!("task hatası: {e}"))??;
        let _ = tokio::fs::remove_file(&zip_path).await;
    }

    // 2) Ses modeli (.onnx + .onnx.json).
    let model = crate::tts::voice_model_path(&dir, &voice);
    if !model.exists() {
        let onnx_url = crate::tts::voice_download_url(&voice, false)
            .ok_or_else(|| format!("geçersiz ses adı: {voice}"))?;
        let json_url = crate::tts::voice_download_url(&voice, true).unwrap();
        download_to(&app, &json_url, &model.with_extension("onnx.json"), "voice").await?;
        download_to(&app, &onnx_url, &model, "voice").await?;
    }

    let _ = app.emit(
        "tts-download-progress",
        TtsDownloadEvent {
            stage: "voice".into(),
            downloaded_bytes: 0,
            total_bytes: 0,
            done: true,
            error: None,
        },
    );
    Ok(())
}

/// Cümleyi konuşma kuyruğuna ekler (stream cevap cümle cümle okunur).
/// `edge_voice` doluysa (örn. "tr-TR-EmelNeural") önce Edge neural ses
/// denenir; hata/offline'da Piper'a düşülür.
#[tauri::command]
pub fn tts_speak(
    app: tauri::AppHandle,
    text: String,
    voice: Option<String>,
    edge_voice: Option<String>,
) -> Result<(), String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir bulunamadı: {e}"))?;
    let voice = voice.unwrap_or_else(|| crate::tts::DEFAULT_VOICE.to_string());
    crate::tts::speak(&dir, &voice, &text, edge_voice.as_deref())
}

/// Barge-in: kuyruğu ve çalan sesi anında keser.
#[tauri::command]
pub fn tts_stop() {
    crate::tts::stop();
}

#[tauri::command]
pub fn tts_is_busy() -> bool {
    crate::tts::is_busy()
}

#[tauri::command]
pub fn audio_model_status(
    app: tauri::AppHandle,
    model_name: String,
) -> Result<WhisperModelStatus, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir bulunamadı: {e}"))?;
    let path = audio::model_path(&config_dir, &model_name);
    let installed = path.exists();
    let size_bytes = if installed {
        std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };
    Ok(WhisperModelStatus {
        name: model_name,
        installed,
        path: path.to_string_lossy().to_string(),
        size_bytes,
    })
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AudioDownloadEvent {
    pub model_name: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub done: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn audio_download_model(
    app: tauri::AppHandle,
    model_name: String,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use tauri::Emitter;

    let dir = whisper_dir(&app)?;
    let target = dir.join(format!("ggml-{}.bin", model_name));
    if target.exists() {
        return Ok(target.to_string_lossy().to_string());
    }
    let tmp = dir.join(format!("ggml-{}.bin.part", model_name));
    let url = audio::model_download_url(&model_name);

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("indirme başlatılamadı: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);

    let mut file = tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| format!("dosya oluşturulamadı: {e}"))?;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("indirme hatası: {e}"))?;
        downloaded += bytes.len() as u64;
        use tokio::io::AsyncWriteExt;
        file.write_all(&bytes)
            .await
            .map_err(|e| format!("yazma hatası: {e}"))?;

        if last_emit.elapsed().as_millis() > 200 {
            let _ = app.emit(
                "audio-download-progress",
                AudioDownloadEvent {
                    model_name: model_name.clone(),
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                    done: false,
                    error: None,
                },
            );
            last_emit = std::time::Instant::now();
        }
    }

    use tokio::io::AsyncWriteExt;
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    tokio::fs::rename(&tmp, &target)
        .await
        .map_err(|e| format!("rename hatası: {e}"))?;

    let _ = app.emit(
        "audio-download-progress",
        AudioDownloadEvent {
            model_name: model_name.clone(),
            downloaded_bytes: downloaded,
            total_bytes: total,
            done: true,
            error: None,
        },
    );

    Ok(target.to_string_lossy().to_string())
}

// ---- Screen Capture -------------------------------------------------------

use crate::screen;
use base64::Engine as _;

#[tauri::command]
pub fn screen_list_monitors() -> Result<Vec<screen::MonitorInfo>, String> {
    screen::list_monitors().map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotResult {
    pub data_url: String,
    pub bytes: usize,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub fn screen_capture(monitor_index: Option<u32>) -> Result<ScreenshotResult, String> {
    let png = match monitor_index {
        Some(i) => screen::capture_monitor(i).map_err(|e| e.to_string())?,
        None => screen::capture_primary().map_err(|e| e.to_string())?,
    };

    let bytes = png.len();
    let (width, height) = match image::load_from_memory_with_format(&png, image::ImageFormat::Png) {
        Ok(img) => (img.width(), img.height()),
        Err(_) => (0, 0),
    };

    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    let data_url = format!("data:image/png;base64,{}", b64);

    Ok(ScreenshotResult {
        data_url,
        bytes,
        width,
        height,
    })
}

// ---- Long-term Memory -----------------------------------------------------

use crate::memory::{MemoryHit, MemoryStats, SearchHit};
use crate::MemoryState;

#[tauri::command]
pub async fn memory_store(
    memory: State<'_, MemoryState>,
    registry: State<'_, ModelRegistry>,
    chat_id: String,
    message_id: String,
    role: String,
    text: String,
    embedding_model: String,
) -> Result<i64, String> {
    if text.trim().is_empty() {
        return Ok(0);
    }
    let embedding = registry
        .embed_ollama(&embedding_model, &text)
        .await
        .map_err(|e| e.to_string())?;
    memory
        .store
        .store(&chat_id, &message_id, &role, &text, &embedding, &embedding_model)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn memory_recall(
    memory: State<'_, MemoryState>,
    registry: State<'_, ModelRegistry>,
    query: String,
    embedding_model: String,
    top_k: Option<usize>,
    exclude_chat_id: Option<String>,
    only_chat_id: Option<String>,
) -> Result<Vec<MemoryHit>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    let q_vec = registry
        .embed_ollama(&embedding_model, &query)
        .await
        .map_err(|e| e.to_string())?;
    memory
        .store
        .recall(
            &q_vec,
            top_k.unwrap_or(5).max(1).min(20),
            exclude_chat_id.as_deref(),
            only_chat_id.as_deref(),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn memory_clear_chat(
    memory: State<'_, MemoryState>,
    chat_id: String,
) -> Result<usize, String> {
    memory.store.clear_chat(&chat_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn memory_clear_all(memory: State<'_, MemoryState>) -> Result<usize, String> {
    memory.store.clear_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn memory_stats(memory: State<'_, MemoryState>) -> Result<MemoryStats, String> {
    memory.store.stats(&memory.db_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chat_history_index(
    memory: State<'_, MemoryState>,
    chat_id: String,
    chat_title: Option<String>,
    message_id: String,
    role: String,
    text: String,
) -> Result<(), String> {
    memory
        .store
        .index_message(&chat_id, chat_title.as_deref(), &message_id, &role, &text)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chat_history_search(
    memory: State<'_, MemoryState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    memory
        .store
        .search_messages(&query, limit.unwrap_or(20).min(100))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chat_history_clear(
    memory: State<'_, MemoryState>,
    chat_id: String,
) -> Result<usize, String> {
    memory
        .store
        .delete_chat_messages(&chat_id)
        .map_err(|e| e.to_string())
}

// ---- Chat Persistence (SQLite) ---------------------------------------------

use crate::memory::StoredChat;

#[tauri::command]
pub fn chat_save(memory: State<'_, MemoryState>, chat: StoredChat) -> Result<(), String> {
    memory.store.chat_save(&chat).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chats_load(memory: State<'_, MemoryState>) -> Result<Vec<StoredChat>, String> {
    memory.store.chats_load().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chat_delete(memory: State<'_, MemoryState>, chat_id: String) -> Result<(), String> {
    memory.store.chat_delete(&chat_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chat_images_put(
    memory: State<'_, MemoryState>,
    chat_id: String,
    message_id: String,
    images: Vec<String>,
) -> Result<(), String> {
    memory
        .store
        .chat_images_put(&chat_id, &message_id, &images)
        .map_err(|e| e.to_string())
}

/// Sohbetin tüm resimlerini `{messageId: [base64…]}` olarak döner.
#[tauri::command]
pub fn chat_images_load(
    memory: State<'_, MemoryState>,
    chat_id: String,
) -> Result<std::collections::HashMap<String, Vec<String>>, String> {
    memory
        .store
        .chat_images_load(&chat_id)
        .map(|pairs| pairs.into_iter().collect())
        .map_err(|e| e.to_string())
}

// ---- MCP (Model Context Protocol) ------------------------------------------

use crate::mcp::{McpManager, McpServerConfig, McpServerStatus, McpToolInfo};

/// Sunucu tanımlarını settings'e yazar (bağlantı kurmaz).
#[tauri::command]
pub fn mcp_servers_set(
    state: State<'_, SettingsState>,
    servers: Vec<McpServerConfig>,
) -> Result<(), String> {
    let mut settings = state.settings.write().unwrap();
    settings.mcp_servers = servers;
    crate::settings::save(&state.config_path, &settings)
}

#[tauri::command]
pub fn mcp_servers_get(state: State<'_, SettingsState>) -> Vec<McpServerConfig> {
    state.settings.read().unwrap().mcp_servers.clone()
}

/// Sunucuya bağlanır (idempotent) ve araç listesini döner.
#[tauri::command]
pub async fn mcp_connect(
    mcp: State<'_, McpManager>,
    settings_state: State<'_, SettingsState>,
    name: String,
) -> Result<Vec<McpToolInfo>, String> {
    let cfg = settings_state
        .settings
        .read()
        .unwrap()
        .mcp_servers
        .iter()
        .find(|s| s.name == name)
        .cloned()
        .ok_or_else(|| format!("'{name}' adlı MCP sunucusu tanımlı değil"))?;
    // Spawn + el sıkışma bloklayıcı — async runtime'ı tıkamasın
    let mcp = mcp.inner().clone();
    tokio::task::spawn_blocking(move || mcp.connect(&cfg))
        .await
        .map_err(|e| format!("task hatası: {e}"))?
}

#[tauri::command]
pub fn mcp_disconnect(mcp: State<'_, McpManager>, name: String) {
    mcp.disconnect(&name);
}

#[tauri::command]
pub fn mcp_status(
    mcp: State<'_, McpManager>,
    settings_state: State<'_, SettingsState>,
) -> Vec<McpServerStatus> {
    let configs = settings_state.settings.read().unwrap().mcp_servers.clone();
    mcp.status(&configs)
}

#[tauri::command]
pub async fn mcp_call(
    mcp: State<'_, McpManager>,
    server: String,
    tool: String,
    args: serde_json::Value,
) -> Result<String, String> {
    let mcp = mcp.inner().clone();
    tokio::task::spawn_blocking(move || mcp.call_tool(&server, &tool, args))
        .await
        .map_err(|e| format!("task hatası: {e}"))?
}

// ---- Active Window --------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveWindowInfo {
    pub title: String,
    pub process_name: String,
}

#[cfg(windows)]
#[tauri::command]
pub fn active_window() -> Result<ActiveWindowInfo, String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::System::ProcessStatus::GetModuleBaseNameW;

    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0.is_null() {
            return Err("Aktif pencere bulunamadı".into());
        }
        let mut buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut buf);
        let title = if len > 0 {
            String::from_utf16_lossy(&buf[..len as usize])
        } else {
            String::new()
        };

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let process_name = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
            .ok()
            .and_then(|h| {
                let mut name = [0u16; 260];
                let n = GetModuleBaseNameW(h, None, &mut name);
                let _ = windows::Win32::Foundation::CloseHandle(h);
                if n > 0 {
                    Some(String::from_utf16_lossy(&name[..n as usize]))
                } else {
                    None
                }
            })
            .unwrap_or_default();

        Ok(ActiveWindowInfo { title, process_name })
    }
}

#[cfg(not(windows))]
#[tauri::command]
pub fn active_window() -> Result<ActiveWindowInfo, String> {
    Err("Aktif pencere bilgisi şu an sadece Windows'ta destekleniyor".into())
}


