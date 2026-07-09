// Sesli sohbet — tam ekran deneyim (Gemini Live tarzı, Faz 6 v2).
// Ekranın tamamı sesli moda döner: merkezde faza göre nefes alan orb,
// altında KULLANICININ CANLI (partial, düzeltmeli) transkripti, cevap
// üretilirken akan metin + cümle cümle doğal ses (Piper).

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, X, Download, Loader2 } from "lucide-react";
import { useVoiceConversation, type VoicePhase } from "../../hooks/useVoiceConversation";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";

/** Merkez orb — faza göre nefes/renk. */
function Orb({ phase }: { phase: VoicePhase }) {
  const speaking = phase === "responding" || phase === "speaking";
  const hearing = phase === "hearing";
  const thinking = phase === "transcribing";

  return (
    <div className="relative flex h-44 w-44 items-center justify-center">
      {/* Dış halkalar */}
      {[0, 1].map((i) => (
        <motion.div
          key={i}
          className={`absolute inset-0 rounded-full ${
            hearing ? "bg-danger/15" : speaking ? "bg-success/12" : "bg-accent-muted"
          }`}
          animate={{ scale: [1, 1.35 + i * 0.2], opacity: [0.6, 0] }}
          transition={{
            duration: hearing ? 1.1 : 2.2,
            repeat: Infinity,
            delay: i * (hearing ? 0.35 : 0.7),
            ease: "easeOut",
          }}
        />
      ))}
      {/* Çekirdek */}
      <motion.div
        className={`flex h-28 w-28 items-center justify-center rounded-full border shadow-2xl ${
          hearing
            ? "border-danger/40 bg-danger/10"
            : speaking
              ? "border-success/40 bg-success/10"
              : "border-border-hover bg-surface-2"
        }`}
        animate={
          speaking
            ? { scale: [1, 1.06, 0.98, 1.08, 1] }
            : thinking
              ? { rotate: 360 }
              : { scale: [1, 1.04, 1] }
        }
        transition={
          speaking
            ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" }
            : thinking
              ? { duration: 1.6, repeat: Infinity, ease: "linear" }
              : { duration: 2.6, repeat: Infinity, ease: "easeInOut" }
        }
      >
        {speaking ? (
          <span className="flex h-8 items-end gap-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <motion.span
                key={i}
                className="w-1 rounded-full bg-success"
                animate={{ height: [8, 26, 12, 30, 8] }}
                transition={{ duration: 0.85, repeat: Infinity, delay: i * 0.1 }}
              />
            ))}
          </span>
        ) : thinking ? (
          <Loader2 size={30} className="animate-spin text-text-secondary" />
        ) : (
          <Mic
            size={32}
            strokeWidth={1.5}
            className={hearing ? "text-danger" : "text-text"}
          />
        )}
      </motion.div>
    </div>
  );
}

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

          {/* Merkez: orb + durum */}
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8">
            <Orb phase={phase} />
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
