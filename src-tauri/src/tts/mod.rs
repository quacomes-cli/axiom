// Piper TTS — yerel neural konuşma sentezi (Faz 6 v2).
//
// Windows SAPI (SpeechSynthesis) yerine doğal sesler: Piper CPU'da gerçek
// zamandan ~20x hızlı, Türkçe dahil çok dilli. Binary + ses modeli app config
// dizinine indirilir (whisper model deseniyle aynı).
//
// Mimari: tek kalıcı worker thread + cümle kuyruğu. `speak(text)` kuyruğa
// ekler; worker her cümle için piper subprocess'i çalıştırır (--output-raw:
// ham i16 PCM — WAV stdout'u kullanılmaz çünkü stream'e seek olmadığından
// RIFF boyut alanları bozuk kalıp cızırtıya yol açıyordu) ve rodio
// SamplesBuffer ile çalar. Örnek hızı ses modelinin .onnx.json'ından okunur.
// `stop()` nesli (generation) artırır — kuyruktaki eski işler ve çalan ses
// anında düşer (barge-in). Çalma sırasında ~80ms dilimlerin RMS + 4 bant
// (Goertzel) enerjisi `TtsEvent::Level` ile yayınlanır (görselleştirme);
// kuyruk boşalınca `TtsEvent::Idle` gelir.

mod edge;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;

use parking_lot::Mutex;

/// Varsayılan ses — Türkçe, orta kalite (hız/kalite dengesi iyi).
pub const DEFAULT_VOICE: &str = "tr_TR-dfki-medium";

const PIPER_ZIP_URL: &str =
    "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip";

pub fn piper_dir(app_config_dir: &Path) -> PathBuf {
    app_config_dir.join("tts").join("piper")
}

pub fn piper_exe(app_config_dir: &Path) -> PathBuf {
    piper_dir(app_config_dir).join("piper").join("piper.exe")
}

pub fn voices_dir(app_config_dir: &Path) -> PathBuf {
    app_config_dir.join("tts").join("voices")
}

pub fn voice_model_path(app_config_dir: &Path, voice: &str) -> PathBuf {
    voices_dir(app_config_dir).join(format!("{voice}.onnx"))
}

/// HuggingFace rhasspy/piper-voices URL'i: "tr_TR-dfki-medium" →
/// tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx
pub fn voice_download_url(voice: &str, json: bool) -> Option<String> {
    let mut parts = voice.splitn(3, '-');
    let locale = parts.next()?; // tr_TR
    let name = parts.next()?; // dfki
    let quality = parts.next()?; // medium
    let family = locale.split('_').next()?; // tr
    let ext = if json { ".onnx.json" } else { ".onnx" };
    Some(format!(
        "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/{family}/{locale}/{name}/{quality}/{voice}{ext}"
    ))
}

pub fn piper_zip_url() -> &'static str {
    PIPER_ZIP_URL
}

pub fn is_installed(app_config_dir: &Path, voice: &str) -> (bool, bool) {
    (
        piper_exe(app_config_dir).exists(),
        voice_model_path(app_config_dir, voice).exists(),
    )
}

// ---- Çalma motoru ------------------------------------------------------------

/// Motor olayları — init callback'ine verilir (frontend'e event olarak düşer).
pub enum TtsEvent {
    /// Kuyruk boşaldı (son cümle çalınıp bitti).
    Idle,
    /// Çalma sırasında anlık ses düzeyi + kaba spektrum (görselleştirme).
    Level { level: f32, bands: [f32; 4] },
}

struct Job {
    generation: u64,
    text: String,
    exe: PathBuf,
    model: PathBuf,
    /// Doluysa önce Edge TTS (Microsoft neural — duygulu) denenir;
    /// hata/offline'da yereldeki Piper'a düşülür.
    edge_voice: Option<String>,
}

