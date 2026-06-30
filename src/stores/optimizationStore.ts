import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { OptimizationConfig, ProfilePreset, HardwareProfile } from "../types";

interface OptimizationState {
  config: OptimizationConfig | null;
  hardwareProfile: HardwareProfile | null;
  loading: boolean;

  loadConfig: () => Promise<void>;
  loadHardware: () => Promise<void>;
  saveConfig: (config: OptimizationConfig) => Promise<void>;
  autoDetect: (preset?: ProfilePreset) => Promise<void>;
  setPreset: (preset: ProfilePreset) => Promise<void>;
  updateField: <K extends keyof OptimizationConfig>(key: K, value: OptimizationConfig[K]) => void;
}

export const useOptimizationStore = create<OptimizationState>()((set, get) => ({
  config: null,
  hardwareProfile: null,
  loading: false,

  loadConfig: async () => {
    try {
      const config = await ipc.optimizationGet();
      set({ config });
    } catch {
      // config yok, null kalır
    }
  },

  loadHardware: async () => {
    try {
      const hw = await ipc.hardwareProfile();
      set({ hardwareProfile: hw });
    } catch {
      // donanım bilgisi alınamadı
    }
  },

  saveConfig: async (config) => {
    set({ config });
    await ipc.optimizationSet(config);
  },

  autoDetect: async (preset) => {
    set({ loading: true });
    try {
      let hw = get().hardwareProfile;
      if (!hw) {
        hw = await ipc.hardwareProfile();
        set({ hardwareProfile: hw });
      }
      const config = await ipc.optimizationAutoDetect(preset, hw);
      set({ config });
      await ipc.optimizationSet(config);
    } finally {
      set({ loading: false });
    }
  },

  setPreset: async (preset) => {
    await get().autoDetect(preset);
  },

  updateField: (key, value) => {
    const current = get().config;
    if (!current) return;
    const updated: OptimizationConfig = { ...current, [key]: value, preset: "ozel" as ProfilePreset };
    set({ config: updated });
    ipc.optimizationSet(updated).catch(() => {});
  },
}));
