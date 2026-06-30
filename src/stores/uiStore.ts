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
  direction: 1 | -1;
  appReady: boolean;
  /** SearchModal'dan tetiklenir — ChatPanel scroll edip flash eder, sonra siler */
  pendingScrollMessageId: string | null;
  setView: (view: ViewId) => void;
  toggleSidebar: () => void;
  toggleScreenVision: () => void;
  setSearchOpen: (open: boolean) => void;
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
