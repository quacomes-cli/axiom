import { useState, useEffect, useRef, useCallback } from "react";
import { Settings2, X, Zap, ZapOff, Loader2, AlertCircle, CheckCircle2, Plug, ExternalLink, Copy, Check } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PageHeader } from "../shared/PageHeader";
import {
  useAppStore,
  type AppIntegration,
  type AppConnectionType,
} from "../../stores/appStore";
import {
  formatAllowedChatIds,
  formatPendingPairs,
  parseAllowedChatIds,
  parsePendingPairs,
} from "../../lib/telegramAccess";
import { FaChrome, FaDiscord, FaGithub, FaSpotify, FaTelegram, FaWikipediaW, FaReddit, FaHackerNews, FaGoogle } from "react-icons/fa6";
import { VscVscode } from "react-icons/vsc";
import { RiNotionFill } from "react-icons/ri";
import { SiObsidian, SiGmail, SiGooglecalendar } from "react-icons/si";
import { AppWindow, TrendingDown } from "lucide-react";
import { useT } from "../../i18n";

// connectionType → i18n anahtarı; render'da t() ile çözülür.
const TYPE_LABEL_KEYS: Record<AppConnectionType, string> = {
  api: "apps.connApiKey",
  webhook: "apps.connWebhook",
  oauth: "apps.connOAuth",
  local: "apps.connLocal",
};

type ConfigField =
  | { label: string; key: string; placeholder: string; secret?: boolean; type?: "text" }
  | { label: string; key: string; hint?: string; type: "toggle" };

const CONFIG_FIELDS: Record<string, ConfigField[]> = {
  telegram: [
    { label: "Bot Token", key: "bot_token", placeholder: "123456:ABC-DEF...", secret: true },
    { label: "Chat ID", key: "chat_id", placeholder: "Hedef chat ID (gönderim için)" },
    {
      label: "Otomatik mod",
      key: "auto_mode",
      type: "toggle",
      hint: "Yeni Telegram mesajları geldiğinde AI'a yönlendir ve cevabı otomatik geri yolla",
    },
  ],
  github: [
    { label: "Client ID (OAuth App)", key: "client_id", placeholder: "Ov23li...", secret: false },
    { label: "Personal Access Token", key: "personal_access_token", placeholder: "ghp_... (OAuth ile otomatik dolar)", secret: true },
  ],
  notion: [
    { label: "Integration Token", key: "integration_token", placeholder: "secret_...", secret: true },
  ],
  discord: [
    { label: "Bot Token", key: "bot_token", placeholder: "Bot token...", secret: true },
    { label: "Guild ID", key: "guild_id", placeholder: "Sunucu ID" },
  ],
  spotify: [
    { label: "Client ID", key: "client_id", placeholder: "Spotify Developer Dashboard'dan" },
    { label: "Client Secret", key: "client_secret", placeholder: "Spotify Client Secret", secret: true },
  ],
  // gmail ve gcalendar için kullanıcı credential girmez — uygulama kendi credential'larını kullanır
  vscode: [
    {
      label: "code komutu",
      key: "command",
      placeholder: "code (PATH'te yoksa tam yol)",
    },
  ],
  obsidian: [
    {
      label: "Vault klasörü",
      key: "vault_path",
      placeholder: "C:/Users/.../Obsidian/Vault",
    },
  ],
  wikipedia: [
    {
      label: "Varsayılan dil",
      key: "lang",
      placeholder: "tr veya en (boşsa otomatik)",
    },
  ],
};

const APP_ICONS: Record<string, React.ReactNode> = {
  spotify: <FaSpotify size={22} />,
  telegram: <FaTelegram size={22} />,
  vscode: <VscVscode size={22} />,
  chrome: <FaChrome size={22} />,
  notion: <RiNotionFill size={22} />,
  discord: <FaDiscord size={22} />,
  github: <FaGithub size={22} />,
  wikipedia: <FaWikipediaW size={22} />,
  reddit: <FaReddit size={22} />,
  hackernews: <FaHackerNews size={22} />,
  obsidian: <SiObsidian size={22} />,
  active_window: <AppWindow size={20} strokeWidth={1.5} />,
  price_tracker: <TrendingDown size={20} strokeWidth={1.5} />,
  gmail: <SiGmail size={20} />,
  gcalendar: <SiGooglecalendar size={20} />,
  google: <FaGoogle size={20} />,
};

