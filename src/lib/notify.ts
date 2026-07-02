import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useSettingsStore } from "../stores/settingsStore";

let permissionReady: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  if (permissionReady === true) return true;
  let granted = await isPermissionGranted();
  if (!granted) {
    const result = await requestPermission();
    granted = result === "granted";
  }
  permissionReady = granted;
  return granted;
}

export async function notifyModelDownloaded(modelName: string) {
  if (document.hasFocus()) return;
  const settings = useSettingsStore.getState().settings;
  if (!settings?.notifyModelDownload) return;
  if (!(await ensurePermission())) return;
  sendNotification({
    title: "Model İndirildi",
    body: `${modelName} başarıyla indirildi.`,
  });
}

export async function notifyUpdateReady(version: string | null) {
  if (!(await ensurePermission())) return;
  sendNotification({
    title: "Axiom güncellendi",
    body: version
      ? `v${version} indirildi. Yeniden başlatınca devreye girer.`
      : "Yeni sürüm indirildi. Yeniden başlatınca devreye girer.",
  });
}

export async function notifyResponseComplete(preview?: string) {
  if (document.hasFocus()) return;
  const settings = useSettingsStore.getState().settings;
  if (!settings?.notifyResponse) return;
  if (!(await ensurePermission())) return;
  const body = preview
    ? preview.length > 100
      ? preview.slice(0, 100) + "…"
      : preview
    : "Yanıt hazır.";
  sendNotification({ title: "Axiom", body });
}
