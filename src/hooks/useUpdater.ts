// Tauri updater wrapper — UI tarafı.
//
// Akış:
//  1) checkForUpdate() — manifest endpoint'ini sorgular. Update varsa
//     status "available" olur, pendingUpdate modül scope'unda tutulur.
//  2) downloadAndInstall(onProgress?) — Update objesinin metodu; indirir,
//     imzayı doğrular, kurar. Bittiğinde status "ready" olur.
//  3) restartNow() — relaunch().
//
// pendingUpdate Tauri Update instance'ı; serileştirilemez, store dışı.
// Hem useUpdater (Settings UI) hem useBackgroundUpdater (App-wide poll) aynı
// modül singleton'unu kullanır → state çift kayıt olmaz.

import { useCallback, useEffect } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useUpdaterStore } from "../stores/updaterStore";

let pendingUpdate: Update | null = null;

export function getPendingUpdate(): Update | null {
  return pendingUpdate;
}

export async function loadCurrentVersion(): Promise<string | null> {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    const v = await getVersion();
    useUpdaterStore.getState().setCurrentVersion(v);
    return v;
  } catch {
    return null;
  }
}

export async function performCheck(): Promise<boolean> {
  const s = useUpdaterStore.getState();
  s.setStatus("checking");
  s.setError(null);
  try {
    const update = await check();
    if (!update) {
      useUpdaterStore.getState().setStatus("none");
      return false;
    }
    pendingUpdate = update;
    useUpdaterStore.getState().setIncoming(update.version, update.body ?? null);
    return true;
  } catch (e) {
    useUpdaterStore.getState().setError(friendlyError(e));
    return false;
  }
}

export async function performDownloadAndInstall(): Promise<boolean> {
  if (!pendingUpdate) return false;
  const store = useUpdaterStore.getState();
  store.setStatus("downloading");
  store.setProgress(0);
  store.setError(null);
  try {
    let downloaded = 0;
    let contentLength = 0;
    await pendingUpdate.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          contentLength = event.data.contentLength ?? 0;
          break;
        case "Progress": {
          downloaded += event.data.chunkLength;
          const pct =
            contentLength > 0
              ? Math.min(100, Math.round((downloaded / contentLength) * 100))
              : 0;
          useUpdaterStore.getState().setProgress(pct);
          break;
        }
        case "Finished":
          useUpdaterStore.getState().setProgress(100);
          useUpdaterStore.getState().setStatus("ready");
          break;
      }
    });
    return true;
  } catch (e) {
    useUpdaterStore.getState().setError(friendlyError(e));
    return false;
  }
}

export async function performRestart(): Promise<void> {
  try {
    await relaunch();
  } catch (e) {
    useUpdaterStore.getState().setError(friendlyError(e));
  }
}

/** UI tarafı için reactive hook. */
export function useUpdater() {
  const state = useUpdaterStore();

  useEffect(() => {
    if (!state.currentVersion) {
      void loadCurrentVersion();
    }
  }, [state.currentVersion]);

  const checkForUpdate = useCallback(async () => {
    await performCheck();
  }, []);

  const downloadAndInstall = useCallback(async () => {
    await performDownloadAndInstall();
  }, []);

  const restartNow = useCallback(async () => {
    await performRestart();
  }, []);

  const reset = useCallback(() => {
    pendingUpdate = null;
    useUpdaterStore.getState().reset();
  }, []);

  return {
    state: {
      status: state.status,
      currentVersion: state.currentVersion,
      newVersion: state.newVersion,
      notes: state.notes,
      progress: state.progress,
      error: state.error,
    },
    autoDownload: state.autoDownload,
    setAutoDownload: state.setAutoDownload,
    checkForUpdate,
    downloadAndInstall,
    restartNow,
    reset,
  };
}

function friendlyError(e: unknown): string {
  const msg = String(e);
  if (msg.includes("could not fetch a valid release")) {
    return "Güncelleme sunucusuna ulaşılamadı. İnternet bağlantını kontrol et.";
  }
  if (msg.includes("signature") || msg.includes("verify")) {
    return "İmza doğrulaması başarısız. Güncelleme bozulmuş olabilir.";
  }
  return msg.replace(/^Error:\s*/i, "");
}
