// Piper TTS — yerel neural konuşma sentezi (Faz 6 v2).
//
// Windows SAPI (SpeechSynthesis) yerine doğal sesler: Piper CPU'da gerçek
// zamandan ~20x hızlı, Türkçe dahil çok dilli. Binary + ses modeli app config
// dizinine indirilir (whisper model deseniyle aynı).
//
// Mimari: tek kalıcı worker thread + cümle kuyruğu. `speak(text)` kuyruğa
// ekler; worker her cümle için piper subprocess'i çalıştırır (wav stdout) ve
// rodio ile çalar. `stop()` nesli (generation) artırır — kuyruktaki eski işler
// ve çalan ses anında düşer (barge-in). Kuyruk boşalınca `on_idle` çağrılır.

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

struct Job {
    generation: u64,
    text: String,
    exe: PathBuf,
    model: PathBuf,
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

/// Motoru bir kez kurar. `on_idle` kuyruk boşaldığında (son cümle çalınıp
/// bittiğinde) çağrılır — frontend "konuşma bitti" sinyali olarak dinler.
pub fn init(on_idle: impl Fn() + Send + 'static) {
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

        for job in rx.iter() {
            let stale = || job.generation != gen_w.load(Ordering::SeqCst);
            if stale() {
                pending_w.fetch_sub(1, Ordering::SeqCst);
                continue;
            }

            match synth_wav(&job.exe, &job.model, &job.text) {
                Ok(wav) if !stale() => {
                    let cursor = std::io::Cursor::new(wav);
                    match handle.play_once(cursor) {
                        Ok(sink) => {
                            *sink_w.lock() = Some(sink);
                            // Bitene veya nesil değişene kadar bekle.
                            loop {
                                thread::sleep(std::time::Duration::from_millis(50));
                                let done = sink_w
                                    .lock()
                                    .as_ref()
                                    .map(|s| s.empty())
                                    .unwrap_or(true);
                                if done {
                                    break;
                                }
                                if stale() {
                                    if let Some(s) = sink_w.lock().take() {
                                        s.stop();
                                    }
                                    break;
                                }
                            }
                            *sink_w.lock() = None;
                        }
                        Err(e) => eprintln!("[tts] çalma hatası: {e}"),
                    }
                }
                Ok(_) => {} // stale — çalma
                Err(e) => eprintln!("[tts] sentez hatası: {e}"),
            }

            let left = pending_w.fetch_sub(1, Ordering::SeqCst) - 1;
            if left == 0 {
                on_idle();
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

/// Cümleyi kuyruğa ekler (init edilmediyse sessizce yok sayar).
pub fn speak(app_config_dir: &Path, voice: &str, text: &str) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(());
    }
    let guard = ENGINE.lock();
    let engine = guard.as_ref().ok_or("tts engine init edilmedi")?;

    let exe = piper_exe(app_config_dir);
    let model = voice_model_path(app_config_dir, voice);
    if !exe.exists() {
        return Err("piper yüklü değil".into());
    }
    if !model.exists() {
        return Err(format!("ses modeli yüklü değil: {voice}"));
    }

    engine.pending.fetch_add(1, Ordering::SeqCst);
    engine
        .tx
        .send(Job {
            generation: engine.generation.load(Ordering::SeqCst),
            text: text.to_string(),
            exe,
            model,
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

/// Piper subprocess: stdin'e metin, stdout'tan WAV.
fn synth_wav(exe: &Path, model: &Path, text: &str) -> Result<Vec<u8>, String> {
    let mut cmd = Command::new(exe);
    cmd.arg("--model")
        .arg(model)
        .arg("--output_file")
        .arg("-")
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
    if out.stdout.len() < 44 {
        return Err("piper boş wav döndürdü".into());
    }
    Ok(out.stdout)
}
