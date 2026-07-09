// Hakkında kutusu — uygulama adı, sürüm ve web sitesi bağlantısı.

import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";

const WEBSITE = "https://axiom.quacomes.com";

export function AboutDialog() {
  const t = useT();
  const open = useUiStore((s) => s.aboutOpen);
  const setOpen = useUiStore((s) => s.setAboutOpen);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!open || version) return;
    void (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        setVersion(await getVersion());
      } catch {
        /* ignore */
      }
    })();
  }, [open, version]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={() => setOpen(false)}
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2.5px)" }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-[320px] rounded-2xl border border-border bg-surface-2 p-6 text-center shadow-2xl"
      >
        <button
          onClick={() => setOpen(false)}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-text-faint hover:bg-surface-3 hover:text-text-secondary"
        >
          <X size={15} strokeWidth={1.6} />
        </button>

        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface-3">
          <span className="text-2xl font-semibold tracking-widest text-text">A</span>
        </div>

        <p className="text-lg font-medium tracking-[0.2em] text-text">AXIOM</p>
        <p className="mt-1 text-[0.8571rem] text-text-faint">{t("menu.aboutTagline")}</p>

        <div className="mt-5 space-y-1 border-t border-border pt-4 text-[0.8571rem]">
          <div className="flex justify-between">
            <span className="text-text-faint">{t("menu.aboutVersion")}</span>
            <span className="font-mono text-text-secondary">{version ?? "…"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-faint">{t("menu.aboutWebsite")}</span>
            <button
              onClick={() => void openUrl(WEBSITE)}
              className="font-mono text-accent hover:underline"
            >
              axiom.quacomes.com
            </button>
          </div>
          <div className="flex justify-between">
            <span className="text-text-faint">{t("menu.aboutLogs")}</span>
            <button
              onClick={() => {
                // Crash/hata günlükleri klasörünü dosya yöneticisinde aç.
                void import("../../lib/ipc")
                  .then(({ ipc }) => ipc.logsDir())
                  .then((dir) => import("@tauri-apps/plugin-opener").then((m) => m.openPath(dir)))
                  .catch(() => {});
              }}
              className="font-mono text-accent hover:underline"
            >
              {t("menu.aboutOpenLogs")}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
