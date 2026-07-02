// App-wide arka plan güncelleme kontrolü.
//
// Kural:
//   - autoDownload AÇIK:
//       • Açılıştan 8sn sonra check yapılır, sonra saatte bir tekrar.
//       • Yeni sürüm varsa sessizce indirilir → status "ready" → sidebar'da
//         "Yeniden başlat" butonu belirir.
//   - autoDownload KAPALI:
//       • Arka plan HİÇBİR ŞEY yapmaz. Kullanıcı Ayarlar → Güncelleme →
//         "Şimdi kontrol et"e basar; hem check hem download onun tetiği ile
//         çalışır.
//
// Aktif bir download/ready durumunda tekrar tetiklenmez.

import { useEffect } from "react";
import {
  loadCurrentVersion,
  performCheck,
  performDownloadAndInstall,
} from "./useUpdater";
import { useUpdaterStore } from "../stores/updaterStore";
import { notifyUpdateReady } from "../lib/notify";

const FIRST_CHECK_DELAY_MS = 8_000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function useBackgroundUpdater() {
  useEffect(() => {
    let stopped = false;
    let intervalHandle: ReturnType<typeof setInterval> | null = null;

    async function silentCheckAndDownload() {
      if (stopped) return;
      const s = useUpdaterStore.getState();
      // Kullanıcı manuel işleme başlamışsa veya güncelleme hazırsa dokunma
      if (
        s.status === "checking" ||
        s.status === "downloading" ||
        s.status === "ready" ||
        s.status === "install_failed"
      ) {
        return;
      }
      // Arka plan yalnızca autoDownload açıkken çalışır
      if (!s.autoDownload) return;

      const found = await performCheck();
      if (!found || stopped) return;
      const ok = await performDownloadAndInstall();
      if (ok && !stopped) {
        // Kullanıcı arka planda güncellemenin bittiğinden haberdar olsun
        void notifyUpdateReady(useUpdaterStore.getState().newVersion);
      }
    }

    void loadCurrentVersion();

    const firstTimer = setTimeout(() => {
      void silentCheckAndDownload();
      intervalHandle = setInterval(() => {
        void silentCheckAndDownload();
      }, CHECK_INTERVAL_MS);
    }, FIRST_CHECK_DELAY_MS);

    return () => {
      stopped = true;
      clearTimeout(firstTimer);
      if (intervalHandle) clearInterval(intervalHandle);
    };
  }, []);
}