function StatusDot({ app }: { app: AppIntegration }) {
  if (!app.enabled) return null;
  const s = app.connectionStatus;
  if (s === "checking") return <Loader2 size={12} className="animate-spin text-text-faint" />;
  if (s === "connected") return <CheckCircle2 size={12} className="text-success" />;
  if (s === "error") return <AlertCircle size={12} className="text-error" />;
  return <div className="h-2 w-2 rounded-full bg-text-faint/30" />;
}

const GUIDE_URLS: Record<string, string> = {
  github: "https://github.com/settings/developers",
  spotify: "https://developer.spotify.com/dashboard",
  telegram: "https://t.me/BotFather",
  discord: "https://discord.com/developers/applications",
  notion: "https://www.notion.so/my-integrations",
};

function DeviceCodePanel({ userCode, verificationUri, onCancel }: {
  userCode: string;
  verificationUri: string;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [userCode]);

  useEffect(() => {
    openUrl(verificationUri).catch(() => {});
  }, [verificationUri]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-surface-2 p-4 text-center">
        <div className="mb-2 text-[0.7857rem] uppercase tracking-wider text-text-faint">Bu kodu tarayıcıda gir</div>
        <button
          onClick={copyCode}
          className="group inline-flex items-center gap-2 rounded-lg bg-surface-3 px-4 py-2 font-mono text-xl font-bold tracking-widest text-text transition-colors hover:bg-hover-strong"
        >
          {userCode}
          {copied ? <Check size={16} className="text-success" /> : <Copy size={16} className="text-text-faint group-hover:text-text" />}
        </button>
        <div className="mt-2 text-xs text-text-faint">Kod panoya kopyalandığında tarayıcıya yapıştır</div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-text-faint" />
          <span className="text-xs text-text-faint">Yetkilendirme bekleniyor...</span>
        </div>
        <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs text-text-faint hover:bg-hover hover:text-text">
          İptal
        </button>
      </div>
    </div>
  );
}

/**
 * Telegram erişim kontrolü: onay bekleyen eşleştirme istekleri + onaylı chat
 * listesi. Store'daki CANLI config üzerinden çalışır ki onay, dialog'daki
 * "Kaydet"e basılmadan anında etkili olsun (bot o anda poll ediyor olabilir).
 */
