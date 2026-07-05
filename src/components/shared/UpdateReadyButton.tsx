// Sidebar'da kullanıcı kartının hemen üstüne yerleşen "yeniden başlat ve
// güncelle" butonu. Yalnızca status === "ready" iken görünür (yani indirme
// tamamlanmış, uygulama yeniden başlatılmayı bekliyor).
//
// Açık sidebar'da: ikon + metin + versiyon rozet.
// Kapalı sidebar'da: yalnızca ikon; üzerine küçük pulsing nokta.

import { motion, AnimatePresence } from "framer-motion";
import { ArrowUpCircle } from "lucide-react";
import { useUpdaterStore } from "../../stores/updaterStore";
import { performRestart } from "../../hooks/useUpdater";
import { useT } from "../../i18n";

export function UpdateReadyButton({ open }: { open: boolean }) {
  const t = useT();
  const status = useUpdaterStore((s) => s.status);
  const newVersion = useUpdaterStore((s) => s.newVersion);
  if (status !== "ready") return null;

  return (
    <motion.button
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.96 }}
      transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
      onClick={() => void performRestart()}
      title={open ? undefined : `${t("misc.updateRestart")}${newVersion ? ` (v${newVersion})` : ""}`}
      className="group relative flex items-center rounded-[10px] bg-accent/15 text-accent transition-colors duration-200 hover:bg-accent/25"
      style={{ height: 36 }}
    >
      <span
        className="relative flex shrink-0 items-center justify-center"
        style={{ width: 40, height: 36 }}
      >
        <ArrowUpCircle size={18} strokeWidth={1.6} />
        {!open && (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
        )}
      </span>
      <AnimatePresence>
        {open && (
          <motion.span
            initial={{ clipPath: "inset(0 100% 0 0)", opacity: 0 }}
            animate={{ clipPath: "inset(0 0% 0 0)", opacity: 1 }}
            exit={{ clipPath: "inset(0 100% 0 0)", opacity: 0 }}
            transition={{
              clipPath: { duration: 0.25, ease: [0.32, 0.72, 0, 1] },
              opacity: { duration: 0.2 },
            }}
            className="flex flex-1 items-center gap-1.5 whitespace-nowrap pr-2 text-[0.8571rem] font-medium"
          >
            <span>{t("misc.updateRestart")}</span>
            {newVersion && (
              <span className="ml-auto rounded bg-accent/20 px-1 py-0.5 font-mono text-[0.7143rem] text-accent">
                v{newVersion}
              </span>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
