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

## FAZ 2 — Native function calling (1 gün)

- [ ] Ollama: `/api/chat` isteğine `tools:[...]` şeması ekle (`src-tauri/src/runtime/ollama/client.rs`,
      `types.rs`); yanıttaki `message.tool_calls`'u stream event'ine taşı (`StreamTokenEvent`'e
      `tool_calls_json: Option<String>` alanı).
- [ ] Gemini (`src-tauri/src/runtime/cloud/gemini.rs`): `functionDeclarations` + `functionCall` parse.
- [ ] Frontend: `chatStore.send` döngüsünde önce native `tool_calls`'a bak; yoksa ve model
      tool-capable değilse mevcut regex fallback'i KORU (küçük modeller için).
- [ ] Tool tanımlarını tek kaynaktan üret: `TOOL_SYSTEM_PROMPT` metnini ve JSON şemayı
      aynı registry'den derle (`src/lib/toolRegistry.ts` — yeni dosya).
- Kabul: gemini-2.5-flash ile "İstanbul hava durumu" tek turda functionCall üretiyor;
  tool destekli Ollama modeli (örn. llama3.1) native çalışıyor; eski yol bozulmadı.

## FAZ 3 — MCP client (2-3 gün, ayrı branch)

- [ ] Rust tarafı: `rmcp` (resmi Rust SDK) ile stdio transport MCP client.
      Config: settings'e `mcpServers: [{name, command, args, env}]`.
      Komutlar: `mcp_list_tools(server)`, `mcp_call_tool(server, tool, args_json)`,
      `mcp_server_status()`. Süreç yaşam döngüsü: app start'ta lazy spawn, çıkışta kill.
- [ ] Tool registry'ye MCP tool'ları dinamik eklenir (Faz 2'deki tek kaynak sayesinde
      hem prompt'a hem native şemaya otomatik girer). İsim çakışması: `mcp__server__tool`.
- [ ] Ayarlar UI: sunucu ekle/kaldır/başlat-durdur + tool listesi görünümü.
- [ ] Güvenlik: MCP tool çağrıları Faz 0.4'teki onay kapısından geçer (varsayılan `confirm`).
- Kabul: filesystem MCP sunucusu eklenip chat'ten dosya listeletilebiliyor.

## FAZ 4 — Hızlı palet + i18n (isteğe bağlı, satış cilası)

- [ ] Global hotkey (mevcut `tauri-plugin-global-shortcut`) ile Spotlight tarzı mini pencere:
      yeni `palette` window (tauri.conf.json'a ekle; clipboard penceresindeki acrylic düzeni
      yeniden kullan), tek input → cevap → Enter'la ana pencerede sohbete dönüştür.
- [ ] i18n: `src/i18n/tr.ts` + `en.ts`; başlangıç kapsamı: TitleBar, Sidebar, ChatPanel,
      Settings. Hardcoded metinler kademeli taşınır (büyük patlama YOK).

---

## Çalışma kuralları (tüm fazlar)

1. Her faz ayrı commit seti; Faz 0 maddeleri tek tek commit'lenir (güvenlik izlenebilirliği).
2. Rust değişikliklerinde `cargo check`; frontend'de `npx tsc --noEmit` yeşil olmadan commit yok.
3. Büyük veri IPC kuralı: >1MB payload base64/JSON ile taşınmaz (bkz. Bağlam/ders).
4. Davranış değiştiren her maddede önce mevcut davranışı çalıştırıp gözle (dev app), sonra değiştir.
5. Faz 1 göçünde kullanıcı verisi SİLİNMEZ, yeniden adlandırılır (rollback için).

## NOTLAR / İLERLEME GÜNLÜĞÜ

- 2026-07-02: Plan oluşturuldu (Fable 5).
- 2026-07-02: Faz 0.2 (Telegram whitelist) tamamlandı. Sıradaki: 0.3 (keyring) veya 0.4 (tool onay kapısı).
