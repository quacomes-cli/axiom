use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

const MAX_OUTPUT: usize = 100_000;
const BLOCKED: &[&str] = &[
    "rm -rf /",
    "rm -rf ~",
    "format c:",
    "del /s /q c:",
    ":(){:|:&};:",
    "mkfs",
];

pub fn exec(command: &str, cwd: Option<&str>) -> Result<ShellOutput, String> {
    let cmd_lower = command.to_lowercase();
    for blocked in BLOCKED {
        if cmd_lower.contains(blocked) {
            return Err(format!("Engellenen komut: {}", blocked));
        }
    }

    let (shell, flag) = if cfg!(target_os = "windows") {
        ("cmd", "/C")
    } else {
        ("sh", "-c")
    };

    let mut cmd = Command::new(shell);
    cmd.arg(flag).arg(command).stdin(Stdio::null());

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Komut çalıştırılamadı: {}", e))?;

    let mut stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let mut stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if stdout.len() > MAX_OUTPUT {
        stdout.truncate(MAX_OUTPUT);
        stdout.push_str("\n...[çıktı kısaltıldı]");
    }
    if stderr.len() > MAX_OUTPUT {
        stderr.truncate(MAX_OUTPUT);
        stderr.push_str("\n...[çıktı kısaltıldı]");
    }

    Ok(ShellOutput {
        stdout,
        stderr,
        exit_code: output.status.code().unwrap_or(-1),
    })
}

fn is_blocked(command: &str) -> Option<&'static str> {
    let cmd_lower = command.to_lowercase();
    BLOCKED.iter().find(|b| cmd_lower.contains(*b)).copied()
}

/// Komutu çalıştırır; stdout/stderr satırlarını canlı olarak `on_line(stream, line)`
/// callback'ine iletir. `timeout_secs` aşılırsa süreç öldürülür. Bitince exit kodu döner.
pub fn exec_stream<F>(
    command: &str,
    cwd: Option<&str>,
    timeout_secs: u64,
    mut on_line: F,
) -> Result<i32, String>
where
    F: FnMut(&str, String),
{
    if let Some(b) = is_blocked(command) {
        return Err(format!("Engellenen komut: {}", b));
    }

    let (shell, flag) = if cfg!(target_os = "windows") {
        ("cmd", "/C")
    } else {
        ("sh", "-c")
    };

    let mut cmd = Command::new(shell);
    cmd.arg(flag).arg(command);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    // stdin'i kapat: interaktif CLI prompt'ları (create-vite vb.) EOF alıp
    // varsayılana düşer / çıkar; aksi halde girdi bekleyip takılırlar.
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|e| format!("Komut başlatılamadı: {}", e))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (tx, rx) = mpsc::channel::<(&'static str, String)>();

    let tx_out = tx.clone();
    let out_handle = stdout.map(|out| {
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                if tx_out.send(("stdout", line)).is_err() {
                    break;
                }
            }
        })
    });
    let tx_err = tx;
    let err_handle = stderr.map(|err| {
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                if tx_err.send(("stderr", line)).is_err() {
                    break;
                }
            }
        })
    });

    let start = std::time::Instant::now();
    let mut total = 0usize;
    let mut killed = false;

    loop {
        // Biriken satırları akıt
        while let Ok((stream, line)) = rx.try_recv() {
            if total < MAX_OUTPUT {
                total += line.len();
                on_line(stream, line);
            }
        }

        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() > Duration::from_secs(timeout_secs) {
                    let _ = child.kill();
                    killed = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(e) => return Err(format!("Süreç beklenemedi: {}", e)),
        }
    }

    if let Some(h) = out_handle {
        let _ = h.join();
    }
    if let Some(h) = err_handle {
        let _ = h.join();
    }
    // Kalan satırları akıt
    while let Ok((stream, line)) = rx.try_recv() {
        if total < MAX_OUTPUT {
            total += line.len();
            on_line(stream, line);
        }
    }

    if killed {
        on_line("stderr", format!("[zaman aşımı: {timeout_secs}s — süreç durduruldu]"));
        return Ok(-1);
    }

    let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
    Ok(code)
}
