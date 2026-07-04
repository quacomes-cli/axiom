//! Minimal MCP (Model Context Protocol) stdio istemcisi.
//!
//! Neden hazır SDK değil: MCP'nin stdio taşıması satır-ayrımlı JSON-RPC 2.0 —
//! ihtiyacımız olan üç uç (`initialize`, `tools/list`, `tools/call`) ~200
//! satırda, bağımlılıksız ve her stdio sunucusuyla (npx/uvx/binary) çalışır
//! şekilde yazılabiliyor.
//!
//! Eşzamanlılık modeli: sunucu başına TEK in-flight istek (bağlantı başına
//! Mutex). Okuyucu thread her satırı kanala basar; istek sahibi kanaldan
//! kendi id'sini bekler, sunucudan gelen bildirimleri yok sayar, sunucu
//! kaynaklı istekleri -32601 ile cevaplar (sampling vs. desteklemiyoruz).
//!
//! Yaşam döngüsü: bağlantılar lazy kurulur; uygulama çıkışında
//! `kill_all` (lib.rs RunEvent::Exit) çocuk süreçleri öldürür — yetim
//! npx/node süreçleri kalmaz.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const INIT_TIMEOUT: Duration = Duration::from_secs(30);
const CALL_TIMEOUT: Duration = Duration::from_secs(60);
const PROTOCOL_VERSION: &str = "2024-11-05";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub name: String,
    /// Çalıştırılacak komut (örn. "npx", "uvx", tam yol).
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    pub description: String,
    /// JSON Schema (inputSchema) — frontend native tool şemasına aynen geçer.
    pub input_schema: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    pub name: String,
    pub connected: bool,
    pub tool_count: usize,
}

struct Connection {
    child: Child,
    stdin: ChildStdin,
    rx: Receiver<Value>,
    next_id: u64,
    tools: Vec<McpToolInfo>,
}

/// Clone ucuz (Arc) — async komutlarda spawn_blocking'e taşınabilir.
#[derive(Default, Clone)]
pub struct McpManager {
    conns: Arc<Mutex<HashMap<String, Arc<Mutex<Connection>>>>>,
}

impl McpManager {
    /// Sunucuyu başlatır, el sıkışır ve araç listesini döner. Zaten bağlıysa
    /// mevcut araç listesini döner (idempotent).
    pub fn connect(&self, cfg: &McpServerConfig) -> Result<Vec<McpToolInfo>, String> {
        {
            let conns = self.conns.lock().unwrap();
            if let Some(c) = conns.get(&cfg.name) {
                return Ok(c.lock().unwrap().tools.clone());
            }
        }

        let mut conn = spawn_and_handshake(cfg)?;
        let tools = list_tools(&mut conn)?;
        conn.tools = tools.clone();

        self.conns
            .lock()
            .unwrap()
            .insert(cfg.name.clone(), Arc::new(Mutex::new(conn)));
        eprintln!("[mcp] '{}' bağlandı: {} araç", cfg.name, tools.len());
        Ok(tools)
    }

    pub fn disconnect(&self, name: &str) {
        if let Some(c) = self.conns.lock().unwrap().remove(name) {
            let mut conn = c.lock().unwrap();
            let _ = conn.child.kill();
            let _ = conn.child.wait();
            eprintln!("[mcp] '{name}' bağlantısı kapatıldı");
        }
    }

    pub fn status(&self, configs: &[McpServerConfig]) -> Vec<McpServerStatus> {
        let conns = self.conns.lock().unwrap();
        configs
            .iter()
            .map(|cfg| {
                let tool_count = conns
                    .get(&cfg.name)
                    .map(|c| c.lock().unwrap().tools.len())
                    .unwrap_or(0);
                McpServerStatus {
                    name: cfg.name.clone(),
                    connected: conns.contains_key(&cfg.name),
                    tool_count,
                }
            })
            .collect()
    }

