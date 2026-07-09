// Cross-platform screen capture for Axiom (uses xcap).
//
// Returns PNG-encoded bytes that the frontend can embed as a base64 data URL
// inside the existing image-attachment pipeline (`documentStore.addPastedFile`).
//
// Public API:
//   - `list_monitors()` -> Vec<MonitorInfo>
//   - `capture_monitor(index)` -> Vec<u8>  (PNG)
//   - `capture_primary()` -> Vec<u8>       (PNG; convenience)

use std::io::Cursor;

use serde::Serialize;
use thiserror::Error;
use xcap::Monitor;

#[derive(Debug, Error)]
pub enum ScreenError {
    #[error("no monitor found")]
    NoMonitor,
    #[error("monitor index out of range: {0}")]
    BadIndex(u32),
    #[error("xcap error: {0}")]
    Xcap(String),
    #[error("encode error: {0}")]
    Encode(String),
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub index: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
    pub scale_factor: f32,
}

pub fn list_monitors() -> Result<Vec<MonitorInfo>, ScreenError> {
    let monitors = Monitor::all().map_err(|e| ScreenError::Xcap(e.to_string()))?;
    if monitors.is_empty() {
        return Err(ScreenError::NoMonitor);
    }
    let infos = monitors
        .iter()
        .enumerate()
        .map(|(i, m)| MonitorInfo {
            index: i as u32,
            name: m.name().to_string(),
            width: m.width(),
            height: m.height(),
            is_primary: m.is_primary(),
            scale_factor: m.scale_factor(),
        })
        .collect();
    Ok(infos)
}

pub fn capture_monitor(index: u32) -> Result<Vec<u8>, ScreenError> {
    let monitors = Monitor::all().map_err(|e| ScreenError::Xcap(e.to_string()))?;
    if (index as usize) >= monitors.len() {
        return Err(ScreenError::BadIndex(index));
    }
    let monitor = &monitors[index as usize];
    let image = monitor
        .capture_image()
        .map_err(|e| ScreenError::Xcap(e.to_string()))?;

    let mut buf = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
        .map_err(|e| ScreenError::Encode(e.to_string()))?;
    Ok(buf)
}

pub fn capture_primary() -> Result<Vec<u8>, ScreenError> {
    let monitors = Monitor::all().map_err(|e| ScreenError::Xcap(e.to_string()))?;
    let primary = monitors
        .into_iter()
        .find(|m| m.is_primary())
        .or_else(|| Monitor::all().ok().and_then(|m| m.into_iter().next()))
        .ok_or(ScreenError::NoMonitor)?;
    let image = primary
        .capture_image()
        .map_err(|e| ScreenError::Xcap(e.to_string()))?;
    let mut buf = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut buf), image::ImageFormat::Png)
        .map_err(|e| ScreenError::Encode(e.to_string()))?;
    Ok(buf)
}
