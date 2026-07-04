# Axiom Yol Haritası — Uygulama Planı

> Bu dosya, 2026-07-02'deki ürün değerlendirmesinden çıkan işlerin uygulama planıdır.
> Her faz kendi başına shiplenebilir; sıra bilinçli seçildi (güvenlik → temel → özellik).
> Herhangi bir oturum/model bu dosyadan devam edebilir: her görevde dosya yolları,
> şema ve kabul kriterleri var. Tamamlanan maddeyi `[x]` yap ve NOTLAR bölümüne
> tarih + kısa özet düş.

## Bağlam (yeni oturum için özet)

- Tauri v2 + React/Zustand + Rust. Windows odaklı masaüstü AI asistan.
- Sohbet: `src/stores/chatStore.ts` (zustand persist → localStorage, throttled).
  Tool çağrıları ` ```tool:xxx``` ` regex bloklarıyla (`parseToolBlocks`/`executeToolBlock`).
- Rust IPC: `src-tauri/src/ipc/commands.rs`, kayıt `src-tauri/src/lib.rs`.
- SQLite zaten var: `memory.db` (`src-tauri/src/memory/mod.rs`) — embeddings + FTS chat index.
- Permission engine var: `src-tauri/src/permissions/*` + `permissions_check` komutu,
  ama chat tool döngüsü onu KULLANMIYOR (Faz 0.4'ün konusu).
- Telegram auto-mode: `src/hooks/useTelegramAutoMode.ts` — getUpdates long-poll.
- Cloud sync: `src/hooks/useCloudSync.ts` + `src/lib/syncService.ts` (Firebase).
- Ayarlar: `%APPDATA%/com.axiom.app/settings.json` — API anahtarları DÜZ METİN.
- 2026-07-02'de çözülen "memory leak" vakası: Cargo.toml description mojibake
  (release.ps1 encoding) EXE VERSIONINFO'ya gömülüyordu + alarm WAV base64 IPC.
  Ders: büyük binary'ler IPC'den base64 geçmez (asset protokolü kullan),
  release script dosyaları açık UTF-8 ile okur.

---

## FAZ 0 — Güvenlik yangınları (yarım gün, hemen)

### 0.1 Updater anahtar rotasyonu — KULLANICI AKSİYONU (kod değil)
- [ ] `güncelleme` dosyasındaki private key şifresi commit'lenmiş durumda → şifreyi değiştir:
      yeni keypair üret (`bun run tauri signer generate -w %USERPROFILE%\.tauri\axiom.key`),
      yeni pubkey'i `src-tauri/tauri.conf.json` `plugins.updater.pubkey`'e yaz.
- [ ] `güncelleme` dosyasını repodan sil, `.gitignore`'a ekle.
- [ ] Eski pubkey'le imzalı sürümler yeni imzayı doğrulayamaz → bir "köprü sürüm"
      çıkar: eski anahtarla imzalanmış ama yeni pubkey'i taşıyan bir release.
- Kabul: repoda şifre/anahtar izi yok; güncelleme zinciri kopmadı.

### 0.2 Telegram chat_id whitelist — TAMAMLANDI (2026-07-02)
Dosya: `src/lib/telegramAccess.ts` (yeni), `src/hooks/useTelegramAutoMode.ts`, `src/components/apps/AppsHub.tsx`
- [x] Config: `allowed_chat_ids` ("1,2") + `pending_pairs` ("id|ad,...") — parser/formatter `telegramAccess.ts`'de.
- [x] `poll()`: whitelist dışı chat → model'e gitmez; `handlePairingRequest` pending'e ekler,
      NotificationCenter'a bildirim düşer, karşıya TEK seferlik "özel bot" cevabı gider.
- [x] AppsHub → Telegram dialog'una `TelegramAccessSection`: bekleyenler için İzin ver/Reddet,
      onaylılar chip listesi (kaldırılabilir), elle chat_id ekleme. CANLI config'le çalışır.
- [x] Geçiş tohumu: `allowed_chat_ids` anahtarı hiç yoksa mevcut `chat_id` onaylı sayılır.
- [x] Yan düzeltme: dialog `save()/handleTest()/handleOAuth()` artık canlı config'le merge
      ediyor — dialog açıkken yazılan OAuth token/whitelist onayları ezilmiyor.
- Kabul kriteri karşılandı: whitelist dışı mesaj `handleTelegramMessage`'a hiç ulaşmıyor.

### 0.3 Sırların şifrelenmesi + cloud sync'ten çıkarılması — TAMAMLANDI (2026-07-02)
Dosyalar: `src-tauri/src/settings/secrets.rs` (yeni), `settings/store.rs`, `settings/mod.rs`,
`src-tauri/src/lib.rs`, `src-tauri/src/ipc/commands.rs`, `src/lib/syncService.ts`
- [x] `keyring` crate (windows-native) eklendi. Ayrı IPC komutu yerine save/load
      sınırında şeffaf entegrasyon tercih edildi: `save()` anahtarları keyring'e
      stash'leyip json'a `__keyring__` sentineli yazar; `load_or_default()` sentineli
      keyring'den çözer. Bellekteki AppSettings hep gerçek anahtarı taşır — registry
      ve UI değişmeden çalışır. Keyring yazılamazsa anahtar düz metin bırakılır
      (anahtar kaybı > sızıntı riski trade-off'u, log'a düşer).
- [x] Açılışta tek seferlik göç: `disk_has_plaintext_keys()` true ise save tetiklenir.
- [x] `cloud_providers_set`: silinen provider'ın keyring kaydını temizler.
- [x] `uploadSettings` sanitize: `cloudProviders[*].apiKey` Firebase'e boş gider.
      (Telegram bot_token appStore/localStorage'da, cloud sync'e zaten girmiyor —
      onun keyring'e taşınması Faz 1 sonrası ayrı küçük iş olarak kaldı.)
- Kabul doğrulandı: settings.json'da `"apiKey": "__keyring__"`, Credential Manager'da
  `cloud.gemini.apiKey.com.axiom.app` kaydı, ikinci açılış sorunsuz.

### 0.4 Tehlikeli tool'lara onay kapısı — TAMAMLANDI (2026-07-02)
Dosyalar: `src/stores/approvalStore.ts` (yeni), `src/components/shared/ApprovalPrompt.tsx` (yeni),
`src/stores/chatStore.ts`, `src/hooks/useTaskScheduler.ts`, `src/hooks/useTelegramAutoMode.ts`, `src/App.tsx`
- [x] KÖK HATA düzeltildi: eski `checkPermission`, `confirm` kararını izin sayıyordu
      (`kind !== "deny"`) — "her seferinde sor" ayarı hiç sormuyordu.
- [x] `approvalStore.request()` promise'i kullanıcı kararına kadar bekletir; 120sn
      cevapsız kalırsa otomatik RED. `stopGeneration` bekleyenleri reddeder.
- [x] UI: `ApprovalPrompt` — sağ altta global kart (hangi sekmede olunursa olunsun görünür;
      plandaki "chat içi inline kart" yerine bilinçli tercih). App.tsx'e mount edildi.
- [x] Tüm izin kapıları (fs read/write/dir, shell, network) confirm akışına bağlandı;
      deny artık engine'in `reason`'ını model'e iletiyor.
- [x] Arka plan bağlamları (`useTaskScheduler`, `useTelegramAutoMode`) `interactive:false`
      geçer → confirm gerektiren işlem sorulmadan reddedilir, model'e açıklama döner.
- [x] send döngüsündeki araç zaman aşımı 30sn → 150sn (onay bekleme süresini kapsasın).

---

## FAZ 1 — Sohbet depolamayı SQLite'a taşı (1-2 gün)

Amaç: localStorage tavanından kurtulmak, resimlerin restart'ta kaybolmasını bitirmek,
FTS ile çift kaynağı teke indirmek.

### 1.1 Şema (memory.db içine, `src-tauri/src/memory/mod.rs` yanına `chats.rs`)
```sql
CREATE TABLE chats(
  id TEXT PRIMARY KEY, title TEXT NOT NULL,
  compacted_summary TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE chat_messages(
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL, text TEXT NOT NULL,
  tool_actions_json TEXT, thinking TEXT,
  seq INTEGER NOT NULL, created_at INTEGER);
CREATE INDEX idx_msg_chat ON chat_messages(chat_id, seq);
CREATE TABLE chat_images(
  id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  data BLOB NOT NULL, mime TEXT NOT NULL);
```
- Resimler BLOB olarak DB'de (75MB vakası ders: IPC'ye base64 komple resim listesi
  DEĞİL — mesaj yüklerken resimleri ayrı komutla, sadece görüntülenen mesaj için çek).

### 1.2 Rust komutları
- [ ] `chats_list() -> Vec<ChatMeta>` (mesajsız, updated_at DESC)
- [ ] `chat_messages_get(chat_id, before_seq?, limit?)` (sayfalı)
- [ ] `chat_upsert(meta)`, `chat_delete(id)`, `message_append(msg)`, `message_update(id, text, tool_actions)`,
      `message_delete(id)`, `chat_image_get(message_id) -> Vec<(id, mime)>` + asset benzeri ayrı fetch
- [ ] Mevcut FTS (`chat_history_index`) `message_append` içinde otomatik çağrılır → frontend'deki ayrı index çağrıları silinir.

### 1.3 Frontend göçü
- [ ] `chatStore`'dan `persist` middleware'i çıkar; state sadece "açık sohbet + meta listesi".
- [ ] İlk açılışta göç: localStorage `axiom-chats` varsa → toplu `chat_upsert`/`message_append`,
      başarıyla bitince localStorage anahtarını `axiom-chats.migrated-YYYYMMDD` olarak yeniden adlandır (silme!).
- [ ] Stream sırasında token'lar bellekte birikir; mesaj FINALIZE olunca tek `message_append`
      (her token'da DB yazma YOK — throttledLocalStorage'ın yaptığı işi doğal çözer).
- [ ] `useCloudSync` chat upload'ı değişmez (chats state'inden okumaya devam eder) ama
      "changed" tespiti updated_at üzerinden yapılır.
