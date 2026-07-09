// Audio capture (cpal) + local STT (whisper.cpp) for Axiom.
//
// Public API:
//   - `start_recording(session_id)` opens the default input device, spawns a
//     cpal input stream that converts to mono 16 kHz f32 samples and appends
//     into a shared ring buffer keyed by `session_id`.
//   - `stop_recording_and_transcribe(session_id, model_path, language)` stops
//     the stream, encodes the buffered samples to an in-memory WAV, and runs
//     whisper-rs inference against the provided model file. Returns the
//     decoded text.
//   - `model_path(model: &str)` resolves the on-disk location of a ggml whisper
//     model under the app data dir (`%APPDATA%/Axiom/models/whisper/`).
//
// Notes:
//   - Recording session state lives in a process-global `Mutex<HashMap<…>>`
//     because cpal `Stream` is `!Send` on most platforms; we keep streams alive
//     on the thread that created them by parking inside a worker thread.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use parking_lot::Mutex;
use serde::Serialize;
use thiserror::Error;

/// Target sample rate for whisper.cpp.
const TARGET_SR: u32 = 16_000;

#[derive(Debug, Error)]
pub enum AudioError {
    #[error("no input device available")]
    NoInputDevice,
    #[error("session not found: {0}")]
    SessionNotFound(String),
    #[error("session already exists: {0}")]
    SessionExists(String),
    #[error("cpal error: {0}")]
    Cpal(String),
    #[error("whisper error: {0}")]
    Whisper(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("model file not found: {0}")]
    ModelMissing(PathBuf),
}

impl From<cpal::DefaultStreamConfigError> for AudioError {
    fn from(e: cpal::DefaultStreamConfigError) -> Self {
        AudioError::Cpal(e.to_string())
    }
}
impl From<cpal::BuildStreamError> for AudioError {
    fn from(e: cpal::BuildStreamError) -> Self {
        AudioError::Cpal(e.to_string())
    }
}
impl From<cpal::PlayStreamError> for AudioError {
    fn from(e: cpal::PlayStreamError) -> Self {
        AudioError::Cpal(e.to_string())
    }
}

/// Command sent to the per-session capture worker thread.
enum WorkerCmd {
    Stop,
}

/// Konuşma sonu algılama (VAD) ayarları — sesli asistan modu (Faz 6).
#[derive(Debug, Clone)]
pub struct VadConfig {
    /// Konuşma başladıktan sonra bu kadar ms kesintisiz sessizlik → segment sonu.
    pub silence_ms: u64,
    /// RMS eşiği (mono f32, 16 kHz). Üstü "konuşma", altı "sessizlik" sayılır.
    pub threshold: f32,
    /// Güvenlik tavanı: segment bu süreyi aşarsa sessizlik beklenmeden kapatılır.
    pub max_segment_ms: u64,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            silence_ms: 1200,
            threshold: 0.012,
            max_segment_ms: 60_000,
        }
    }
}

/// VAD olayları — worker thread'den callback'e verilir.
///   "speech-start": kullanıcı konuşmaya başladı (barge-in için TTS sustur)
///   "segment-end":  konuşma bitti; frontend stop_and_transcribe çağırmalı
pub type VadEvent = &'static str;

struct Session {
    /// Channel to ask the worker to stop and flush.
    tx: mpsc::Sender<WorkerCmd>,
    /// Receiver for the final PCM (mono f32 @ 16 kHz) once the worker exits.
    result_rx: mpsc::Receiver<Vec<f32>>,
    /// Canlı buffer — kayıt SÜRERKEN snapshot transkript için paylaşılır.
    buffer: Arc<Mutex<Vec<f32>>>,
    /// Source sample rate (for reference / debugging only).
    source_sample_rate: u32,
    /// Source channel count (1 or 2).
    source_channels: u16,
}

/// Process-global session registry.
static SESSIONS: std::sync::LazyLock<Mutex<HashMap<String, Session>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Public: starts a new recording session bound to `session_id`.
pub fn start_recording(session_id: String) -> Result<(), AudioError> {
    start_recording_inner(session_id, None)
}

/// Public: VAD'li kayıt — worker her ~100ms RMS ölçer; konuşma başlangıcında
/// ve `silence_ms` kesintisiz sessizlikte `on_event` çağrılır. Kayıt otomatik
/// DURMAZ — "segment-end" sonrası frontend stop_and_transcribe/cancel çağırır.
pub fn start_recording_with_vad(
    session_id: String,
    vad: VadConfig,
    on_event: impl Fn(VadEvent) + Send + 'static,
) -> Result<(), AudioError> {
    start_recording_inner(session_id, Some((vad, Box::new(on_event))))
}

