mod audio;
mod documents;
mod filesystem;
mod ipc;
mod mcp;
mod memory;
mod permissions;
mod runtime;
mod screen;
mod search;
mod settings;
mod shell;
mod skills;
use std::sync::RwLock;
use tauri::Manager;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use permissions::PermissionEngine;
use runtime::registry::ModelRegistry;
use settings::AppSettings;

pub struct SettingsState {
    pub settings: RwLock<AppSettings>,

    pub config_path: std::path::PathBuf,
}

pub struct MemoryState {
    pub store: memory::MemoryStore,
    pub db_path: std::path::PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let config_dir = app
                .path()
                .app_config_dir()
                .expect("failed to resolve app config dir");
            let engine = PermissionEngine::load(config_dir.join("permissions.json"));
            app.manage(engine);

            let settings_path = config_dir.join("settings.json");
            let app_settings = settings::load_or_default(&settings_path);
            // Diskte düz metin API anahtarı kaldıysa ilk açılışta keyring'e taşı
            // (save, anahtarları stash'leyip json'a sentinel yazar).
            if settings::disk_has_plaintext_keys(&settings_path) {
                if let Err(e) = settings::save(&settings_path, &app_settings) {
                    eprintln!("[secrets] açılış göçü başarısız: {e}");
                }
            }
            let registry = ModelRegistry::new(
                app_settings.model_config.ollama_base_url.clone(),
                app_settings.model_config.cloud_providers.clone(),
                app_settings.model_config.active_model.clone(),
                app_settings.model_config.optimization.clone(),
            );

            app.manage(registry);
            app.manage(SettingsState {
                settings: RwLock::new(app_settings),
                config_path: settings_path,
            });
            app.manage(mcp::McpManager::default());

            let memory_path = config_dir.join("memory.db");
            match memory::MemoryStore::open(&memory_path) {
                Ok(store) => {
                    app.manage(MemoryState {
                        store,
                        db_path: memory_path,
                    });
                }
                Err(e) => {
                    eprintln!("[memory] failed to open store: {e}");
                }
            }

            // --- PENCERE İKONUNU DEĞİŞTİRME OPERASYONU ---
            if let Some(window) = app.get_webview_window("main") {
                let icon_bytes = include_bytes!("../icons/app-window-icon.png");
                if let Ok(tauri_icon) = tauri::image::Image::from_bytes(icon_bytes) {
                    let _ = window.set_icon(tauri_icon);
                }
            }

            // --- PALET PENCERESİ: Windows Acrylic blur ---
            // CSS backdrop-filter Tauri'de çalışmadığı için OS düzeyinde
            // Acrylic (Win 10+) / Mica (Win 11) efekti uyguluyoruz.
            if let Some(palette_win) = app.get_webview_window("palette") {
                #[cfg(target_os = "windows")]
                {
                    use window_vibrancy::apply_acrylic;
                    // RGB tint + alpha — şeffaflığı CSS bg ile değil OS ile veriyoruz
                    let _ = apply_acrylic(&palette_win, Some((14, 14, 16, 190)));
                }
                #[cfg(target_os = "macos")]
                {
                    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                    let _ = apply_vibrancy(
                        &palette_win,
                        NSVisualEffectMaterial::HudWindow,
                        None,
                        None,
                    );
                }
            }

            // --- SYSTEM TRAY ---
            let show_item = MenuItemBuilder::with_id("show", "Axiom'u Göster").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Çıkış").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let tray_icon_bytes = include_bytes!("../icons/32x32.png");
            let tray_icon_image = tauri::image::Image::from_bytes(tray_icon_bytes)
                .expect("tray icon decode hatası");

            let _tray = TrayIconBuilder::new()
                .icon(tray_icon_image)
                .menu(&tray_menu)
                .tooltip("Axiom")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;
            

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let settings_state = app.state::<SettingsState>();
                let close_to_tray = settings_state
                    .settings
                    .read()
                    .map(|s| s.close_to_tray)
                    .unwrap_or(false);

                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            ipc::commands::app_info,
            ipc::commands::hardware_profile,
            ipc::commands::permissions_get,
            ipc::commands::permissions_set,
            ipc::commands::permissions_check,
            ipc::commands::settings_get,
            ipc::commands::settings_set,
            ipc::commands::set_autostart,
            ipc::commands::models_list,
            ipc::commands::models_pull,
            ipc::commands::models_quantize,
            ipc::commands::models_delete,
            ipc::commands::models_set_active,
            ipc::commands::models_chat,
            ipc::commands::models_chat_stream,
            ipc::commands::ollama_status,
            ipc::commands::ollama_check,
            ipc::commands::ollama_start,
            ipc::commands::ollama_restart,
            ipc::commands::ollama_install,
            ipc::commands::cloud_providers_get,
            ipc::commands::cloud_providers_set,
            ipc::commands::web_search,
            ipc::commands::weather_fetch,
            ipc::commands::currency_fetch,
            ipc::commands::document_parse,
            ipc::commands::skills_discover,
            ipc::commands::skills_fetch_content,
            ipc::commands::fs_read_dir,
            ipc::commands::fs_read_file,
            ipc::commands::fs_write_file,
            ipc::commands::fs_create_dir,
            ipc::commands::fs_apply_edit,
            ipc::commands::fs_delete_path,
            ipc::commands::fs_rename_path,
            ipc::commands::fs_search,
            ipc::commands::fs_glob,
            ipc::commands::shell_exec,
            ipc::commands::shell_exec_stream,
            ipc::commands::http_fetch,
            ipc::commands::oauth_device_start,
            ipc::commands::oauth_device_poll,
            ipc::commands::oauth_localhost_start,
            ipc::commands::optimization_get,
            ipc::commands::optimization_set,
            ipc::commands::optimization_auto_detect,
            ipc::commands::model_show,
            ipc::commands::memory_estimate,
            ipc::commands::ollama_library,
            ipc::commands::ollama_registry_tags,
            ipc::commands::cache_alarm_audio,
            ipc::commands::audio_start_recording,
            ipc::commands::audio_start_recording_vad,
            ipc::commands::audio_cancel_recording,
            ipc::commands::audio_stop_and_transcribe,
            ipc::commands::audio_model_status,
            ipc::commands::audio_download_model,
            ipc::commands::screen_list_monitors,
            ipc::commands::screen_capture,
            ipc::commands::memory_store,
            ipc::commands::memory_recall,
            ipc::commands::memory_clear_chat,
            ipc::commands::memory_clear_all,
            ipc::commands::memory_stats,
            ipc::commands::chat_save,
            ipc::commands::chats_load,
            ipc::commands::chat_delete,
            ipc::commands::chat_images_put,
            ipc::commands::chat_images_load,
            ipc::commands::chat_history_index,
            ipc::commands::chat_history_search,
            ipc::commands::chat_history_clear,
            ipc::commands::mcp_servers_get,
            ipc::commands::mcp_servers_set,
            ipc::commands::mcp_connect,
            ipc::commands::mcp_disconnect,
            ipc::commands::mcp_status,
            ipc::commands::mcp_call,
            ipc::commands::active_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // Uygulama kapanırken MCP çocuk süreçlerini öldür — yetim
            // npx/node süreçleri arka planda kalmasın.
            if let tauri::RunEvent::Exit = event {
                app.state::<mcp::McpManager>().kill_all();
            }
        });
}