- Kabul: 50MB'lık sohbet geçmişiyle açılış < 1sn (meta liste); eski sohbetler göç etti;
  resimler restart sonrası duruyor; arama (SearchModal) çalışıyor.

---

## FAZ 2 — Native function calling

### 2a — Ollama native tools — TAMAMLANDI (2026-07-03)
Tasarım kararı (plandakinden sapma, bilinçli): stream callback zincirine yeni alan
eklemek 9+ çağrı noktasına yayılıyordu. Bunun yerine Rust, native `tool_calls`'u
mevcut ` ```tool:...``` ` blok METNİNE çevirip token akışına enjekte ediyor
(`ollama/client.rs tool_call_to_block`) — event zinciri, frontend parser ve yürütme
yolu SIFIR değişiklikle native calling kazandı.
- [x] `InferenceRequest.tools` (opak JSON) → `OllamaChatRequest.tools`; hem stream
      hem non-stream (agent/Telegram) yolda tool_calls → blok dönüşümü.
- [x] `src/lib/toolRegistry.ts`: built-in araç şemaları + etkin app araçları
      (app tool adları rewriteAppToolBlocks ile app_tool bloğuna zaten dönüşüyor).
      DİKKAT: parametre adları Rust dönüştürücü ve parseToolBlocks ile kilitli
      (web_search→query, run_command→command, write_file→path+content).
