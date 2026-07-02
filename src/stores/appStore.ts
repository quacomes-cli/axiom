import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ipc } from "../lib/ipc";
import {
  OAUTH_PROVIDERS,
  buildAuthUrl,
  exchangeCodeForToken,
  getValidAccessToken,
  resolveClientId,
  resolveClientSecret,
} from "../lib/oauthProviders";

export const AppVersion: string = "v0.1.5"

export type AppConnectionType = "api" | "webhook" | "oauth" | "local";
export type AppConnectionStatus = "disconnected" | "checking" | "connected" | "error";

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    date: number;
    chat: { id: number; type: string };
    from?: { id: number; first_name?: string; username?: string };
    text?: string;
    caption?: string;
    photo?: unknown[];
    voice?: unknown;
  };
}

export interface AppTool {
  name: string;
  description: string;
  parameters: string;
}

export interface AppIntegration {
  id: string;
  name: string;
  description: string;
  connectionType: AppConnectionType;
  enabled: boolean;
  config: Record<string, string>;
  icon: string;
  tools: AppTool[];
  connectionStatus: AppConnectionStatus;
  lastError?: string;
}

const DEFAULT_APPS: AppIntegration[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Repo, issue ve PR yönetimi",
    connectionType: "api",
    enabled: false,
    config: {},
    icon: "github",
    connectionStatus: "disconnected",
    tools: [
      { name: "github_list_repos", description: "Kullanıcının repolarını listele", parameters: "yok" },
      { name: "github_list_issues", description: "Bir reponun issue'larını listele", parameters: "owner, repo" },
      { name: "github_create_issue", description: "Yeni issue oluştur", parameters: "owner, repo, title, body" },
      { name: "github_repo_info", description: "Repo detaylarını getir", parameters: "owner, repo" },
      { name: "github_get_readme", description: "Bir reponun README dosyasını oku", parameters: "owner, repo" },
    ],
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "Bot üzerinden mesaj gönderme ve alma",
    connectionType: "api",
    enabled: false,
    config: {},
    icon: "telegram",
    connectionStatus: "disconnected",
    tools: [
      { name: "telegram_send_message", description: "Mesaj gönder", parameters: "text" },
      { name: "telegram_get_updates", description: "Botla yapılan son konuşmaları getir (auto mode açıkken hafızadan son 20 mesaj; kapalıysa API'den henüz okunmamış mesajlar)", parameters: "limit (opsiyonel, varsayılan 20)" },
    ],
  },
  {
    id: "discord",
    name: "Discord",
    description: "Bot ile sunucu ve kanal yönetimi",
    connectionType: "api",
    enabled: false,
    config: {},
    icon: "discord",
    connectionStatus: "disconnected",
    tools: [
      { name: "discord_send_message", description: "Kanala mesaj gönder", parameters: "channel_id, text" },
      { name: "discord_list_guilds", description: "Botun sunucularını listele", parameters: "yok" },
    ],
  },
  {
    id: "notion",
    name: "Notion",
    description: "Not ve veritabanı entegrasyonu",
    connectionType: "api",
    enabled: false,
    config: {},
    icon: "notion",
    connectionStatus: "disconnected",
    tools: [
      { name: "notion_search", description: "Notion'da sayfa ara", parameters: "query" },
      { name: "notion_create_page", description: "Yeni sayfa oluştur", parameters: "title, content, parent_id (opsiyonel)" },
    ],
  },
  {
    id: "spotify",
    name: "Spotify",
    description: "Müzik kontrolü, arama ve şu an çalan",
    connectionType: "oauth",
    enabled: false,
    config: {},
    icon: "spotify",
    connectionStatus: "disconnected",
    tools: [
      { name: "spotify_now_playing", description: "Şu an çalan parçayı getir", parameters: "yok" },
      { name: "spotify_play", description: "Bir parçayı/sanatçıyı çal (yoksa sıradakine devam et)", parameters: "query (opsiyonel)" },
      { name: "spotify_pause", description: "Çalmayı duraklat", parameters: "yok" },
      { name: "spotify_next", description: "Sıradaki parçaya geç", parameters: "yok" },
      { name: "spotify_prev", description: "Önceki parçaya dön", parameters: "yok" },
      { name: "spotify_search", description: "Spotify'da ara", parameters: "query, type (opsiyonel: track/artist/album)" },
      { name: "spotify_queue_add", description: "Sıraya parça ekle", parameters: "query" },
    ],
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Okunmamış mesajlar, son N mail, taslak oluştur",
    connectionType: "oauth",
    enabled: false,
    config: {},
    icon: "gmail",
    connectionStatus: "disconnected",
    tools: [
      { name: "gmail_unread_count", description: "Okunmamış mesaj sayısını getir", parameters: "yok" },
      { name: "gmail_recent", description: "Son N mesajın özetini getir", parameters: "limit (varsayılan 10)" },
      { name: "gmail_search", description: "Gmail araması (örn. from:x OR subject:y)", parameters: "query, limit (varsayılan 10)" },
      { name: "gmail_draft", description: "Yeni taslak oluştur (gönderilmez)", parameters: "to, subject, body" },
      { name: "gmail_send", description: "Doğrudan e-posta gönder", parameters: "to, subject, body" },
      { name: "gmail_mark_as_read", description: "Maili okundu olarak işaretle veya arşivle", parameters: "messageId, action ('read' veya 'archive')" },
    ],
  },
  {
    id: "gcalendar",
    name: "Google Calendar",
    description: "Etkinlik listele ve oluştur",
    connectionType: "oauth",
    enabled: false,
    config: {},
    icon: "gcalendar",
    connectionStatus: "disconnected",
    tools: [
      { name: "calendar_today", description: "Bugünkü etkinlikleri getir", parameters: "yok" },
      { name: "calendar_upcoming", description: "Yaklaşan etkinlikleri getir", parameters: "days (varsayılan 7)" },
      { name: "calendar_create_event", description: "Yeni etkinlik oluştur", parameters: "title, start (ISO veya 'HH:MM bugün'), duration_min (opsiyonel 60), description (opsiyonel)" },
    ],
  },
  {
    id: "vscode",
    name: "VS Code",
    description: "Editör komutları ve dosya/klasör açma",
    connectionType: "local",
    enabled: false,
    config: {},
    icon: "vscode",
    connectionStatus: "disconnected",
    tools: [
      { name: "vscode_open_path", description: "VS Code'da dosya veya klasör aç", parameters: "path, new_window (opsiyonel)" },
      { name: "vscode_open_repo", description: "Bir git repo klasörünü yeni pencerede aç", parameters: "path" },
    ],
  },
  {
    id: "chrome",
    name: "Tarayıcı",
    description: "Varsayılan tarayıcıda URL aç",
    connectionType: "local",
    enabled: false,
    config: {},
    icon: "chrome",
    connectionStatus: "disconnected",
    tools: [
      { name: "browser_open_url", description: "Varsayılan tarayıcıda URL aç", parameters: "url" },
      { name: "browser_search", description: "Google'da arama yap (yeni sekme)", parameters: "query" },
    ],
  },
  {
    id: "wikipedia",
    name: "Wikipedia",
    description: "Madde özetleri ve hızlı bilgi",
    connectionType: "local",
    enabled: false,
    config: {},
    icon: "wikipedia",
    connectionStatus: "disconnected",
    tools: [
      { name: "wikipedia_summary", description: "Bir başlığın özetini getir (TR/EN otomatik)", parameters: "query, lang (opsiyonel: tr/en)" },
    ],
  },
  {
    id: "reddit",
    name: "Reddit",
    description: "Subreddit'lerden son gönderiler",
    connectionType: "local",
    enabled: false,
    config: {},
    icon: "reddit",
    connectionStatus: "disconnected",
    tools: [
      { name: "reddit_top", description: "Bir subreddit'in en popüler gönderilerini getir", parameters: "subreddit, limit (varsayılan 10)" },
      { name: "reddit_search", description: "Reddit'te ara", parameters: "query, limit (varsayılan 10)" },
    ],
  },
  {
    id: "hackernews",
    name: "Hacker News",
    description: "HN top stories",
    connectionType: "local",
    enabled: false,
    config: {},
    icon: "hackernews",
    connectionStatus: "disconnected",
    tools: [
      { name: "hn_top", description: "Top hikayeleri getir", parameters: "limit (varsayılan 10)" },
      { name: "hn_new", description: "Yeni hikayeleri getir", parameters: "limit (varsayılan 10)" },
    ],
  },
  {
    id: "obsidian",
    name: "Obsidian",
    description: "Yerel vault üzerinde not okuma/yazma",
    connectionType: "local",
    enabled: false,
    config: {},
    icon: "obsidian",
    connectionStatus: "disconnected",
    tools: [
      { name: "obsidian_list", description: "Vault'taki notları listele", parameters: "subdir (opsiyonel)" },
      { name: "obsidian_read", description: "Bir notun içeriğini oku", parameters: "name" },
      { name: "obsidian_append", description: "Bir nota satır ekle (yoksa oluştur)", parameters: "name, content" },
    ],
  },
  {
    id: "active_window",
    name: "Aktif Pencere",
    description: "Şu an odaktaki uygulamayı algıla",
    connectionType: "local",
    enabled: false,
    config: {},
    icon: "active_window",
    connectionStatus: "disconnected",
    tools: [
      { name: "active_window_get", description: "Şu an odaktaki pencerenin başlığını ve programını getir", parameters: "yok" },
    ],
  },
  {
    id: "price_tracker",
    name: "Fiyat Takibi",
    description: "E-ticaret ürünlerinin fiyatlarını takip et",
    connectionType: "local",
    enabled: false,
    config: {},
    icon: "price_tracker",
    connectionStatus: "disconnected",
    tools: [
      { name: "price_track_add", description: "Bir ürün URL'sini takip listesine ekle. Sayfayı çekip ismini ve fiyatını otomatik bulur.", parameters: "url, target_price (opsiyonel, bu değerin altına düşerse alarm), name (opsiyonel, otomatik bulunur)" },
      { name: "price_track_list", description: "Takip edilen tüm ürünleri ve mevcut fiyatlarını listele", parameters: "yok" },
      { name: "price_track_remove", description: "Bir ürünü takipten çıkar", parameters: "id (price_track_list'ten gelen id)" },
      { name: "price_track_check_now", description: "Bir ürünün fiyatını şimdi yeniden kontrol et", parameters: "id" },
    ],
  },
];

