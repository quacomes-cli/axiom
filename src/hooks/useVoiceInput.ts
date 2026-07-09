import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ipc } from "../lib/ipc";
import { useSettingsStore } from "../stores/settingsStore";
import type { AudioDownloadEvent } from "../types";

export type VoiceState =
  | { kind: "idle" }
  | { kind: "downloading"; progress: number; modelName: string }
  | { kind: "recording"; startedAt: number }
  | { kind: "transcribing" }
  | { kind: "error"; message: string };

export interface UseVoiceInput {
  state: VoiceState;
  toggle: () => Promise<void>;
  cancel: () => Promise<void>;
}

/**
 * Microphone capture + local whisper transcription bridge.
 * `onTranscript` fires with the recognized text once transcription completes.
 */
export function useVoiceInput(onTranscript: (text: string) => void): UseVoiceInput {
  const [state, setState] = useState<VoiceState>({ kind: "idle" });
  const sessionRef = useRef<string | null>(null);
  const settings = useSettingsStore((s) => s.settings);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // Listen for model download progress events.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    (async () => {
      unlisten = await listen<AudioDownloadEvent>("audio-download-progress", (e) => {
        const { downloadedBytes, totalBytes, done, error, modelName } = e.payload;
        if (error) {
          setState({ kind: "error", message: error });
          return;
        }
        if (done) {
          setState({ kind: "idle" });
          return;
        }
        const progress = totalBytes > 0 ? downloadedBytes / totalBytes : 0;
        setState({ kind: "downloading", progress, modelName });
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const startRecording = useCallback(async () => {
    const voice = settings?.voice;
    const modelName = voice?.model ?? "base";
    const language = voice?.language && voice.language !== "auto" ? voice.language : undefined;

    // Ensure model exists; download if missing.
    try {
      const status = await ipc.audioModelStatus(modelName);
      if (!status.installed) {
        setState({ kind: "downloading", progress: 0, modelName });
        await ipc.audioDownloadModel(modelName);
      }
    } catch (e) {
      setState({ kind: "error", message: `Model indirilemedi: ${String(e)}` });
      return;
    }

    const sessionId = crypto.randomUUID();
    sessionRef.current = sessionId;
    try {
      await ipc.audioStartRecording(sessionId);
      setState({ kind: "recording", startedAt: Date.now() });
    } catch (e) {
      sessionRef.current = null;
      setState({ kind: "error", message: `Mikrofon başlatılamadı: ${String(e)}` });
    }

    // Stash language for stop step.
    (sessionRef as React.MutableRefObject<string | null> & { lang?: string }).lang = language;
  }, [settings?.voice]);

  const stopAndTranscribe = useCallback(async () => {
    const sessionId = sessionRef.current;
    if (!sessionId) return;
    const modelName = settings?.voice?.model ?? "base";
    const language = (sessionRef as React.MutableRefObject<string | null> & { lang?: string }).lang;

    setState({ kind: "transcribing" });
    sessionRef.current = null;
    try {
      const res = await ipc.audioStopAndTranscribe(sessionId, modelName, language);
      const text = res.text.trim();
      if (text.length > 0) {
        onTranscriptRef.current(text);
      }
      setState({ kind: "idle" });
    } catch (e) {
      setState({ kind: "error", message: `Transkripsiyon başarısız: ${String(e)}` });
    }
  }, [settings?.voice]);

  const toggle = useCallback(async () => {
    if (state.kind === "recording") {
      await stopAndTranscribe();
    } else if (state.kind === "idle" || state.kind === "error") {
      await startRecording();
    }
  }, [state.kind, startRecording, stopAndTranscribe]);

  const cancel = useCallback(async () => {
    const sessionId = sessionRef.current;
    if (sessionId) {
      try {
        await ipc.audioCancelRecording(sessionId);
      } catch {
        /* ignore */
      }
      sessionRef.current = null;
    }
    setState({ kind: "idle" });
  }, []);

  return { state, toggle, cancel };
}
