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
import { convertFileSrc } from "@tauri-apps/api/core";
import type { AlarmSoundConfig } from "../types";

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
  const { markExecuted, rescheduleNext, attachNotification, updateTask, moveTask } = useTaskStore.getState();
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

  // Pano görevlerinde (manuel todo) talimat = başlık + açıklama; agent
  // görevlerinde kullanıcının yazdığı actionMessage esastır.
  const goal =
    task.actionMessage?.trim() ||
    [task.title, task.description].filter((s) => s?.trim()).join("\n");

  // Persona + arka plan davranış talimatı — derin agent döngüsünün (agentLoop)
  // sistem promptunun başına eklenir. Araç şemaları/blok sözdizimi agentLoop'ta.
  const persona =
    (task.agentPrompt?.trim() ||
      "Sen Axiom uygulamasının zamanlanmış arka plan ajansısın. Verilen görevi kısa, doğrudan ve özet bir şekilde yerine getir. Türkçe yanıt ver.") +
    `\n\n# Arka plan görevi davranışı\n` +
    `Bu koşu arka planda zamanlanmış bir görevdir; karşında bir kullanıcı yok. ` +
    `Görevde "telegrama at", "mail at" gibi bir mecra geçiyorsa **mutlaka** ilgili app_tool'u (ör. telegram_send_message) çağırarak çıktıyı gönder. ` +
    `Sadece düz metin yanıt yetmez — tool çağrısını yap, ardından kısa onay yaz.`;

  console.log("[agent] deep-agent goal:", goal, "model:", active.id);

  let finalContent = "";
  try {
    // Derin agent döngüsü (Faz 5): planla → araç zinciri → sentez.
    // interactive:false — onay gerektiren araçlar sessizce reddedilir.
    const { runAgentDetached } = await import("../lib/agentLoop");
    finalContent = (await runAgentDetached(goal, { persona })).trim();

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

  if (task.actionType !== "agent") {
    // Pano görevi agent'a yaptırıldı → tamamlananlara taşı
    moveTask(task.id, "completed");
    console.log("[agent] board task completed:", task.id);
  } else if (task.recurring && task.recurring !== "once") {
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