- [x] chatStore.send + useTaskScheduler + useTelegramAutoMode `tools` gönderiyor
      (yalnız model "tools" yeteneğine sahipse; değilse alan yok, regex yolu aynen).
- [x] Protokol doğrulandı: gemma4:12b, registry şemasıyla "İstanbulda hava nasıl?" →
      `tool_calls:[{name:"weather", arguments:{city:"Istanbul"}}]` döndürdü.
- UI uçtan uca test: kullanıcı gemma4:12b ile hava durumu sorup tool kartının
  çıktığını görmeli.

### 2b — Gemini functionDeclarations — YAPILMADI
Gemini regex-prompt yoluyla zaten güvenilir çalışıyor (talimat takibi güçlü);
native'e geçiş düşük öncelik. Yapılacaksa: `cloud/gemini.rs`'de `tools` →
`functionDeclarations` çevirisi + yanıt `functionCall` → aynı blok-metin enjeksiyonu.

## FAZ 3 — MCP client — TAMAMLANDI (2026-07-04, faz3-mcp branch)

- [x] Rust tarafı: **elle yazılmış** minimal stdio MCP client (`src-tauri/src/mcp/mod.rs`).
      `rmcp` SDK yerine bağımlılıksız ~470 satır tercih edildi (initialize →
      notifications/initialized → tools/list → tools/call, satır-ayrımlı JSON-RPC).
      Config: `AppSettings.mcp_servers: [{name, command, args, env, enabled}]`.
      Komutlar: `mcp_servers_get/set`, `mcp_connect`, `mcp_disconnect`, `mcp_status`,
      `mcp_call`. Yaşam döngüsü: açılışta enabled sunuculara auto-connect (App.tsx),
      çıkışta `kill_all` (lib.rs RunEvent::Exit).
- [x] Tool registry'ye MCP tool'ları dinamik eklenir: native ad `mcp__server__tool`,
      sunucunun kendi `inputSchema`'sı aynen geçer. Rust `tool_call_to_block` bu adı
      `tool:mcp_call` bloğuna çevirir (server/tool + `---` + JSON args). Prompt-tabanlı
      modeller için `buildMcpToolsPrompt` sistem prompt'una araç bloğu ekler.
