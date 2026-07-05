// Başlık çubuğu hızlı-erişim menüsü (genişleyen / accordion).
// TitleBar'daki ☰ butonuna bağlanır; dışına tıklanınca veya Esc ile kapanır.

import { AnimatePresence, motion } from "framer-motion";
import {
  Plus,
  RefreshCw,
  LayoutGrid,
  Minus,
  ChevronDown,
  ChevronRight,
  Settings,
  RefreshCcwDot,
  Info,
  Power,
  ExternalLink,
  Smartphone,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useUiStore } from "../../stores/uiStore";
import { useChatStore } from "../../stores/chatStore";
import { useAuthStore } from "../../stores/authStore";
import { performCheckAndDownload } from "../../hooks/useUpdater";
import { PhoneConnectPanel } from "./PhoneConnectPanel";
import { useT } from "../../i18n";

const appWindow = getCurrentWindow();
const WEBSITE = "https://axiom.quacomes.com";

export function TitleMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const setView = useUiStore((s) => s.setView);
  const setLaunchpadOpen = useUiStore((s) => s.setLaunchpadOpen);
  const setAboutOpen = useUiStore((s) => s.setAboutOpen);
  const openSettings = useUiStore((s) => s.openSettings);
  const loggedIn = useAuthStore((s) => !!s.user);
  const [sysOpen, setSysOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Menü açıkken bir sonraki tick'te dinle ki açan tıklama kapatmasın.
    const id = window.setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const newChat = () => {
    useChatStore.getState().newChat();
    setView("chat");
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.14, ease: "easeOut" }}
          className="absolute left-1.5 top-[38px] z-[9997] w-[240px] rounded-xl border border-border bg-surface-2 p-1.5 shadow-2xl"
          style={{ transformOrigin: "top left" }}
        >
          <MenuItem icon={Plus} label={t("menu.newChat")} kbd="Ctrl N" onClick={act(newChat)} />
          <MenuItem
            icon={RefreshCw}
            label={t("menu.refresh")}
            kbd="Ctrl R"
            onClick={act(() => window.location.reload())}
          />

          <MenuItem
            icon={LayoutGrid}
            label={t("menu.appGrid")}
            onClick={act(() => setLaunchpadOpen(true))}
          />
          <MenuItem
            icon={Minus}
            label={t("menu.minimizeTray")}
            onClick={act(() => void appWindow.hide())}
          />

          <div className="my-1 h-px bg-border" />

          <MenuItem
            icon={Smartphone}
            label={t("menu.connectPhone")}
            arrow={loggedIn}
            active={phoneOpen}
            disabled={!loggedIn}
            title={!loggedIn ? t("phoneConnect.needSignIn") : undefined}
            onClick={() => loggedIn && setPhoneOpen((v) => !v)}
          />

          {/* Sağa açılan QR flyout — menü açık kalır (bu div menü ref'i içinde). */}
          <AnimatePresence>
            {phoneOpen && loggedIn && (
              <motion.div
                initial={{ opacity: 0, x: -8 , y: 135, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, y: 135, scale: 1 }}
                exit={{ opacity: 0, x: -8 , y: 135, scale: 0.98 }}
                transition={{ duration: 0.14, ease: "easeOut" }}
                className="absolute left-full top-0 ml-2"
                style={{ transformOrigin: "left top" }}
              >
                <PhoneConnectPanel onClose={() => setPhoneOpen(false)} />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="my-1 h-px bg-border" />

          {/* Sistem — accordion */}
          <button
            onClick={() => setSysOpen((v) => !v)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.8214rem] text-text-secondary hover:bg-surface-1 hover:text-text"
          >
            <Settings size={16} strokeWidth={1.5} />
            <span>{t("menu.system")}</span>
            <ChevronDown
              size={15}
              className={`ml-auto transition-transform duration-200 ${sysOpen ? "rotate-180" : ""}`}
            />
          </button>
          <AnimatePresence initial={false}>
            {sysOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                <MenuItem
                  icon={RefreshCcwDot}
                  label={t("menu.checkUpdate")}
                  indent
                  onClick={act(() => void performCheckAndDownload())}
                />
                <MenuItem
                  icon={Settings}
                  label={t("menu.settings")}
                  indent
                  onClick={act(() => openSettings("general"))}
                />
                <MenuItem
                  icon={Info}
                  label={t("menu.about")}
                  indent
                  onClick={act(() => setAboutOpen(true))}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="my-1 h-px bg-border" />

          <MenuItem
            icon={Power}
            label={t("menu.close")}
            danger
            onClick={act(() => void appWindow.close())}
          />

          <div className="mt-1 flex items-center justify-center border-t border-border pt-2 pb-0.5">
            <button
              onClick={act(() => void openUrl(WEBSITE))}
              className="flex items-center gap-1.5 text-[12px] h-5 tracking-[0.14em] text-text-faint hover:text-text-secondary"
            >
              AXIOM <ExternalLink size={12} strokeWidth={1.6} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MenuItem({
  icon: Icon,
  label,
  kbd,
  onClick,
  danger,
  indent,
  arrow,
  active,
  disabled,
  title,
}: {
  icon: typeof Plus;
  label: string;
  kbd?: string;
  onClick: () => void;
  danger?: boolean;
  indent?: boolean;
  arrow?: boolean;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex w-full items-center gap-2.5 rounded-lg py-2 text-[0.8214rem] ${indent ? "pl-9 pr-2.5" : "px-2.5"
        } ${disabled
          ? "cursor-not-allowed text-text-faint/60"
          : danger
            ? "text-danger hover:bg-danger/10"
            : active
              ? "bg-base text-text"
              : "text-text-secondary hover:bg-base hover:text-text"
        }`}
    >
      <Icon size={16} strokeWidth={1.5} className="shrink-0" />
      <span>{label}</span>
      {kbd && <span className="ml-auto text-[0.7857rem] text-text-faint">{kbd}</span>}
      {arrow && (
        <ChevronRight
          size={16}
          strokeWidth={1.6}
          className={`ml-auto shrink-0 ${active ? "text-text" : "text-text-faint"}`}
        />
      )}
    </button>
  );
}
