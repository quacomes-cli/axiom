import { useState } from "react";
import { Search, Camera, Loader2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useChatStore } from "../../stores/chatStore";
import { useDocumentStore } from "../../stores/documentStore";
import { useModelStore, modelSupportsVision } from "../../stores/modelStore";
import { ipc } from "../../lib/ipc";
import { NotificationCenter } from "./NotificationCenter";

const appWindow = getCurrentWindow();

function WindowControls() {
  // h/w px ile sabit — font-size'dan etkilenmesin
  const btnBase =
    "flex h-[40px] w-[48px] items-center justify-center text-text-faint transition-colors duration-150";

  return (
    <div className="flex items-center">
      <button
        onClick={() => appWindow.minimize()}
        className={`${btnBase} hover:bg-hover-strong`}
        style={{
          zIndex: 1001,
        }}
      >
        <svg width="12" height="1">
          <rect width="12" height="1" rx="0.5" fill="currentColor" />
        </svg>
      </button>
      <button
        onClick={() => appWindow.toggleMaximize()}
        className={`${btnBase} hover:bg-hover-strong`}
        style={{
          zIndex: 1001,
        }}
      >
        <svg width="10" height="10">
          <rect
            x="0.5"
            y="0.5"
            width="9"
            height="9"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
      </button>
      <button
        onClick={() => appWindow.close()}
        className={`${btnBase} hover:bg-[rgba(232,78,78,0.9)] hover:text-white`}
        style={{
          zIndex: 1001,
        }}
      >
        <svg width="12" height="12">
          <line
            x1="2"
            y1="2"
            x2="10"
            y2="10"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <line
            x1="10"
            y1="2"
            x2="2"
            y2="10"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

function formatShortcutDisplay(combo: string): string {
  return combo.replace(/\+/g, " ");
}

async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  return new File([blob], name, { type: blob.type || "image/png" });
}

export function TitleBar() {
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const searchOpen = useUiStore((s) => s.searchOpen);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const shortcuts = useSettingsStore((s) => s.settings?.shortcuts);
  const activeModel = useModelStore((s) => s.models.find((m) => m.isActive));
  const visionOk = modelSupportsVision(activeModel);
  const [capturing, setCapturing] = useState(false);

  async function quickScreenshot() {
    const chatId = useChatStore.getState().activeChatId;
    if (!chatId || !visionOk) return;
    setCapturing(true);
    try {
      const res = await ipc.screenCapture(undefined);
      const file = await dataUrlToFile(
        res.dataUrl,
        `ekran-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
      );
      await useDocumentStore.getState().addPastedFile(chatId, file);
    } catch (e) {
      console.error("Hızlı ekran yakalama hatası:", e);
    } finally {
      setCapturing(false);
    }
  }


  return (
    <header
      data-tauri-drag-region
      className="relative flex h-[40px] shrink-0 items-center bg-transparent z-999999"
    >
      {/* Left — Axiom branding + sidebar toggle. Tüm boyutlar font-size'dan bağımsız. */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-center gap-1"
        style={{ paddingLeft: 14 }}
      >
        <span
          className="font-extrabold tracking-tight text-text-secondary"
          style={{ zIndex: 1001, fontSize: 13 }}
        >
          Axiom
        </span>
        <button
          onClick={toggleSidebar}
          title={(sidebarOpen ? "Daralt" : "Genişlet")+" (Ctrl+B)"}
          className="flex items-center justify-center rounded-md text-text-faint transition-colors duration-150 hover:bg-hover hover:text-text-secondary"
          style={{ zIndex: 1001, height: 28, width: 28 }}
        >
          {sidebarOpen ? (
            <PanelLeftClose size={15} strokeWidth={1.4} />
          ) : (
            <PanelLeftOpen size={15} strokeWidth={1.4} />
          )}
        </button>
      </div>

      {/* Center — search trigger */}
      {searchOpen == false && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          style={{
            zIndex: "1000",
          }}
        >
          <button
            onClick={() => setSearchOpen(true)}
            className="pointer-events-auto flex w-full max-w-sm cursor-text items-center gap-2 rounded-lg bg-hover px-3 py-1.5 pr-1.75 text-text-faint transition-colors duration-200 hover:bg-hover-strong hover:text-text-secondary"
            style={{ fontSize: 12 }}
          >
            <Search size={13} strokeWidth={1.4} />
            <span>Ara...</span>
            <kbd className="ml-auto rounded bg-kbd px-1.5 py-0.5 text-text-faint" style={{ fontSize: 10 }}>
              {shortcuts ? formatShortcutDisplay(shortcuts.search) : "Ctrl K"}
            </kbd>
          </button>
        </div>
      )}

      {/* Right spacer */}
      <div data-tauri-drag-region className="min-w-0 flex-1" />

      {/* Right — notifications + screenshot + window controls */}
      <div className="flex shrink-0 items-center">
        <NotificationCenter />
        {visionOk && (
          <button
            onClick={quickScreenshot}
            disabled={capturing}
            title={`Hızlı ekran yakala${shortcuts ? ` (${formatShortcutDisplay(shortcuts.toggleScreenVision)})` : ""}`}
            className="flex items-center gap-1.5 px-3 py-1 text-text-faint transition-all duration-200 hover:text-text-secondary disabled:opacity-50"
            style={{ fontSize: 11 }}
          >
            {capturing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Camera size={14} strokeWidth={1.4} />
            )}
          </button>
        )}

        <WindowControls />
      </div>
    </header>
  );
}
