use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyData {
    pub rates: Vec<CurrencyRate>,
    pub last_updated: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyRate {
    pub code: String,
    pub name: String,
    pub rate: f64,
    pub symbol: String,
}

#[derive(Deserialize)]
struct ErApiResponse {
    result: String,
    time_last_update_utc: Option<String>,
    rates: HashMap<String, f64>,
}

const TRACKED: &[(&str, &str, &str)] = &[
    ("USD", "ABD Doları", "$"),
    ("EUR", "Euro", "€"),
    ("GBP", "İngiliz Sterlini", "£"),
    ("JPY", "Japon Yeni", "¥"),
    ("CHF", "İsviçre Frangı", "₣"),
];

pub async fn fetch_currency() -> Result<CurrencyData, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://open.er-api.com/v6/latest/TRY")
        .send()
        .await
        .map_err(|e| format!("Döviz kuru alınamadı: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Exchange API HTTP {}", resp.status()));
    }

    let data: ErApiResponse = resp
        .json()
        .await
        .map_err(|e| format!("JSON parse hatası: {e}"))?;

    if data.result != "success" {
        return Err("Exchange API başarısız yanıt döndü".into());
    }

    let rates = TRACKED
        .iter()
        .filter_map(|(code, name, symbol)| {
            data.rates.get(*code).map(|&try_rate| {
                let rate = if try_rate > 0.0 { 1.0 / try_rate } else { 0.0 };
                CurrencyRate {
                    code: code.to_string(),
                    name: name.to_string(),
                    rate: (rate * 10000.0).round() / 10000.0,
                    symbol: symbol.to_string(),
                }
            })
        })
        .collect();

    Ok(CurrencyData {
        rates,
        last_updated: data.time_last_update_utc.unwrap_or_default(),
    })
}
