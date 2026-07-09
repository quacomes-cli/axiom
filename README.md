# 🧠 Axiom — Local AI Agent for Desktop

> "Bilgisayarını kullanan ikinci bir beyin."

Donanım-aware, izin tabanlı bir masaüstü AI agent. Tauri 2 (Rust) + React 19 + TypeScript.

## Durum: Faz 1 — Temel (in progress)

Bu repo şu an **çalışan iskelet (v0.1 base)** durumunda:

- ✅ Tauri 2 + React 19 + TypeScript + Vite kabuğu
- ✅ Tailwind CSS 4 (CSS-first `@theme` token'ları) + dark-first tasarım dili
- ✅ Zustand state yönetimi
- ✅ 5 sayfalı kabuk: **Chat · Tasks · Models · Apps · Settings**
- ✅ Type-safe IPC katmanı (`src/lib/ipc.ts` ↔ `src-tauri/src/ipc`)
- ✅ Çalışan **Hardware Profiler** (CPU/RAM) — uçtan uca IPC örneği (`Models` sekmesi)

Henüz bağlanmamış (sonraki fazlar): model inference, permission engine backend,
agent planner/executor, screen vision, app connectors. Arayüzdeki bu bölümler
şimdilik placeholder.

## Geliştirme

Gereksinimler: Node 18+, Rust (MSVC toolchain), WebView2 (Windows 11'de hazır).

```bash
npm install          # bağımlılıklar
npm run tauri dev    # masaüstü uygulamasını dev modunda aç
npm run build        # frontend type-check + production build
```

> Not: npm 11 allow-scripts kullanır; `esbuild` postinstall'u `package.json`
> içindeki `allowScripts` ile onaylanmıştır.

## Yapı

```
src/                       # React frontend
├── components/
│   ├── chat/              # ChatPanel
│   ├── tasks/             # TaskBoard
│   ├── models/            # ModelList + HardwarePanel (canlı profiler)
│   ├── apps/              # AppsHub
│   ├── settings/          # PermissionGrid
│   └── shared/            # Sidebar, StatusBar, PageHeader
├── stores/                # Zustand (uiStore, chatStore)
├── lib/ipc.ts             # type-safe Tauri invoke wrapper'ları
├── types.ts               # Rust kontratlarını yansıtan tipler
└── styles/index.css       # Tailwind 4 + Axiom tema token'ları

src-tauri/src/             # Rust backend
├── ipc/commands.rs        # Tauri command handler'ları (app_info, hardware_profile)
├── runtime/profiler.rs    # Donanım profili (sysinfo)
└── lib.rs                 # Tauri builder + invoke_handler
```

## Sonraki adımlar (Faz 1'in kalanı)

- Rust **Permission Engine** (filesystem/process/network) + config persistence
- `PermissionGrid` UI'yı gerçek backend'e bağlama
- FS read/write tool'ları + onay mekanizması
- Ollama / OpenAI-compatible API entegrasyonu (Faz 2 başlangıcı)

## Release & Auto-Update

Axiom Tauri 2'nin updater plugin'ini kullanır. İmzalı `latest.json` GitHub
Releases'tan dağıtılır; uygulama içinden **Ayarlar → Güncelleme** sekmesinden
manuel kontrol edilir.

### Tek seferlik kurulum

1. **LLVM** kurulu olmalı (whisper-rs bindgen için): https://github.com/llvm/llvm-project/releases
   — Windows default yolu (`C:\Program Files\LLVM`) `.cargo/config.toml` ile
   otomatik set edilir. Başka yere kurduysan o dosyayı güncelle.

2. **Updater keypair** oluştur (sadece bir kez):
   ```powershell
   bun run tauri signer generate -w $env:USERPROFILE\.tauri\axiom.key
   ```
   - Çıkan **public key**'i `src-tauri/tauri.conf.json` içindeki
     `plugins.updater.pubkey` alanına yapıştır.
   - **Private key** (`.key` dosyası) ASLA commitleme. Bir password manager'a
     yedekle.

3. `tauri.conf.json`'daki `endpoints` URL'sini kendi GitHub repo'una göre
   güncelle (şu an placeholder olarak `firatmio/axiom`).

### Her release

```powershell
# 1) Private key'i ortama yükle
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $env:USERPROFILE\.tauri\axiom.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "key-sifren"

# 2) Build + bundle (versiyon stringi her yere yazılır)
.\scripts\release.ps1 0.2.0

# 3) Script çıktısındaki .nsis.zip / .msi.zip ve onların .sig'lerini
#    GitHub Releases'a yükle. latest.json'i de manuel oluştur ve yükle.
#    (script şablonunu basıyor.)
```

Uygulama başlatıldıktan sonra Ayarlar → Güncelleme → "Şimdi kontrol et"
butonu yeni sürümü bulur, imza doğrulanır, indirilir, "Yeniden başlat"
ile devreye girer.
