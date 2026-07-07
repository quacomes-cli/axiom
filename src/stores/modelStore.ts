import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "../lib/ipc";
import { notifyModelDownloaded } from "../lib/notify";
import type {
  CloudProviderConfig,
  ModelInfo,
  OllamaStatus,
  ProviderKind,
} from "../types";

export interface PullProgress {
  status: string;
  completed: number;
  total: number;
  percent: number; // 0–100, -1 = belirsiz (manifest/doğrulama aşaması)
}

interface PullProgressEvent {
  modelId: string;
  status: string;
  completed: number | null;
  total: number | null;
}

type CreateProgressEvent = PullProgressEvent;

export function modelSupportsTools(m: ModelInfo | undefined | null): boolean {
  if (!m) return false;
  if (m.provider === "cloud") return true;
  return m.capabilities ? m.capabilities.includes("tools") : false;
}

export function modelSupportsVision(m: ModelInfo | undefined | null): boolean {
  if (!m?.capabilities) return false;
  return m.capabilities.includes("vision");
}

/**
 * Küçük yerel modeller (≈14B altı) araç çağırmada (tool calling) güvenilmezdir:
 * olmayan araç/parametre uydurur, yanlış format üretir. Bunu kullanıcıya uyarı
 * olarak göstermek için tespit ederiz. Cloud modelleri güçlü kabul edilir.
 */
export function modelWeakAtTools(m: ModelInfo | undefined | null): boolean {
  if (!m) return false;
  if (m.provider === "cloud") return false;
  // parameterCount örn "8B", "7.6B", "70B", "1.5B"
  const pc = m.parameterCount?.toLowerCase() ?? "";
  const bMatch = pc.match(/([\d.]+)\s*b/);
  if (bMatch) return parseFloat(bMatch[1]) < 14;
  // parameterCount yoksa id'den tahmin et (örn "llama3.1:8b", "qwen2.5:3b")
  const idMatch = m.id.toLowerCase().match(/[:\-]([\d.]+)b\b/);
  if (idMatch) return parseFloat(idMatch[1]) < 14;
  return false;
}

interface ModelState {
  models: ModelInfo[];
  ollamaOnline: boolean;
  ollamaStatus: OllamaStatus | null;
  ollamaInstalling: boolean;
  ollamaStarting: boolean;
  cloudProviders: CloudProviderConfig[];
  cloudProvidersLoaded: boolean;
  loading: boolean;
  pulling: string | null;
  pullProgress: Record<string, PullProgress>;
  quantizing: string | null;
  quantizeProgress: Record<string, PullProgress>;
  error: string | null;

  loadModels: () => Promise<void>;
  checkOllama: () => Promise<void>;
  checkOllamaLifecycle: () => Promise<void>;
  startOllama: () => Promise<void>;
  installOllama: () => Promise<void>;
  pullModel: (provider: ProviderKind, modelId: string) => Promise<void>;
  quantizeModel: (source: string, targetTag: string, quantType: string) => Promise<void>;
  deleteModel: (provider: ProviderKind, modelId: string) => Promise<void>;
  setActive: (provider: ProviderKind, modelId: string) => Promise<void>;
  loadCloudProviders: () => Promise<void>;
  saveCloudProviders: (configs: CloudProviderConfig[]) => Promise<void>;
}

