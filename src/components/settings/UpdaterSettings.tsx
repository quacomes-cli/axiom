// Güncelleme yönetim paneli.
//
// "Şimdi kontrol et" + indirme progress'i + restart butonu.
// İlk açılışta otomatik kontrol etmiyoruz — kullanıcı bilinçli tetiklesin
// (LSP'leri/dev'i bozacak otomatik prompt'ları sevmiyoruz).

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, CheckCircle2, RefreshCw, AlertCircle, Sparkles } from "lucide-react";
import { useUpdater } from "../../hooks/useUpdater";

const EASE = [0.32, 0.72, 0, 1] as const;

export function UpdaterSettings() {
  const { state, checkForUpdate, downloadAndInstall, restartNow } = useUpdater(); // , autoDownload, setAutoDownload

  useEffect(() => {
    // Sayfaya girince otomatik kontrol etme — kullanıcı butona bassın.
  }, []);

  const isChecking = state.status === "checking";
  const canCheck = state.status === "idle" || state.status === "none" || state.status === "error";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface-1 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-text">Sürüm</h3>
            <p className="mt-0.5 text-[0.8571rem] text-text-faint">
              Yüklü Axiom sürümü
            </p>
          </div>
          <motion.span
            key={state.currentVersion ?? "?"}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="rounded-md bg-surface-2 px-2 py-1 text-[0.8571rem] font-mono text-text-secondary"
          >
            v{state.currentVersion ?? "?"}
          </motion.span>
        </div>
      </div>

      {/* <div className="rounded-lg border border-border bg-surface-1 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-text">Otomatik indir</h3>
            <p className="mt-0.5 text-[0.8571rem] text-text-faint">
              Yeni sürüm bulunduğunda arka planda otomatik indirilsin, kenar çubuğunda "Yeniden başlat" butonu gösterilsin.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAutoDownload(!autoDownload)}
            className={`relative h-5.5 w-9 shrink-0 rounded-full transition-colors ${
              autoDownload ? "bg-blue-400" : "bg-surface-2"
            }`}
            aria-pressed={autoDownload}
          >
            <motion.span
              animate={{ x: autoDownload ? 16 : 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white"
            />
          </button>
        </div>
      </div> */}

      <div className="rounded-lg border border-border bg-surface-1 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-text">Güncellemeler</h3>
            <p className="mt-0.5 text-[0.8571rem] text-text-faint">
              Yeni sürüm var mı diye kontrol et
            </p>
          </div>

          <div className="relative">
            <AnimatePresence mode="wait" initial={false}>
              {canCheck && (
                <CheckButton
                  key="check"
                  onClick={checkForUpdate}
                />
              )}
              {isChecking && <CheckingChip key="checking" />}
            </AnimatePresence>
          </div>
        </div>

        {/* Sonuç paneli */}
        <AnimatePresence mode="wait" initial={false}>
          {state.status === "none" && (
            <ResultPanel key="none" tone="success">
              <CheckCircle2 size={13} strokeWidth={1.8} />
              <span>En güncel sürümdesin.</span>
            </ResultPanel>
          )}

          {state.status === "available" && (
            <motion.div
              key="available"
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.28, ease: EASE }}
              className="space-y-3 overflow-hidden rounded-md bg-accent/10 p-3"
            >
              <div className="flex items-center gap-2 text-[0.8571rem] text-text">
                <motion.span
                  animate={{ rotate: [0, -10, 10, -6, 6, 0], scale: [1, 1.15, 1] }}
                  transition={{ duration: 0.9, ease: EASE }}
                  className="inline-flex"
                >
                  <Sparkles size={13} strokeWidth={1.8} className="text-accent" />
                </motion.span>
                <span>
                  Yeni sürüm: <span className="font-mono font-medium">v{state.newVersion}</span>
                </span>
              </div>
              {state.notes && (
                <div className="max-h-40 overflow-y-auto rounded-md bg-surface-1 px-2.5 py-2 text-[0.7857rem] text-text-secondary">
                  <pre className="whitespace-pre-wrap font-sans">{state.notes}</pre>
                </div>
              )}
              <motion.button
                type="button"
                onClick={downloadAndInstall}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[0.8571rem] font-medium text-black hover:bg-accent/90"
              >
                <Download size={12} strokeWidth={1.8} />
                İndir ve kur
              </motion.button>
            </motion.div>
          )}

          {state.status === "downloading" && (
            <motion.div
              key="downloading"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="space-y-2 rounded-md bg-accent/10 p-3"
            >
              <div className="flex items-center justify-between text-[0.8571rem] text-text">
                <span className="flex items-center gap-1.5">
                  <motion.span
                    animate={{ y: [0, 3, 0] }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                    className="inline-flex"
                  >
                    <Download size={12} strokeWidth={1.8} className="text-accent" />
                  </motion.span>
                  İndiriliyor…
                </span>
                <motion.span
                  key={state.progress}
                  initial={{ y: -2, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.15 }}
                  className="font-mono text-text-secondary"
                >
                  {state.progress}%
                </motion.span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <motion.div
                  animate={{ width: `${state.progress}%` }}
                  transition={{ duration: 0.25, ease: EASE }}
                  className="h-full bg-accent"
                />
              </div>
            </motion.div>
          )}

          {state.status === "ready" && (
            <motion.div
              key="ready"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="space-y-2 rounded-md bg-green-500/10 p-3"
            >
              <div className="flex items-center gap-2 text-[0.8571rem] text-green-400">
                <motion.span
                  initial={{ scale: 0, rotate: -90 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 400, damping: 18, delay: 0.05 }}
                  className="inline-flex"
                >
                  <CheckCircle2 size={13} strokeWidth={1.8} />
                </motion.span>
                <span>Kurulum tamam. Uygulamayı yeniden başlat.</span>
              </div>
              <motion.button
                type="button"
                onClick={restartNow}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="flex items-center gap-1.5 rounded-md bg-green-500 px-3 py-1.5 text-[0.8571rem] font-medium text-white hover:bg-green-500/90"
              >
                Yeniden başlat
              </motion.button>
            </motion.div>
          )}

          {state.status === "error" && state.error && (
            <ResultPanel key="error" tone="error">
              <AlertCircle size={13} strokeWidth={1.8} className="mt-0.5 shrink-0" />
              <span>{state.error}</span>
            </ResultPanel>
          )}
        </AnimatePresence>
      </div>

      <div className="rounded-lg border border-border bg-surface-1 p-4 text-[0.7857rem] text-text-faint">
        <p>
          Güncellemeler GitHub Releases üzerinden imzalı manifest ile dağıtılır.
          İmza doğrulanamayan paketler kurulmaz.
        </p>
      </div>
    </div>
  );
}

