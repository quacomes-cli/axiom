// Canlı sesli asistan döngüsü v2 (Gemini Live tarzı):
//   dinle (CANLI partial transkript ekranda, düzeltmeler dahil)
//   → segment biter → final transkript → send()
//   → cevap STREAM edilirken tamamlanan cümleler ANINDA seslendirilir
//     (Piper doğal ses — Rust kuyruk; yoksa SpeechSynthesis fallback)
//   → konuşma biter → tekrar dinle. Barge-in: speech-start → TTS kesilir.

import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ipc } from "../lib/ipc";
import { useChatStore } from "../stores/chatStore";
import { useSettingsStore } from "../stores/settingsStore";
import { sanitizeForSpeech } from "./useTTS";
import { getLocale } from "../i18n";

/** Uygulama diline uygun Edge neural sesi (duygulu, bulut). */
const EDGE_VOICES: Record<string, string> = {
  tr: "tr-TR-EmelNeural",
  en: "en-US-AriaNeural",
  es: "es-ES-ElviraNeural",
  de: "de-DE-KatjaNeural",
  fr: "fr-FR-DeniseNeural",
  pt: "pt-BR-FranciscaNeural",
  ru: "ru-RU-SvetlanaNeural",
  ja: "ja-JP-NanamiNeural",
  zh: "zh-CN-XiaoxiaoNeural",
};

function edgeVoiceForLocale(): string {
  return EDGE_VOICES[getLocale()] ?? EDGE_VOICES.en;
}

export type VoicePhase =
  | "idle"
  | "listening"
  | "hearing" // konuşma algılandı, partial yazım akıyor
  | "transcribing"
  | "responding" // model üretiyor (cümleler anlık okunuyor)
  | "speaking" // üretim bitti, kalan kuyruk okunuyor
  | "error";

interface VadPayload {
  sessionId: string;
  kind: "speech-start" | "segment-end";
}

/** Metinden tamamlanmış cümleleri ayırır; kalan (yarım) kısmı döner. */
function splitSentences(buf: string): { done: string[]; rest: string } {
  const re = /[^.!?…\n]*[.!?…]+[)\]"'”]*\s*|[^\n]*\n+/g;
  const done: string[] = [];
  let consumed = 0;
  for (const m of buf.matchAll(re)) {
    if (m.index !== consumed) break; // aradaki boşluk — dur
    done.push(m[0]);
    consumed += m[0].length;
  }
  return { done, rest: buf.slice(consumed) };
}

export interface UseVoiceConversation {
  phase: VoicePhase;
  /** Canlı (partial) veya kesinleşen kullanıcı sözü. */
  transcript: string;
  /** Modelin akan cevabı (tool blokları temizlenmiş). */
  reply: string;
  error: string | null;
  /** Piper doğal ses paketi durumu. */
  piperReady: boolean;
  downloadingPct: number | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  downloadPiper: () => Promise<void>;
}

