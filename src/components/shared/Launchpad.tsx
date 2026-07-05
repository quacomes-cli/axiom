// Uygulama Izgarası (launchpad) — tüm sayfaları büyük ikon ızgarası olarak
// gösteren tam ekran overlay. Bir kutuya tıklayınca o görünüme geçer.

import { AnimatePresence, motion } from "framer-motion";
import {
  MessageCircle,
  Box,
  LayoutGrid,
  Sparkles,
  Send,
  TrendingDown,
  SquareCheckBig,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useEffect } from "react";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import type { ViewId } from "../../types";

const TILES: { id: ViewId; labelKey: string; icon: LucideIcon }[] = [
  { id: "chat", labelKey: "nav.chat", icon: MessageCircle },
  { id: "models", labelKey: "nav.models", icon: Box },
  { id: "apps", labelKey: "nav.apps", icon: LayoutGrid },
  { id: "skills", labelKey: "nav.skills", icon: Sparkles },
  { id: "telegram", labelKey: "nav.telegram", icon: Send },
  { id: "price-tracker", labelKey: "nav.priceTracker", icon: TrendingDown },
  { id: "tasks", labelKey: "nav.tasks", icon: SquareCheckBig },
  { id: "settings", labelKey: "menu.settings", icon: Settings },
];

export function Launchpad() {
  const t = useT();
  const open = useUiStore((s) => s.launchpadOpen);
  const setOpen = useUiStore((s) => s.setLaunchpadOpen);
  const setView = useUiStore((s) => s.setView);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const go = (id: ViewId) => {
    setView(id);
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[9998] flex flex-col items-center justify-center"
          style={{ backdropFilter: "blur(18px)", background: "rgba(0,0,0,0.35)" }}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col items-center"
          >
            <p className="mb-1 text-lg font-medium text-text">{t("menu.launchpadTitle")}</p>
            <p className="mb-8 text-[0.8571rem] text-text-faint">{t("menu.launchpadHint")}</p>

            <div className="grid grid-cols-4 gap-6">
              {TILES.map(({ id, labelKey, icon: Icon }, i) => (
                <motion.button
                  key={id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.03 * i, type: "spring", stiffness: 400, damping: 26 }}
                  onClick={() => go(id)}
                  className="group flex w-[104px] flex-col items-center gap-2.5"
                >
                  <div className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl border border-border bg-surface-2 text-text-secondary transition-all duration-150 group-hover:scale-105 group-hover:border-border-hover group-hover:bg-surface-3 group-hover:text-text">
                    <Icon size={28} strokeWidth={1.4} />
                  </div>
                  <span className="text-center text-[0.8214rem] text-text-faint transition-colors group-hover:text-text-secondary">
                    {t(labelKey)}
                  </span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
