// Canlı sesli asistan döngüsü (Faz 6):
//   dinle → (VAD segment-end) → transkript → chatStore.send → cevap bitince
//   TTS oku → tekrar dinle. Barge-in: TTS çalarken kullanıcı konuşmaya
//   başlarsa (speech-start) TTS anında susturulur.
//
// Kayıt/VAD Rust'ta (audio_start_recording_vad + "voice-vad" event'i);
// bu hook yalnızca durum makinesi + TTS orkestrasyonu.

import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ipc } from "../lib/ipc";
import { useChatStore } from "../stores/chatStore";
import { useSettingsStore } from "../stores/settingsStore";
import { sanitizeForSpeech } from "./useTTS";

export type VoicePhase =
  | "idle"
  | "listening" // mikrofon açık, konuşma bekleniyor
  | "hearing" // konuşma algılandı, sürüyor
  | "transcribing"
  | "responding" // model cevap üretiyor
  | "speaking" // TTS okuyor
  | "error";

interface VadPayload {
  sessionId: string;
  kind: "speech-start" | "segment-end";
}

export interface UseVoiceConversation {
  phase: VoicePhase;
  /** Son tanınan kullanıcı sözü (overlay'de gösterilir). */
  lastTranscript: string;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function useVoiceConversation(): UseVoiceConversation {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [lastTranscript, setLastTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Aktiflik/oturum ref'leri — event callback'leri güncel değeri görsün.
  const activeRef = useRef(false);
  const sessionRef = useRef<string | null>(null);
  const phaseRef = useRef<VoicePhase>("idle");
  const setPhaseBoth = (p: VoicePhase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const stopTts = () => {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* yok say */
    }
  };

  /** Yeni bir dinleme segmenti başlatır (model hazırsa). */
  const beginListening = useCallback(async () => {
    if (!activeRef.current) return;
    const voice = useSettingsStore.getState().settings?.voice;
    const modelName = voice?.model ?? "base";

    try {
      const status = await ipc.audioModelStatus(modelName);
      if (!status.installed) {
        // Sesli modda sessizce indirme başlatmak kafa karıştırır — hata göster.
        setError(`Whisper modeli (${modelName}) yüklü değil — Ayarlar → Ses`);
        setPhaseBoth("error");
        activeRef.current = false;
        return;
      }
      const sessionId = crypto.randomUUID();
      sessionRef.current = sessionId;
      await ipc.audioStartRecordingVad(sessionId);
      setPhaseBoth("listening");
    } catch (e) {
      setError(String(e));
      setPhaseBoth("error");
      activeRef.current = false;
    }
  }, []);

  /** Segment bitti: transkript → send → TTS → tekrar dinle. */
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
    // Boş/anlamsız segment → yeniden dinle.
    if (text.length < 2) {
      void beginListening();
      return;
    }

    setLastTranscript(text);
    setPhaseBoth("responding");

    const chat = useChatStore.getState();
    if (!chat.activeChatId) chat.newChat();
    try {
      await chat.send(text);
    } catch (e) {
      console.warn("[voice] send hatası:", e);
    }
    if (!activeRef.current) return;

    // Son agent cevabını TTS ile oku; bitince tekrar dinle.
    const state = useChatStore.getState();
    const active = state.chats.find((c) => c.id === state.activeChatId);
    const lastAgent = [...(active?.messages ?? [])]
      .reverse()
      .find((m) => m.role === "agent" && m.text.trim());
    const spoken = lastAgent ? sanitizeForSpeech(lastAgent.text) : "";

    if (!spoken) {
      void beginListening();
      return;
    }

    setPhaseBoth("speaking");
    const cfg = useSettingsStore.getState().settings?.tts;
    const utter = new SpeechSynthesisUtterance(spoken);
    const voices = window.speechSynthesis.getVoices();
    if (cfg?.voice) {
      const found = voices.find((v) => v.name === cfg.voice);
      if (found) utter.voice = found;
    } else {
      const tr = voices.find((v) => v.lang.toLowerCase().startsWith("tr"));
      if (tr) utter.voice = tr;
    }
    utter.rate = Math.max(0.5, Math.min(2.0, cfg?.rate || 1.0));

    // Barge-in: konuşma sırasında da mikrofon dinlemede kalır — speech-start
    // gelirse TTS kesilir (aşağıdaki event handler). Bu yüzden TTS başlarken
    // yeni bir VAD oturumu açıyoruz.
    utter.onend = () => {
      if (!activeRef.current) return;
      // TTS bitti; mikrofon zaten açık (barge-in oturumu) → dinlemeye dön.
      if (phaseRef.current === "speaking") setPhaseBoth("listening");
    };
    utter.onerror = utter.onend;
    stopTts();
    window.speechSynthesis.speak(utter);

    // TTS sürerken barge-in için dinlemeyi hemen başlat.
    void beginListening().then(() => {
      // beginListening fazı "listening" yapar; TTS hâlâ çalıyorsa "speaking"e çek.
      if (activeRef.current && window.speechSynthesis.speaking) {
        setPhaseBoth("speaking");
      }
    });
  }, [beginListening]);

  // VAD event köprüsü.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    (async () => {
      unlisten = await listen<VadPayload>("voice-vad", (e) => {
        if (!activeRef.current) return;
        if (e.payload.sessionId !== sessionRef.current) return;
        if (e.payload.kind === "speech-start") {
          // Barge-in: kullanıcı konuşmaya başladı — TTS'i sustur.
          stopTts();
          setPhaseBoth("hearing");
        } else if (e.payload.kind === "segment-end") {
          void handleSegmentEnd();
        }
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [handleSegmentEnd]);

  const start = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    setError(null);
    setLastTranscript("");
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
  }, []);

  // Unmount'ta temizle.
  useEffect(() => {
    return () => {
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { phase, lastTranscript, error, start, stop };
}
