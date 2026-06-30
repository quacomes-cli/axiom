// App-wide arka plan güncelleme kontrolü.
//
// - Açılışta 8 saniye sonra ilk check (uygulama nefes alsın diye).
// - Sonra her 60 dakikada bir check.
// - Yeni sürüm bulunduğunda:
//     • autoDownload açık → otomatik indirir, status "ready" olur,
//       sidebar'daki "Yeniden başlat" butonu görünür.
//     • autoDownload kapalı → status "available" kalır, Settings sayfasında
//       "İndir ve kur" butonu görünür.
// - "downloading" / "ready" / "checking" durumdayken tekrar tetiklenmez.

import { useEffect } from "react";
import {
  loadCurrentVersion,
  performCheck,
  performDownloadAndInstall,
} from "./useUpdater";
import { useUpdaterStore } from "../stores/updaterStore";

const FIRST_CHECK_DELAY_MS = 8_000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function useBackgroundUpdater() {
  useEffect(() => {
    let stopped = false;
    let intervalHandle: ReturnType<typeof setInterval> | null = null;

    async function checkAndMaybeDownload() {
      if (stopped) return;
      const status = useUpdaterStore.getState().status;
      if (status === "checking" || status === "downloading" || status === "ready") return;

      const found = await performCheck();
      if (!found || stopped) return;

      if (useUpdaterStore.getState().autoDownload) {
        await performDownloadAndInstall();
      }
    }

    void loadCurrentVersion();

    const firstTimer = setTimeout(() => {
      void checkAndMaybeDownload();
      intervalHandle = setInterval(() => {
        void checkAndMaybeDownload();
      }, CHECK_INTERVAL_MS);
    }, FIRST_CHECK_DELAY_MS);

    return () => {
      stopped = true;
      clearTimeout(firstTimer);
      if (intervalHandle) clearInterval(intervalHandle);
    };
  }, []);
}
