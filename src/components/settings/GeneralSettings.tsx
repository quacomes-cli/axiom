import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import { useSettingsStore } from "../../stores/settingsStore";
import { ipc } from "../../lib/ipc";
import { useT, SUPPORTED_LOCALES } from "../../i18n";
import type { AlarmSoundSource, FontFamily, Theme } from "../../types";

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-3">
      <div className="min-w-0">
        <div className="text-[0.9286rem] text-text-secondary">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-text-faint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  layoutId,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  layoutId: string;
}) {
  return (
    <div className="flex gap-0.5 rounded-lg bg-surface p-0.5">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`relative rounded-lg px-3 py-1 text-[0.8571rem] font-medium transition-colors duration-150 ${
              active ? "text-text" : "text-text-faint hover:text-text-secondary"
            }`}
          >
            {active && (
              <motion.div
                layoutId={layoutId}
                className="absolute inset-0 rounded-lg bg-surface-3"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-5.25 w-9 rounded-full transition-colors duration-200 ${
        checked ? "bg-blue-400" : "bg-surface-3"
      }`}
    >
      <motion.span
        animate={{ x: checked ? 13.5 : 0.5 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className={`absolute top-0.5 left-0.5 block h-4 w-4 rounded-full ${
          checked ? "bg-white" : "bg-text-faint"
        }`}
      />
    </button>
  );
}

const WHISPER_MODELS: { id: string; labelKey: string; size: string }[] = [
  { id: "tiny", labelKey: "settings.voice.modelTiny", size: "~75 MB" },
  { id: "base", labelKey: "settings.voice.modelBase", size: "~150 MB" },
  { id: "small", labelKey: "settings.voice.modelSmall", size: "~500 MB" },
  { id: "medium", labelKey: "settings.voice.modelMedium", size: "~1.5 GB" },
];

const VOICE_LANGS: { id: string; labelKey: string }[] = [
  { id: "auto", labelKey: "settings.voice.langAuto" },
  { id: "tr", labelKey: "settings.voice.langTr" },
  { id: "en", labelKey: "settings.voice.langEn" },
];

function VoiceSettings() {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [downloading, setDownloading] = useState<string | null>(null);

  const voice = settings?.voice ?? {
    enabled: true,
    model: "base",
    language: "auto",
    pushToTalk: false,
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map: Record<string, boolean> = {};
      for (const m of WHISPER_MODELS) {
        try {
          const st = await ipc.audioModelStatus(m.id);
          map[m.id] = st.installed;
        } catch {
          map[m.id] = false;
        }
      }
      if (!cancelled) setInstalled(map);
    })();
    return () => { cancelled = true; };
  }, [downloading]);

  if (!settings) return null;

  async function downloadModel(modelId: string) {
    setDownloading(modelId);
    try {
      await ipc.audioDownloadModel(modelId);
    } catch (e) {
      console.error("Whisper indirme hatası:", e);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-1">
      <SettingRow
        label={t("settings.voice.enabled")}
        hint={t("settings.voice.enabledHint")}
      >
        <Toggle
          checked={voice.enabled}
          onChange={(v) => update({ voice: { ...voice, enabled: v } })}
        />
      </SettingRow>

      <SettingRow
        label={t("settings.voice.language")}
        hint={t("settings.voice.languageHint")}
      >
        <SegmentedControl<string>
          layoutId="seg-voice-lang"
          options={VOICE_LANGS.map((l) => ({ value: l.id, label: t(l.labelKey) }))}
          value={voice.language}
          onChange={(v) => update({ voice: { ...voice, language: v } })}
        />
      </SettingRow>

      <div className="rounded-xl bg-surface-2 px-3.5 py-3">
        <div className="text-[0.9286rem] text-text-secondary mb-2">{t("settings.voice.whisperModel")}</div>
        <div className="space-y-1.5">
          {WHISPER_MODELS.map((m) => {
            const isActive = voice.model === m.id;
            const isInstalled = installed[m.id];
            const isDownloading = downloading === m.id;
            return (
              <div
                key={m.id}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition-colors ${
                  isActive ? "border-blue-400/60 bg-blue-500/10" : "border-border bg-surface"
                }`}
              >
                <button
                  type="button"
                  onClick={() => update({ voice: { ...voice, model: m.id } })}
                  className="flex flex-1 items-center gap-2 text-left"
                >
                  <span className={isActive ? "text-text" : "text-text-secondary"}>{t(m.labelKey)}</span>
                  <span className="text-text-faint">· {m.size}</span>
                </button>
                {isInstalled ? (
                  <span className="text-[0.7143rem] text-green-400">{t("settings.voice.downloaded")}</span>
                ) : isDownloading ? (
                  <span className="text-[0.7143rem] text-blue-400">{t("settings.voice.downloading")}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => downloadModel(m.id)}
                    className="rounded-md bg-active px-2 py-0.5 text-[0.7143rem] text-text-secondary hover:bg-border-hover hover:text-text"
                  >
                    {t("settings.voice.download")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TtsSettings() {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [testing, setTesting] = useState(false);

  const tts = settings?.tts ?? {
    enabled: true,
    voice: "",
    rate: 1.0,
    autoSpeak: false,
  };

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    function refresh() {
      const all = window.speechSynthesis.getVoices();
      // Türkçe'yi öne al
      all.sort((a, b) => {
        const at = a.lang.toLowerCase().startsWith("tr") ? 0 : 1;
        const bt = b.lang.toLowerCase().startsWith("tr") ? 0 : 1;
        return at - bt;
      });
      setVoices(all);
    }
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, []);

  if (!settings) return null;
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  function testVoice() {
    if (!supported) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t("settings.tts.testMessage"));
    const v = voices.find((x) => x.name === tts.voice);
    if (v) u.voice = v;
    else {
      const tr = voices.find((x) => x.lang.toLowerCase().startsWith("tr"));
      if (tr) u.voice = tr;
    }
    u.rate = tts.rate;
    setTesting(true);
    u.onend = () => setTesting(false);
    u.onerror = () => setTesting(false);
    window.speechSynthesis.speak(u);
  }

  return (
    <div className="space-y-1">
      {!supported && (
        <div className="rounded-xl bg-red-500/10 px-3.5 py-3 text-xs text-red-300">
          {t("settings.tts.unsupported")}
        </div>
      )}
      <SettingRow
        label={t("settings.tts.enabled")}
        hint={t("settings.tts.enabledHint")}
      >
        <Toggle
          checked={tts.enabled}
          onChange={(v) => update({ tts: { ...tts, enabled: v } })}
        />
      </SettingRow>

      <SettingRow
        label={t("settings.tts.autoSpeak")}
        hint={t("settings.tts.autoSpeakHint")}
      >
        <Toggle
          checked={tts.autoSpeak}
          onChange={(v) => update({ tts: { ...tts, autoSpeak: v } })}
        />
      </SettingRow>

      <div className="rounded-xl bg-surface-2 px-3.5 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[0.9286rem] text-text-secondary">{t("settings.tts.voice")}</span>
          <button
            type="button"
            onClick={testVoice}
            disabled={!supported || testing}
            className="rounded-md bg-active px-2 py-0.5 text-[0.7143rem] text-text-secondary transition-colors hover:bg-border-hover hover:text-text disabled:opacity-30"
          >
            {testing ? t("settings.tts.playing") : t("settings.tts.test")}
          </button>
        </div>
        <select
          value={tts.voice}
          onChange={(e) => update({ tts: { ...tts, voice: e.target.value } })}
          className="w-full rounded-lg bg-surface px-2 py-1.5 text-xs text-text outline-none"
        >
          <option value="">{t("settings.tts.voiceAuto")}</option>
          {voices.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name} — {v.lang}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl bg-surface-2 px-3.5 py-3">
        <div className="mb-2 flex items-center justify-between text-[0.9286rem] text-text-secondary">
          <span>{t("settings.tts.rate")}</span>
          <span className="text-text-faint tabular-nums">{tts.rate.toFixed(2)}×</span>
        </div>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={tts.rate}
          onChange={(e) =>
            update({ tts: { ...tts, rate: parseFloat(e.target.value) } })
          }
          className="w-full accent-blue-400"
        />
      </div>
    </div>
  );
}

function MemorySettings() {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [stats, setStats] = useState<{
    totalChunks: number;
    totalChats: number;
    embeddingModel: string | null;
    dbSizeBytes: number;
  } | null>(null);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const memory = settings?.memory ?? {
    enabled: true,
    embeddingModel: "nomic-embed-text",
    topK: 5,
    scoreThreshold: 0.55,
    crossChat: true,
  };

  async function refreshStats() {
    try {
      const s = await ipc.memoryStats();
      setStats(s);
    } catch {
      setStats(null);
    }
  }

  useEffect(() => {
    void refreshStats();
  }, []);

  async function clearAll() {
    setClearing(true);
    try {
      await ipc.memoryClearAll();
      await refreshStats();
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  }

  if (!settings) return null;

  return (
    <div className="space-y-1">
      <SettingRow
        label={t("settings.memory.enabled")}
        hint={t("settings.memory.enabledHint")}
      >
        <Toggle
          checked={memory.enabled}
          onChange={(v) => update({ memory: { ...memory, enabled: v } })}
        />
      </SettingRow>

      <SettingRow
        label={t("settings.memory.crossChat")}
        hint={t("settings.memory.crossChatHint")}
      >
        <Toggle
          checked={memory.crossChat}
          onChange={(v) => update({ memory: { ...memory, crossChat: v } })}
        />
      </SettingRow>

      <SettingRow
        label={t("settings.memory.embeddingModel")}
        hint={t("settings.memory.embeddingModelHint")}
      >
        <input
          type="text"
          value={memory.embeddingModel}
          onChange={(e) => update({ memory: { ...memory, embeddingModel: e.target.value } })}
          className="w-44 rounded-lg bg-surface px-2.5 py-1 text-xs text-text outline-none"
        />
      </SettingRow>

      <SettingRow
        label={t("settings.memory.topK")}
        hint={t("settings.memory.topKHint")}
      >
        <input
          type="number"
          min={1}
          max={20}
          value={memory.topK}
          onChange={(e) =>
            update({ memory: { ...memory, topK: Math.max(1, Math.min(20, parseInt(e.target.value || "5"))) } })
          }
          className="w-16 rounded-lg bg-surface px-2 py-1 text-xs text-text outline-none text-center"
        />
      </SettingRow>

      <SettingRow
        label={t("settings.memory.threshold")}
        hint={t("settings.memory.thresholdHint")}
      >
        <input
          type="number"
          step="0.05"
          min={0}
          max={1}
          value={memory.scoreThreshold}
          onChange={(e) =>
            update({ memory: { ...memory, scoreThreshold: Math.max(0, Math.min(1, parseFloat(e.target.value || "0.55"))) } })
          }
          className="w-20 rounded-lg bg-surface px-2 py-1 text-xs text-text outline-none text-center"
        />
      </SettingRow>

      {stats && (
        <div className="rounded-xl bg-surface-2 px-3.5 py-3 text-xs text-text-faint">
          <div className="flex justify-between">
            <span>{t("settings.memory.totalChunks")}</span>
            <span className="text-text-secondary tabular-nums">{stats.totalChunks.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>{t("settings.memory.distinctChats")}</span>
            <span className="text-text-secondary tabular-nums">{stats.totalChats}</span>
          </div>
          <div className="flex justify-between">
            <span>{t("settings.memory.dbSize")}</span>
            <span className="text-text-secondary tabular-nums">{(stats.dbSizeBytes / 1024 / 1024).toFixed(2)} MB</span>
          </div>
          {stats.embeddingModel && (
            <div className="flex justify-between">
              <span>{t("settings.memory.lastModel")}</span>
              <span className="text-text-secondary truncate ml-2">{stats.embeddingModel}</span>
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl bg-surface-2 px-3.5 py-3">
        {!confirmClear ? (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="w-full rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400 transition-colors hover:bg-red-500/20"
          >
            {t("settings.memory.clearAll")}
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={clearAll}
              disabled={clearing}
              className="flex-1 rounded-lg bg-red-500/30 px-3 py-2 text-xs text-red-300 transition-colors hover:bg-red-500/40 disabled:opacity-50"
            >
              {clearing ? t("settings.memory.clearing") : t("settings.memory.confirmClear")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="flex-1 rounded-lg bg-surface px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-border-hover"
            >
              {t("settings.memory.cancelClear")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AlarmSoundSettings() {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [ytUrl, setYtUrl] = useState(settings?.alarmSound?.youtubeUrl ?? "");
  const [caching, setCaching] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);

  if (!settings) return null;
  const alarm = settings.alarmSound ?? { source: "default" as const, duration: 5 };

  async function cacheFromYoutube() {
    const url = ytUrl.trim();
    if (!url) return;
    setCaching(true);
    setCacheError(null);
    try {
      const cachedPath = await ipc.cacheAlarmAudio("youtube", url);
      await update({
        alarmSound: { ...alarm, source: "youtube", youtubeUrl: url, cachedPath },
      });
    } catch (e: unknown) {
      setCacheError(e instanceof Error ? e.message : String(e));
    } finally {
      setCaching(false);
    }
  }

  async function pickLocalFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: t("settings.alarm.audioFile"), extensions: ["mp3", "wav", "ogg", "m4a"] }],
    });
    if (!selected) return;
    const filePath = typeof selected === "string" ? selected : selected;
    setCaching(true);
    setCacheError(null);
    try {
      const cachedPath = await ipc.cacheAlarmAudio("local", filePath as string);
      await update({
        alarmSound: { ...alarm, source: "local", localPath: filePath as string, cachedPath },
      });
    } catch (e: unknown) {
      setCacheError(e instanceof Error ? e.message : String(e));
    } finally {
      setCaching(false);
    }
  }

  return (
    <div className="space-y-1">
      <SettingRow label={t("settings.alarm.source")} hint={t("settings.alarm.sourceHint")}>
        <SegmentedControl<AlarmSoundSource>
          layoutId="seg-alarm-source"
          options={[
            { value: "default", label: t("settings.alarm.sourceDefault") },
            { value: "youtube", label: t("settings.alarm.sourceYoutube") },
            { value: "local", label: t("settings.alarm.sourceFile") },
          ]}
          value={alarm.source}
          onChange={(v) => update({ alarmSound: { ...alarm, source: v } })}
        />
      </SettingRow>

      {alarm.source === "youtube" && (
        <div className="rounded-xl bg-surface-2 px-3.5 py-3">
          <div className="text-[0.9286rem] text-text-secondary mb-2">{t("settings.alarm.youtubeUrl")}</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={ytUrl}
              onChange={(e) => setYtUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="flex-1 rounded-lg bg-surface px-2.5 py-1.5 text-xs text-text outline-none placeholder:text-text-faint"
            />
            <button
              onClick={cacheFromYoutube}
              disabled={caching || !ytUrl.trim()}
              className="rounded-lg bg-active px-3 py-1.5 text-xs text-text transition-colors hover:bg-border-hover disabled:opacity-30"
            >
              {caching ? t("settings.alarm.adding") : t("settings.alarm.add")}
            </button>
          </div>
          {alarm.cachedPath && alarm.source === "youtube" && (
            <div className="mt-1.5 text-[0.7143rem] text-emerald-400">{t("settings.alarm.added")}</div>
          )}
          {cacheError && (
            <div className="mt-1.5 text-[0.7143rem] text-red-400">{cacheError}</div>
          )}
        </div>
      )}

      {alarm.source === "local" && (
        <div className="rounded-xl bg-surface-2 px-3.5 py-3">
          <div className="text-[0.9286rem] text-text-secondary mb-2">{t("settings.alarm.audioFile")}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={pickLocalFile}
              disabled={caching}
              className="rounded-lg bg-active px-3 py-1.5 text-xs text-text transition-colors hover:bg-border-hover disabled:opacity-30"
            >
              {caching ? t("settings.alarm.copying") : t("settings.alarm.pickFile")}
            </button>
            {alarm.localPath && (
              <span className="truncate text-[0.7857rem] text-text-faint">
                {alarm.localPath.replace(/\\/g, "/").split("/").pop()}
              </span>
            )}
          </div>
          {alarm.cachedPath && alarm.source === "local" && (
            <div className="mt-1.5 text-[0.7143rem] text-emerald-400">{t("settings.alarm.ready")}</div>
          )}
          {cacheError && (
            <div className="mt-1.5 text-[0.7143rem] text-red-400">{cacheError}</div>
          )}
        </div>
      )}

      <SettingRow label={t("settings.alarm.duration")} hint={t("settings.alarm.durationHint", { sec: alarm.duration })}>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={1}
            max={60}
            step={1}
            value={alarm.duration}
            onChange={(e) => update({ alarmSound: { ...alarm, duration: Number(e.target.value) } })}
            className="w-24 accent-blue-400"
          />
          <span className="w-8 text-center font-mono text-[0.9286rem] text-text">
            {alarm.duration}s
          </span>
        </div>
      </SettingRow>
    </div>
  );
}

export function GeneralSettings() {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const loaded = useSettingsStore((s) => s.loaded);
  const update = useSettingsStore((s) => s.update);
  const load = useSettingsStore((s) => s.load);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  if (!settings) return null;

  return (
    <div className="space-y-1.5">
      <div className="rounded-2xl bg-surface p-4">
        <div className="mb-3 text-[0.7857rem] uppercase tracking-widest text-text-faint">
          {t("settings.sections.language")}
        </div>
        <SettingRow label={t("settings.language.label")} hint={t("settings.language.hint")}>
          <select
            value={settings.language}
            onChange={(e) => update({ language: e.target.value })}
            className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-[0.8571rem] text-text outline-none"
          >
            <option value="system">{t("settings.language.system")}</option>
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </SettingRow>
      </div>

      <div className="rounded-2xl bg-surface p-4">
        <div className="mb-3 text-[0.7857rem] uppercase tracking-widest text-text-faint">
          {t("settings.sections.appearance")}
        </div>
        <div className="space-y-1">
          <SettingRow label={t("settings.appearance.theme")}>
            <SegmentedControl<Theme>
              layoutId="seg-theme"
              options={[
                { value: "dark", label: t("settings.appearance.themeDark") },
                { value: "light", label: t("settings.appearance.themeLight") },
              ]}
              value={settings.theme}
              onChange={(v) => update({ theme: v })}
            />
          </SettingRow>

          <SettingRow label={t("settings.appearance.fontSize")} hint={`${settings.fontSize}px`}>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  update({ fontSize: Math.max(12, settings.fontSize - 1) })
                }
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface text-text-faint transition-colors hover:bg-surface-3 hover:text-text-secondary"
              >
                −
              </button>
              <span className="w-6 text-center font-mono text-[0.9286rem] text-text">
                {settings.fontSize}
              </span>
              <button
                onClick={() =>
                  update({ fontSize: Math.min(20, settings.fontSize + 1) })
                }
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface text-text-faint transition-colors hover:bg-surface-3 hover:text-text-secondary"
              >
                +
              </button>
            </div>
          </SettingRow>

          <SettingRow label={t("settings.appearance.fontFamily")}>
            <SegmentedControl<FontFamily>
              layoutId="seg-font"
              options={[
                { value: "inter", label: "Inter" },
                { value: "system", label: t("settings.appearance.fontSystem") },
                { value: "jetbrains", label: "JetBrains" },
              ]}
              value={settings.fontFamily}
              onChange={(v) => update({ fontFamily: v })}
            />
          </SettingRow>
        </div>
      </div>

      <div className="rounded-2xl bg-surface p-4">
        <div className="mb-3 text-[0.7857rem] uppercase tracking-widest text-text-faint">
          {t("settings.sections.system")}
        </div>
        <div className="space-y-1">
          <SettingRow
            label={t("settings.system.launchAtStartup")}
            hint={t("settings.system.launchAtStartupHint")}
          >
            <Toggle
              checked={settings.launchAtStartup}
              onChange={(v) => update({ launchAtStartup: v })}
            />
          </SettingRow>
          <SettingRow
            label={t("settings.system.closeToTray")}
            hint={t("settings.system.closeToTrayHint")}
          >
            <Toggle
              checked={settings.closeToTray}
              onChange={(v) => update({ closeToTray: v })}
            />
          </SettingRow>
        </div>
      </div>

      <div className="rounded-2xl bg-surface p-4">
        <div className="mb-3 text-[0.7857rem] uppercase tracking-widest text-text-faint">
          {t("settings.sections.notifications")}
        </div>
        <div className="space-y-1">
          <SettingRow
            label={t("settings.notifications.response")}
            hint={t("settings.notifications.responseHint")}
          >
            <Toggle
              checked={settings.notifyResponse}
              onChange={(v) => update({ notifyResponse: v })}
            />
          </SettingRow>
          <SettingRow
            label={t("settings.notifications.modelDownload")}
            hint={t("settings.notifications.modelDownloadHint")}
          >
            <Toggle
              checked={settings.notifyModelDownload}
              onChange={(v) => update({ notifyModelDownload: v })}
            />
          </SettingRow>
        </div>
      </div>

      <div className="rounded-2xl bg-surface p-4">
        <div className="mb-3 text-[0.7857rem] uppercase tracking-widest text-text-faint">
          {t("settings.sections.alarmSound")}
        </div>
        <AlarmSoundSettings />
      </div>

      <div className="rounded-2xl bg-surface p-4">
        <div className="mb-3 text-[0.7857rem] uppercase tracking-widest text-text-faint">
          {t("settings.sections.voiceInput")}
        </div>
        <VoiceSettings />
      </div>

      <div className="rounded-2xl bg-surface p-4">
        <div className="mb-3 text-[0.7857rem] uppercase tracking-widest text-text-faint">
          {t("settings.sections.memory")}
        </div>
        <MemorySettings />
      </div>

      <div className="rounded-2xl bg-surface p-4">
        <div className="mb-3 text-[0.7857rem] uppercase tracking-widest text-text-faint">
          {t("settings.sections.tts")}
        </div>
        <TtsSettings />
      </div>
    </div>
  );
}