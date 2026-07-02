// Tauri updater wrapper — UI tarafı.
//
// Akış (quiet mode):
//  - checkForUpdate() → manifest sorgulama
//  - checkAndDownload() → check + varsa arka planda otomatik indir/kur
//  - restartNow() → relaunch()
//
// Neden atomic check+download? Kullanıcı deneyimi:
//   • autoDownload açık: uygulama açılışında arka planda tetiklenir
//   • autoDownload kapalı: kullanıcı "Şimdi kontrol et"e basar; bulunursa
//     ara-onay istemeden hemen indirir (ekstra tıklama yok). Ready olunca
//     aynı buton "Yeniden başlat"a dönüşür.
//
// Install failure (elevation/UAC): quiet mode admin gerektiriyorsa sessizce
// çöker. Bu durumu ayrı "install_failed" durumu ile yakalayıp release
// sayfasına manuel yönlendirme sunuyoruz.

import { useCallback, useEffect } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useUpdaterStore } from "../stores/updaterStore";

let pendingUpdate: Update | null = null;

const RELEASE_PAGE_BASE = "https://github.com/quacomes-cli/axiom/releases/tag";

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

  let downloadFinished = false;
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
          downloadFinished = true;
          useUpdaterStore.getState().setProgress(100);
          break;
      }
    });
    // downloadAndInstall dönerse install de başarılı — hazır sinyalini ver.
    useUpdaterStore.getState().setStatus("ready");
    return true;
  } catch (e) {
    const s = useUpdaterStore.getState();
    const msg = String(e);
    if (downloadFinished || looksLikeElevation(msg)) {
      // İndirme tamam, install çöktü — muhtemelen admin/UAC gerekli.
      s.setError(
        "Otomatik kurulum başarısız (muhtemelen yönetici izni gerekli). Elle indirip kurabilirsin.",
      );
      s.setStatus("install_failed");
    } else {
      s.setError(friendlyError(e));
    }
    return false;
  }
}

export async function performCheckAndDownload(): Promise<boolean> {
  const found = await performCheck();
  if (!found) return false;
  return performDownloadAndInstall();
}

export async function performRestart(): Promise<void> {
  try {
    await relaunch();
  } catch (e) {
    useUpdaterStore.getState().setError(friendlyError(e));
  }
}

export async function openReleasePage(): Promise<void> {
  const v = useUpdaterStore.getState().newVersion;
  const url = v ? `${RELEASE_PAGE_BASE}/v${v}` : `${RELEASE_PAGE_BASE.replace("/tag", "/latest")}`;
  try {
    await openUrl(url);
  } catch {
    /* ignore */
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

  const checkAndDownload = useCallback(async () => {
    await performCheckAndDownload();
  }, []);

  const downloadAndInstall = useCallback(async () => {
    await performDownloadAndInstall();
  }, []);

  const restartNow = useCallback(async () => {
    await performRestart();
  }, []);

  const openManual = useCallback(async () => {
    await openReleasePage();
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
    checkAndDownload,
    downloadAndInstall,
    restartNow,
    openManual,
    reset,
  };
}

function looksLikeElevation(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("elevat") ||
    m.includes("admin") ||
    m.includes("access is denied") ||
    m.includes("code: 740") ||
    m.includes("exit code 740") ||
    m.includes("1223")
  );
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
