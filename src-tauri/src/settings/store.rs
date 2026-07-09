use std::fs;
use std::path::Path;

use super::model::AppSettings;
use super::secrets;

pub fn load_or_default(path: &Path) -> AppSettings {
    let mut settings: AppSettings = match fs::read_to_string(path) {
        Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
        Err(_) => AppSettings::default(),
    };
    // Diskte sentinel olarak duran anahtarları keyring'den geri çöz — bellekteki
    // kopya her zaman gerçek anahtarları taşır.
    secrets::resolve_provider_keys(&mut settings.model_config.cloud_providers);
    settings
}

/// Disk kopyasında hâlâ düz metin API anahtarı var mı? (Açılıştaki tek
/// seferlik keyring göçünün gerekip gerekmediğini anlamak için — bellekteki
/// çözülmüş kopyaya bakılamaz, o her zaman doludur.)
pub fn disk_has_plaintext_keys(path: &Path) -> bool {
    let Ok(json) = fs::read_to_string(path) else { return false };
    let Ok(raw) = serde_json::from_str::<AppSettings>(&json) else { return false };
    raw.model_config
        .cloud_providers
        .iter()
        .any(|p| !p.api_key.is_empty() && p.api_key != secrets::KEYRING_SENTINEL)
}

pub fn save(path: &Path, settings: &AppSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Disk kopyasında API anahtarı olmasın: anahtarlar keyring'e, json'a sentinel.
    // Çağıranın elindeki (bellekteki) settings değişmez.
    let mut disk_copy = settings.clone();
    secrets::stash_provider_keys(&mut disk_copy.model_config.cloud_providers);
    let json = serde_json::to_string_pretty(&disk_copy).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}
