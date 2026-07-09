//! API anahtarlarının diske düz metin yazılmasını engeller.
//!
//! `save()` öncesi cloud provider anahtarları Windows Credential Manager'a
//! (keyring) taşınır ve settings.json'a yalnızca `__keyring__` sentineli
//! yazılır; `load()` sonrası sentinel görülen anahtarlar keyring'den geri
//! çözülür. Böylece bellekteki `AppSettings` her zaman gerçek anahtarları
//! taşır (registry ve UI değişmeden çalışır) ama disk kopyası sır içermez.
//!
//! Hata toleransı: keyring yazılamazsa anahtar json'da düz metin BIRAKILIR
//! (anahtar kaybetmek, sızdırmamaktan daha kötü bir kullanıcı deneyimi);
//! okunamazsa boş string döner ve provider zarifçe devre dışı kalır.

use keyring::Entry;

use crate::runtime::cloud::types::CloudProviderConfig;

const SERVICE: &str = "com.axiom.app";
pub const KEYRING_SENTINEL: &str = "__keyring__";

fn key_name(provider: &str) -> String {
    format!("cloud.{provider}.apiKey")
}

/// Anahtarları keyring'e yazıp yerlerine sentinel koyar (diske yazım öncesi).
pub fn stash_provider_keys(providers: &mut [CloudProviderConfig]) {
    for p in providers.iter_mut() {
        if p.api_key.is_empty() || p.api_key == KEYRING_SENTINEL {
            continue;
        }
        let stored = Entry::new(SERVICE, &key_name(&p.name))
            .and_then(|e| e.set_password(&p.api_key));
        match stored {
            Ok(()) => p.api_key = KEYRING_SENTINEL.to_string(),
            Err(e) => eprintln!("[secrets] '{}' anahtarı keyring'e yazılamadı: {e}", p.name),
        }
    }
}

/// Sentinel görülen anahtarları keyring'den gerçek değerlerine çözer (yükleme sonrası).
pub fn resolve_provider_keys(providers: &mut [CloudProviderConfig]) {
    for p in providers.iter_mut() {
        if p.api_key != KEYRING_SENTINEL {
            continue;
        }
        p.api_key = Entry::new(SERVICE, &key_name(&p.name))
            .and_then(|e| e.get_password())
            .unwrap_or_else(|e| {
                eprintln!("[secrets] '{}' anahtarı keyring'den okunamadı: {e}", p.name);
                String::new()
            });
    }
}

/// Provider silindiğinde keyring kaydını da temizle.
pub fn delete_provider_key(provider: &str) {
    if let Ok(entry) = Entry::new(SERVICE, &key_name(provider)) {
        let _ = entry.delete_credential();
    }
}

/// Genel amaçlı keyring erişimi — uygulama entegrasyonlarının (Telegram bot
/// token'ı, Discord bot token'ı vb.) düz metin localStorage yerine Windows
/// Credential Manager'a yazması için. `key` çağıran taraf tarafından
/// namespace'lenmiş olmalı (örn. "app.telegram.bot_token").
pub fn store_secret(key: &str, value: &str) -> Result<(), String> {
    Entry::new(SERVICE, key)
        .and_then(|e| e.set_password(value))
        .map_err(|e| e.to_string())
}

pub fn read_secret(key: &str) -> Option<String> {
    Entry::new(SERVICE, key).ok().and_then(|e| e.get_password().ok())
}

pub fn delete_secret(key: &str) {
    if let Ok(entry) = Entry::new(SERVICE, key) {
        let _ = entry.delete_credential();
    }
}
