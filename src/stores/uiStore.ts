import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ViewId } from "../types";
import { VIEW_ORDER } from "../types";

interface UiState {
  view: ViewId;
  prevView: ViewId;
  sidebarOpen: boolean;
  screenVisionOn: boolean;
  searchOpen: boolean;
  /** Başlık menüsünden açılan launchpad (uygulama ızgarası) overlay'i */
  launchpadOpen: boolean;
  /** Hakkında kutusu */
  aboutOpen: boolean;
  /** SettingsPage açılışta hangi sekmeye gitsin (menüden derin bağlantı) */
  settingsTab: string;
  direction: 1 | -1;
  appReady: boolean;
  /** SearchModal'dan tetiklenir — ChatPanel scroll edip flash eder, sonra siler */
  pendingScrollMessageId: string | null;
  setView: (view: ViewId) => void;
  toggleSidebar: () => void;
  toggleScreenVision: () => void;
  setSearchOpen: (open: boolean) => void;
  setLaunchpadOpen: (open: boolean) => void;
  setAboutOpen: (open: boolean) => void;
  /** Ayarları belirli bir sekmede açar */
  openSettings: (tab?: string) => void;
  setAppReady: () => void;
  requestScrollToMessage: (id: string | null) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      view: "chat",
      prevView: "chat",
      sidebarOpen: true,
      screenVisionOn: false,
      searchOpen: false,
      launchpadOpen: false,
      aboutOpen: false,
      settingsTab: "general",
      direction: 1,
      appReady: false,
      pendingScrollMessageId: null,
      setView: (next) =>
        set((s) => {
          const fromIdx = VIEW_ORDER.indexOf(s.view);
          const toIdx = VIEW_ORDER.indexOf(next);
          return {
            prevView: s.view,
            view: next,
            direction: toIdx >= fromIdx ? 1 : -1,
          };
        }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleScreenVision: () => set((s) => ({ screenVisionOn: !s.screenVisionOn })),
      setSearchOpen: (open) => set({ searchOpen: open }),
      setLaunchpadOpen: (open) => set({ launchpadOpen: open }),
      setAboutOpen: (open) => set({ aboutOpen: open }),
      openSettings: (tab) =>
        set((s) => {
          const fromIdx = VIEW_ORDER.indexOf(s.view);
          const toIdx = VIEW_ORDER.indexOf("settings");
          return {
            prevView: s.view,
            view: "settings",
            direction: toIdx >= fromIdx ? 1 : -1,
            settingsTab: tab ?? "general",
          };
        }),
      setAppReady: () => set({ appReady: true }),
      requestScrollToMessage: (id) => set({ pendingScrollMessageId: id }),
    }),
    {
      name: "axiom-ui",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) =>
        ({ sidebarOpen: state.sidebarOpen }) as unknown as UiState,
    }
  )
);
