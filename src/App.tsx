import { useEffect, useState, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import { Sidebar } from "./components/shared/Sidebar";
import { TitleBar } from "./components/shared/TitleBar";
import { AnimatedView } from "./components/shared/AnimatedView";
import { SearchModal } from "./components/shared/SearchModal";
import { ApprovalPrompt } from "./components/shared/ApprovalPrompt";
import { AuthModal } from "./components/auth/AuthModal";
import { MigrationModal } from "./components/auth/MigrationModal";
import { useUiStore } from "./stores/uiStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useModelStore } from "./stores/modelStore";
import { useChatStore } from "./stores/chatStore";
import { useOptimizationStore } from "./stores/optimizationStore";
import { useAuthStore } from "./stores/authStore";
import { useCloudSync } from "./hooks/useCloudSync";
import { useTaskScheduler } from "./hooks/useTaskScheduler";
import { useTelegramAutoMode } from "./hooks/useTelegramAutoMode";
import { usePriceTracker } from "./hooks/usePriceTracker";
import { useBackgroundUpdater } from "./hooks/useBackgroundUpdater";

function matchesShortcut(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.split("+").map((p) => p.trim().toLowerCase());
  const needCtrl = parts.includes("ctrl");
  const needAlt = parts.includes("alt");
  const needShift = parts.includes("shift");
  const key = parts.filter((p) => !["ctrl", "alt", "shift"].includes(p))[0];
  if (!key) return false;
  return (
    (e.ctrlKey || e.metaKey) === needCtrl &&
    e.altKey === needAlt &&
    e.shiftKey === needShift &&
    e.key.toLowerCase() === key.toLowerCase()
  );
}

function SplashScreen() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-base">
      <div
        className="h-12 w-12 animate-pulse bg-accent"
        style={{
          WebkitMaskImage: "url('/logo.svg')",
          maskImage: "url('/logo.svg')",
          WebkitMaskSize: "contain",
          maskSize: "contain",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
        }}
      />
    </div>
  );
}

export default function App() {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const shortcuts = useSettingsStore((s) => s.settings?.shortcuts);
  const newChat = useChatStore((s) => s.newChat);
  const hasChats = useChatStore((s) => s.chats.length > 0);
  const authInit = useAuthStore((s) => s.init);

  useCloudSync();
  useTaskScheduler();
  useTelegramAutoMode();
  usePriceTracker();
  useBackgroundUpdater();

  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [migrationModalOpen, setMigrationModalOpen] = useState(false);
  const appReady = settingsLoaded && modelsLoaded;

  // Tarayıcı kısayollarını yakala (context menu, Ctrl+P/S/U/F, Ctrl+Shift+I/C/J)
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === "p" || k === "s" || k === "u" || k === "f") {
          e.preventDefault();
        }
        if (e.shiftKey && (k === "i" || k === "c" || k === "j")) {
          e.preventDefault();
        }
      }
    };
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // Firebase auth listener
  useEffect(() => {
    const unsubscribe = authInit();
    return unsubscribe;
  }, [authInit]);

  useEffect(() => {
    async function init() {
      // Settings hızlı — dosya okuma. loadModels Ollama'ya bağlıyorsa
      // saniyeler alabilir; UI'yı splash'te takılı bırakmasın diye
      // paralel ve timeout'lu yürütüyoruz.
      await useSettingsStore.getState().load();
      void useOptimizationStore.getState().loadConfig();
      void useModelStore.getState().checkOllamaLifecycle();

      const modelsPromise = useModelStore.getState().loadModels().catch(() => { });
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
      await Promise.race([modelsPromise, timeout]);
      setModelsLoaded(true);
    }
    init();
  }, []);

  useEffect(() => {
    if (!appReady) return;
    if (!hasChats) newChat();
  }, [appReady, hasChats, newChat]);

  useEffect(() => {
    if (!shortcuts) return;
    function onKey(e: KeyboardEvent) {
      if (matchesShortcut(e, shortcuts!.toggleSidebar)) {
        e.preventDefault();
        toggleSidebar();
      } else if (matchesShortcut(e, shortcuts!.search)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts, toggleSidebar, setSearchOpen]);

  const handleOpenAuth = useCallback(() => setAuthModalOpen(true), []);

  const handleAuthSuccess = useCallback(() => {
    setAuthModalOpen(false);
    const chatCount = useChatStore.getState().chats.filter((c) => c.messages.length > 0).length;
    if (chatCount > 0) {
      setMigrationModalOpen(true);
    }
  }, []);

  if (!appReady) return <SplashScreen />;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-base">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar onOpenAuth={handleOpenAuth} />
        <main className="min-h-0 min-w-0 flex-1">
          <AnimatedView />
        </main>
      </div>
      <SearchModal />
      <ApprovalPrompt />

      <AnimatePresence>
        {authModalOpen && (
          <AuthModal
            onClose={() => setAuthModalOpen(false)}
            onSuccess={handleAuthSuccess}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {migrationModalOpen && (
          <MigrationModal onClose={() => setMigrationModalOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