fn start_recording_inner(
    session_id: String,
    vad: Option<(VadConfig, Box<dyn Fn(VadEvent) + Send>)>,
) -> Result<(), AudioError> {
    {
        let map = SESSIONS.lock();
        if map.contains_key(&session_id) {
            return Err(AudioError::SessionExists(session_id));
        }
    }

    let host = cpal::default_host();
    let device = host.default_input_device().ok_or(AudioError::NoInputDevice)?;
    let config = device.default_input_config()?;

    let source_sr = config.sample_rate().0;
    let source_ch = config.channels();
    let sample_format = config.sample_format();
    let stream_config: StreamConfig = config.into();

    let (cmd_tx, cmd_rx) = mpsc::channel::<WorkerCmd>();
    let (result_tx, result_rx) = mpsc::channel::<Vec<f32>>();

    // Buffer thread dışında yaratılır: Session'a bir Arc kopyası konur ki kayıt
    // SÜRERKEN snapshot transkript (canlı yazım) buffer'ı okuyabilsin.
    let shared_buffer: Arc<Mutex<Vec<f32>>> =
        Arc::new(Mutex::new(Vec::with_capacity(TARGET_SR as usize * 30)));

    // The cpal Stream is !Send on many platforms; build it inside a dedicated
    // worker thread and park there until we get a stop signal.
    let buffer_for_worker = Arc::clone(&shared_buffer);
    thread::spawn(move || {
        let buffer = buffer_for_worker;

        let buf_clone = Arc::clone(&buffer);
        let err_fn = |e| eprintln!("[audio] cpal stream error: {e}");

        let stream_result = match sample_format {
            SampleFormat::F32 => device.build_input_stream(
                &stream_config,
                move |data: &[f32], _| append_samples(&buf_clone, data, source_ch, source_sr),
                err_fn,
                None,
            ),
            SampleFormat::I16 => device.build_input_stream(
                &stream_config,
                move |data: &[i16], _| {
                    let f: Vec<f32> = data.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
                    append_samples(&buf_clone, &f, source_ch, source_sr);
                },
                err_fn,
                None,
            ),
            SampleFormat::U16 => device.build_input_stream(
                &stream_config,
                move |data: &[u16], _| {
                    let f: Vec<f32> = data
                        .iter()
                        .map(|&s| (s as f32 - u16::MAX as f32 / 2.0) / (u16::MAX as f32 / 2.0))
                        .collect();
                    append_samples(&buf_clone, &f, source_ch, source_sr);
                },
                err_fn,
                None,
            ),
            other => Err(cpal::BuildStreamError::StreamConfigNotSupported)
                .map_err(|_| {
                    let _ = other;
                    cpal::BuildStreamError::StreamConfigNotSupported
                }),
        };

        let stream = match stream_result {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[audio] failed to build stream: {e}");
                let _ = result_tx.send(Vec::new());
                return;
            }
        };

        if let Err(e) = stream.play() {
            eprintln!("[audio] failed to start stream: {e}");
            let _ = result_tx.send(Vec::new());
            return;
        }

        match vad {
            None => {
                // Park until stop signal (klasik bas-konuş yolu).
                let _ = cmd_rx.recv();
            }
            Some((cfg, on_event)) => {
                // VAD döngüsü: ~100ms tick'lerle son pencerenin RMS'ine bak.
                use std::sync::mpsc::RecvTimeoutError;
                use std::time::{Duration, Instant};
                const TICK_MS: u64 = 100;
                const WINDOW: usize = (TARGET_SR as usize / 1000) * TICK_MS as usize; // 100ms örnek

                let started = Instant::now();
                let mut speech_started = false;
                let mut voiced_ticks: u32 = 0;
                let mut silence_ticks: u32 = 0;
                let mut segment_ended = false;

                loop {
                    match cmd_rx.recv_timeout(Duration::from_millis(TICK_MS)) {
                        Ok(WorkerCmd::Stop) | Err(RecvTimeoutError::Disconnected) => break,
                        Err(RecvTimeoutError::Timeout) => {
                            if segment_ended {
                                continue; // frontend'in stop çağrısı bekleniyor
                            }
                            let rms = {
                                let buf = buffer.lock();
                                let n = buf.len().min(WINDOW);
                                if n == 0 {
                                    0.0
                                } else {
                                    let tail = &buf[buf.len() - n..];
                                    (tail.iter().map(|s| s * s).sum::<f32>() / n as f32).sqrt()
                                }
                            };
                            let voiced = rms > cfg.threshold;

                            if !speech_started {
                                voiced_ticks = if voiced { voiced_ticks + 1 } else { 0 };
                                // ~200ms kesintisiz ses = gerçek konuşma (tık/öksürük eleği)
                                if voiced_ticks >= 2 {
                                    speech_started = true;
                                    on_event("speech-start");
                                }
                            } else {
                                silence_ticks = if voiced { 0 } else { silence_ticks + 1 };
                                let silent_ms = silence_ticks as u64 * TICK_MS;
                                let too_long =
                                    started.elapsed().as_millis() as u64 >= cfg.max_segment_ms;
                                if silent_ms >= cfg.silence_ms || too_long {
                                    segment_ended = true;
                                    on_event("segment-end");
                                }
                            }
                        }
                    }
                }
            }
        }
        drop(stream);

        let pcm = std::mem::take(&mut *buffer.lock());
        let _ = result_tx.send(pcm);
    });

    let mut map = SESSIONS.lock();
    map.insert(
        session_id,
        Session {
            tx: cmd_tx,
            result_rx,
            buffer: shared_buffer,
            source_sample_rate: source_sr,
            source_channels: source_ch,
        },
    );
    Ok(())
}

