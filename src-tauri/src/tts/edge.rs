// Edge TTS — Microsoft'un ücretsiz neural ses endpoint'i (Edge tarayıcının
// "sesli oku" özelliğinin kullandığı WSS). Gerçek insan tonlaması; Piper'ın
// duygusuz VITS sesine üst kademe. İnternet gerektirir — worker hata alırsa
// Piper'a düşer.
//
// Protokol (edge-tts ile aynı):
//   1) WSS bağlantısı: TrustedClientToken + Sec-MS-GEC (DRM: SHA256(ticks+token))
//   2) speech.config text mesajı (çıkış formatı: mp3)
//   3) SSML text mesajı (X-RequestId + Path:ssml)
//   4) Binary frame'ler: [2B header uzunluğu][header][mp3 chunk] — Path:audio
//   5) Path:turn.end → bitti.

use futures_util::{SinkExt, StreamExt};
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

const TRUSTED_CLIENT_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION: &str = "130.0.2849.68";
const OUTPUT_FORMAT: &str = "audio-24khz-48kbitrate-mono-mp3";
const SYNTH_TIMEOUT: Duration = Duration::from_secs(15);

/// Sec-MS-GEC DRM token'ı: Windows epoch tick'leri 5 dk'ya yuvarlanır,
/// TrustedClientToken ile birleştirilip SHA256 (hex, büyük harf) alınır.
fn sec_ms_gec() -> String {
    let unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut ticks = (unix + 11_644_473_600) * 10_000_000;
    ticks -= ticks % 3_000_000_000; // 5 dakikalık pencere
    let mut hasher = Sha256::new();
    hasher.update(format!("{ticks}{TRUSTED_CLIENT_TOKEN}"));
    format!("{:X}", hasher.finalize())
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Binary frame'den mp3 payload'ını ayıklar (Path:audio ise).
fn audio_payload(frame: &[u8]) -> Option<&[u8]> {
    if frame.len() < 2 {
        return None;
    }
    let header_len = u16::from_be_bytes([frame[0], frame[1]]) as usize;
    if frame.len() < 2 + header_len {
        return None;
    }
    let header = std::str::from_utf8(&frame[2..2 + header_len]).ok()?;
    if !header.contains("Path:audio") {
        return None;
    }
    Some(&frame[2 + header_len..])
}

/// Metni Edge TTS ile sentezler; mp3 baytları döner. Bloklayan sarmalayıcı —
/// TTS worker thread'inden çağrılır (kendi mini tokio runtime'ı ile).
pub fn synth_mp3(text: &str, voice: &str) -> Result<Vec<u8>, String> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("runtime: {e}"))?;
    rt.block_on(async {
        tokio::time::timeout(SYNTH_TIMEOUT, synth_inner(text, voice))
            .await
            .map_err(|_| "edge tts zaman aşımı".to_string())?
    })
}

async fn synth_inner(text: &str, voice: &str) -> Result<Vec<u8>, String> {
    let connection_id = uuid::Uuid::new_v4().simple().to_string();
    let url = format!(
        "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1\
         ?TrustedClientToken={TRUSTED_CLIENT_TOKEN}\
         &Sec-MS-GEC={}&Sec-MS-GEC-Version=1-{CHROMIUM_FULL_VERSION}\
         &ConnectionId={connection_id}",
        sec_ms_gec()
    );

    let mut request = url
        .into_client_request()
        .map_err(|e| format!("istek kurulamadı: {e}"))?;
    {
        let headers = request.headers_mut();
        headers.insert("Pragma", "no-cache".parse().unwrap());
        headers.insert("Cache-Control", "no-cache".parse().unwrap());
        headers.insert(
            "Origin",
            "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold".parse().unwrap(),
        );
        headers.insert(
            "User-Agent",
            format!(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/{CHROMIUM_FULL_VERSION}"
            )
            .parse()
            .unwrap(),
        );
    }

    let (mut ws, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| format!("edge tts bağlantı hatası: {e}"))?;

    // 1) speech.config
    let config = format!(
        "X-Timestamp:{}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n\
         {{\"context\":{{\"synthesis\":{{\"audio\":{{\"metadataoptions\":{{\
         \"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"}},\
         \"outputFormat\":\"{OUTPUT_FORMAT}\"}}}}}}}}",
        chrono_like_ts()
    );
    ws.send(Message::Text(config))
        .await
        .map_err(|e| format!("config gönderilemedi: {e}"))?;

    // 2) SSML
    let request_id = uuid::Uuid::new_v4().simple().to_string();
    let lang = voice.splitn(3, '-').take(2).collect::<Vec<_>>().join("-"); // tr-TR
    let ssml = format!(
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='{lang}'>\
         <voice name='{voice}'>{}</voice></speak>",
        escape_xml(text)
    );
    let msg = format!(
        "X-RequestId:{request_id}\r\nContent-Type:application/ssml+xml\r\n\
         X-Timestamp:{}\r\nPath:ssml\r\n\r\n{ssml}",
        chrono_like_ts()
    );
    ws.send(Message::Text(msg))
        .await
        .map_err(|e| format!("ssml gönderilemedi: {e}"))?;

    // 3) Yanıtları topla.
    let mut mp3: Vec<u8> = Vec::new();
    while let Some(frame) = ws.next().await {
        match frame.map_err(|e| format!("ws hatası: {e}"))? {
            Message::Binary(data) => {
                if let Some(payload) = audio_payload(&data) {
                    mp3.extend_from_slice(payload);
                }
            }
            Message::Text(text) => {
                if text.contains("Path:turn.end") {
                    break;
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    let _ = ws.close(None).await;

    if mp3.is_empty() {
        return Err("edge tts ses döndürmedi".into());
    }
    Ok(mp3)
}

/// Edge'in beklediği zaman damgası biçimi (tam doğruluk gerekmez).
fn chrono_like_ts() -> String {
    // "Thu Jan 01 1970 00:00:00 GMT+0000 (Coordinated Universal Time)" benzeri
    // bir metin yeterli — sunucu içerik doğrulaması yapmıyor.
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{secs}")
}
