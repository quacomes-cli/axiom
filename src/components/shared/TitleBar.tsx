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
import { TitleMenu } from "./TitleMenu";
import { useT } from "../../i18n";
import { motion } from "framer-motion";

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
          zIndex: 9999,
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
          zIndex: 9999,
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
          zIndex: 9999,
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
  const t = useT();
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const shortcuts = useSettingsStore((s) => s.settings?.shortcuts);
  const activeModel = useModelStore((s) => s.models.find((m) => m.isActive));
  const visionOk = modelSupportsVision(activeModel);
  const [capturing, setCapturing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
      className="relative flex h-[40px] shrink-0 items-center bg-transparent"
    >
      {/* Left — Axiom branding + sidebar toggle. Tüm boyutlar font-size'dan bağımsız. */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-center"
        style={{ paddingLeft: 6 }}
      >
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className={`flex items-center justify-center rounded-md hover:bg-surface-dark hover:text-text-secondary mr-0.5 ${menuOpen ? "bg-surface-dark text-text-secondary" : "text-text-faint"}`}
          style={{ fontSize: 12, height: 30, width: 30 }}
          title="Axiom"
        >
          <motion.svg
            xmlns="http://www.w3.org/2000/svg"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            whileHover="hover"
            style={{ cursor: "pointer" }}
          >
            <motion.line
              x1="4"
              y1="6"
              x2={20}
              y2="6"
              variants={{
                hover: { x2: 16 }
              }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }} // Şöyle tatlı, hafif yaylanan bir geçiş
            />

            <motion.line
              x1="4"
              y1="12"
              x2={20}
              y2="12"
              variants={{
                hover: { x2: 12 }
              }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }} // Şöyle tatlı, hafif yaylanan bir geçiş
            />

            <motion.line
              x1="4"
              y1="18"
              x2={12}
              y2="18"
              variants={{
                hover: { x2: 20 }
              }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }} // Şöyle tatlı, hafif yaylanan bir geçiş
            />

          </motion.svg>

        </button>
        <TitleMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
        <button
          onClick={toggleSidebar}
          title={(sidebarOpen ? t("titlebar.collapse") : t("titlebar.expand")) + " (Ctrl+B)"}
          className="flex items-center justify-center rounded-md text-text-faint hover:bg-surface-dark hover:text-text-secondary mr-0.5"
          style={{ height: 30, width: 30 }}
        >
          {sidebarOpen ? (
            <PanelLeftClose size={15} strokeWidth={1.4} />
          ) : (
            <PanelLeftOpen size={15} strokeWidth={1.4} />
          )}
        </button>
        {/* Center — search trigger */}
        <button
          onClick={() => setSearchOpen(true)}
          className="flex items-center justify-center rounded-md text-text-faint hover:bg-surface-dark hover:text-text-secondary"
          style={{ fontSize: 12, height: 30, width: 30 }}
          title={`${t("titlebar.search")} (Ctrl+K)`}
        >
          <Search size={15} strokeWidth={1.4} className="ml-0.5" />
        </button>
      </div>


      {/* Right spacer */}
      <div data-tauri-drag-region className="min-w-0 flex-1" style={{ zIndex: 9999 }} />

      {/* Right — notifications + screenshot + window controls */}
      <div className="flex shrink-0 items-center">
        <NotificationCenter />
        {visionOk && (
          <button
            onClick={quickScreenshot}
            disabled={capturing}
            title={`${t("titlebar.quickScreenshot")}${shortcuts ? ` (${formatShortcutDisplay(shortcuts.toggleScreenVision)})` : ""}`}
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
