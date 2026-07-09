import { useCallback, useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";

/**
 * Markdown ve teknik gürültüyü TTS için temizler:
 * - Kod bloklarını "kod bloğu" sözel ipucu ile değiştir
 * - Backtick, asterisk, underscore, header sembolleri kaldır
 * - URL'leri kısalt
 * - Tool blokları tamamen at
 */
export function sanitizeForSpeech(text: string): string {
  return text
    .replace(/```tool:[a-z_]+\n[\s\S]*?(```|$)/g, "")
    .replace(/```[a-z]*\n[\s\S]*?```/g, " kod bloğu ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " bağlantı ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Process-global tracking — yalnızca bir konuşma aynı anda aktif olsun. */
let currentSpeakingId: string | null = null;
const idChangeListeners = new Set<(id: string | null) => void>();

function setCurrentSpeakingId(id: string | null) {
  currentSpeakingId = id;
  for (const fn of idChangeListeners) fn(id);
}

export interface UseTTS {
  voices: SpeechSynthesisVoice[];
  speakingId: string | null;
  /** `id` benzersiz olmalı (genelde mesaj id'si). Aynı id ikinci kez verilirse durdurur. */
  speak: (id: string, text: string) => void;
  stop: () => void;
  supported: boolean;
}

export function useTTS(): UseTTS {
  const settings = useSettingsStore((s) => s.settings);
  const cfg = settings?.tts;

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speakingId, setSpeakingId] = useState<string | null>(currentSpeakingId);

  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (!supported) return;
    function refresh() {
      setVoices(window.speechSynthesis.getVoices());
    }
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, [supported]);

  useEffect(() => {
    const fn = (id: string | null) => setSpeakingId(id);
    idChangeListeners.add(fn);
    return () => { idChangeListeners.delete(fn); };
  }, []);

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setCurrentSpeakingId(null);
  }, [supported]);

  const speak = useCallback(
    (id: string, text: string) => {
      if (!supported || !cfg?.enabled) return;
      // Toggle: aynı id zaten konuşuyorsa durdur.
      if (currentSpeakingId === id) {
        stop();
        return;
      }
      window.speechSynthesis.cancel();
      const cleaned = sanitizeForSpeech(text);
      if (!cleaned) return;

      const utter = new SpeechSynthesisUtterance(cleaned);
      const allVoices = window.speechSynthesis.getVoices();
      if (cfg.voice) {
        const found = allVoices.find((v) => v.name === cfg.voice);
        if (found) utter.voice = found;
      } else {
        // Tercih sırası: tr-TR > tr-* > sistem default
        const tr = allVoices.find((v) => v.lang.toLowerCase().startsWith("tr"));
        if (tr) utter.voice = tr;
      }
      utter.rate = Math.max(0.5, Math.min(2.0, cfg.rate || 1.0));
      utter.onend = () => {
        if (currentSpeakingId === id) setCurrentSpeakingId(null);
      };
      utter.onerror = () => {
        if (currentSpeakingId === id) setCurrentSpeakingId(null);
      };
      setCurrentSpeakingId(id);
      window.speechSynthesis.speak(utter);
    },
    [supported, cfg?.enabled, cfg?.voice, cfg?.rate, stop],
  );

  return { voices, speakingId, speak, stop, supported };
}

/** Hook'suz, doğrudan çağırılabilir çağrı — chatStore.send sonunda kullanılır. */
export function speakOnce(text: string, cfg: { voice: string; rate: number }) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const cleaned = sanitizeForSpeech(text);
  if (!cleaned) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(cleaned);
  const allVoices = window.speechSynthesis.getVoices();
  if (cfg.voice) {
    const f = allVoices.find((v) => v.name === cfg.voice);
    if (f) utter.voice = f;
  } else {
    const tr = allVoices.find((v) => v.lang.toLowerCase().startsWith("tr"));
    if (tr) utter.voice = tr;
  }
  utter.rate = Math.max(0.5, Math.min(2.0, cfg.rate || 1.0));
  window.speechSynthesis.speak(utter);
}
