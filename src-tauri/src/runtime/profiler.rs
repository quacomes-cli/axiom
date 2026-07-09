use serde::{Deserialize, Serialize};
use sysinfo::System;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareProfile {
    pub cpu_brand: String,
    pub cpu_cores_physical: usize,
    pub cpu_cores_logical: usize,
    pub total_ram_mb: u64,
    pub available_ram_mb: u64,
    pub gpu_name: Option<String>,
    pub gpu_vram_mb: Option<u64>,
    pub os_name: String,
}

pub fn profile() -> HardwareProfile {
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu_all();

    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .filter(|b| !b.is_empty())
        .unwrap_or_else(|| "Unknown CPU".to_string());

    let logical = sys.cpus().len();
    let physical = sys.physical_core_count().unwrap_or(logical);

    let bytes_to_mb = |b: u64| b / 1024 / 1024;

    let os_name = format!(
        "{} {}",
        System::name().unwrap_or_else(|| "Unknown OS".to_string()),
        System::os_version().unwrap_or_default()
    )
    .trim()
    .to_string();

    let (gpu_name, gpu_vram_mb) = detect_gpu();

    HardwareProfile {
        cpu_brand,
        cpu_cores_physical: physical,
        cpu_cores_logical: logical,
        total_ram_mb: bytes_to_mb(sys.total_memory()),
        available_ram_mb: bytes_to_mb(sys.available_memory()),
        gpu_name,
        gpu_vram_mb,
        os_name,
    }
}

#[cfg(windows)]
fn detect_gpu() -> (Option<String>, Option<u64>) {
    // Try nvidia-smi first — accurate VRAM for NVIDIA GPUs (WMI AdapterRAM is
    // uint32 and overflows above 4 GB).
    if let Some(result) = detect_gpu_nvidia_smi() {
        return result;
    }
    detect_gpu_wmi()
}

#[cfg(windows)]
fn detect_gpu_nvidia_smi() -> Option<(Option<String>, Option<u64>)> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let output = std::process::Command::new("nvidia-smi")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().next()?.trim().to_string();
    if line.is_empty() {
        return None;
    }

    // Format: "NVIDIA GeForce RTX 4060 Laptop GPU, 8188"
    let parts: Vec<&str> = line.splitn(2, ',').collect();
    let name = parts.first()?.trim().to_string();
    let vram_mb: u64 = parts.get(1)?.trim().parse().ok()?;

    Some((Some(name), Some(vram_mb)))
}

#[cfg(windows)]
fn detect_gpu_wmi() -> (Option<String>, Option<u64>) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let output = std::process::Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ForEach-Object { $_.Name + '|' + $_.AdapterRAM }",
        ])
        .output();

    let output = match output {
        Ok(o) if o.status.success() => o,
        _ => return (None, None),
    };

    let text = String::from_utf8_lossy(&output.stdout);
    let mut best_name: Option<String> = None;
    let mut best_vram: Option<u64> = None;

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(2, '|').collect();
        if parts.len() < 2 {
            continue;
        }
        let name = parts[0].trim();
        let vram_str = parts[1].trim();

        if name.is_empty() || name.to_lowercase().contains("basic") {
            continue;
        }

        let vram_bytes: u64 = vram_str.parse().unwrap_or(0);
        let vram_mb = vram_bytes / 1024 / 1024;

        if vram_mb > best_vram.unwrap_or(0) {
            best_name = Some(name.to_string());
            best_vram = Some(vram_mb);
        }
    }

    (best_name, best_vram.filter(|&v| v > 0))
}

#[cfg(not(windows))]
fn detect_gpu() -> (Option<String>, Option<u64>) {
    (None, None)
}
