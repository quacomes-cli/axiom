use serde::{Deserialize, Serialize};

use crate::runtime::cloud::types::CloudProviderConfig;

fn default_true() -> bool { true }
use crate::runtime::optimizer::OptimizationConfig;
use crate::runtime::registry::ActiveModelRef;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: Theme,
    pub font_size: u8,
    pub font_family: FontFamily,
    pub launch_at_startup: bool,
    #[serde(default)]
    pub close_to_tray: bool,
    #[serde(default = "default_true")]
    pub notify_response: bool,
    #[serde(default = "default_true")]
    pub notify_model_download: bool,
    pub shortcuts: Shortcuts,
    #[serde(default)]
    pub model_config: ModelConfig,
    #[serde(default)]
    pub alarm_sound: AlarmSoundConfig,
    #[serde(default)]
    pub voice: VoiceConfig,
    #[serde(default)]
    pub memory: MemoryConfig,
    #[serde(default)]
    pub tts: TtsConfig,
    #[serde(default)]
    pub clipboard: ClipboardConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardConfig {
    pub max_items: u32,
    /// 0–100; popup background opacity yüzdesi
    pub transparency: u32,
    pub blur: bool,
}

impl Default for ClipboardConfig {
    fn default() -> Self {
        Self {
            max_items: 50,
            transparency: 85,
            blur: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TtsConfig {
    pub enabled: bool,
    /// Web SpeechSynthesis voice name; empty = browser default.
    pub voice: String,
    /// 0.5 .. 2.0
    pub rate: f32,
    /// Asistan yanıtı bittiğinde otomatik seslendir
    pub auto_speak: bool,
}

impl Default for TtsConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            voice: String::new(),
            rate: 1.0,
            auto_speak: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryConfig {
    pub enabled: bool,
    pub embedding_model: String,
    pub top_k: u32,
    pub score_threshold: f32,
    pub cross_chat: bool,
}

impl Default for MemoryConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            embedding_model: "nomic-embed-text".to_string(),
            top_k: 5,
            score_threshold: 0.55,
            cross_chat: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VoiceConfig {
    pub enabled: bool,
    pub model: String,        // "base", "small", "medium", ...
    pub language: String,     // "auto", "tr", "en", ...
    pub push_to_talk: bool,
}

impl Default for VoiceConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            model: "base".to_string(),
            language: "auto".to_string(),
            push_to_talk: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    pub ollama_base_url: String,
    pub cloud_providers: Vec<CloudProviderConfig>,
    pub active_model: Option<ActiveModelRef>,
    pub gguf_paths: Vec<String>,
    #[serde(default)]
    pub optimization: Option<OptimizationConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlarmSoundConfig {
    pub source: AlarmSoundSource,
    pub youtube_url: Option<String>,
    pub local_path: Option<String>,
    pub cached_path: Option<String>,
    pub duration: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AlarmSoundSource {
    Default,
    Youtube,
    Local,
}

impl Default for AlarmSoundConfig {
    fn default() -> Self {
        Self {
            source: AlarmSoundSource::Default,
            youtube_url: None,
            local_path: None,
            cached_path: None,
            duration: 5,
        }
    }
}

impl Default for ModelConfig {
    fn default() -> Self {
        Self {
            ollama_base_url: "http://localhost:11434".to_string(),
            cloud_providers: vec![],
            active_model: None,
            gguf_paths: vec![],
            optimization: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Dark,
    Light,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FontFamily {
    #[serde(rename = "inter")]
    Inter,
    #[serde(rename = "system")]
    System,
    #[serde(rename = "jetbrains")]
    JetBrains,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shortcuts {
    pub toggle_sidebar: String,
    pub search: String,
    pub toggle_screen_vision: String,
    pub new_chat: String,
    #[serde(default = "default_clipboard_shortcut")]
    pub clipboard: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: Theme::Dark,
            font_size: 14,
            font_family: FontFamily::Inter,
            launch_at_startup: false,
            close_to_tray: false,
            notify_response: true,
            notify_model_download: true,
            shortcuts: Shortcuts::default(),
            model_config: ModelConfig::default(),
            alarm_sound: AlarmSoundConfig::default(),
            voice: VoiceConfig::default(),
            memory: MemoryConfig::default(),
            tts: TtsConfig::default(),
            clipboard: ClipboardConfig::default(),
        }
    }
}

impl Default for Shortcuts {
    fn default() -> Self {
        Self {
            toggle_sidebar: "Ctrl+B".to_string(),
            search: "Ctrl+K".to_string(),
            toggle_screen_vision: "Ctrl+Shift+V".to_string(),
            new_chat: "Ctrl+N".to_string(),
            clipboard: default_clipboard_shortcut(),
        }
    }
}

fn default_clipboard_shortcut() -> String {
    "Ctrl+Alt+V".to_string()
}