interface AppState {
  apps: AppIntegration[];
  toggleApp: (id: string) => void;
  updateConfig: (id: string, config: Record<string, string>) => void;
  testConnection: (id: string) => Promise<void>;
  setConnectionStatus: (id: string, status: AppConnectionStatus, error?: string) => void;
  oauthConnect: (id: string) => Promise<{ userCode?: string; verificationUri?: string; deviceCode?: string; interval?: number; localhost?: boolean } | null>;
  oauthPoll: (id: string, deviceCode: string) => Promise<boolean>;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      apps: DEFAULT_APPS,

      toggleApp: (id) => {
        set((s) => ({
          apps: s.apps.map((a) =>
            a.id === id ? { ...a, enabled: !a.enabled } : a
          ),
        }));
      },

      updateConfig: (id, config) => {
        // ÖNEMLİ: gelen config'i mevcut config'e MERGE et, tamamen değiştirme.
        // Aksi halde AppsHub formundan gelen (OAuth token'larını içermeyen) kısmi
        // değerler access_token/refresh_token gibi alanları silip "Hesap bağlı
        // değil" hatasına yol açar. Status'a dokunmuyoruz — token yenileme gibi
        // arka plan güncellemeleri bağlantıyı koparmasın.
        set((s) => ({
          apps: s.apps.map((a) =>
            a.id === id ? { ...a, config: { ...a.config, ...config } } : a
          ),
        }));
      },

      setConnectionStatus: (id, status, error?) => {
        set((s) => ({
          apps: s.apps.map((a) =>
            a.id === id ? { ...a, connectionStatus: status, lastError: error } : a
          ),
        }));
      },

