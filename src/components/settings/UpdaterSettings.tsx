// Güncelleme yönetim paneli.
//
// Tek "morfik" buton mantığı:
//   idle/none/error  →  "Şimdi kontrol et"
//   checking         →  "Kontrol ediliyor…"
//   downloading      →  "%X indiriliyor…"
//   ready            →  "Yeniden başlat"
//   install_failed   →  "Elle indir" (release sayfasına yönlendirir)
//
// autoDownload açıksa arka plan tamamlar; kapalıysa kullanıcı bu butonla
// hem check hem download işlemini tek tıkla tetikler.

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, RefreshCw, AlertCircle, Sparkles, Download, Rocket, ExternalLink } from "lucide-react";
import { useUpdater } from "../../hooks/useUpdater";

const EASE = [0.32, 0.72, 0, 1] as const;

export function UpdaterSettings() {
  const {
    state,
    autoDownload,
    setAutoDownload,
    checkAndDownload,
    restartNow,
    openManual,
  } = useUpdater();

  useEffect(() => {
    // Sayfaya girince otomatik kontrol etme — kullanıcı butona bassın.
  }, []);

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

      <div className="rounded-lg border border-border bg-surface-1 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-text">Otomatik indir</h3>
            <p className="mt-0.5 text-[0.8571rem] text-text-faint">
              Yeni sürüm bulunduğunda arka planda sessizce indirilir; kenar çubuğunda "Yeniden başlat" butonu belirir.
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
      </div>

      <div className="rounded-lg border border-border bg-surface-1 p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-text">Güncellemeler</h3>
            <p className="mt-0.5 text-[0.8571rem] text-text-faint">
              {state.status === "ready"
                ? "Yeni sürüm indirildi. Yeniden başlatınca devreye girer."
                : state.status === "downloading"
                  ? "Yeni sürüm sessizce indiriliyor…"
                  : "Yeni sürüm var mı diye kontrol et"}
            </p>
          </div>

          <div className="relative shrink-0">
            <AnimatePresence mode="wait" initial={false}>
              <MorphButton
                key={state.status}
                status={state.status}
                progress={state.progress}
                onCheck={checkAndDownload}
                onRestart={restartNow}
                onManual={openManual}
              />
            </AnimatePresence>
          </div>
        </div>

        {/* Bilgi/hata paneli */}
        <AnimatePresence mode="wait" initial={false}>
          {state.status === "none" && (
            <ResultPanel key="none" tone="success">
              <CheckCircle2 size={16} strokeWidth={1.8} />
              <span>En güncel sürümdesin.</span>
            </ResultPanel>
          )}

          {(state.status === "downloading" || state.status === "ready") && state.newVersion && (
            <motion.div
              key="downloading-panel"
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
              {state.status === "downloading" && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[0.7857rem] text-text-secondary">
                    <span className="flex items-center gap-1.5">
                      <motion.span
                        animate={{ y: [0, 2, 0] }}
                        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                        className="inline-flex"
                      >
                        <Download size={11} strokeWidth={1.8} className="text-accent" />
                      </motion.span>
                      İndiriliyor
                    </span>
                    <motion.span
                      key={state.progress}
                      initial={{ y: -2, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.15 }}
                      className="font-mono"
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
                </div>
              )}
            </motion.div>
          )}

          {state.status === "install_failed" && (
            <motion.div
              key="install-failed"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="space-y-2 rounded-md bg-amber-500/10 p-3 text-amber-400"
            >
              <div className="flex items-start gap-2 text-[0.8571rem]">
                <AlertCircle size={16} strokeWidth={1.8} className="mt-0.5 shrink-0" />
                <span>{state.error ?? "Kurulum başarısız oldu."}</span>
              </div>
            </motion.div>
          )}

          {state.status === "error" && state.error && (
            <ResultPanel key="error" tone="error">
              <AlertCircle size={16} strokeWidth={1.8} className="mt-0.5 shrink-0" />
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

// Tek buton — status'a göre biçim/renk/işlev değiştirir.
function MorphButton({
  status,
  progress,
  onCheck,
  onRestart,
  onManual,
}: {
  status: string;
  progress: number;
  onCheck: () => void;
  onRestart: () => void;
  onManual: () => void;
}) {
  if (status === "checking") {
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

  if (status === "downloading" || status === "available") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.2, ease: EASE }}
        className="flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 text-[0.8571rem] text-text-faint"
      >
        <motion.span
          animate={{ y: [0, 2, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          className="inline-flex"
        >
          <Download size={12} strokeWidth={1.8} className="text-accent" />
        </motion.span>
        <span className="font-mono tabular-nums">{progress}%</span>
      </motion.div>
    );
  }

  if (status === "ready") {
    return (
      <motion.button
        type="button"
        onClick={onRestart}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className="group relative flex items-center gap-1.5 overflow-hidden rounded-full bg-green-500 px-3 py-1.5 text-[0.8571rem] font-medium text-white"
      >
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-white/25"
          initial={{ x: "-200%" }}
          animate={{ x: "400%" }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear", repeatDelay: 1 }}
        />
        <motion.span
          animate={{ rotate: [0, 8, -8, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          className="relative inline-flex"
        >
          <Rocket size={12} strokeWidth={1.8} />
        </motion.span>
        <span className="relative">Yeniden başlat</span>
      </motion.button>
    );
  }

  if (status === "install_failed") {
    return (
      <motion.button
        type="button"
        onClick={onManual}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className="flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1.5 text-[0.8571rem] font-medium text-black"
      >
        <ExternalLink size={12} strokeWidth={1.8} />
        Elle indir
      </motion.button>
    );
  }

  // idle / none / error → check button
  return (
    <motion.button
      type="button"
      onClick={onCheck}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className="group relative flex items-center gap-1.5 overflow-hidden rounded-full bg-accent px-3 py-1.5 text-[0.8571rem] font-medium text-black"
    >
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-white/20"
        initial={{ x: "-200%" }}
        animate={{ x: "400%" }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "linear", repeatDelay: 1.2 }}
      />
      <motion.span
        className="relative inline-flex"
        whileHover={{ rotate: 180 }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        <RefreshCw size={12} strokeWidth={1.8} />
      </motion.span>
      <span className="relative">Şimdi kontrol et</span>
    </motion.button>
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
    >
      {children}
    </motion.div>
  );
}
