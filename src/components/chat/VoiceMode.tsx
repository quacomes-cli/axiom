// Canlı sesli asistan overlay'i (Faz 6) — alt-orta kompakt kart.
// Dalga/nabız animasyonu faza göre değişir; canlı transkript gösterilir.
// Konuş → sustuğunda otomatik gönderilir → cevap sesli okunur → tekrar dinler.
// TTS çalarken konuşmaya başlarsan keser (barge-in).

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, X, Loader2, Volume2, Ear } from "lucide-react";
import { useVoiceConversation, type VoicePhase } from "../../hooks/useVoiceConversation";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";

function PhaseVisual({ phase }: { phase: VoicePhase }) {
  if (phase === "transcribing" || phase === "responding") {
    return <Loader2 size={22} className="animate-spin text-text-secondary" />;
  }
  if (phase === "speaking") {
    // Konuşan dalga barları
    return (
      <span className="flex h-6 items-end gap-[3px]">
        {[0, 1, 2, 3, 4].map((i) => (
          <motion.span
            key={i}
            className="w-[3px] rounded-full bg-success"
            animate={{ height: [6, 18, 8, 22, 6] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.12 }}
          />
        ))}
      </span>
    );
  }
  // listening / hearing — nabız halkası (hearing daha hızlı/canlı)
  const fast = phase === "hearing";
  return (
    <span className="relative flex h-8 w-8 items-center justify-center">
      <motion.span
        className={`absolute inset-0 rounded-full ${fast ? "bg-danger/25" : "bg-accent-muted"}`}
        animate={{ scale: [1, 1.6], opacity: [0.7, 0] }}
        transition={{ duration: fast ? 0.7 : 1.6, repeat: Infinity, ease: "easeOut" }}
      />
      <Mic size={17} strokeWidth={1.7} className={fast ? "text-danger" : "text-text"} />
    </span>
  );
}

export function VoiceMode() {
  const t = useT();
  const open = useUiStore((s) => s.voiceModeOpen);
  const setOpen = useUiStore((s) => s.setVoiceModeOpen);
  const { phase, lastTranscript, error, start, stop } = useVoiceConversation();

  // Overlay açılınca döngüyü başlat, kapanınca durdur.
  useEffect(() => {
    if (open) void start();
    else void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="fixed bottom-24 left-1/2 z-[9992] w-[340px] -translate-x-1/2 rounded-2xl border border-border bg-surface-2/95 p-3.5 shadow-2xl backdrop-blur-md"
        >
          <div className="flex items-center gap-3">
            <PhaseVisual phase={phase} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[0.8214rem] font-medium text-text">
                {phase === "speaking" ? (
                  <Volume2 size={13} className="text-success" />
                ) : (
                  <Ear size={13} className="text-text-faint" />
                )}
                {phaseLabel}
              </p>
              <p className="mt-0.5 truncate text-[0.75rem] text-text-faint">
                {error ?? (lastTranscript ? `"${lastTranscript}"` : t("voiceMode.hint"))}
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              title={t("voiceMode.close")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-faint hover:bg-surface-3 hover:text-text-secondary"
            >
              <X size={15} strokeWidth={1.6} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