interface CheckButtonProps {
  onClick: () => Promise<void> | void; // onClick artık asenkron da olabilir
}

function CheckButton({ onClick }: CheckButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    if (isLoading) return; // Zaten yükleniyorsa double click'e geçit yok
    
    setIsLoading(true);
    try {
      await onClick(); // Dışarıdan gelen fonksiyonu çalıştırıyoruz (API isteği vs.)
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false); // İşlem bitince durdur motoru
    }
  };

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className="group relative flex items-center gap-1.5 overflow-hidden rounded-full bg-surface-2 px-3 py-1.5 text-[0.8571rem] font-medium text-text disabled:opacity-70"
      disabled={isLoading} // Yüklenirken butonu kilitleyelim, bug olmasın
    >
      {/* Shimmer Efekti */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-white/20"
        initial={{ x: "-200%" }}
        animate={{ x: "400%" }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "linear", repeatDelay: 1.2 }}
      />
      
      {/* Fır fır dönen ikon alanı */}
      <motion.span
        className="relative inline-flex"
        animate={isLoading ? { rotate: 360 } : { rotate: 0 }}
        whileHover={!isLoading ? { rotate: 180 } : {}}
        transition={
          isLoading
            ? { repeat: Infinity, duration: 1, ease: "linear" } // Tıklanınca helikopter pervanesi modu
            : { duration: 0.6, ease: EASE } // Normal hover modu
        }
      >
        <RefreshCw size={12} strokeWidth={1.8} />
      </motion.span>
      
      <span className="relative text-text">
        {isLoading ? "Kontrol ediliyor..." : "Şimdi kontrol et"}
      </span>
    </motion.button>
  );
}

function CheckingChip() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.2, ease: EASE }}
      className="flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 text-[0.8571rem] text-text-faint"
    >
      <motion.span
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        className="inline-flex"
      >
        <RefreshCw size={12} strokeWidth={1.8} className="text-accent" />
      </motion.span>
      <motion.span
        animate={{ opacity: [1, 0.55, 1] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      >
        Kontrol ediliyor…
      </motion.span>
    </motion.div>
  );
}

function ResultPanel({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: React.ReactNode;
}) {
  const bg = tone === "success" ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22, ease: EASE }}
      className={`flex items-start gap-2 rounded-md px-3 py-2 text-[0.8571rem] ${bg}`}
      style={{
        display: "flex",
        flexDirection: "row",
        gap: 8,
        alignItems: "center",
        justifyContent: "flex-start"
      }}
    >
      {children}
    </motion.div>
  );
}
