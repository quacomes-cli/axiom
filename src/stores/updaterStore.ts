// Updater state — preferences (persisted) + transient status (memory only).
//
// Mimari notu: pendingUpdate (Tauri Update objesi) serileştirilemez, bu yüzden
// store'da değil useUpdater.ts'in modül-scope'unda tutulur.

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "install_failed"
  | "none"
  | "error";

interface UpdaterState {
  // Persisted preferences
  autoDownload: boolean;
  setAutoDownload: (v: boolean) => void;

  // Transient (not persisted)
  status: UpdaterStatus;
  currentVersion: string | null;
  newVersion: string | null;
  notes: string | null;
  progress: number;
  error: string | null;

  setStatus: (s: UpdaterStatus) => void;
  setCurrentVersion: (v: string | null) => void;
  setIncoming: (version: string, notes: string | null) => void;
  setProgress: (p: number) => void;
  setError: (e: string | null) => void;
  reset: () => void;
}

export const useUpdaterStore = create<UpdaterState>()(
  persist(
    (set) => ({
      autoDownload: true,
      setAutoDownload: (autoDownload) => set({ autoDownload }),

      status: "idle",
      currentVersion: null,
      newVersion: null,
      notes: null,
      progress: 0,
      error: null,

      setStatus: (status) => set({ status }),
      setCurrentVersion: (currentVersion) => set({ currentVersion }),
      setIncoming: (newVersion, notes) =>
        set({ newVersion, notes, status: "available" }),
      setProgress: (progress) => set({ progress }),
      setError: (error) => set({ error, status: error ? "error" : "idle" }),
      reset: () =>
        set({
          status: "idle",
          newVersion: null,
          notes: null,
          progress: 0,
          error: null,
        }),
    }),
    {
      name: "axiom-updater",
      // Sadece tercihleri kalıcılaştır
      partialize: (s) => ({ autoDownload: s.autoDownload }),
    },
  ),
);