function TelegramAccessSection() {
  const liveApp = useAppStore((s) => s.apps.find((a) => a.id === "telegram"));
  const updateConfig = useAppStore((s) => s.updateConfig);
  const [manualId, setManualId] = useState("");

  if (!liveApp) return null;
  const config = liveApp.config;
  const allowed = Array.from(parseAllowedChatIds(config));
  const pending = parsePendingPairs(config);

  function write(next: { allowed?: string[]; pending?: typeof pending }) {
    const cfg = useAppStore.getState().apps.find((a) => a.id === "telegram")?.config ?? {};
    updateConfig("telegram", {
      ...cfg,
      ...(next.allowed !== undefined ? { allowed_chat_ids: formatAllowedChatIds(next.allowed) } : {}),
      ...(next.pending !== undefined ? { pending_pairs: formatPendingPairs(next.pending) } : {}),
    });
  }

  function approve(chatId: string) {
    write({
      allowed: [...allowed, chatId],
      pending: pending.filter((p) => p.chatId !== chatId),
    });
  }

  function deny(chatId: string) {
    write({ pending: pending.filter((p) => p.chatId !== chatId) });
  }

  function removeAllowed(chatId: string) {
    write({ allowed: allowed.filter((id) => id !== chatId) });
  }

  function addManual() {
    const id = manualId.trim();
    if (!/^-?\d+$/.test(id)) return;
    write({ allowed: [...allowed, id] });
    setManualId("");
  }

  return (
    <div className="mt-4">
      <div className="mb-2 text-[0.7857rem] uppercase tracking-wider text-text-faint">
        Erişim kontrolü
      </div>
      <div className="mb-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-faint">
        Otomatik mod yalnızca onaylı chat'lere cevap verir. Yabancı biri bota
        yazarsa burada onay isteği belirir.
      </div>

      {pending.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {pending.map((p) => (
            <div
              key={p.chatId}
              className="flex items-center gap-2 rounded-lg bg-warn/10 px-2.5 py-1.5 text-xs"
            >
              <AlertCircle size={11} className="shrink-0 text-warn" />
              <span className="min-w-0 truncate text-text-secondary">
                {p.name || "bilinmeyen"} <span className="text-text-faint">({p.chatId})</span>
              </span>
              <div className="ml-auto flex shrink-0 gap-1.5">
                <button
                  onClick={() => approve(p.chatId)}
                  className="rounded-md bg-success/15 px-2 py-0.5 text-success transition-colors hover:bg-success/25"
                >
                  İzin ver
                </button>
                <button
                  onClick={() => deny(p.chatId)}
                  className="rounded-md bg-surface-3 px-2 py-0.5 text-text-faint transition-colors hover:text-text-secondary"
                >
                  Reddet
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {allowed.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {allowed.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-xs text-text-secondary"
            >
              {id}
              <button
                onClick={() => removeAllowed(id)}
                title="Erişimi kaldır"
                className="text-text-faint transition-colors hover:text-red-400"
              >
                <X size={10} strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-warn">
          Onaylı chat yok — bot şu an kimseye cevap vermiyor. Botuna Telegram'dan
          bir mesaj at, ardından buradan onayla.
        </div>
      )}

      <div className="mt-2 flex gap-1.5">
        <input
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManual(); } }}
          placeholder="Chat ID'yi elle ekle"
          className="w-full rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-text outline-none placeholder:text-text-faint focus:bg-surface-3"
        />
        <button
          onClick={addManual}
          disabled={!/^-?\d+$/.test(manualId.trim())}
          className="shrink-0 rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-3 disabled:opacity-40"
        >
          Ekle
        </button>
      </div>
    </div>
  );
}

function AppConfigDialog({
  app,
  onClose,
}: {
  app: AppIntegration;
  onClose: () => void;
}) {
  const updateConfig = useAppStore((s) => s.updateConfig);
  const testConnection = useAppStore((s) => s.testConnection);
  const oauthConnect = useAppStore((s) => s.oauthConnect);
  const oauthPoll = useAppStore((s) => s.oauthPoll);
  const fields = CONFIG_FIELDS[app.id] ?? [];
  const [values, setValues] = useState<Record<string, string>>({ ...app.config });
  const [testing, setTesting] = useState(false);
  const [deviceFlow, setDeviceFlow] = useState<{ userCode: string; verificationUri: string; deviceCode: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveApp = useAppStore((s) => s.apps.find((a) => a.id === app.id))!;

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Canlı config ile birleştirerek yazar: dialog açıkken store'a yazılan
  // alanlar (OAuth token'ları, Telegram whitelist onayları) buradaki bayat
  // `values` kopyası tarafından ezilmesin. Whitelist anahtarları yalnızca
  // TelegramAccessSection üzerinden yönetilir — values'tan ayıklanır.
  function applyValues() {
    const { allowed_chat_ids: _a, pending_pairs: _p, ...rest } = values;
    const live = useAppStore.getState().apps.find((a) => a.id === app.id)?.config ?? {};
    updateConfig(app.id, { ...live, ...rest });
  }

  function save() {
    applyValues();
    onClose();
  }

  async function handleTest() {
    applyValues();
    setTesting(true);
    await testConnection(app.id);
    setTesting(false);
  }

  const [oauthBusy, setOauthBusy] = useState(false);

  async function handleOAuth() {
    setOauthBusy(true);
    try {
      applyValues();
      const result = await oauthConnect(app.id);
      // GitHub Device Flow ise pop-up göster + polling
      if (result?.userCode && result.deviceCode) {
        setDeviceFlow({
          userCode: result.userCode,
          verificationUri: result.verificationUri!,
          deviceCode: result.deviceCode,
        });
        pollRef.current = setInterval(async () => {
          const done = await oauthPoll(app.id, result.deviceCode!);
          if (done) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setDeviceFlow(null);
          }
        }, (result.interval || 5) * 1000);
      }
      // localhost flow ise result.localhost === true; tüm iş Promise içinde tamamlandı
    } finally {
      setOauthBusy(false);
    }
  }

  function cancelDeviceFlow() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setDeviceFlow(null);
    useAppStore.getState().setConnectionStatus(app.id, "disconnected");
  }

  const OAUTH_APPS = new Set(["github", "spotify", "gmail", "gcalendar"]);
  const supportsOAuth = OAUTH_APPS.has(app.id);
  const OAUTH_BUTTON_LABELS: Record<string, string> = {
    github: "GitHub ile Bağlan",
    spotify: "Spotify ile Bağlan",
    gmail: "Gmail ile Bağlan",
    gcalendar: "Google Calendar ile Bağlan",
  };
  const guideUrl = GUIDE_URLS[app.id];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" style={{ backdropFilter: "blur(2.5px)" }}>
      <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl max-h-[80vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-text-secondary">
              {APP_ICONS[app.id]}
            </span>
            <div>
              <h2 className="text-sm font-medium text-text">{app.name}</h2>
              <p className="text-xs text-text-faint">{app.description}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-hover hover:text-text"
          >
            <X size={14} strokeWidth={1.6} />
          </button>
        </div>

        {deviceFlow ? (
          <DeviceCodePanel
            userCode={deviceFlow.userCode}
            verificationUri={deviceFlow.verificationUri}
            onCancel={cancelDeviceFlow}
          />
        ) : (
          <>
            {fields.length > 0 ? (
              <div className="space-y-3">
                {fields.map((field) => {
                  if (field.type === "toggle") {
                    const on = values[field.key] === "true";
                    return (
                      <div
                        key={field.key}
                        className="flex items-start justify-between rounded-lg bg-surface-2 px-3 py-2.5"
                      >
                        <div className="mr-3 min-w-0">
                          <div className="text-[0.8571rem] text-text-secondary">{field.label}</div>
                          {field.hint && (
                            <div className="mt-0.5 text-[0.7857rem] text-text-faint">{field.hint}</div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setValues((v) => ({ ...v, [field.key]: on ? "false" : "true" }))
                          }
                          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
                            on ? "bg-blue-400" : "bg-surface-3"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 block h-4 w-4 rounded-full bg-text-faint transition-transform duration-200 ${
                              on ? "translate-x-[18px] bg-accent" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div key={field.key}>
                      <label className="mb-1 block text-[0.7857rem] uppercase tracking-wider text-text-faint">
                        {field.label}
                      </label>
                      <input
                        type={field.secret ? "password" : "text"}
                        value={values[field.key] ?? ""}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, [field.key]: e.target.value }))
                        }
                        placeholder={field.placeholder}
                        className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm text-text outline-none transition-colors placeholder:text-text-faint focus:bg-surface-3"
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl bg-surface-2 py-6 text-center text-xs text-text-faint">
                Bu entegrasyon için yapılandırma gerekmez.
              </div>
            )}

            {app.id === "github" && (
              <div className="mt-3 flex flex-col">
                <div className="mb-2 text-[0.7857rem] uppercase tracking-wider text-text-faint">Hızlı bağlantı</div>
                <div className="space-y-2">
                  <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-faint">
                    <span className="font-medium text-text-secondary">1.</span> GitHub'da OAuth App oluştur
                    <button
                      onClick={() => openUrl(GUIDE_URLS.github).catch(() => {})}
                      className="ml-1.5 inline-flex items-center gap-1 text-text-secondary hover:text-text"
                    >
                      <ExternalLink size={10} /> Aç
                    </button>
                  </div>
                  <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-faint">
                    <span className="font-medium text-text-secondary">2.</span> Client ID'yi yukarıya gir, <span className="font-medium text-text-secondary">Device Flow</span>'u etkinleştir
                  </div>
                  <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-faint">
                    <span className="font-medium text-text-secondary">3.</span> "GitHub ile Bağlan"a tıkla
                  </div>
                </div>
              </div>
            )}
            {(app.id === "gmail" || app.id === "gcalendar") && (
              <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-xs text-text-faint">
                Google hesabınla giriş yapman yeterli — başka yapılandırma gerekmez.
              </div>
            )}

            {app.id === "telegram" && <TelegramAccessSection />}

            {liveApp.connectionStatus === "error" && liveApp.lastError && (
              <div className="mt-3 rounded-lg bg-error/10 px-3 py-2 text-xs text-error">
                {liveApp.lastError}
              </div>
            )}

            {liveApp.connectionStatus === "connected" && (
              <div className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
                Bağlantı başarılı
              </div>
            )}

            {app.tools.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-[0.7857rem] uppercase tracking-wider text-text-faint">Araçlar</div>
                <div className="space-y-1">
                  {app.tools.map((t) => (
                    <div key={t.name} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs">
                      <Plug size={10} className="text-text-faint" />
                      <span className="text-text-secondary">{t.name}</span>
                      <span className="text-text-faint">— {t.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 flex items-center justify-between">
              <div className="flex gap-2">
                {supportsOAuth && (
                  <button
                    onClick={handleOAuth}
                    disabled={oauthBusy}
                    className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-3 disabled:opacity-50"
                  >
                    {oauthBusy ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        Tarayıcı bekleniyor...
                      </>
                    ) : (
                      <>
                        <ExternalLink size={12} />
                        {OAUTH_BUTTON_LABELS[app.id] || "OAuth ile Bağlan"}
                      </>
                    )}
                  </button>
                )}
                {!supportsOAuth && guideUrl && (
                  <button
                    onClick={() => openUrl(guideUrl).catch(() => {})}
                    className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-3"
                  >
                    <ExternalLink size={12} />
                    Kurulum Rehberi
                  </button>
                )}
                {fields.length > 0 && (
                  <button
                    onClick={handleTest}
                    disabled={testing}
                    className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-3 disabled:opacity-50"
                  >
                    {testing ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                    Test Et
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="rounded-lg px-3 py-1.5 text-xs text-text-faint transition-colors hover:bg-hover hover:text-text"
                >
                  İptal
                </button>
                <button
                  onClick={save}
                  className="rounded-lg bg-active px-3 py-1.5 text-xs text-text transition-colors hover:bg-border-hover"
                >
                  Kaydet
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AppCard({ app }: { app: AppIntegration }) {
  const t = useT();
  const toggleApp = useAppStore((s) => s.toggleApp);
  const [configOpen, setConfigOpen] = useState(false);

  const hasTools = app.tools.length > 0;

  return (
    <>
      <div className={`flex items-center justify-between rounded-2xl p-4 transition-colors duration-200 ${
        app.enabled ? "bg-surface-2" : "bg-surface"
      } hover:bg-surface-2`}>
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl transition-colors ${
            app.enabled ? "bg-surface-3 text-text" : "bg-surface-2 text-text-faint"
          }`}>
            {APP_ICONS[app.id]}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-text">{app.name}</span>
              <StatusDot app={app} />
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-text-faint">
              <span>{t(`appDesc.${app.id}`)}</span>
            </div>
            {hasTools && (
              <div className="mt-1 text-[0.7143rem] text-text-faint">
                {t("apps.toolCount", { count: app.tools.length })}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[0.8571rem] text-text-faint">
            {t(TYPE_LABEL_KEYS[app.connectionType])}
          </span>
          <button
            onClick={() => setConfigOpen(true)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-faint transition-colors hover:bg-hover hover:text-text"
            title="Ayarlar"
          >
            <Settings2 size={13} strokeWidth={1.4} />
          </button>
          <button
            onClick={() => toggleApp(app.id)}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${app.enabled
                ? "bg-success/10 text-success hover:bg-success/20"
                : "text-text-faint hover:bg-hover hover:text-text"
              }`}
            title={app.enabled ? "Devre dışı bırak" : "Etkinleştir"}
          >
            {app.enabled ? <Zap size={13} strokeWidth={1.6} /> : <ZapOff size={13} strokeWidth={1.6} />}
          </button>
        </div>
      </div>
      {configOpen && (
        <AppConfigDialog app={app} onClose={() => setConfigOpen(false)}/>
      )}
    </>
  );
}

export function AppsHub() {
  const t = useT();
  const apps = useAppStore((s) => s.apps);
  const enabledCount = apps.filter((a) => a.enabled).length;
  const connectedCount = apps.filter((a) => a.connectionStatus === "connected").length;

  const appsWithTools = apps.filter((a) => a.tools.length > 0);
  const appsWithout = apps.filter((a) => a.tools.length === 0);

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title={t("apps.title")}
        subtitle={`${t("apps.active", { count: enabledCount })}${connectedCount > 0 ? ` · ${t("apps.connected", { count: connectedCount })}` : ""} — ${t("apps.integrations", { count: apps.length })}`}
      />

      {appsWithTools.length > 0 && (
        <>
          <div className="mb-2 mt-4 text-[0.7857rem] uppercase tracking-wider text-text-faint">{t("apps.toolSupported")}</div>
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            {appsWithTools.map((app) => (
              <AppCard key={app.id} app={app} />
            ))}
          </div>
        </>
      )}

      {appsWithout.length > 0 && (
        <>
          <div className="mb-2 mt-6 text-[0.7857rem] uppercase tracking-wider text-text-faint">{t("apps.comingSoon")}</div>
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            {appsWithout.map((app) => (
              <AppCard key={app.id} app={app} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