export const useModelStore = create<ModelState>((set, get) => ({
  models: [],
  ollamaOnline: false,
  ollamaStatus: null,
  ollamaInstalling: false,
  ollamaStarting: false,
  cloudProviders: [],
  cloudProvidersLoaded: false,
  loading: false,
  pulling: null,
  pullProgress: {},
  quantizing: null,
  quantizeProgress: {},
  error: null,

  loadModels: async () => {
    set({ loading: true, error: null });
    try {
      const models = await ipc.modelsList();
      await get().loadCloudProviders();
      set({ models, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  checkOllama: async () => {
    try {
      const online = await ipc.ollamaStatus();
      set({ ollamaOnline: online });
    } catch {
      set({ ollamaOnline: false });
    }
  },

  checkOllamaLifecycle: async () => {
    try {
      const status = await ipc.ollamaCheck();
      set({ ollamaStatus: status, ollamaOnline: status.running });

      if (status.installed && !status.running) {
        await get().startOllama();
      }
    } catch {
      set({
        ollamaStatus: { installed: false, running: false, path: null },
      });
    }
  },

  startOllama: async () => {
    set({ ollamaStarting: true });
    try {
      await ipc.ollamaStart();
      // Poll until running
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const online = await ipc.ollamaStatus();
        if (online) {
          set({
            ollamaOnline: true,
            ollamaStarting: false,
            ollamaStatus: { ...get().ollamaStatus!, running: true },
          });
          await get().loadModels();
          return;
        }
      }
      set({ ollamaStarting: false });
    } catch (e) {
      set({ ollamaStarting: false, error: String(e) });
    }
  },

  installOllama: async () => {
    set({ ollamaInstalling: true, error: null });
    try {
      await ipc.ollamaInstall();
      // Poll until installed (winget runs in background)
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const status = await ipc.ollamaCheck();
        if (status.installed) {
          set({
            ollamaInstalling: false,
            ollamaStatus: status,
          });
          await get().startOllama();
          return;
        }
      }
      set({ ollamaInstalling: false, error: "Kurulum zaman aşımına uğradı" });
    } catch (e) {
      set({ ollamaInstalling: false, error: String(e) });
    }
  },

  pullModel: async (provider, modelId) => {
    set((s) => ({
      pulling: modelId,
      error: null,
      pullProgress: {
        ...s.pullProgress,
        [modelId]: { status: "başlatılıyor", completed: 0, total: 0, percent: -1 },
      },
    }));

    const unlisten = await listen<PullProgressEvent>("model-pull-progress", (event) => {
      const p = event.payload;
      if (p.modelId !== modelId) return;
      const completed = p.completed ?? 0;
      const total = p.total ?? 0;
      const percent = total > 0 ? Math.round((completed / total) * 100) : -1;
      set((s) => ({
        pullProgress: {
          ...s.pullProgress,
          [modelId]: { status: p.status, completed, total, percent },
        },
      }));
    });

    try {
      await ipc.modelsPull(provider, modelId);
      set((s) => {
        const next = { ...s.pullProgress };
        delete next[modelId];
        return { pulling: null, pullProgress: next };
      });
      await get().loadModels();
      void notifyModelDownloaded(modelId);
    } catch (e) {
      set((s) => {
        const next = { ...s.pullProgress };
        delete next[modelId];
        return { pulling: null, pullProgress: next, error: String(e) };
      });
    } finally {
      unlisten();
    }
  },

  quantizeModel: async (source, targetTag, quantType) => {
    set((s) => ({
      quantizing: targetTag,
      error: null,
      quantizeProgress: {
        ...s.quantizeProgress,
        [targetTag]: { status: "başlatılıyor", completed: 0, total: 0, percent: -1 },
      },
    }));

    const unlisten = await listen<CreateProgressEvent>("model-create-progress", (event) => {
      const p = event.payload;
      if (p.modelId !== targetTag) return;
      const completed = p.completed ?? 0;
      const total = p.total ?? 0;
      const percent = total > 0 ? Math.round((completed / total) * 100) : -1;
      set((s) => ({
        quantizeProgress: {
          ...s.quantizeProgress,
          [targetTag]: { status: p.status, completed, total, percent },
        },
      }));
    });

    try {
      await ipc.modelsQuantize(source, targetTag, quantType);
      set((s) => {
        const next = { ...s.quantizeProgress };
        delete next[targetTag];
        return { quantizing: null, quantizeProgress: next };
      });
      await get().loadModels();
      void notifyModelDownloaded(targetTag);
    } catch (e) {
      set((s) => {
        const next = { ...s.quantizeProgress };
        delete next[targetTag];
        return { quantizing: null, quantizeProgress: next, error: String(e) };
      });
      throw e;
    } finally {
      unlisten();
    }
  },

  deleteModel: async (provider, modelId) => {
    set({ error: null });
    try {
      await ipc.modelsDelete(provider, modelId);
      await get().loadModels();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setActive: async (provider, modelId) => {
    try {
      await ipc.modelsSetActive(provider, modelId);
      await get().loadModels();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadCloudProviders: async () => {
    try {
      const configs = await ipc.cloudProvidersGet();
      set({ cloudProviders: configs, cloudProvidersLoaded: true });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  saveCloudProviders: async (configs) => {
    try {
      await ipc.cloudProvidersSet(configs);
      set({ cloudProviders: configs, cloudProvidersLoaded: true });
      await get().loadModels();
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
