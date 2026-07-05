import { useEffect, useState } from "react";
import { Mic, MicOff, Loader2, Download } from "lucide-react";
import { useVoiceInput } from "../../hooks/useVoiceInput";
import { useT } from "../../i18n";

interface MicButtonProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

export function MicButton({ onTranscript, disabled }: MicButtonProps) {
  const t = useT();
  const { state, toggle, cancel } = useVoiceInput(onTranscript);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (state.kind !== "recording") {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - state.startedAt) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [state]);

  const baseCls =
    "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors";

  if (state.kind === "downloading") {
    return (
      <button
        type="button"
        disabled
        className={`${baseCls} bg-blue-500/15 text-blue-400 cursor-wait`}
        title={`Whisper modeli indiriliyor: ${Math.round(state.progress * 100)}%`}
      >
        <Download size={14} className="animate-pulse" />
        <span>{Math.round(state.progress * 100)}%</span>
      </button>
    );
  }

  if (state.kind === "transcribing") {
    return (
      <button
        type="button"
        disabled
        className={`${baseCls} bg-zinc-700/50 text-text-faint cursor-wait`}
        title={t("misc.micTranscribing")}
      >
        <Loader2 size={14} className="animate-spin" />
      </button>
    );
  }

  if (state.kind === "recording") {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          void toggle();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          void cancel();
        }}
        className={`${baseCls} bg-red-500/20 text-red-400 hover:bg-red-500/30 animate-pulse`}
        title={`Kaydediliyor… (${elapsed}s) — bitirmek için tıkla, iptal için sağ tıkla`}
      >
        <MicOff size={14} />
        <span className="tabular-nums">{elapsed}s</span>
      </button>
    );
  }

  if (state.kind === "error") {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          void toggle();
        }}
        disabled={disabled}
        className={`${baseCls} bg-red-500/10 text-red-400 hover:bg-red-500/20`}
        title={state.message}
      >
        <Mic size={14} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        void toggle();
      }}
      disabled={disabled}
      className={`${baseCls} text-text-faint hover:text-text hover:bg-zinc-800/60`}
      title={t("misc.micVoiceInput")}
    >
      <Mic size={14} />
    </button>
  );
}
