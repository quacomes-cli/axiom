use serde::{Deserialize, Serialize};

use crate::runtime::ollama::types::OllamaChatOptions;
use crate::runtime::profiler::HardwareProfile;
use crate::runtime::provider::ModelInfo;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProfilePreset {
    Hiz,
    Denge,
    Kalite,
    Ozel,
}

impl Default for ProfilePreset {
    fn default() -> Self {
        Self::Denge
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationConfig {
    pub preset: ProfilePreset,
    pub num_gpu: Option<i32>,
    pub num_thread: Option<u32>,
    pub num_ctx: Option<u32>,
    pub num_batch: Option<u32>,
    pub mmap: Option<bool>,
    pub use_mlock: Option<bool>,
    pub keep_alive: Option<String>,
    pub flash_attention: bool,
    #[serde(default)]
    pub kv_cache_type: Option<String>,
}

impl Default for OptimizationConfig {
    fn default() -> Self {
        Self {
            preset: ProfilePreset::Denge,
            num_gpu: None,
            num_thread: None,
            num_ctx: None,
            num_batch: None,
            mmap: Some(true),
            use_mlock: None,
            keep_alive: Some("5m".to_string()),
            flash_attention: false,
            kv_cache_type: None,
        }
    }
}

impl OptimizationConfig {
    pub fn to_ollama_options(&self) -> OllamaChatOptions {
        OllamaChatOptions {
            temperature: None,
            num_predict: None,
            num_gpu: self.num_gpu,
            num_thread: self.num_thread,
            num_ctx: self.num_ctx,
            num_batch: self.num_batch,
            mmap: self.mmap,
            use_mlock: self.use_mlock,
        }
    }
}

/// Parses a parameter-count string into a raw parameter count.
/// Handles "7b", "12B", "1.5b", "350m", and Gemma 3n effective tags like "e2b"/"e4b".
fn parse_param_count(raw: &str) -> Option<f64> {
    let up = raw.trim().to_uppercase();
    // Gemma 3n uses effective-parameter tags (E2B = ~2B, E4B = ~4B).
    let up = up.strip_prefix('E').unwrap_or(&up);
    if let Some(n) = up.strip_suffix('B') {
        n.parse::<f64>().ok().map(|v| v * 1e9)
    } else if let Some(n) = up.strip_suffix('M') {
        n.parse::<f64>().ok().map(|v| v * 1e6)
    } else {
        up.parse::<f64>().ok()
    }
}

fn estimate_model_size_mb(model: &ModelInfo) -> u64 {
    if let Some(size_bytes) = model.size_bytes {
        return size_bytes / 1024 / 1024;
    }

    let params: f64 = model
        .parameter_count
        .as_deref()
        .and_then(parse_param_count)
        .unwrap_or(7_000_000_000.0);

    let bits_per_param: f64 = match model.quantization.as_deref() {
        Some(q) => {
            let q = q.to_uppercase();
            if q.contains("Q2") {
                2.5
            } else if q.contains("Q3") {
                3.5
            } else if q.contains("Q4") {
                4.5
            } else if q.contains("Q5") {
                5.5
            } else if q.contains("Q6") {
                6.5
            } else if q.contains("Q8") {
                8.0
            } else if q.contains("F16") || q.contains("FP16") {
                16.0
            } else if q.contains("F32") || q.contains("FP32") {
                32.0
            } else {
                4.5
            }
        }
        None => 4.5,
    };

    (params * bits_per_param / 8.0 / 1024.0 / 1024.0) as u64
}

pub fn auto_configure_with_preset(
    hw: &HardwareProfile,
    model: &ModelInfo,
    preset: &ProfilePreset,
) -> OptimizationConfig {
    let model_mb = estimate_model_size_mb(model);
    let vram_mb = hw.gpu_vram_mb.unwrap_or(0);
    let has_gpu = vram_mb > 0 || hw.gpu_name.is_some();
    let ram_mb = hw.total_ram_mb;
    let cores = hw.cpu_cores_physical as u32;

    match preset {
        ProfilePreset::Hiz => {
            let num_gpu = if has_gpu { Some(-1_i32) } else { Some(0) };
            OptimizationConfig {
                preset: ProfilePreset::Hiz,
                num_gpu,
                num_thread: Some(cores),
                num_ctx: Some(2048),
                num_batch: Some(512),
                mmap: Some(true),
                use_mlock: if ram_mb < 16_000 { Some(true) } else { Some(false) },
                keep_alive: Some("10m".to_string()),
                flash_attention: true,
                kv_cache_type: None,
            }
        }
        ProfilePreset::Denge => {
            let (num_gpu, num_ctx, num_batch, use_mlock) = if vram_mb >= model_mb && vram_mb > 0 {
                (Some(-1_i32), Some(4096_u32), Some(512_u32), Some(false))
            } else if vram_mb >= model_mb / 2 && vram_mb > 0 {
                let ratio = vram_mb as f64 / model_mb as f64;
                let layers = (ratio * 33.0) as i32;
                (Some(layers.max(1)), Some(3072), Some(256), Some(false))
            } else if has_gpu {
                (Some(-1_i32), Some(4096), Some(256), Some(false))
            } else {
                (Some(0), Some(2048), Some(128), Some(true))
            };

            let num_thread = if ram_mb < 8_000 {
                Some(cores / 2)
            } else {
                Some(cores.saturating_sub(1).max(1))
            };

            OptimizationConfig {
                preset: ProfilePreset::Denge,
                num_gpu,
                num_thread,
                num_ctx,
                num_batch,
                mmap: Some(true),
                use_mlock,
                keep_alive: Some("5m".to_string()),
                flash_attention: has_gpu,
                kv_cache_type: None,
            }
        }
        ProfilePreset::Kalite => {
            let num_gpu = if has_gpu { Some(-1_i32) } else { Some(0) };
            let num_ctx = if vram_mb >= model_mb * 2 {
                Some(8192)
            } else if vram_mb >= model_mb {
                Some(4096)
            } else {
                Some(4096)
            };

            OptimizationConfig {
                preset: ProfilePreset::Kalite,
                num_gpu,
                num_thread: Some(cores),
                num_ctx,
                num_batch: Some(512),
                mmap: Some(true),
                use_mlock: Some(false),
                keep_alive: Some("-1".to_string()),
                flash_attention: has_gpu,
                kv_cache_type: None,
            }
        }
        ProfilePreset::Ozel => OptimizationConfig::default(),
    }
}

// ---- Memory Estimation ----

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEstimate {
    pub model_size_mb: u64,
    pub kv_cache_mb: u64,
    pub total_mb: u64,
    pub fits_vram: bool,
    pub fits_ram: bool,
    pub recommended_ctx: u32,
}

pub fn estimate_memory(
    hw: &HardwareProfile,
    param_count: Option<&str>,
    quantization: Option<&str>,
    context: u32,
) -> MemoryEstimate {
    let dummy = ModelInfo {
        id: String::new(),
        provider: crate::runtime::provider::ProviderKind::Ollama,
        display_name: String::new(),
        size_bytes: None,
        quantization: quantization.map(|s| s.to_string()),
        parameter_count: param_count.map(|s| s.to_string()),
        context_length: None,
        is_active: false,
        family: None,
        capabilities: None,
    };

    let model_mb = estimate_model_size_mb(&dummy);

    let params: f64 = param_count
        .and_then(parse_param_count)
        .unwrap_or(7e9);

    // KV cache: ~2 bytes per param dimension per context token for Q4
    // Simplified: layers * 2 * hidden_dim * context * 2 bytes
    // Rough estimate: (params / 1e9) * context * 0.5 MB / 4096
    let kv_cache_mb = ((params / 1e9) * (context as f64) * 0.5 / 4096.0).ceil() as u64;

    let total_mb = model_mb + kv_cache_mb;
    let vram_mb = hw.gpu_vram_mb.unwrap_or(0);
    let ram_mb = hw.total_ram_mb;

    let fits_vram = vram_mb > 0 && total_mb <= vram_mb;
    let fits_ram = total_mb <= ram_mb;

    // Recommend max context that fits in available memory
    let available = if vram_mb > 0 { vram_mb } else { ram_mb };
    let headroom = available.saturating_sub(model_mb);
    let max_ctx_from_mem = if params > 0.0 {
        ((headroom as f64) * 4096.0 / (params / 1e9) / 0.5) as u32
    } else {
        4096
    };
    let recommended_ctx = max_ctx_from_mem.min(131072).max(2048);
    // Round down to nearest 1024
    let recommended_ctx = (recommended_ctx / 1024) * 1024;

    MemoryEstimate {
        model_size_mb: model_mb,
        kv_cache_mb,
        total_mb,
        fits_vram,
        fits_ram,
        recommended_ctx,
    }
}
