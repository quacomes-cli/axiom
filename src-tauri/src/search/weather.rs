use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherData {
    pub city: String,
    pub temp_c: i32,
    pub feels_like_c: i32,
    pub humidity: u32,
    pub description: String,
    pub wind_kph: u32,
    pub icon: String,
    pub forecast: Vec<ForecastDay>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForecastDay {
    pub date: String,
    pub max_temp_c: i32,
    pub min_temp_c: i32,
    pub icon: String,
}

#[derive(Deserialize)]
struct GeoResponse {
    results: Option<Vec<GeoResult>>,
}

#[derive(Deserialize)]
struct GeoResult {
    name: String,
    latitude: f64,
    longitude: f64,
}

#[derive(Deserialize)]
struct ForecastResponse {
    current: CurrentWeather,
    daily: DailyWeather,
}

#[derive(Deserialize)]
struct CurrentWeather {
    temperature_2m: f64,
    relative_humidity_2m: f64,
    apparent_temperature: f64,
    weather_code: u32,
    wind_speed_10m: f64,
}

#[derive(Deserialize)]
struct DailyWeather {
    time: Vec<String>,
    weather_code: Vec<u32>,
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
}

fn wmo_icon(code: u32) -> &'static str {
    match code {
        0 => "clear",
        1 | 2 => "partly_cloudy",
        3 => "cloudy",
        45 | 48 => "fog",
        51 | 53 | 55 | 56 | 57 | 61 => "light_rain",
        63 | 65 | 66 | 67 | 80 | 81 | 82 => "rain",
        71 | 73 | 75 | 77 | 85 | 86 => "snow",
        95 | 96 | 99 => "thunder",
        _ => "partly_cloudy",
    }
}

fn wmo_description(code: u32) -> &'static str {
    match code {
        0 => "Açık",
        1 => "Çoğunlukla açık",
        2 => "Parçalı bulutlu",
        3 => "Kapalı",
        45 | 48 => "Sisli",
        51 | 53 | 55 => "Çisenti",
        56 | 57 => "Dondurucu çisenti",
        61 => "Hafif yağmur",
        63 => "Yağmur",
        65 => "Şiddetli yağmur",
        66 | 67 => "Dondurucu yağmur",
        71 => "Hafif kar",
        73 => "Kar yağışı",
        75 | 77 => "Yoğun kar",
        80 | 81 | 82 => "Sağanak",
        85 | 86 => "Kar sağanağı",
        95 => "Gök gürültülü fırtına",
        96 | 99 => "Dolu ile fırtına",
        _ => "Bilinmiyor",
    }
}

pub async fn fetch_weather(city: &str) -> Result<WeatherData, String> {
    let client = reqwest::Client::new();

    let geo_url = format!(
        "https://geocoding-api.open-meteo.com/v1/search?name={}&count=1&language=tr",
        urlencoding::encode(city)
    );
    let geo_resp: GeoResponse = client
        .get(&geo_url)
        .send()
        .await
        .map_err(|e| format!("Geocoding hatası: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Geocoding JSON hatası: {e}"))?;

    let geo = geo_resp
        .results
        .and_then(|r| r.into_iter().next())
        .ok_or_else(|| format!("'{}' konumu bulunamadı", city))?;

    let weather_url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={}&longitude={}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5",
        geo.latitude, geo.longitude
    );
    let data: ForecastResponse = client
        .get(&weather_url)
        .send()
        .await
        .map_err(|e| format!("Hava durumu alınamadı: {e}"))?
        .json()
        .await
        .map_err(|e| format!("JSON parse hatası: {e}"))?;

    let forecast = data
        .daily
        .time
        .iter()
        .enumerate()
        .map(|(i, date)| {
            let code = data.daily.weather_code.get(i).copied().unwrap_or(0);
            ForecastDay {
                date: date.clone(),
                max_temp_c: data.daily.temperature_2m_max.get(i).copied().unwrap_or(0.0) as i32,
                min_temp_c: data.daily.temperature_2m_min.get(i).copied().unwrap_or(0.0) as i32,
                icon: wmo_icon(code).to_string(),
            }
        })
        .collect();

    let code = data.current.weather_code;
    Ok(WeatherData {
        city: geo.name,
        temp_c: data.current.temperature_2m as i32,
        feels_like_c: data.current.apparent_temperature as i32,
        humidity: data.current.relative_humidity_2m as u32,
        description: wmo_description(code).to_string(),
        wind_kph: data.current.wind_speed_10m as u32,
        icon: wmo_icon(code).to_string(),
        forecast,
    })
}