/// Sentez sonucu — hangi motordan gelirse gelsin ortak çalma yolu.
struct Synth {
    samples: Vec<i16>,
    sample_rate: u32,
    channels: u16,
}

/// Edge mp3'ünü örneklere çözer (rodio symphonia-mp3).
fn decode_mp3(mp3: Vec<u8>) -> Result<Synth, String> {
    use rodio::Source;
    let decoder = rodio::Decoder::new(std::io::Cursor::new(mp3))
        .map_err(|e| format!("mp3 çözülemedi: {e}"))?;
    let sample_rate = decoder.sample_rate();
    let channels = decoder.channels();
    let samples: Vec<i16> = decoder.collect();
    if samples.is_empty() {
        return Err("mp3 boş".into());
    }
    Ok(Synth {
        samples,
        sample_rate,
        channels,
    })
}

/// Ses modelinin örnek hızı (.onnx.json → audio.sample_rate). Yol bazlı cache.
fn model_sample_rate(model: &Path) -> u32 {
    static CACHE: Mutex<Option<(PathBuf, u32)>> = Mutex::new(None);
    let mut guard = CACHE.lock();
    if let Some((p, sr)) = guard.as_ref() {
        if p == model {
            return *sr;
        }
    }
    let sr = std::fs::read_to_string(model.with_extension("onnx.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.pointer("/audio/sample_rate").and_then(|x| x.as_u64()))
        .map(|x| x as u32)
        .unwrap_or(22_050);
    *guard = Some((model.to_path_buf(), sr));
    sr
}

/// Tek frekans için Goertzel enerjisi (normalize edilmiş, kabaca 0..1).
fn goertzel(samples: &[f32], sample_rate: u32, freq: f32) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let k = (0.5 + samples.len() as f32 * freq / sample_rate as f32).floor();
    let w = 2.0 * std::f32::consts::PI * k / samples.len() as f32;
    let coeff = 2.0 * w.cos();
    let (mut s1, mut s2) = (0.0f32, 0.0f32);
    for &x in samples {
        let s0 = x + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    let power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    (power.max(0.0).sqrt() / samples.len() as f32 * 8.0).min(1.0)
}

struct Engine {
    tx: mpsc::Sender<Job>,
    /// Aktif nesil — stop() artırır; eski nesil işler/sesler düşer.
    generation: Arc<AtomicU64>,
    /// Çalmakta olan sink — stop() anında durdurabilsin.
    current_sink: Arc<Mutex<Option<rodio::Sink>>>,
    /// Kuyrukta bekleyen iş sayısı (idle tespiti).
    pending: Arc<AtomicU64>,
}

static ENGINE: Mutex<Option<Engine>> = Mutex::new(None);

/// Motoru bir kez kurar. `on_event`: Idle (kuyruk bitti) + Level (çalma
/// sırasında düzey/spektrum — parçacık görselleştirmesi bununla oynar).
pub fn init(on_event: impl Fn(TtsEvent) + Send + 'static) {
    let mut guard = ENGINE.lock();
    if guard.is_some() {
        return;
    }

    let (tx, rx) = mpsc::channel::<Job>();
    let generation = Arc::new(AtomicU64::new(0));
    let current_sink: Arc<Mutex<Option<rodio::Sink>>> = Arc::new(Mutex::new(None));
    let pending = Arc::new(AtomicU64::new(0));

    let gen_w = Arc::clone(&generation);
    let sink_w = Arc::clone(&current_sink);
    let pending_w = Arc::clone(&pending);

    thread::spawn(move || {
        // OutputStream !Send — worker içinde yaratılır ve burada yaşar.
        let stream = rodio::OutputStream::try_default();
        let (_stream, handle) = match stream {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[tts] ses çıkışı açılamadı: {e}");
                // İşleri boşalt ki kuyruk sonsuz büyümesin.
                for _ in rx.iter() {
                    pending_w.fetch_sub(1, Ordering::SeqCst);
                }
                return;
            }
        };

        const TICK_MS: u64 = 80;
        // Analiz bantları: konuşma enerjisinin ana bölgeleri (Hz).
        const BANDS: [f32; 4] = [200.0, 500.0, 1200.0, 2800.0];

        for job in rx.iter() {
            let stale = || job.generation != gen_w.load(Ordering::SeqCst);
            if stale() {
                pending_w.fetch_sub(1, Ordering::SeqCst);
                continue;
            }

            // Motor zinciri: Edge (duygulu, bulut) → Piper (yerel) → hata.
            let synth: Result<Synth, String> = {
                let edge_result = job
                    .edge_voice
                    .as_deref()
                    .map(|v| edge::synth_mp3(&job.text, v).and_then(decode_mp3));
                match edge_result {
                    Some(Ok(s)) => Ok(s),
                    other => {
                        if let Some(Err(e)) = other {
                            eprintln!("[tts] edge başarısız, piper'a düşülüyor: {e}");
                        }
                        if job.exe.exists() && job.model.exists() {
                            synth_raw(&job.exe, &job.model, &job.text).map(|samples| Synth {
                                sample_rate: model_sample_rate(&job.model),
                                channels: 1,
                                samples,
                            })
                        } else {
                            Err("hiçbir tts motoru kullanılamıyor".into())
                        }
                    }
                }
            };

            match synth {
                Ok(synth) if !stale() && !synth.samples.is_empty() => {
                    let Synth {
                        samples,
                        sample_rate: sr,
                        channels,
                    } = synth;
                    // Analiz için mono f32 kopya (çok kanallıysa downmix).
                    let mono: Vec<f32> = if channels <= 1 {
                        samples.iter().map(|&s| s as f32 / i16::MAX as f32).collect()
                    } else {
                        samples
                            .chunks(channels as usize)
                            .map(|fr| {
                                fr.iter().map(|&s| s as f32).sum::<f32>()
                                    / (channels as f32 * i16::MAX as f32)
                            })
                            .collect()
                    };

                    let sink = match rodio::Sink::try_new(&handle) {
                        Ok(s) => s,
                        Err(e) => {
                            eprintln!("[tts] sink hatası: {e}");
                            let left = pending_w.fetch_sub(1, Ordering::SeqCst) - 1;
                            if left == 0 {
                                on_event(TtsEvent::Idle);
                            }
                            continue;
                        }
                    };
                    sink.append(rodio::buffer::SamplesBuffer::new(channels, sr, samples));
                    *sink_w.lock() = Some(sink);

                    // Çalma boyunca dilim analizi yayınla; stale'de kes.
                    let started = std::time::Instant::now();
                    let win = (sr as u64 * TICK_MS / 1000) as usize;
                    loop {
                        thread::sleep(std::time::Duration::from_millis(TICK_MS));
                        let done = sink_w.lock().as_ref().map(|s| s.empty()).unwrap_or(true);
                        if done {
                            break;
                        }
                        if stale() {
                            if let Some(s) = sink_w.lock().take() {
                                s.stop();
                            }
                            break;
                        }
                        let pos =
                            (started.elapsed().as_millis() as u64 * sr as u64 / 1000) as usize;
                        if pos < mono.len() {
                            let end = (pos + win).min(mono.len());
                            let slice = &mono[pos..end];
                            let rms = (slice.iter().map(|x| x * x).sum::<f32>()
                                / slice.len().max(1) as f32)
                                .sqrt();
                            let level = (rms * 6.0).min(1.0);
                            let bands = [
                                goertzel(slice, sr, BANDS[0]),
                                goertzel(slice, sr, BANDS[1]),
                                goertzel(slice, sr, BANDS[2]),
                                goertzel(slice, sr, BANDS[3]),
                            ];
                            on_event(TtsEvent::Level { level, bands });
                        }
                    }
                    *sink_w.lock() = None;
                }
                Ok(_) => {} // stale/boş — çalma
                Err(e) => eprintln!("[tts] sentez hatası: {e}"),
            }

            let left = pending_w.fetch_sub(1, Ordering::SeqCst) - 1;
            if left == 0 {
                on_event(TtsEvent::Idle);
            }
        }
    });

    *guard = Some(Engine {
        tx,
        generation,
        current_sink,
        pending,
    });
}

/// Cümleyi kuyruğa ekler. `edge_voice` doluysa önce Edge (duygulu) denenir —
/// bu durumda Piper'ın yüklü olması ŞART değildir (yalnız fallback).
pub fn speak(
    app_config_dir: &Path,
    voice: &str,
    text: &str,
    edge_voice: Option<&str>,
) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(());
    }
    let guard = ENGINE.lock();
    let engine = guard.as_ref().ok_or("tts engine init edilmedi")?;

    let exe = piper_exe(app_config_dir);
    let model = voice_model_path(app_config_dir, voice);
    let piper_ready = exe.exists() && model.exists();
    if edge_voice.is_none() && !piper_ready {
        return Err("hiçbir tts motoru yüklü değil".into());
    }

    engine.pending.fetch_add(1, Ordering::SeqCst);
    engine
        .tx
        .send(Job {
            generation: engine.generation.load(Ordering::SeqCst),
            text: text.to_string(),
            exe,
            model,
            edge_voice: edge_voice.map(|s| s.to_string()),
        })
        .map_err(|e| format!("kuyruk hatası: {e}"))
}