      testConnection: async (id) => {
        const app = get().apps.find((a) => a.id === id);
        if (!app) return;

        get().setConnectionStatus(id, "checking");

        try {
          switch (id) {
            case "github": {
              const token = app.config["personal_access_token"];
              if (!token) throw new Error("Token girilmedi");
              const resp = await ipc.httpFetch({
                url: "https://api.github.com/user",
                headers: { Authorization: `Bearer ${token}`, "User-Agent": "Axiom" },
              });
              if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
              break;
            }
            case "telegram": {
              const token = app.config["bot_token"];
              if (!token) throw new Error("Bot token girilmedi");
              const resp = await ipc.httpFetch({
                url: `https://api.telegram.org/bot${token}/getMe`,
              });
              if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
              const data = JSON.parse(resp.body);
              if (!data.ok) throw new Error(data.description || "Bot geçersiz");
              break;
            }
            case "discord": {
              const token = app.config["bot_token"];
              if (!token) throw new Error("Bot token girilmedi");
              const resp = await ipc.httpFetch({
                url: "https://discord.com/api/v10/users/@me",
                headers: { Authorization: `Bot ${token}` },
              });
              if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
              break;
            }
            case "notion": {
              const token = app.config["integration_token"];
              if (!token) throw new Error("Integration token girilmedi");
              const resp = await ipc.httpFetch({
                url: "https://api.notion.com/v1/users/me",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Notion-Version": "2022-06-28",
                },
              });
              if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
              break;
            }
            default:
              throw new Error("Bu entegrasyon için bağlantı testi yok");
          }
          get().setConnectionStatus(id, "connected");
        } catch (e) {
          get().setConnectionStatus(id, "error", String(e));
        }
      },

      oauthConnect: async (id) => {
        const app = get().apps.find((a) => a.id === id);
        if (!app) return null;

        get().setConnectionStatus(id, "checking");

        try {
          // GitHub: Device Flow (mevcut, değiştirilmedi)
          if (id === "github") {
            const clientId = app.config["client_id"];
            if (!clientId) {
              get().setConnectionStatus(id, "error", "GitHub OAuth App Client ID gerekli.");
              return null;
            }
            const result = await ipc.oauthDeviceStart(clientId, "repo,read:user");
            return {
              userCode: result.userCode,
              verificationUri: result.verificationUri,
              deviceCode: result.deviceCode,
              interval: result.interval,
            };
          }

          // Diğer provider'lar: localhost callback + dış tarayıcı
          const provider = OAUTH_PROVIDERS[id];
          if (!provider) {
            get().setConnectionStatus(id, "error", "Bu uygulama için OAuth henüz desteklenmiyor.");
            return null;
          }

          // Builtin credentials varsa onları kullan; yoksa kullanıcı config'ine bak
          const clientId = resolveClientId(provider, app.config);
          const clientSecret = resolveClientSecret(provider, app.config);

          if (!clientId) {
            get().setConnectionStatus(id, "error", "Client ID eksik. Yapılandırmadan gir.");
            return null;
          }
          if (provider.needsClientSecret && !clientSecret) {
            get().setConnectionStatus(id, "error", "Client Secret eksik. Yapılandırmadan gir.");
            return null;
          }

          // Backend'den localhost dinleyici al — döndürülen authUrl'i kullanmıyoruz,
          // sadece port'u kullanıp authUrl'i frontend'de inşa ediyoruz (offline/access_type
          // gibi provider-spesifik ek parametreler için).
          const { port } = await ipc.oauthLocalhostStart(
            id,
            clientId,
            provider.authUrlBase,
            provider.scopes,
          );
          const redirectUri = `http://localhost:${port}`;
          const authUrl = buildAuthUrl(provider, clientId, redirectUri);

          // Dış tarayıcıda aç
          await openUrl(authUrl);

          // Backend'den "oauth-callback" event'ini bekle (2dk timeout)
          const code = await new Promise<string>((resolve, reject) => {
            let unlisten: UnlistenFn | undefined;
            const timer = setTimeout(() => {
              unlisten?.();
              reject(new Error("Yetkilendirme zaman aşımı (2 dk). Tekrar dene."));
            }, 120_000);
            listen<{ provider: string; code: string | null }>("oauth-callback", (e) => {
              if (e.payload.provider !== id) return;
              clearTimeout(timer);
              unlisten?.();
              if (!e.payload.code) reject(new Error("Yetkilendirme reddedildi."));
              else resolve(e.payload.code);
            }).then((u) => {
              unlisten = u;
            });
          });

          // Token exchange
          const tokens = await exchangeCodeForToken(
            provider,
            code,
            clientId,
            clientSecret,
            redirectUri,
          );

          // Kaydet
          get().updateConfig(id, {
            ...app.config,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || app.config["refresh_token"] || "",
            expires_at: String(tokens.expires_at),
          });
          get().setConnectionStatus(id, "connected");
          if (!app.enabled) get().toggleApp(id);
          return { localhost: true };
        } catch (e) {
          get().setConnectionStatus(id, "error", String(e));
          return null;
        }
      },

      oauthPoll: async (id, deviceCode) => {
        const app = get().apps.find((a) => a.id === id);
        if (!app) return false;

        const clientId = app.config["client_id"];
        if (!clientId) return false;

        try {
          const result = await ipc.oauthDevicePoll(clientId, deviceCode);
          if (result.status === "success" && result.accessToken) {
            get().updateConfig(id, { ...app.config, personal_access_token: result.accessToken });
            get().setConnectionStatus(id, "connected");
            if (!app.enabled) get().toggleApp(id);
            return true;
          }
          return false;
        } catch {
          return false;
        }
      },
    }),
    {
      name: "axiom-apps",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        apps: state.apps.map((a) => ({ ...a, connectionStatus: "disconnected" as const, lastError: undefined })),
      }) as unknown as AppState,
      merge: (persisted, current) => {
        const p = persisted as Partial<AppState> | undefined;
        if (!p?.apps) return current;
        const merged = DEFAULT_APPS.map((def) => {
          const saved = p.apps!.find((a) => a.id === def.id);
          if (!saved) return def;
          const config = saved.config || {};
          // Restart sonrası status'u dürüst yansıt: config'de kullanılabilir bir
          // kimlik bilgisi varsa "connected" göster (her seferinde "disconnected"
          // sıfırlaması kullanıcıyı "bağlıyım ama bağlı değil diyor" diye yanıltıyordu).
          const hasCredential = Boolean(
            config["access_token"] ||
            config["refresh_token"] ||
            config["personal_access_token"] ||
            config["bot_token"] ||
            config["integration_token"],
          );
          return {
            ...def,
            enabled: saved.enabled,
            config,
            connectionStatus: hasCredential ? ("connected" as const) : ("disconnected" as const),
          };
        });
        return { ...current, apps: merged };
      },
    }
  )
);

// ---- App Tool Execution Engine ----

/**
 * Google API (Gmail/Calendar) hata yanıtını kullanıcıya anlaşılır mesaja çevirir.
 * 403 iki ana sebepten gelir: (a) Gmail/Calendar API projede etkin değil,
 * (b) token yetersiz scope ile alınmış. Yanıt gövdesinden ayırt ederiz.
 */
function googleApiError(resp: { status: number; body: string }): string {
  let reason = "";
  let message = "";
  try {
    const data = JSON.parse(resp.body);
    reason = data?.error?.errors?.[0]?.reason || data?.error?.status || "";
    message = data?.error?.message || "";
  } catch { /* gövde JSON değil */ }

  if (resp.status === 403) {
    const lower = (message + reason).toLowerCase();
    if (lower.includes("has not been used") || lower.includes("disabled") || lower.includes("is disabled")) {
      return (
        `Hata: Bu Google projesi için ilgili API kapalı. Google Cloud Console → ` +
        `"APIs & Services" → Gmail API / Calendar API'yi **Enable** et, 1-2 dk bekle. (${message || "HTTP 403"})`
      );
    }
    if (lower.includes("insufficient") || lower.includes("scope") || reason === "PERMISSION_DENIED") {
      return (
        `Hata: Token yetersiz izinle alınmış. Uygulamalar sekmesinden Gmail'i **bağlantıyı kes + tekrar bağlan**; ` +
        `izin ekranında Gmail kutucuğunu işaretle. (${message || "insufficient scopes"})`
      );
    }
    return `Hata: HTTP 403 — ${message || resp.body.slice(0, 200)}`;
  }
  if (resp.status === 401) {
    return "Hata: Oturum geçersiz (401). Uygulamalar sekmesinden tekrar bağlan.";
  }
  return `Hata: HTTP ${resp.status} — ${message || resp.body.slice(0, 200)}`;
}

