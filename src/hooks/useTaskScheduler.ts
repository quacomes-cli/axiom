import { useEffect, useRef } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useTaskStore, type Task } from "../stores/taskStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useModelStore } from "../stores/modelStore";
import { useNotificationStore } from "../stores/notificationStore";
import {
  TOOL_SYSTEM_PROMPT,
  parseToolBlocks,
  executeToolBlock,
  buildToolResultText,
  modelSupportsTools,
  buildEnabledAppsPrompt,
} from "../stores/chatStore";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ipc } from "../lib/ipc";
import { buildNativeTools } from "../lib/toolRegistry";
import type { AlarmSoundConfig, ChatMessage as IpcChatMessage } from "../types";

let notifReady: boolean | null = null;

async function ensureNotifPermission(): Promise<boolean> {
  if (notifReady === true) return true;
  let granted = await isPermissionGranted();
  if (!granted) {
    const result = await requestPermission();
    granted = result === "granted";
  }
  notifReady = granted;
  return granted;
}

function playDefaultBeep(durationMs: number) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.3;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    let on = true;
    const toggle = setInterval(() => {
      on = !on;
      gain.gain.value = on ? 0.3 : 0;
    }, 400);

    setTimeout(() => {
      clearInterval(toggle);
      osc.stop();
      ctx.close();
    }, durationMs);
  } catch { /* AudioContext not available */ }
}

// Ses dosyasını base64 data URL olarak IPC'den GEÇİRME. 70MB'lık bir wav,
// base64 + JSON + IPC katmanlarında her süreçte yüzlerce MB kopya üretir
// (axiom.exe + WebView2 browser/network süreçleri şişer). Asset protokolü
// dosyayı range-request'lerle diskten stream eder — bellek maliyeti ~0.
function alarmAudioUrl(config: AlarmSoundConfig): string | null {
  if (config.source === "default" || !config.cachedPath) return null;
  try {
    return convertFileSrc(config.cachedPath);
  } catch {
    return null;
  }
}

function playAudioFromUrl(url: string, durationMs: number) {
  const audio = new Audio(url);
  audio.volume = 1;
  audio.play().catch(() => playDefaultBeep(durationMs));
  setTimeout(() => {
    audio.pause();
    audio.currentTime = 0;
    // Medya kaynağını bırak — decode buffer'ları bekletilmesin
    audio.src = "";
    audio.load();
  }, durationMs);
}

async function playAlarmSound(config: AlarmSoundConfig) {
  const duration = Math.max(1, Math.min(60, config.duration)) * 1000;

  if (config.source === "default") {
    playDefaultBeep(duration);
    return;
  }

  const url = alarmAudioUrl(config);
  if (url) {
    playAudioFromUrl(url, duration);
  } else {
    playDefaultBeep(duration);
  }
}

async function executeScheduledTask(taskId: string, title: string, message?: string) {
  const { markExecuted } = useTaskStore.getState();
  markExecuted(taskId);

  const alarmSound = useSettingsStore.getState().settings?.alarmSound;
  if (alarmSound) {
    await playAlarmSound(alarmSound);
  }

  if (await ensureNotifPermission()) {
    sendNotification({
      title: `Axiom — ${title}`,
      body: message || title,
    });
  }
}

/** Aynı agent görevinin manuel + zamanlı tetiklenmesini engellemek için ortak set. */
const agentInflight = new Set<string>();

/**
 * Otonom agent görevi: kullanıcının tanımladığı bir prompt'la modeli arka
 * planda çalıştırır, çıktıyı NotificationStore'a yazar ve OS bildirim atar.
 * Recurring görevlerde tamamlandıktan sonra bir sonraki zamana yeniden zamanlanır.
 * Manuel "Şimdi Çalıştır" için de dışa açıktır.
 */
export async function runAgentTaskNow(taskId: string): Promise<void> {
  const task = useTaskStore.getState().tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (agentInflight.has(taskId)) return;
  agentInflight.add(taskId);
  try {
    await executeAgentTask(task);
  } finally {
    agentInflight.delete(taskId);
  }
}