/// Kayıt SÜRERKEN mevcut sesin (son `window_secs` sn) transkriptini döner —
/// canlı yazım (partial) için. Kayıt durmaz; sonuç geçicidir, segment sonunda
/// tam transkript yine `stop_recording_and_transcribe` ile alınır.
pub fn transcribe_snapshot(
    session_id: &str,
    model_path: &Path,
    language: Option<&str>,
    window_secs: u32,
) -> Result<String, AudioError> {
    let pcm: Vec<f32> = {
        let map = SESSIONS.lock();
        let session = map
            .get(session_id)
            .ok_or_else(|| AudioError::SessionNotFound(session_id.to_string()))?;
        let buf = session.buffer.lock();
        let max = (TARGET_SR as usize) * window_secs as usize;
        let n = buf.len().min(max);
        if n < TARGET_SR as usize / 2 {
            return Ok(String::new()); // <0.5sn ses — çözmeye değmez
        }
        buf[buf.len() - n..].to_vec()
    };
    if !model_path.exists() {
        return Err(AudioError::ModelMissing(model_path.to_path_buf()));
    }
    transcribe_pcm(&pcm, model_path, language)
}

/// Public: stops a session and returns transcribed text using the given model.
pub fn stop_recording_and_transcribe(
    session_id: &str,
    model_path: &Path,
    language: Option<&str>,
) -> Result<TranscriptResult, AudioError> {
    let session = {
        let mut map = SESSIONS.lock();
        map.remove(session_id)
            .ok_or_else(|| AudioError::SessionNotFound(session_id.to_string()))?
    };

    let _ = session.tx.send(WorkerCmd::Stop);
    let pcm = session
        .result_rx
        .recv()
        .map_err(|e| AudioError::Cpal(format!("worker join failed: {e}")))?;

    if pcm.is_empty() {
        return Ok(TranscriptResult {
            text: String::new(),
            sample_count: 0,
            duration_ms: 0,
        });
    }

    if !model_path.exists() {
        return Err(AudioError::ModelMissing(model_path.to_path_buf()));
    }

    let duration_ms = (pcm.len() as f64 / TARGET_SR as f64 * 1000.0) as u64;
    let text = transcribe_pcm(&pcm, model_path, language)?;

    // Drop the unused fields warning silently.
    let _ = (session.source_sample_rate, session.source_channels);

    Ok(TranscriptResult {
        text,
        sample_count: pcm.len(),
        duration_ms,
    })
}

