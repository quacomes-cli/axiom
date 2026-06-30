use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub installed: bool,
    pub running: bool,
    pub path: Option<String>,
}

pub fn check_installed() -> OllamaStatus {
    let mut cmd = Command::new("where");
    cmd.arg("ollama");

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output();

    match output {
        Ok(out) if out.status.success() => {
            let path = String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();

            OllamaStatus {
                installed: true,
                running: false,
                path: if path.is_empty() { None } else { Some(path) },
            }
        }
        _ => OllamaStatus {
            installed: false,
            running: false,
            path: None,
        },
    }
}

pub fn start_serve(flash_attention: bool, kv_cache_type: Option<&str>) -> Result<(), String> {
    let mut cmd = Command::new("ollama");
    cmd.arg("serve");

    if flash_attention {
        cmd.env("OLLAMA_FLASH_ATTENTION", "1");
        // KV cache quantization yalnızca flash attention açıkken geçerli
        if let Some(kv) = kv_cache_type {
            if !kv.is_empty() && kv != "f16" {
                cmd.env("OLLAMA_KV_CACHE_TYPE", kv);
            }
        }
    }

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    cmd.spawn()
        .map_err(|e| format!("Ollama başlatılamadı: {e}"))?;
    Ok(())
}

pub fn stop_serve() -> Result<(), String> {
    let mut cmd = Command::new("taskkill");
    cmd.args(["/F", "/IM", "ollama.exe"]);

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    let _ = cmd.output();

    let mut cmd2 = Command::new("taskkill");
    cmd2.args(["/F", "/IM", "ollama_runners.exe"]);

    #[cfg(windows)]
    cmd2.creation_flags(CREATE_NO_WINDOW);

    cmd2.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    let _ = cmd2.output();

    Ok(())
}

pub fn install_via_winget() -> Result<(), String> {
    let mut cmd = Command::new("winget");
    cmd.args([
        "install",
        "--id",
        "Ollama.Ollama",
        "--accept-source-agreements",
        "--accept-package-agreements",
        "--silent",
    ]);

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    let child = cmd
        .spawn()
        .map_err(|e| format!("winget başlatılamadı: {e}"))?;

    std::thread::spawn(move || {
        let _ = child.wait_with_output();
    });

    Ok(())
}