async function executeAgentTask(task: Task) {
  console.log("[agent] executing task:", task.id, task.title);
  const { markExecuted, rescheduleNext, attachNotification, updateTask } = useTaskStore.getState();
  const addNotification = useNotificationStore.getState().add;
  const active = useModelStore.getState().models.find((m) => m.isActive);

  if (!active) {
    const id = addNotification({
      taskId: task.id,
      title: task.title,
      content: "Aktif model yok — agent görevi çalıştırılamadı. Bir model seç.",
      isError: true,
    });
    attachNotification(task.id, id);
    updateTask(task.id, { status: "failed" });
    return;
  }

  const persona =
    task.agentPrompt?.trim() ||
    "Sen Axiom uygulamasının zamanlanmış arka plan ajansısın. Verilen görevi kısa, doğrudan ve özet bir şekilde yerine getir. Türkçe yanıt ver.";
  const userMsg = task.actionMessage?.trim() || task.title;
  const hasTools = modelSupportsTools(active);

  // System prompt'u: persona + built-in tool tarifi + etkin uygulama tool'ları
  // (telegram_send_message, gmail_*, spotify_* vb.). Bunlar olmadan agent
  // mesajda "telegrama at" yazsa bile aracı bilmediği için sadece metin üretir.
  let systemPrompt = persona;
  if (hasTools) {
    systemPrompt += `\n\n${TOOL_SYSTEM_PROMPT}`;
    const appsPrompt = buildEnabledAppsPrompt();
    if (appsPrompt) systemPrompt += `\n\n${appsPrompt}`;
    systemPrompt +=
      `\n\n# Arka plan görevi davranışı\n` +
      `Bu konuşma arka planda zamanlanmış bir görevdir; karşında bir kullanıcı yok. ` +
      `Görevde "telegrama at", "mail at" gibi bir mecra geçiyorsa **mutlaka** ilgili app_tool'u (ör. telegram_send_message) çağırarak çıktıyı gönder. ` +
      `Sadece düz metin yanıt yetmez — tool çağrısını yap, ardından kısa onay yaz.`;
  }
  console.log("[agent] persona:", persona);
  console.log("[agent] userMsg:", userMsg);
  console.log("[agent] hasTools:", hasTools, "model:", active.id);

  // Tool loop — sohbet akışına benzer küçük bir döngü. Maks 6 adım.
  const MAX_STEPS = 6;
  const history: IpcChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMsg },
  ];

  let finalContent = "";
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const resp = await ipc.modelsChat({
        modelId: active.id,
        provider: active.provider,
        messages: history,
        temperature: 0.5,
        maxTokens: 2048,
        tools: hasTools ? buildNativeTools(active) : undefined,
      });
      const out = resp.content.trim();
      console.log(`[agent] step ${step} model output:`, out.slice(0, 400));
      history.push({ role: "assistant", content: out });

      // Tool yoksa / model tool desteklemiyorsa → biter.
      if (!hasTools) {
        finalContent = out;
        break;
      }
      const blocks = parseToolBlocks(out);
      console.log(`[agent] step ${step} parsed tool blocks:`, blocks.length, blocks.map((b) => b.kind));
      if (blocks.length === 0) {
        finalContent = out;
        break;
      }

      // Tool'ları sırayla yürüt. Arka plan bağlamı: onay gerektiren izinler
      // sorulmaz, otomatik reddedilir (kullanıcı başında değil).
      const actions = [];
      for (const b of blocks) {
        actions.push(await executeToolBlock(b, { interactive: false }));
      }
      const resultText = buildToolResultText(actions);
      console.log(`[agent] step ${step} tool results:`, resultText.slice(0, 400));
      history.push({ role: "user", content: `[Araç çıktıları]\n${resultText}` });

      // Son adımda hala tool döndürdüyse, sonucu birikmiş çıktıyla bırak.
      if (step === MAX_STEPS - 1) {
        finalContent = out + "\n\n" + resultText;
      }
    }

    if (!finalContent) finalContent = "Agent görevi tamamlandı.";

    const notifId = addNotification({
      taskId: task.id,
      title: task.title,
      content: finalContent,
    });
    attachNotification(task.id, notifId);

    if (await ensureNotifPermission()) {
      sendNotification({
        title: `Axiom — ${task.title}`,
        body: finalContent.slice(0, 200),
      });
    }
  } catch (e) {
    const notifId = addNotification({
      taskId: task.id,
      title: task.title,
      content: `Agent görevi başarısız: ${String(e)}`,
      isError: true,
    });
    attachNotification(task.id, notifId);
    updateTask(task.id, { status: "failed" });
    return;
  }

  if (task.recurring && task.recurring !== "once") {
    rescheduleNext(task.id);
    console.log("[agent] rescheduled:", task.id, task.recurring);
  } else {
    markExecuted(task.id);
    console.log("[agent] completed (once):", task.id);
  }
}

export function useTaskScheduler() {
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      const now = Date.now();
      const tasks = useTaskStore.getState().tasks;

      for (const task of tasks) {
        if (
          task.scheduledAt &&
          task.status === "running" &&
          !task.executedAt &&
          task.scheduledAt <= now
        ) {
          if (task.actionType === "agent") {
            if (agentInflight.has(task.id)) continue;
            console.log("[scheduler] tick → agent task due:", task.id, task.title);
            agentInflight.add(task.id);
            void executeAgentTask(task).finally(() => agentInflight.delete(task.id));
          } else {
            executeScheduledTask(task.id, task.title, task.actionMessage);
          }
        }
      }
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, []);
}