export async function executeAppTool(
  appId: string,
  toolName: string,
  params: Record<string, string>
): Promise<string> {
  const app = useAppStore.getState().apps.find((a) => a.id === appId);
  if (!app) return "Hata: Uygulama bulunamadı.";
  if (!app.enabled) return "Hata: Uygulama etkin değil.";

  try {
    switch (toolName) {
      // ---- GitHub ----
      case "github_list_repos": {
        const token = app.config["personal_access_token"];
        if (!token) return "Hata: GitHub token ayarlanmadı.";

        let allRepos: Array<{ full_name: string; description: string | null; stargazers_count: number; language: string | null }> = [];
        let page = 1;
        let hasNextPage = true;

        while (hasNextPage) {
          const resp = await ipc.httpFetch({
            // page ve per_page parametrelerini dinamikleştiriyoruz
            url: `https://api.github.com/user/repos?sort=updated&per_page=20&page=${page}`,
            headers: { Authorization: `Bearer ${token}`, "User-Agent": "Axiom" },
          });

          if (resp.status !== 200) return `Hata: HTTP ${resp.status}`;

          const repos = JSON.parse(resp.body) as Array<{ full_name: string; description: string | null; stargazers_count: number; language: string | null }>;

          if (repos.length === 0) {
            hasNextPage = false; // Gelen veri bittiyse döngüden çık
          } else {
            allRepos = allRepos.concat(repos);
            page++; // Sonraki sayfaya geç
          }
        }

        // 129 reponun hepsi allRepos içinde toplandı, şimdi map'liyoruz
        return allRepos.map((r) => `• ${r.full_name} — ⭐${r.stargazers_count} ${r.language || ""}\n  ${r.description || ""}`).join("\n");
      }
      case "github_repo_info": {
        const token = app.config["personal_access_token"];
        if (!token) return "Hata: GitHub token ayarlanmadı.";
        const resp = await ipc.httpFetch({
          url: `https://api.github.com/repos/${params.owner}/${params.repo}`,
          headers: { Authorization: `Bearer ${token}`, "User-Agent": "Axiom" },
        });
        if (resp.status !== 200) return `Hata: HTTP ${resp.status}`;
        const r = JSON.parse(resp.body);
        return `${r.full_name}\n${r.description || "-"}\n⭐ ${r.stargazers_count} | 🍴 ${r.forks_count} | 👁 ${r.watchers_count}\nDil: ${r.language || "-"} | Açık issue: ${r.open_issues_count}`;
      }
      case "github_list_issues": {
        const token = app.config["personal_access_token"];
        if (!token) return "Hata: GitHub token ayarlanmadı.";
        const resp = await ipc.httpFetch({
          url: `https://api.github.com/repos/${params.owner}/${params.repo}/issues?state=open&per_page=10`,
          headers: { Authorization: `Bearer ${token}`, "User-Agent": "Axiom" },
        });
        if (resp.status !== 200) return `Hata: HTTP ${resp.status}`;
        const issues = JSON.parse(resp.body) as Array<{ number: number; title: string; labels: Array<{ name: string }> }>;
        if (issues.length === 0) return "Açık issue bulunamadı.";
        return issues.map((i) => `#${i.number} ${i.title} ${i.labels.map((l) => `[${l.name}]`).join(" ")}`).join("\n");
      }
      case "github_create_issue": {
        const token = app.config["personal_access_token"];
        if (!token) return "Hata: GitHub token ayarlanmadı.";
        const resp = await ipc.httpFetch({
          url: `https://api.github.com/repos/${params.owner}/${params.repo}/issues`,
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "User-Agent": "Axiom", "Content-Type": "application/json" },
          body: JSON.stringify({ title: params.title, body: params.body || "" }),
        });
        if (resp.status !== 201) return `Hata: HTTP ${resp.status} — ${resp.body}`;
        const issue = JSON.parse(resp.body);
        return `Issue oluşturuldu: #${issue.number} — ${issue.html_url}`;
      }

      case "github_get_readme": {
        const token = app.config["personal_access_token"];
        if (!token) return "Hata: GitHub token ayarlanmadı.";
        const resp = await ipc.httpFetch({
          url: `https://api.github.com/repos/${params.owner}/${params.repo}/readme`,
          headers: { Authorization: `Bearer ${token}`, "User-Agent": "Axiom", Accept: "application/vnd.github.raw+json" },
        });
        if (resp.status === 404) {
          const resp = await ipc.httpFetch({
            url: `https://api.github.com/repos/${params.owner}/.github/profile/`,
            headers: { Authorization: `Bearer ${token}`, "User-Agent": "Axiom", Accept: "application/vnd.github.raw+json" },
          });
          if (resp.status === 404) return "README bulunamadı.";
          return resp.body;
        }
        if (resp.status !== 200) return `Hata: HTTP ${resp.status}`;
        return resp.body;
      }

      // ---- Telegram ----
      case "telegram_send_message": {
        const token = app.config["bot_token"];
        const chatId = app.config["chat_id"];
        if (!token || !chatId) return "Hata: Bot token veya Chat ID eksik.";
        // Model `text`, `message`, `body` veya `content` adını kullanabilir — esnek ol.
        const text = params.text || params.message || params.body || params.content || "";
        if (!text.trim()) return "Hata: Gönderilecek metin boş.";
        const resp = await ipc.httpFetch({
          url: `https://api.telegram.org/bot${token}/sendMessage`,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
        });
        const data = JSON.parse(resp.body);
        if (!data.ok) return `Hata: ${data.description}`;
        return "Mesaj gönderildi.";
      }
      case "telegram_get_updates": {
        const token = app.config["bot_token"];
        if (!token) return "Hata: Bot token eksik.";
        const autoOn = app.config["auto_mode"] === "true";

        // Auto mode aktifse Telegram offset'ini polling tüketmiş olur — mesajlar
        // Telegram store'unda (inbox) tutulur. Önce onu döndür.
        if (autoOn) {
          const { useTelegramStore } = await import("./telegramStore");
          const chats = Object.values(useTelegramStore.getState().chats);
          if (chats.length === 0) {
            return "Henüz Telegram konuşması yok. Bot'a bir mesaj at, sonra tekrar dene.";
          }
          const limit = Math.min(parseInt(params.limit || "20"), 50);
          const chunks: string[] = [];
          for (const chat of chats) {
            const recent = chat.messages.slice(-limit);
            const lines = recent.map((msg) => {
              const who = msg.role === "user" ? chat.sender : "Bot (sen)";
              return `${who}: ${msg.content}`;
            });
            chunks.push(`### ${chat.sender} (chat ${chat.chatId})\n${lines.join("\n")}`);
          }
          return chunks.join("\n\n");
        }

        // Auto mode kapalıysa eski davranış: Telegram API'den henüz okunmamış
        // güncellemeleri çek.
        await ipc.httpFetch({
          url: `https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`,
        }).catch(() => { });

        const resp = await ipc.httpFetch({
          url: `https://api.telegram.org/bot${token}/getUpdates?limit=10&timeout=0&allowed_updates=["message"]`,
        });
        let data;
        try {
          data = JSON.parse(resp.body);
        } catch {
          return `Hata: Telegram cevabı parse edilemedi (HTTP ${resp.status}).`;
        }
        if (!data.ok) {
          if (data.error_code === 409) {
            return "Hata: Başka bir oturum getUpdates dinliyor. Bot başka bir cihazda webhook veya polling moduna kurulu olabilir.";
          }
          return `Hata: ${data.description || `HTTP ${resp.status}`}`;
        }
        const updates: TelegramUpdate[] = data.result || [];
        if (updates.length === 0) return "Yeni mesaj yok.";

        const lines: string[] = [];
        for (const u of updates) {
          const m = u.message;
          if (!m) continue;
          const who = m.from?.first_name || m.from?.username || "Bilinmeyen";
          const text = m.text || m.caption || (m.photo ? "[foto]" : m.voice ? "[sesli mesaj]" : "[medya]");
          const when = new Date(m.date * 1000).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
          lines.push(`[${when}] ${who}: ${text}`);
        }
        return lines.length > 0 ? lines.join("\n") : "Metin mesajı yok.";
      }

      // ---- Discord ----
      case "discord_send_message": {
        const token = app.config["bot_token"];
        if (!token) return "Hata: Bot token eksik.";
        const channelId = params.channel_id || app.config["guild_id"];
        if (!channelId) return "Hata: Kanal ID belirtilmedi.";
        const resp = await ipc.httpFetch({
          url: `https://discord.com/api/v10/channels/${channelId}/messages`,
          method: "POST",
          headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ content: params.text }),
        });
        if (resp.status !== 200) return `Hata: HTTP ${resp.status}`;
        return "Mesaj gönderildi.";
      }
      case "discord_list_guilds": {
        const token = app.config["bot_token"];
        if (!token) return "Hata: Bot token eksik.";
        const resp = await ipc.httpFetch({
          url: "https://discord.com/api/v10/users/@me/guilds",
          headers: { Authorization: `Bot ${token}` },
        });
        if (resp.status !== 200) return `Hata: HTTP ${resp.status}`;
        const guilds = JSON.parse(resp.body) as Array<{ name: string; id: string }>;
        return guilds.map((g) => `• ${g.name} (${g.id})`).join("\n") || "Sunucu yok.";
      }

      // ---- Notion ----
      case "notion_search": {
        const token = app.config["integration_token"];
        if (!token) return "Hata: Notion token eksik.";
        const resp = await ipc.httpFetch({
          url: "https://api.notion.com/v1/search",
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: params.query, page_size: 5 }),
        });
        if (resp.status !== 200) return `Hata: HTTP ${resp.status}`;
        const data = JSON.parse(resp.body);
        if (!data.results || data.results.length === 0) return "Sonuç bulunamadı.";
        return data.results
          .map((r: { object: string; id: string; properties?: { title?: { title?: Array<{ plain_text: string }> } }; url?: string }) => {
            const title = r.properties?.title?.title?.[0]?.plain_text || r.object;
            return `• ${title} — ${r.url || r.id}`;
          })
          .join("\n");
      }
      case "notion_create_page": {
        const token = app.config["integration_token"];
        if (!token) return "Hata: Notion token eksik.";
        const parentId = params.parent_id;
        if (!parentId) return "Hata: parent_id gerekli (hedef database veya sayfa ID).";
        const body: Record<string, unknown> = {
          parent: { page_id: parentId },
          properties: { title: { title: [{ text: { content: params.title } }] } },
        };
        if (params.content) {
          body.children = [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: params.content } }] } }];
        }
        const resp = await ipc.httpFetch({
          url: "https://api.notion.com/v1/pages",
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (resp.status !== 200) return `Hata: HTTP ${resp.status} — ${resp.body}`;
        const page = JSON.parse(resp.body);
        return `Sayfa oluşturuldu: ${page.url || page.id}`;
      }

      // ---- Spotify ----
      case "spotify_now_playing": {
        const token = await getValidAccessToken("spotify", app.config, useAppStore.getState().updateConfig);
        const resp = await ipc.httpFetch({
          url: "https://api.spotify.com/v1/me/player/currently-playing",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.status === 204) return "Şu an çalan yok.";
        if (resp.status !== 200) return `Hata: HTTP ${resp.status}`;
        const data = JSON.parse(resp.body);
        const item = data.item;
        if (!item) return "Şu an çalan parça bilgisi alınamadı.";
        const artists = (item.artists || []).map((a: { name: string }) => a.name).join(", ");
        return `▶ **${item.name}** — ${artists}${data.is_playing === false ? " (duraklatıldı)" : ""}`;
      }
      case "spotify_play":
      case "spotify_pause":
      case "spotify_next":
      case "spotify_prev": {
        const token = await getValidAccessToken("spotify", app.config, useAppStore.getState().updateConfig);
        // Eğer query verildiyse önce arayıp uri'sini bul, sonra çal
        if (toolName === "spotify_play" && params.query) {
          const sResp = await ipc.httpFetch({
            url: `https://api.spotify.com/v1/search?q=${encodeURIComponent(params.query)}&type=track&limit=1`,
            headers: { Authorization: `Bearer ${token}` },
          });
          if (sResp.status !== 200) return `Hata: Arama başarısız (HTTP ${sResp.status})`;
          const sData = JSON.parse(sResp.body);
          const track = sData.tracks?.items?.[0];
          if (!track) return `"${params.query}" bulunamadı.`;
          const r = await ipc.httpFetch({
            url: "https://api.spotify.com/v1/me/player/play",
            method: "PUT",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ uris: [track.uri] }),
          });
          if (r.status === 404) return "Aktif Spotify cihazı yok. Bir cihazda Spotify aç.";
          if (r.status >= 400) return `Hata: HTTP ${r.status}`;
          return `▶ Çalınıyor: ${track.name} — ${(track.artists || []).map((a: { name: string }) => a.name).join(", ")}`;
        }
        const endpoint =
          toolName === "spotify_play"
            ? { url: "https://api.spotify.com/v1/me/player/play", method: "PUT" }
            : toolName === "spotify_pause"
              ? { url: "https://api.spotify.com/v1/me/player/pause", method: "PUT" }
              : toolName === "spotify_next"
                ? { url: "https://api.spotify.com/v1/me/player/next", method: "POST" }
                : { url: "https://api.spotify.com/v1/me/player/previous", method: "POST" };
        const r = await ipc.httpFetch({
          url: endpoint.url,
          method: endpoint.method,
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.status === 404) return "Aktif Spotify cihazı yok.";
        if (r.status >= 400) return `Hata: HTTP ${r.status}`;
        return "OK";
      }
      case "spotify_search": {
        const token = await getValidAccessToken("spotify", app.config, useAppStore.getState().updateConfig);
        const q = params.query;
        if (!q) return "Hata: query parametresi gerekli.";
        const type = params.type || "track";
        const resp = await ipc.httpFetch({
          url: `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=${type}&limit=5`,
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.status !== 200) return `Hata: HTTP ${resp.status}`;
        const data = JSON.parse(resp.body);
        const items = data[type + "s"]?.items || [];
        if (items.length === 0) return "Sonuç yok.";
        return items
          .map((t: { name: string; artists?: { name: string }[]; uri: string }, i: number) => {
            const arts = (t.artists || []).map((a) => a.name).join(", ");
            return `${i + 1}. **${t.name}**${arts ? ` — ${arts}` : ""} (${t.uri})`;
          })
          .join("\n");
      }
      case "spotify_queue_add": {
        const token = await getValidAccessToken("spotify", app.config, useAppStore.getState().updateConfig);
        const q = params.query;
        if (!q) return "Hata: query parametresi gerekli.";
        const sResp = await ipc.httpFetch({
          url: `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=1`,
          headers: { Authorization: `Bearer ${token}` },
        });
        const sData = JSON.parse(sResp.body);
        const track = sData.tracks?.items?.[0];
        if (!track) return `"${q}" bulunamadı.`;
        const r = await ipc.httpFetch({
          url: `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(track.uri)}`,
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.status === 404) return "Aktif Spotify cihazı yok.";
        if (r.status >= 400) return `Hata: HTTP ${r.status}`;
        return `Sıraya eklendi: ${track.name}`;
      }

      // ---- Gmail ----
      case "gmail_unread_count": {
        const token = await getValidAccessToken("gmail", app.config, useAppStore.getState().updateConfig);
        const resp = await ipc.httpFetch({
          url: "https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.status !== 200) return googleApiError(resp);
        const data = JSON.parse(resp.body);
        return `📬 Gelen kutusunda **${data.messagesUnread ?? 0}** okunmamış mesaj (toplam ${data.messagesTotal ?? 0}).`;
      }
      case "gmail_recent":
      case "gmail_search": {
        const token = await getValidAccessToken("gmail", app.config, useAppStore.getState().updateConfig);
        const limit = Math.min(parseInt(params.limit || "10"), 25);
        const q = toolName === "gmail_search" ? params.query : "in:inbox";
        if (toolName === "gmail_search" && !q) return "Hata: query parametresi gerekli.";
        const listResp = await ipc.httpFetch({
          url: `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}&q=${encodeURIComponent(q || "")}`,
          headers: { Authorization: `Bearer ${token}` },
        });
        if (listResp.status !== 200) return googleApiError(listResp);
        const listData = JSON.parse(listResp.body);
        const ids: string[] = (listData.messages || []).map((m: { id: string }) => m.id);
        if (ids.length === 0) return "Mesaj yok.";
        const details = await Promise.all(
          ids.map(async (id) => {
            const r = await ipc.httpFetch({
              url: `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
              headers: { Authorization: `Bearer ${token}` },
            });
            if (r.status !== 200) return null;
            return JSON.parse(r.body);
          }),
        );
        return details
          .filter(Boolean)
          .map((m, i) => {
            const headers = (m.payload?.headers || []) as { name: string; value: string }[];
            const from = headers.find((h) => h.name === "From")?.value || "?";
            const subject = headers.find((h) => h.name === "Subject")?.value || "(konu yok)";
            const isUnread = (m.labelIds || []).includes("UNREAD");
            return `${i + 1}. ${isUnread ? "🔵" : "⚪"} **${subject}** — _${from}_\n   ${m.snippet?.slice(0, 120) || ""}`;
          })
          .join("\n\n");
      }
      case "gmail_draft": {
        const token = await getValidAccessToken("gmail", app.config, useAppStore.getState().updateConfig);
        const to = params.to;
        const subject = params.subject;
        const body = params.body;
        if (!to || !subject || !body) return "Hata: to, subject ve body gerekli.";
        const raw = [
          `To: ${to}`,
          `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
          "Content-Type: text/plain; charset=utf-8",
          "",
          body,
        ].join("\r\n");
        const encoded = btoa(unescape(encodeURIComponent(raw)))
          .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const resp = await ipc.httpFetch({
          url: "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ message: { raw: encoded } }),
        });
        if (resp.status >= 400) return googleApiError(resp);
        return `Taslak oluşturuldu (${to}).`;
      }
      case "gmail_mark_as_read": {
        const token = await getValidAccessToken("gmail", app.config, useAppStore.getState().updateConfig);
        const messageId = params.messageId;
        const action = params.action || "read";

        if (!messageId) return "Hata: messageId gerekli.";

        const removeLabels = action === "archive" ? ["UNREAD", "INBOX"] : ["UNREAD"];

        const resp = await ipc.httpFetch({
          url: `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ removeLabelIds: removeLabels }),
        });

        if (resp.status >= 400) return googleApiError(resp);
        return `Mesaj ${action === "archive" ? "arşivlendi" : "okundu olarak işaretlendi"} (${messageId}).`;
      }

      case "gmail_send": {
        const token = await getValidAccessToken("gmail", app.config, useAppStore.getState().updateConfig);
        const to = params.to;
        const subject = params.subject;
        const body = params.body;

        if (!to || !subject || !body) return "Hata: to, subject ve body gerekli.";

        const raw = [
          `To: ${to}`,
          `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
          "Content-Type: text/plain; charset=utf-8",
          "",
          body,
        ].join("\r\n");

        const encoded = btoa(unescape(encodeURIComponent(raw)))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        const resp = await ipc.httpFetch({
          url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ raw: encoded }),
        });

        if (resp.status >= 400) return googleApiError(resp);
        return `🚀 Mail başarıyla gönderildi (${to}).`;
      }

      // ---- Google Calendar ----
      case "calendar_today":
      case "calendar_upcoming": {
        const token = await getValidAccessToken("gcalendar", app.config, useAppStore.getState().updateConfig);
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
        const days = toolName === "calendar_today" ? 1 : Math.max(1, parseInt(params.days || "7"));
        const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 23, 59, 59);
        const end = endDate.toISOString();
        const url =
          `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
          `?timeMin=${encodeURIComponent(start)}&timeMax=${encodeURIComponent(end)}` +
          `&singleEvents=true&orderBy=startTime&maxResults=25`;
        const resp = await ipc.httpFetch({
          url,
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.status !== 200) return googleApiError(resp);
        const data = JSON.parse(resp.body);
        const items = data.items || [];
        if (items.length === 0) return toolName === "calendar_today" ? "Bugün etkinlik yok." : "Yaklaşan etkinlik yok.";
        return items
          .map((ev: { summary?: string; start?: { dateTime?: string; date?: string }; location?: string }) => {
            const startStr = ev.start?.dateTime || ev.start?.date || "";
            const when = startStr
              ? new Date(startStr).toLocaleString("tr-TR", {
                weekday: "short", day: "numeric", month: "short",
                hour: "2-digit", minute: "2-digit",
              })
              : "?";
            return `• **${ev.summary || "(başlıksız)"}** — ${when}${ev.location ? ` · 📍 ${ev.location}` : ""}`;
          })
          .join("\n");
      }
      case "calendar_create_event": {
        const token = await getValidAccessToken("gcalendar", app.config, useAppStore.getState().updateConfig);
        const title = params.title;
        const startRaw = params.start;
        if (!title || !startRaw) return "Hata: title ve start gerekli.";
        const dur = parseInt(params.duration_min || "60");

        // "HH:MM bugün" / "HH:MM yarın" desteği
        let startDt: Date;
        const hmToday = startRaw.match(/^(\d{1,2}):(\d{2})(?:\s+(bugün|yarın|tomorrow|today))?$/i);
        if (hmToday) {
          const h = parseInt(hmToday[1]);
          const m = parseInt(hmToday[2]);
          const word = (hmToday[3] || "bugün").toLowerCase();
          const d = new Date();
          if (word.startsWith("yarın") || word === "tomorrow") d.setDate(d.getDate() + 1);
          d.setHours(h, m, 0, 0);
          startDt = d;
        } else {
          startDt = new Date(startRaw);
        }
        if (isNaN(startDt.getTime())) return "Hata: start parse edilemedi. ISO veya 'HH:MM bugün' kullan.";
        const endDt = new Date(startDt.getTime() + dur * 60_000);
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Istanbul";
        const resp = await ipc.httpFetch({
          url: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            summary: title,
            description: params.description || "",
            start: { dateTime: startDt.toISOString(), timeZone: tz },
            end: { dateTime: endDt.toISOString(), timeZone: tz },
          }),
        });
        if (resp.status >= 400) return `Hata: HTTP ${resp.status} — ${resp.body.slice(0, 200)}`;
        const ev = JSON.parse(resp.body);
        const when = startDt.toLocaleString("tr-TR", {
          weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        });
        return `📅 Etkinlik oluşturuldu: **${title}** — ${when}\n${ev.htmlLink || ""}`;
      }

      // ---- VS Code ----
      case "vscode_open_path":
      case "vscode_open_repo": {
        const target = params.path;
        if (!target) return "Hata: path parametresi gerekli.";
        const code = app.config["command"] || "code";
        const args =
          toolName === "vscode_open_repo"
            ? `${code} -n "${target.replace(/"/g, '\\"')}"`
            : params.new_window === "true"
              ? `${code} -n "${target.replace(/"/g, '\\"')}"`
              : `${code} "${target.replace(/"/g, '\\"')}"`;
        try {
          await ipc.shellExec(args);
          return `VS Code açıldı: ${target}`;
        } catch (e) {
          return `Hata: ${String(e)} (PATH'te "code" yok ise yapılandırmadan tam yol gir)`;
        }
      }

      // ---- Tarayıcı ----
      case "browser_open_url": {
        const url = params.url;
        if (!url) return "Hata: url parametresi gerekli.";
        try {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl(url);
          return `Tarayıcıda açıldı: ${url}`;
        } catch (e) {
          return `Hata: ${String(e)}`;
        }
      }
      case "browser_search": {
        const query = params.query;
        if (!query) return "Hata: query parametresi gerekli.";
        try {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
          return `Google'da arandı: "${query}"`;
        } catch (e) {
          return `Hata: ${String(e)}`;
        }
      }

      // ---- Wikipedia ----
      case "wikipedia_summary": {
        const q = params.query;
        if (!q) return "Hata: query parametresi gerekli.";
        const requested = params.lang || app.config["lang"] || "";
        // Otomatik: önce TR sonra EN
        const langs = requested ? [requested] : ["tr", "en"];
        for (const lang of langs) {
          const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`;
          const resp = await ipc.httpFetch({ url });
          if (resp.status === 200) {
            const data = JSON.parse(resp.body);
            if (data.extract) {
              return `**${data.title}** (${lang})\n\n${data.extract}\n\n${data.content_urls?.desktop?.page || ""}`;
            }
          }
        }
        return `Wikipedia'da "${q}" bulunamadı.`;
      }

      // ---- Reddit ----
      case "reddit_top":
      case "reddit_search": {
        const limit = Math.min(parseInt(params.limit || "10"), 25);
        let url: string;
        if (toolName === "reddit_top") {
          const sub = (params.subreddit || "").replace(/^r\//, "").trim();
          if (!sub) return "Hata: subreddit parametresi gerekli.";
          url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/top.json?limit=${limit}&t=day`;
        } else {
          const q = params.query;
          if (!q) return "Hata: query parametresi gerekli.";
          url = `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&limit=${limit}&sort=relevance`;
        }
        const resp = await ipc.httpFetch({
          url,
          headers: { "User-Agent": "Axiom/0.1 (desktop)" },
        });
        if (resp.status !== 200) return `Hata: HTTP ${resp.status}`;
        type RedditChild = { data: { title: string; subreddit: string; score: number; num_comments: number; permalink: string } };
        const data = JSON.parse(resp.body);
        const items: RedditChild[] = data?.data?.children || [];
        if (items.length === 0) return "Sonuç yok.";
        return items
          .map((c, i) => `${i + 1}. **${c.data.title}** — r/${c.data.subreddit} · ${c.data.score} oy · ${c.data.num_comments} yorum\n   https://reddit.com${c.data.permalink}`)
          .join("\n");
      }

      // ---- Hacker News ----
      case "hn_top":
      case "hn_new": {
        const limit = Math.min(parseInt(params.limit || "10"), 20);
        const endpoint = toolName === "hn_top" ? "topstories" : "newstories";
        const idsResp = await ipc.httpFetch({
          url: `https://hacker-news.firebaseio.com/v0/${endpoint}.json`,
        });
        if (idsResp.status !== 200) return `Hata: HTTP ${idsResp.status}`;
        const ids: number[] = JSON.parse(idsResp.body).slice(0, limit);
        const items = await Promise.all(
          ids.map(async (id) => {
            const r = await ipc.httpFetch({
              url: `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
            });
            return r.status === 200 ? JSON.parse(r.body) : null;
          }),
        );
        return items
          .filter((x) => x && x.title)
          .map((x, i) => `${i + 1}. **${x.title}** — ${x.score || 0} puan · ${x.descendants || 0} yorum\n   ${x.url || `https://news.ycombinator.com/item?id=${x.id}`}`)
          .join("\n");
      }

      // ---- Obsidian ----
      case "obsidian_list": {
        const vault = app.config["vault_path"];
        if (!vault) return "Hata: Vault klasörü yapılandırılmamış.";
        const subdir = params.subdir ? `${vault}/${params.subdir}` : vault;
        try {
          const entries = await ipc.fsReadDir(subdir, vault, 3);
          const notes = entries.filter((e) => !e.isDir && e.name.endsWith(".md"));
          if (notes.length === 0) return "Vault'ta .md dosyası yok.";
          return notes.slice(0, 50).map((n) => `- ${n.name}`).join("\n");
        } catch (e) {
          return `Hata: ${String(e)}`;
        }
      }
      case "obsidian_read": {
        const vault = app.config["vault_path"];
        const name = params.name;
        if (!vault) return "Hata: Vault klasörü yapılandırılmamış.";
        if (!name) return "Hata: name parametresi gerekli.";
        const path = name.endsWith(".md") ? `${vault}/${name}` : `${vault}/${name}.md`;
        try {
          const res = await ipc.fsReadFile(path, vault);
          return res.content;
        } catch (e) {
          return `Hata: ${String(e)}`;
        }
      }
      case "obsidian_append": {
        const vault = app.config["vault_path"];
        const name = params.name;
        const content = params.content;
        if (!vault) return "Hata: Vault klasörü yapılandırılmamış.";
        if (!name || !content) return "Hata: name ve content parametreleri gerekli.";
        const path = name.endsWith(".md") ? `${vault}/${name}` : `${vault}/${name}.md`;
        let existing = "";
        try {
          const res = await ipc.fsReadFile(path, vault);
          existing = res.content;
        } catch {
          /* file may not exist */
        }
        const sep = existing && !existing.endsWith("\n") ? "\n" : "";
        const next = `${existing}${sep}${content}\n`;
        try {
          await ipc.fsWriteFile(path, next, vault);
          return existing ? `Nota eklendi: ${name}` : `Yeni not oluşturuldu: ${name}`;
        } catch (e) {
          return `Hata: ${String(e)}`;
        }
      }

      // ---- Aktif Pencere ----
      case "active_window_get": {
        try {
          const w = await ipc.activeWindow();
          if (!w.title && !w.processName) return "Aktif pencere bilgisi alınamadı.";
          return `**${w.title || "(başlıksız)"}** — ${w.processName || "?"}`;
        } catch (e) {
          return `Hata: ${String(e)}`;
        }
      }

      // ---- Fiyat Takibi ----
      case "price_track_add": {
        const url = params.url;
        if (!url || !/^https?:\/\//i.test(url)) {
          return "Hata: Geçerli bir URL gerekli (http/https ile başlamalı).";
        }
        const { usePriceTrackStore } = await import("./priceTrackStore");
        const { scrapePrice } = await import("../lib/priceScraper");

        const result = await scrapePrice(url);
        if (result.price === null) {
          return `Hata: Bu URL'den fiyat çıkarılamadı (yöntem: ${result.source}). Sayfa dinamik yükleniyor olabilir veya site desteklenmiyor.`;
        }

        const name = params.name?.trim() || result.title || new URL(url).hostname;
        const targetPrice = params.target_price ? parseFloat(params.target_price.replace(",", ".")) : null;

        const id = usePriceTrackStore.getState().add({
          name,
          url,
          currentPrice: result.price,
          currency: result.currency || "TRY",
          targetPrice: targetPrice && isFinite(targetPrice) ? targetPrice : null,
        });
        return (
          `✅ Takibe eklendi (id: ${id}).\n` +
          `• ${name}\n` +
          `• Şu anki fiyat: ${result.price} ${result.currency || "TRY"}\n` +
          (targetPrice ? `• Hedef: ${targetPrice} ${result.currency || "TRY"} altına düşerse bildirim` : `• Hedef belirtilmedi — her düşüşte bildirim atılır`)
        );
      }

      case "price_track_list": {
        const { usePriceTrackStore } = await import("./priceTrackStore");
        const items = usePriceTrackStore.getState().items;
        if (items.length === 0) return "Takip edilen ürün yok.";
        return items
          .map((it) => {
            const cur = it.currentPrice !== null ? `${it.currentPrice} ${it.currency}` : "?";
            const low = it.lowestPrice !== null ? `, en düşük: ${it.lowestPrice}` : "";
            const target = it.targetPrice !== null ? ` · hedef: ${it.targetPrice}` : "";
            const err = it.lastError ? ` · ⚠ ${it.lastError}` : "";
            return `• \`${it.id}\` **${it.name}** — ${cur}${low}${target}${err}\n  ${it.url}`;
          })
          .join("\n");
      }

      case "price_track_remove": {
        const id = params.id;
        if (!id) return "Hata: id parametresi gerekli (price_track_list'ten al).";
        const { usePriceTrackStore } = await import("./priceTrackStore");
        const exists = usePriceTrackStore.getState().items.some((i) => i.id === id);
        if (!exists) return `Hata: ${id} id'li ürün bulunamadı.`;
        usePriceTrackStore.getState().remove(id);
        return `Takipten çıkarıldı: ${id}`;
      }

      case "price_track_check_now": {
        const id = params.id;
        if (!id) return "Hata: id parametresi gerekli.";
        const { usePriceTrackStore } = await import("./priceTrackStore");
        const item = usePriceTrackStore.getState().items.find((i) => i.id === id);
        if (!item) return `Hata: ${id} id'li ürün bulunamadı.`;
        const { scrapePrice } = await import("../lib/priceScraper");
        const result = await scrapePrice(item.url);
        if (result.price === null) {
          usePriceTrackStore.getState().recordScrape(id, { price: null, error: "Fiyat çıkarılamadı" });
          return `Hata: ${item.name} için fiyat çıkarılamadı.`;
        }
        usePriceTrackStore.getState().recordScrape(id, {
          price: result.price,
          currency: result.currency || item.currency,
        });
        const prev = item.currentPrice;
        const delta = prev !== null ? result.price - prev : 0;
        const arrow = delta < 0 ? "📉" : delta > 0 ? "📈" : "•";
        return `${arrow} **${item.name}** — ${result.price} ${result.currency || item.currency}${prev !== null ? ` (öncesi ${prev})` : ""}`;
      }

      default: {
        const valid = app.tools.map((t) => t.name).join(", ");
        return (
          `Hata: "${toolName}" diye bir araç yok. ` +
          `${app.name} için geçerli araçlar: ${valid}. ` +
          `Yalnızca bu adlardan birini kullan; parametre uydurma.`
        );
      }
    }
  } catch (e) {
    return `Hata: ${String(e)}`;
  }
}
