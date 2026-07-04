import { create } from "zustand";
import type { AppSettings } from "../types";
import { ipc } from "../lib/ipc";
import { applyLocaleFromSetting } from "../i18n";

interface SettingsState {
  settings: AppSettings | null;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => Promise<void>;
  updateShortcut: (key: keyof AppSettings["shortcuts"], value: string) => Promise<void>;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  language: "system",
  fontSize: 14,
  fontFamily: "inter",
  launchAtStartup: false,
  closeToTray: false,
  notifyResponse: true,
  notifyModelDownload: true,
  shortcuts: {
    toggleSidebar: "Ctrl+B",
    search: "Ctrl+K",
    toggleScreenVision: "Ctrl+Shift+V",
    newChat: "Ctrl+N",
    clipboard: "Ctrl+Alt+V",
    palette: "Ctrl+Shift+Space",
  },
  modelConfig: {
    ollamaBaseUrl: "http://localhost:11434",
    cloudProviders: [],
    activeModel: null,
    ggufPaths: [],
    optimization: null,
  },
  alarmSound: {
    source: "default",
    duration: 5,
  },
  voice: {
    enabled: true,
    model: "base",
    language: "auto",
    pushToTalk: false,
  },
  memory: {
    enabled: true,
    embeddingModel: "nomic-embed-text",
    topK: 5,
    scoreThreshold: 0.55,
    crossChat: true,
  },
  tts: {
    enabled: true,
    voice: "",
    rate: 1.0,
    autoSpeak: false,
  },
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  loaded: false,

  async load() {
    try {
      const settings = await ipc.settingsGet();
      set({ settings, loaded: true });
      applyToDOM(settings);
    } catch {
      set({ settings: DEFAULT_SETTINGS, loaded: true });
      applyToDOM(DEFAULT_SETTINGS);
    }
  },

  async update(patch) {
    const prev = get().settings;
    if (!prev) return;
    const next = { ...prev, ...patch };
    set({ settings: next });
    applyToDOM(next);
    if (patch.launchAtStartup !== undefined) {
      await ipc.setAutostart(patch.launchAtStartup);
    }
    await ipc.settingsSet(next);
  },

  async updateShortcut(key, value) {
    const prev = get().settings;
    if (!prev) return;
    const next = {
      ...prev,
      shortcuts: { ...prev.shortcuts, [key]: value },
    };
    set({ settings: next });
    await ipc.settingsSet(next);
  },
}));

const FONT_MAP: Record<string, string> = {
  inter: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  jetbrains: '"JetBrains Mono", "Cascadia Code", ui-monospace, monospace',
};

function applyToDOM(s: AppSettings) {
  const root = document.documentElement;
  root.style.fontSize = `${s.fontSize}px`;
  root.style.fontFamily = FONT_MAP[s.fontFamily] ?? FONT_MAP.inter;
  root.setAttribute("data-theme", s.theme);
  applyLocaleFromSetting(s.language);
}