/// Barge-in: kuyruğu ve çalan sesi anında keser.
pub fn stop() {
    let guard = ENGINE.lock();
    if let Some(engine) = guard.as_ref() {
        engine.generation.fetch_add(1, Ordering::SeqCst);
        if let Some(sink) = engine.current_sink.lock().take() {
            sink.stop();
        }
    }
}

/// Kuyrukta/çalmada iş var mı?
pub fn is_busy() -> bool {
    let guard = ENGINE.lock();
    guard
        .as_ref()
        .map(|e| e.pending.load(Ordering::SeqCst) > 0)
        .unwrap_or(false)
}

/// Piper subprocess: stdin'e metin, stdout'tan HAM i16 PCM (--output-raw).
/// WAV stdout'u KULLANILMAZ: stream'e seek olmadığından RIFF boyut alanları
/// bozuk kalıyor ve decoder cızırtı üretiyordu.
fn synth_raw(exe: &Path, model: &Path, text: &str) -> Result<Vec<i16>, String> {
    let mut cmd = Command::new(exe);
    cmd.arg("--model")
        .arg(model)
        .arg("--output-raw")
        // Monotonluğu kıran canlılık ayarları: noise_scale tonlama varyasyonu,
        // noise_w hece süresi dalgalanması, sentence_silence nefes payı.
        .arg("--noise_scale")
        .arg("0.8")
        .arg("--noise_w")
        .arg("1.0")
        .arg("--sentence_silence")
        .arg("0.25")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("piper başlatılamadı: {e}"))?;
    // Tek satır: piper satır başına bir sentez yapar.
    let line = text.replace(['\r', '\n'], " ");
    child
        .stdin
        .take()
        .ok_or("stdin yok")?
        .write_all(format!("{line}\n").as_bytes())
        .map_err(|e| format!("stdin yazılamadı: {e}"))?;

    let out = child
        .wait_with_output()
        .map_err(|e| format!("piper bekleme hatası: {e}"))?;
    if !out.status.success() {
        return Err(format!("piper çıkış kodu: {:?}", out.status.code()));
    }

    // i16 LE mono — bayt çiftlerini örneklere çevir.
    let bytes = out.stdout;
    if bytes.len() < 2 {
        return Err("piper boş ses döndürdü".into());
    }
    let samples: Vec<i16> = bytes
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]))
        .collect();
    Ok(samples)
}