export function useVoiceConversation(): UseVoiceConversation {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [piperReady, setPiperReady] = useState(false);
  const [downloadingPct, setDownloadingPct] = useState<number | null>(null);

  const activeRef = useRef(false);
  const sessionRef = useRef<string | null>(null);
  const phaseRef = useRef<VoicePhase>("idle");
  /** Rust TTS kullanılabilir mi (Piper yüklü VEYA Edge için çevrimiçi). */
  const rustTtsRef = useRef(false);
  const piperRef = useRef(false);
  /** SpeechSynthesis fallback'te kuyruktaki utterance sayısı. */
  const fallbackPendingRef = useRef(0);
  /** Model üretimi bitti mi (tts-idle geldiğinde dinlemeye dönme kararı için). */
  const generationDoneRef = useRef(true);

  const setPhaseBoth = (p: VoicePhase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  // ---- TTS (Piper öncelikli, SpeechSynthesis fallback) -----------------------

  const speakSentence = useCallback((raw: string) => {
    const text = sanitizeForSpeech(raw).trim();
    if (!text) return;

    const speakViaSynthesis = (t: string) => {
      const cfg = useSettingsStore.getState().settings?.tts;
      const u = new SpeechSynthesisUtterance(t);
      const voices = window.speechSynthesis.getVoices();
      const found = cfg?.voice ? voices.find((v) => v.name === cfg.voice) : undefined;
      const tr = voices.find((v) => v.lang.toLowerCase().startsWith("tr"));
      if (found ?? tr) u.voice = (found ?? tr)!;
      u.rate = Math.max(0.5, Math.min(2.0, cfg?.rate || 1.0));
      fallbackPendingRef.current += 1;
      const doneOne = () => {
        fallbackPendingRef.current -= 1;
        if (
          fallbackPendingRef.current <= 0 &&
          generationDoneRef.current &&
          activeRef.current &&
          phaseRef.current === "speaking"
        ) {
          void beginListening();
        }
      };
      u.onend = doneOne;
      u.onerror = doneOne;
      window.speechSynthesis.speak(u);
    };

    if (rustTtsRef.current) {
      // Edge (duygulu) → Piper zinciri Rust'ta; ikisi de düşerse tarayıcı sesi.
      const edge = navigator.onLine ? edgeVoiceForLocale() : undefined;
      void ipc.ttsSpeak(text, undefined, edge).catch((e) => {
        console.warn("[voice] rust tts başarısız, tarayıcı sesine düşülüyor:", e);
        rustTtsRef.current = false;
        speakViaSynthesis(text);
      });
    } else {
      speakViaSynthesis(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopTts = useCallback(() => {
    if (rustTtsRef.current) void ipc.ttsStop().catch(() => {});
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* yok say */
    }
    fallbackPendingRef.current = 0;
  }, []);

  // ---- Dinleme ---------------------------------------------------------------

  const beginListening = useCallback(async () => {
    if (!activeRef.current) return;
    const voice = useSettingsStore.getState().settings?.voice;
    const modelName = voice?.model ?? "base";
    try {
      const status = await ipc.audioModelStatus(modelName);
      if (!status.installed) {
        setError(`Whisper modeli (${modelName}) yüklü değil — Ayarlar → Ses`);
        setPhaseBoth("error");
        activeRef.current = false;
        return;
      }
      const sessionId = crypto.randomUUID();
      sessionRef.current = sessionId;
      await ipc.audioStartRecordingVad(sessionId);
      setTranscript("");
      setPhaseBoth("listening");
      void partialLoop(sessionId);
    } catch (e) {
      setError(String(e));
      setPhaseBoth("error");
      activeRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Canlı yazım: kayıt sürerken ardışık snapshot transkriptleri. */
  const partialLoop = useCallback(async (sessionId: string) => {
    const voice = useSettingsStore.getState().settings?.voice;
    const modelName = voice?.model ?? "base";
    const language =
      voice?.language && voice.language !== "auto" ? voice.language : undefined;

    while (activeRef.current && sessionRef.current === sessionId) {
      // Yalnızca konuşma varken çöz (boş odada CPU yakma).
      if (phaseRef.current === "hearing") {
        try {
          const text = await ipc.audioTranscribeSnapshot(sessionId, modelName, language);
          if (sessionRef.current === sessionId && text.trim()) {
            setTranscript(text.trim());
          }
        } catch {
          /* snapshot hatası önemsiz — bir sonraki turda tekrar */
        }
      }
      await new Promise((r) => setTimeout(r, 600));
    }
  }, []);

  // ---- Segment → cevap → konuşma ---------------------------------------------

  const handleSegmentEnd = useCallback(async () => {
    const sessionId = sessionRef.current;
    if (!sessionId || !activeRef.current) return;
    sessionRef.current = null;

    const voice = useSettingsStore.getState().settings?.voice;
    const modelName = voice?.model ?? "base";
    const language =
      voice?.language && voice.language !== "auto" ? voice.language : undefined;

    setPhaseBoth("transcribing");
    let text = "";
    try {
      const res = await ipc.audioStopAndTranscribe(sessionId, modelName, language);
      text = res.text.trim();
    } catch (e) {
      console.warn("[voice] transkripsiyon hatası:", e);
    }
    if (!activeRef.current) return;
    if (text.length < 2) {
      void beginListening();
      return;
    }

    setTranscript(text);
    setReply("");
    setPhaseBoth("responding");
    generationDoneRef.current = false;

    const chat = useChatStore.getState();
    if (!chat.activeChatId) chat.newChat();
    const chatId = useChatStore.getState().activeChatId;

    // STREAMING KONUŞMA: cevap büyürken tamamlanan cümleleri anında oku.
    let spokenUpTo = 0;
    let agentMsgId: string | null = null;
    const unsub = useChatStore.subscribe((s) => {
      const c = s.chats.find((cc) => cc.id === chatId);
      const last = c?.messages[c.messages.length - 1];
      if (!last || last.role !== "agent") return;
      if (agentMsgId && last.id !== agentMsgId) return;
      agentMsgId = last.id;

      const clean = sanitizeForSpeech(last.text);
      setReply(clean);
      const fresh = clean.slice(spokenUpTo);
      const { done } = splitSentences(fresh);
      for (const sentence of done) {
        speakSentence(sentence);
        spokenUpTo += sentence.length;
      }
    });

    try {
      await useChatStore.getState().send(text);
    } catch (e) {
      console.warn("[voice] send hatası:", e);
    } finally {
      unsub();
      generationDoneRef.current = true;
    }
    if (!activeRef.current) return;

    // Kalan yarım cümleyi de oku.
    const state = useChatStore.getState();
    const c = state.chats.find((cc) => cc.id === chatId);
    const last = c?.messages[c.messages.length - 1];
    if (last && last.role === "agent") {
      const clean = sanitizeForSpeech(last.text);
      setReply(clean);
      const tail = clean.slice(spokenUpTo).trim();
      if (tail) speakSentence(tail);
    }

    // Hâlâ konuşacak şey var mı? Varsa "speaking" — tts-idle dinlemeye döndürür.
    const busy = rustTtsRef.current
      ? await ipc.ttsIsBusy().catch(() => false)
      : fallbackPendingRef.current > 0;
    if (busy) {
      setPhaseBoth("speaking");
    } else {
      void beginListening();
    }
  }, [beginListening, speakSentence]);

  // ---- Event köprüleri ---------------------------------------------------------

  useEffect(() => {
    const unlistens: UnlistenFn[] = [];
    (async () => {
      unlistens.push(
        await listen<VadPayload>("voice-vad", (e) => {
          if (!activeRef.current) return;
          if (e.payload.sessionId !== sessionRef.current) return;
          if (e.payload.kind === "speech-start") {
            stopTts(); // barge-in
            setPhaseBoth("hearing");
          } else if (e.payload.kind === "segment-end") {
            void handleSegmentEnd();
          }
        }),
      );
      unlistens.push(
        await listen("tts-idle", () => {
          if (!activeRef.current) return;
          if (phaseRef.current === "speaking" && generationDoneRef.current) {
            void beginListening();
          }
        }),
      );
      unlistens.push(
        await listen<{ downloadedBytes: number; totalBytes: number; done: boolean }>(
          "tts-download-progress",
          (e) => {
            if (e.payload.done) {
              setDownloadingPct(null);
              setPiperReady(true);
              piperRef.current = true;
      rustTtsRef.current = true;
              rustTtsRef.current = true;
            } else if (e.payload.totalBytes > 0) {
              setDownloadingPct(
                Math.round((e.payload.downloadedBytes / e.payload.totalBytes) * 100),
              );
            }
          },
        ),
      );
    })();
    return () => {
      unlistens.forEach((u) => u());
    };
  }, [handleSegmentEnd, beginListening, stopTts]);

  // ---- Kontroller ---------------------------------------------------------------

  const start = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    setError(null);
    setTranscript("");
    setReply("");
    generationDoneRef.current = true;
    try {
      const st = await ipc.ttsStatus();
      const ready = st.piperInstalled && st.voiceInstalled;
      piperRef.current = ready;
      setPiperReady(ready);
      // Rust TTS: Piper yüklüyse VEYA Edge için çevrimiçiysek kullanılır.
      rustTtsRef.current = ready || navigator.onLine;
    } catch {
      piperRef.current = false;
      setPiperReady(false);
      rustTtsRef.current = navigator.onLine;
    }
    await beginListening();
  }, [beginListening]);

  const stop = useCallback(async () => {
    activeRef.current = false;
    stopTts();
    const sessionId = sessionRef.current;
    sessionRef.current = null;
    if (sessionId) {
      try {
        await ipc.audioCancelRecording(sessionId);
      } catch {
        /* yok say */
      }
    }
    setPhaseBoth("idle");
  }, [stopTts]);

  const downloadPiper = useCallback(async () => {
    setDownloadingPct(0);
    try {
      await ipc.ttsDownload();
      piperRef.current = true;
      setPiperReady(true);
    } catch (e) {
      setError(`Ses paketi indirilemedi: ${String(e)}`);
    } finally {
      setDownloadingPct(null);
    }
  }, []);

  useEffect(() => {
    return () => {
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { phase, transcript, reply, error, piperReady, downloadingPct, start, stop, downloadPiper };
}