- [x] Ayarlar UI: **MCP sekmesi** (`McpSettings.tsx`) — ekle/sil/bağlan/kes,
      enable toggle, canlı durum (bağlı/araç sayısı/hata), araç listesi.
- [x] Güvenlik: MCP çağrıları HER ZAMAN onay kartından geçer (arka planda otomatik red —
      `interactive:false` → uzaktan sessiz dış-araç çalıştırma engellenir).
- [x] Kabul: filesystem sunucusu (`npx @modelcontextprotocol/server-filesystem`) entegrasyon
      testiyle doğrulandı (14 araç, list_directory çalışıyor). Canlı chat doğrulaması
      kullanıcıda: MCP sekmesinden filesystem ekle → sohbetten dosya listelet.
- NOT (spawn/PATH tuzağı, çözüldü): `cargo run`/`cargo test` bağımlılıkların DLL
      arama yollarını (whisper-rs-sys CMake dizinleri) PATH'e ekleyip ~19KB'a şişiriyor;
      cmd.exe 8191 karakter üstünü genişletemediği için npx .cmd shim'leri "is not
      recognized" ile ölüyordu. `sanitized_path()` PATH >8000 ise `target\debug|release`
      girdilerini ayıklar. Gerçek kullanıcı PATH'i (~2.3KB) zaten sınır altında.

## FAZ 4 — Hızlı palet + i18n

### 4a — Hızlı palet — TAMAMLANDI (2026-07-03)
- [x] `palette` penceresi (tauri.conf.json): gizli başlar, çerçevesiz, şeffaf,
      hep üstte, taskbar'da görünmez. OS Acrylic blur lib.rs setup'ında
      (eski ölü "clipboard" bloğu palete dönüştürüldü — clipboard penceresi
      hiç yaratılmıyordu).
