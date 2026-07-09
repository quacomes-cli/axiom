// Sesli sohbet — tam ekran deneyim (Gemini Live tarzı, Faz 6 v2).
// Ekranın tamamı sesli moda döner: merkezde faza göre nefes alan orb,
// altında KULLANICININ CANLI (partial, düzeltmeli) transkripti, cevap
// üretilirken akan metin + cümle cümle doğal ses (Piper).

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Download, Loader2 } from "lucide-react";
import { useVoiceConversation } from "../../hooks/useVoiceConversation";
import { VoiceParticles } from "./VoiceParticles";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";

export function VoiceMode() {
  const t = useT();
  const open = useUiStore((s) => s.voiceModeOpen);
  const setOpen = useUiStore((s) => s.setVoiceModeOpen);
  const {
    phase,
    transcript,
    reply,
    error,
    piperReady,
    downloadingPct,
    start,
    stop,
    downloadPiper,
  } = useVoiceConversation();

  useEffect(() => {
    if (open) void start();
    else void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const phaseLabel =
    phase === "listening"
      ? t("voiceMode.listening")
      : phase === "hearing"
        ? t("voiceMode.hearing")
        : phase === "transcribing"
          ? t("voiceMode.transcribing")
          : phase === "responding"
            ? t("voiceMode.responding")
            : phase === "speaking"
              ? t("voiceMode.speaking")
              : phase === "error"
                ? t("voiceMode.error")
                : "";

  const showReply = (phase === "responding" || phase === "speaking") && reply;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-x-0 bottom-0 top-[40px] z-[9992] flex flex-col bg-base"
        >
          {/* Üst bar */}
          <div className="flex items-center justify-between px-5 py-3">
            <span className="text-[0.8571rem] font-medium tracking-wide text-text-faint">
              {t("voiceMode.title")}
            </span>
            <button
              onClick={() => setOpen(false)}
              title={t("voiceMode.close")}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-faint hover:bg-surface-2 hover:text-text-secondary"
            >
              <X size={17} strokeWidth={1.6} />
            </button>
          </div>

          {/* Merkez: parçacık görseli + durum */}
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8">
            <VoiceParticles phase={phase} />
            <p className="text-[0.9286rem] font-medium text-text-secondary">{phaseLabel}</p>

            {/* Canlı kullanıcı transkripti (partial — her snapshot'ta değişir) */}
            <AnimatePresence mode="wait">
              {transcript && !showReply && (
                <motion.p
                  key={transcript}
                  initial={{ opacity: 0.5 }}
                  animate={{ opacity: 1 }}
                  className="max-w-[560px] text-center text-lg leading-relaxed text-text"
                >
                  “{transcript}”
                </motion.p>
              )}
            </AnimatePresence>

            {/* Akan cevap */}
            {showReply && (
              <div className="max-h-[30vh] w-full max-w-[620px] overflow-y-auto text-center scrollbar-none">
                <p className="text-[0.9286rem] leading-relaxed text-text-secondary">
                  {reply.length > 600 ? `…${reply.slice(-600)}` : reply}
                </p>
              </div>
            )}

            {error && <p className="max-w-[480px] text-center text-[0.8571rem] text-danger">{error}</p>}
          </div>

          {/* Alt: Piper durumu */}
          <div className="flex items-center justify-center pb-6">
            {downloadingPct !== null ? (
              <span className="flex items-center gap-2 rounded-full border border-border px-3.5 py-1.5 text-[0.7857rem] text-text-secondary">
                <Loader2 size={12} className="animate-spin" />
                {t("voiceMode.downloadingVoice", { pct: downloadingPct })}
              </span>
            ) : !piperReady ? (
              <button
                onClick={() => void downloadPiper()}
                className="flex items-center gap-2 rounded-full border border-border-hover px-3.5 py-1.5 text-[0.7857rem] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text"
              >
                <Download size={12} strokeWidth={1.8} />
                {t("voiceMode.downloadVoice")}
              </button>
            ) : (
              <span className="text-[0.7143rem] text-text-faint">{t("voiceMode.hint")}</span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