    /// Bağlı bir sunucudaki aracı çağırır; sonucu düz metin olarak döner.
    pub fn call_tool(&self, server: &str, tool: &str, args: Value) -> Result<String, String> {
        let conn_arc = self
            .conns
            .lock()
            .unwrap()
            .get(server)
            .cloned()
            .ok_or_else(|| format!("'{server}' MCP sunucusu bağlı değil"))?;

        let mut conn = conn_arc.lock().unwrap();
        let result = request(
            &mut conn,
            "tools/call",
            json!({ "name": tool, "arguments": args }),
            CALL_TIMEOUT,
        )?;

        // result.content: [{type:"text", text}, ...]; isError true olabilir.
        let is_error = result.get("isError").and_then(|v| v.as_bool()).unwrap_or(false);
        let text = result
            .get("content")
            .and_then(|c| c.as_array())
            .map(|parts| {
                parts
                    .iter()
                    .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();

        if is_error {
            Err(if text.is_empty() { "MCP aracı hata döndürdü".into() } else { text })
        } else {
            Ok(if text.is_empty() { "(boş yanıt)".into() } else { text })
        }
    }

    /// Uygulama kapanırken tüm çocuk süreçleri öldür (yetim npx/node kalmasın).
    pub fn kill_all(&self) {
        let mut conns = self.conns.lock().unwrap();
        for (name, c) in conns.drain() {
            if let Ok(mut conn) = c.lock() {
                let _ = conn.child.kill();
                let _ = conn.child.wait();
                eprintln!("[mcp] '{name}' kapatıldı (uygulama çıkışı)");
            }
        }
    }
}

/// cmd.exe 8191 karakterden uzun bir değişkeni genişletemez (boş görür).
/// `cargo run`/`cargo test` bağımlılıkların DLL arama yollarını (örn.
/// whisper-rs-sys'in yüzlerce CMake dizini) PATH'e ekleyip ~19KB'a şişiriyor;
/// npx dahil tüm .cmd shim'leri cmd üzerinden çalıştığı için MCP sunucuları
/// "is not recognized" ile ölüyordu. Çocuğa geçen PATH sınırı aşıyorsa
/// cargo'nun target\ girdilerini ayıkla — MCP sunucularının onlara ihtiyacı yok.
#[cfg(windows)]
fn sanitized_path() -> Option<String> {
    let path = std::env::var("PATH").ok()?;
    if path.len() <= 8000 {
        return None;
    }
    let filtered: Vec<&str> = path
        .split(';')
        .filter(|e| {
            let l = e.to_ascii_lowercase();
            !l.contains("\\target\\debug") && !l.contains("\\target\\release")
        })
        .collect();
    Some(filtered.join(";"))
}

fn build_command(program: &str, cfg: &McpServerConfig) -> Command {
    let mut cmd = Command::new(program);
    cmd.args(&cfg.args);
    #[cfg(windows)]
    if let Some(p) = sanitized_path() {
        cmd.env("PATH", p);
    }
    // KRİTİK: cwd nötr olmalı (home). Uygulamanın/projenin dizininde
    // başlatılan npx, yukarı yürüyüp bir package.json bulursa "proje
    // bağlamında exec" moduna girer ve o projenin node_modules'üne
    // dokunmaya kalkar — hem tehlikeli hem de kırılgan (bkz. Faz 3 notu:
    // 'mcp-server-filesystem is not recognized' vakası).
    if let Some(home) = dirs::home_dir() {
        cmd.current_dir(home);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    for (k, v) in &cfg.env {
        cmd.env(k, v);
    }
    // MCP_DEBUG=1 ile sunucunun stderr'i konsola akar (teşhis için).
    let stderr = if std::env::var("MCP_DEBUG").is_ok() { Stdio::inherit() } else { Stdio::null() };
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(stderr);
    cmd
}

/// npx/uvx gibi shim komutları için son çare: komut satırının TAMAMI tek bir
/// raw_arg olarak cmd'ye verilir (`/C` dahil) — std'nin .cmd-quoting'i npx'in
/// iç bin çözümlemesini bozuyor, arg-arg /C geçmek ise cmd ayrıştırmasını.
#[cfg(windows)]
fn spawn_via_cmd(cfg: &McpServerConfig) -> std::io::Result<Child> {
    use std::os::windows::process::CommandExt;
    fn quote(s: &str) -> String {
        if s.contains(char::is_whitespace) { format!("\"{s}\"") } else { s.to_string() }
    }
    let mut line = format!("/C {}", quote(&cfg.command));
    for a in &cfg.args {
        line.push(' ');
        line.push_str(&quote(a));
    }
    let mut cmd = Command::new("cmd.exe");
    cmd.raw_arg(line);
    cmd.creation_flags(0x08000000);
    if let Some(p) = sanitized_path() {
        cmd.env("PATH", p);
    }
    if let Some(home) = dirs::home_dir() {
        cmd.current_dir(home);
    }
    for (k, v) in &cfg.env {
        cmd.env(k, v);
    }
    let stderr = if std::env::var("MCP_DEBUG").is_ok() { Stdio::inherit() } else { Stdio::null() };
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(stderr).spawn()
}

#[cfg(not(windows))]
fn spawn_via_cmd(_cfg: &McpServerConfig) -> std::io::Result<Child> {
    unreachable!("yalnız Windows yolu")
}

fn spawn_and_handshake(cfg: &McpServerConfig) -> Result<Connection, String> {
    // Önce komutu doğrudan dene; Windows'ta bulunamazsa .cmd shim'ini dene
    // (npx, pnpm dlx vb.). Rust std, .cmd spawn'ında cmd.exe tırnaklamasını
    // kendisi güvenli yapar (BatBadBut düzeltmesi) — elle `cmd /C` satırı
    // KURULMAZ; parantez/noktalı virgül içeren argümanlar orada bozuluyor.
    let mut child = match build_command(&cfg.command, cfg).spawn() {
        Ok(c) => c,
        Err(first_err) => {
            if cfg!(windows) && !cfg.command.contains('.') && !cfg.command.contains(['/', '\\']) {
                spawn_via_cmd(cfg).map_err(|e| format!("'{}' başlatılamadı: {e}", cfg.command))?
            } else {
                return Err(format!("'{}' başlatılamadı: {first_err}", cfg.command));
            }
        }
    };

    let stdin = child.stdin.take().ok_or("stdin alınamadı")?;
    let stdout = child.stdout.take().ok_or("stdout alınamadı")?;

    // Okuyucu thread: her JSON satırını kanala bas. Süreç ölünce kanal kapanır.
    let (tx, rx) = channel::<Value>();
    let debug = std::env::var("MCP_DEBUG").is_ok();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(e) => {
                    if debug { eprintln!("[mcp:reader] okuma hatası: {e}"); }
                    break;
                }
            };
            if debug { eprintln!("[mcp:reader] satır: {}", &line[..line.len().min(120)]); }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
                if tx.send(v).is_err() {
                    break;
                }
            }
        }
        if debug { eprintln!("[mcp:reader] EOF — thread çıkıyor"); }
    });

    let mut conn = Connection { child, stdin, rx, next_id: 0, tools: vec![] };

    // MCP el sıkışması
    request(
        &mut conn,
        "initialize",
        json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "axiom", "version": env!("CARGO_PKG_VERSION") }
        }),
        INIT_TIMEOUT,
    )?;
    notify(&mut conn, "notifications/initialized", json!({}))?;

    Ok(conn)
}