/// Public: cancels a session without transcription.
pub fn cancel_recording(session_id: &str) -> Result<(), AudioError> {
    let session = {
        let mut map = SESSIONS.lock();
        map.remove(session_id)
            .ok_or_else(|| AudioError::SessionNotFound(session_id.to_string()))?
    };
    let _ = session.tx.send(WorkerCmd::Stop);
    // Drain the channel so the worker exits cleanly.
    let _ = session.result_rx.recv();
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct TranscriptResult {
    pub text: String,
    pub sample_count: usize,
    pub duration_ms: u64,
}

/// Resolves the on-disk path for a given whisper model name (e.g. "base.en",
/// "small", "medium"). Files are expected to live as
/// `models/whisper/ggml-<name>.bin` under the Tauri app data dir.
pub fn model_path(app_data_dir: &Path, model_name: &str) -> PathBuf {
    app_data_dir
        .join("models")
        .join("whisper")
        .join(format!("ggml-{}.bin", model_name))
}

/// Returns the canonical HuggingFace URL for a whisper.cpp ggml model.
pub fn model_download_url(model_name: &str) -> String {
    format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin",
        model_name
    )
}

// --- internals --------------------------------------------------------------

/// Append callback samples to the buffer after channel-downmix + resample.
fn append_samples(buf: &Arc<Mutex<Vec<f32>>>, samples: &[f32], channels: u16, sample_rate: u32) {
    // Downmix to mono first.
    let mono: Vec<f32> = if channels <= 1 {
        samples.to_vec()
    } else {
        let ch = channels as usize;
        samples
            .chunks(ch)
            .map(|frame| frame.iter().copied().sum::<f32>() / ch as f32)
            .collect()
    };

    // Resample to TARGET_SR via simple linear interpolation. Good enough for
    // speech; whisper.cpp is not picky.
    let resampled = if sample_rate == TARGET_SR {
        mono
    } else {
        linear_resample(&mono, sample_rate, TARGET_SR)
    };

    buf.lock().extend_from_slice(&resampled);
}

fn linear_resample(input: &[f32], src_sr: u32, dst_sr: u32) -> Vec<f32> {
    if input.is_empty() || src_sr == dst_sr {
        return input.to_vec();
    }
    let ratio = src_sr as f64 / dst_sr as f64;
    let out_len = ((input.len() as f64) / ratio).floor() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_pos = i as f64 * ratio;
        let idx = src_pos.floor() as usize;
        let frac = (src_pos - idx as f64) as f32;
        let s0 = input[idx];
        let s1 = if idx + 1 < input.len() { input[idx + 1] } else { s0 };
        out.push(s0 + (s1 - s0) * frac);
    }
    out
}

/// Yüklü whisper modeli cache'i — PERFORMANSIN KALBİ. Eskiden her segmentte
/// model diskten yeniden yükleniyordu (base ~150MB, small ~500MB) ve "whisper
/// bazen çok yavaş" şikayetinin kök nedeni buydu. Artık aynı model yolu için
/// context bir kez yüklenir; her transkript yalnızca hafif bir state açar.
static WHISPER_CTX: std::sync::LazyLock<Mutex<Option<(PathBuf, Arc<whisper_rs::WhisperContext>)>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));

fn cached_context(model_path: &Path) -> Result<Arc<whisper_rs::WhisperContext>, AudioError> {
    use whisper_rs::{WhisperContext, WhisperContextParameters};

    let mut guard = WHISPER_CTX.lock();
    if let Some((cached_path, ctx)) = guard.as_ref() {
        if cached_path == model_path {
            return Ok(Arc::clone(ctx));
        }
    }
    let ctx = WhisperContext::new_with_params(
        model_path.to_string_lossy().as_ref(),
        WhisperContextParameters::default(),
    )
    .map_err(|e| AudioError::Whisper(e.to_string()))?;
    let ctx = Arc::new(ctx);
    *guard = Some((model_path.to_path_buf(), Arc::clone(&ctx)));
    Ok(ctx)
}

fn transcribe_pcm(pcm: &[f32], model_path: &Path, language: Option<&str>) -> Result<String, AudioError> {
    use whisper_rs::{FullParams, SamplingStrategy};

    let ctx = cached_context(model_path)?;

    let mut state = ctx
        .create_state()
        .map_err(|e| AudioError::Whisper(e.to_string()))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(num_cpus_safe());
    params.set_print_progress(false);
    params.set_print_special(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);
    if let Some(lang) = language {
        params.set_language(Some(lang));
    }

    state
        .full(params, pcm)
        .map_err(|e| AudioError::Whisper(e.to_string()))?;

    let mut buf = String::new();
    for segment in state.as_iter() {
        buf.push_str(&segment.to_string());
    }
    Ok(buf.trim().to_string())
}

fn num_cpus_safe() -> i32 {
    std::thread::available_parallelism()
        .map(|n| n.get() as i32)
        .unwrap_or(4)
        .max(1)
        .min(8)
}