- [x] Çoklu pencere yönlendirmesi: `main.tsx` pencere etiketine bakar; palet
      penceresi App'i ve arka plan hook'larını YÜKLEMEZ (PalettePage hafif,
      yalnız ipc kullanır — chatStore yok, araç yok, onay UI'sı yok).
- [x] Global kısayol `settings.shortcuts.palette` (varsayılan Ctrl+Shift+Space,
      Ayarlar → Kısayollar'dan değiştirilebilir; Rust Shortcuts struct'ına
      serde default ile eklendi). Kayıt `usePaletteBridge` hook'unda.
- [x] Akış: Enter → ipc.modelsChat (non-stream, araçsız, kısa cevap promptu);
      Ctrl+Enter → `palette-handoff` event → ana pencere öne gelir, soru yeni
      sohbette tam altyapıyla gönderilir. Esc / odak kaybı → gizlen.
- UI testi kullanıcıda: Ctrl+Shift+Space (uygulama arka plandayken de).

### 4b — i18n — YAPILMADI
- [ ] `src/i18n/tr.ts` + `en.ts`; başlangıç kapsamı: TitleBar, Sidebar, ChatPanel,
      Settings. Hardcoded metinler kademeli taşınır (büyük patlama YOK).

---

## Çalışma kuralları (tüm fazlar)

1. Her faz ayrı commit seti; Faz 0 maddeleri tek tek commit'lenir (güvenlik izlenebilirliği).
2. Rust değişikliklerinde `cargo check`; frontend'de `npx tsc --noEmit` yeşil olmadan commit yok.
3. Büyük veri IPC kuralı: >1MB payload base64/JSON ile taşınmaz (bkz. Bağlam/ders).
4. Davranış değiştiren her maddede önce mevcut davranışı çalıştırıp gözle (dev app), sonra değiştir.
5. Faz 1 göçünde kullanıcı verisi SİLİNMEZ, yeniden adlandırılır (rollback için).

## ARA İŞLER (plan dışı, kullanıcı talebiyle)

### İzin sistemi UX yenilemesi — TAMAMLANDI (2026-07-03)
- Model, kullanıcı adını görünen addan tahmin ediyordu ("C:/Users/Fırat Tuna Arslan")
  → `src/lib/envInfo.ts`: gerçek ev/masaüstü/belgeler/indirilenler yolları sistem
  prompt'una enjekte ediliyor (App açılışında init).
- Engine: kapsam dışı dosya yolu artık sert RED değil CONFIRM (onay kartı) —
  `Blocked` seviyesi hâlâ keser. Test güncellendi (6/6 yeşil).
- Onay kartı üç kararlı: Reddet / Bu sefer / Her zaman. "Her zaman" →
  `src/lib/permissionUpdates.ts` kalıcı kurala çevirir (fs: dizin kapsama eklenir +
  seviye allowed; shell/network: seviye allowed). İzinler sayfası aynı config'i
  okuduğundan modal kararları sayfada görünür; sayfada "izinli" yapılan şey için
  modal hiç tetiklenmez. Sayfa focus'ta yeniden yükleniyor.
- PermissionGrid yenilendi: Türkçe etiketler, grup ikonları, açıklamalar,
  modal-sayfa ilişkisinin açıklaması.

### UI/UX toplu paketi — TAMAMLANDI (2026-07-03)
- Tema: sıkıştırılmış radius skalası + sıcak palet (kullanıcı koyu temayı nötr
  gri/beyaz vurguya çekti — 15274d3); light tema krem/terracotta.
- Yanıt: yeniden oluştur + sürüm gezgini (‹ 2/3 ›) + raporla (MessageActions).
- İnteraktif HTML yanıtlar: ```html blokları sandbox iframe'de canlı render
  (allow-same-origin YOK — IPC erişilemez). `InteractiveHtml.tsx`.
- Custom Tooltip (`shared/Tooltip.tsx`): portal, viewport flip, ok hizalama.
  Uygulanan yerler: mesaj aksiyonları, TaskBoard. Kalan title'lar kademeli geçer.
- Görevler full agentable: pano görevleri tek tıkla agent'a devredilir.
- "Hızlandır" Modeller başlığına taşınmıştı (kullanıcı commit'i) — doğrulandı.

## NOTLAR / İLERLEME GÜNLÜĞÜ

- 2026-07-02: Plan oluşturuldu (Fable 5).
- 2026-07-02: Faz 0.2 (Telegram whitelist) tamamlandı — commit 01fa528.
- 2026-07-02: Faz 0.4 (tool onay kapısı) tamamlandı — commit e2e022a.
- 2026-07-02: Faz 0.3 (keyring + sync sanitize) tamamlandı — commit df38afa.
- 2026-07-02: Faz 0.1 kod tarafı: 'güncelleme' dosyası repodan çıkarıldı — commit 9983e41.
  KALAN (kullanıcı aksiyonu): anahtar rotasyonu — parola git geçmişinde hâlâ mevcut!
- 2026-07-02: FAZ 1 tamamlandı. Tasarım plandakinden bilinçli sapma: UI'yı kırmamak
  için store bellekte tam kalır (sayfalı yükleme YOK), yalnızca kalıcılık katmanı
  değişti — `chat_save` sohbet başına full-replace (mesaj finalize'ında, token başına
  değil), resimler `chat_images` tablosunda BLOB (IPC'den mesaj başına bir kez geçer,
  `persistedImageMsgIds` ile). localStorage persist'te sadece toolUseEnabled/chatMode
  kaldı (axiom-chat-prefs). Güvenlik ağı: store subscription thinking=false'ken aktif
  sohbeti referans-karşılaştırmalı kaydeder. Göç doğrulandı: 13 sohbet/121 mesaj
  SQLite'a taşındı, ikinci açılışta duplikasyon 0, UTF-8 sağlam, eski localStorage
  verisi `axiom-chats.migrated-*` olarak korunuyor.
  TEST EDİLMEDİ (manuel doğrula): resimli mesajın restart sonrası geri gelmesi
  (chat_images_put/load yolu) — resimli bir sohbet gönderip app'i yeniden başlat.
- Sıradaki: FAZ 2 (native function calling). BAŞLAMADAN OKU: Bu faz canlı model
  testi gerektirir (tool-capable bir Ollama modeli veya Gemini kotası) — kullanıcı
  başındayken yapılmalı, çünkü chat çekirdeğine dokunuyor ve kabul kriteri ancak
  UI'dan mesaj atarak doğrulanabilir. Uygulama sırası: (1) `src/lib/toolRegistry.ts`
  tek kaynak (isim + açıklama + JSON şema); (2) Rust `InferenceRequest`'e
  `tools: Option<serde_json::Value>` + `StreamTokenEvent`'e `tool_calls_json`;
  (3) Ollama `/api/chat` `tools` paramı + yanıttaki `message.tool_calls` parse;
  (4) Gemini `functionDeclarations`/`functionCall`; (5) chatStore send döngüsü önce
  native tool_calls'a bakar, yoksa regex fallback AYNEN kalır (küçük modeller için).