fn list_tools(conn: &mut Connection) -> Result<Vec<McpToolInfo>, String> {
    let result = request(conn, "tools/list", json!({}), INIT_TIMEOUT)?;
    let tools = result
        .get("tools")
        .and_then(|t| t.as_array())
        .ok_or("tools/list beklenmedik yanıt")?
        .iter()
        .filter_map(|t| {
            Some(McpToolInfo {
                name: t.get("name")?.as_str()?.to_string(),
                description: t
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("")
                    .to_string(),
                input_schema: t
                    .get("inputSchema")
                    .cloned()
                    .unwrap_or_else(|| json!({"type": "object", "properties": {}})),
            })
        })
        .collect();
    Ok(tools)
}

fn write_line(stdin: &mut ChildStdin, v: &Value) -> Result<(), String> {
    let line = serde_json::to_string(v).map_err(|e| e.to_string())?;
    stdin
        .write_all(line.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("MCP sunucusuna yazılamadı: {e}"))
}

fn notify(conn: &mut Connection, method: &str, params: Value) -> Result<(), String> {
    write_line(
        &mut conn.stdin,
        &json!({ "jsonrpc": "2.0", "method": method, "params": params }),
    )
}

/// Tek istek gönderir, kendi id'sinin yanıtını bekler. Aradaki bildirimleri
/// yok sayar; sunucu kaynaklı istekleri method-not-found ile cevaplar.
fn request(conn: &mut Connection, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
    conn.next_id += 1;
    let id = conn.next_id;
    write_line(
        &mut conn.stdin,
        &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
    )?;

    let deadline = std::time::Instant::now() + timeout;
    loop {
        let remaining = deadline
            .checked_duration_since(std::time::Instant::now())
            .ok_or_else(|| format!("MCP '{method}' zaman aşımı"))?;
        let msg = match conn.rx.recv_timeout(remaining) {
            Ok(m) => m,
            Err(RecvTimeoutError::Timeout) => return Err(format!("MCP '{method}' zaman aşımı")),
            Err(RecvTimeoutError::Disconnected) => {
                let status = conn
                    .child
                    .try_wait()
                    .ok()
                    .flatten()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "hala calisiyor".into());
                return Err(format!("MCP sunucu süreci kapandı (durum: {status})"));
            }
        };

        let msg_id = msg.get("id").and_then(|i| i.as_u64());
        let has_method = msg.get("method").is_some();

        if msg_id == Some(id) && !has_method {
            if let Some(err) = msg.get("error") {
                let m = err.get("message").and_then(|m| m.as_str()).unwrap_or("bilinmeyen");
                return Err(format!("MCP hatası: {m}"));
            }
            return Ok(msg.get("result").cloned().unwrap_or(Value::Null));
        }

        // Sunucu kaynaklı istek (sampling vb.) — desteklemiyoruz, kibarca reddet.
        if has_method && msg_id.is_some() {
            let _ = write_line(
                &mut conn.stdin,
                &json!({
                    "jsonrpc": "2.0", "id": msg_id,
                    "error": { "code": -32601, "message": "not supported" }
                }),
            );
        }
        // Bildirimler ve eşleşmeyen mesajlar: yok say, beklemeye devam.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Saf-node mock MCP sunucusuyla protokol katmanının uçtan uca testi:
    /// spawn → initialize → tools/list → tools/call. npx/ağ gerektirmez,
    /// yalnız PATH'te node ister:
    ///   cargo test mock_node_server -- --ignored --nocapture
    #[test]
    #[ignore]
    fn mock_node_server_handshake_and_call() {
        let script = r#"
const rl=require('readline').createInterface({input:process.stdin});
function send(o){process.stdout.write(JSON.stringify(o)+'\n')}
rl.on('line',l=>{let m;try{m=JSON.parse(l)}catch(e){return}
if(m.method==='initialize')send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'mock',version:'0'}}});
else if(m.method==='tools/list')send({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'echo',description:'geri yansit',inputSchema:{type:'object',properties:{msg:{type:'string'}}}}]}});
else if(m.method==='tools/call')send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'yanki: '+m.params.arguments.msg}]}});
});
"#;
        let mgr = McpManager::default();
        let cfg = McpServerConfig {
            name: "mock".into(),
            command: "node".into(),
            args: vec!["-e".into(), script.into()],
            env: HashMap::new(),
            enabled: true,
        };
        let tools = mgr.connect(&cfg).expect("bağlantı başarısız");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "echo");

        let out = mgr
            .call_tool("mock", "echo", json!({ "msg": "merhaba" }))
            .expect("tools/call başarısız");
        assert_eq!(out, "yanki: merhaba");
        mgr.kill_all();
    }

    /// Gerçek bir MCP sunucusuyla uçtan uca el sıkışma + araç çağrısı.
    /// npx ve ağ gerektirir — normal build'de atlanır:
    ///   cargo test filesystem_server -- --ignored --nocapture
    ///
    /// Bu test bir dönem "mcp-server-filesystem is not recognized" ile
    /// düşüyordu — nedeni `sanitized_path` üstündeki cargo/cmd 8191 notu.
    #[test]
    #[ignore]
    fn filesystem_server_handshake_and_call() {
        let dir = std::env::temp_dir().join("axiom-mcp-test");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("selam.txt"), "merhaba mcp").unwrap();

        let mgr = McpManager::default();
        let cfg = McpServerConfig {
            name: "fs-test".into(),
            command: "npx".into(),
            args: vec![
                "-y".into(),
                "@modelcontextprotocol/server-filesystem".into(),
                dir.to_string_lossy().to_string(),
            ],
            env: HashMap::new(),
            enabled: true,
        };

        let tools = mgr.connect(&cfg).expect("bağlantı başarısız");
        assert!(!tools.is_empty(), "araç listesi boş");
        eprintln!("araçlar: {:?}", tools.iter().map(|t| &t.name).collect::<Vec<_>>());

        let out = mgr
            .call_tool(
                "fs-test",
                "list_directory",
                json!({ "path": dir.to_string_lossy() }),
            )
            .expect("tools/call başarısız");
        eprintln!("list_directory çıktısı: {out}");
        assert!(out.contains("selam.txt"));

        mgr.kill_all();
    }
}
