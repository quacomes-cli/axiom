// Modelin çalıştığı makinenin GERÇEK ortam bilgisi.
//
// Model, kullanıcının profil adından ("Fırat Tuna Arslan") Windows kullanıcı
// adını tahmin edip "C:/Users/Fırat Tuna Arslan/..." gibi var olmayan yollar
// üretiyordu. Buradaki blok sistem prompt'una eklenir; model her zaman doğru
// ev dizini ve özel klasör yollarını bilir.

import { homeDir, desktopDir, documentDir, downloadDir } from "@tauri-apps/api/path";

interface EnvInfo {
  home: string;
  desktop: string;
  documents: string;
  downloads: string;
  username: string;
}

let cached: EnvInfo | null = null;

/** App açılışında bir kez çağrılır; hatada sessizce boş kalır. */
export async function initEnvInfo(): Promise<void> {
  try {
    const [home, desktop, documents, downloads] = await Promise.all([
      homeDir(),
      desktopDir(),
      documentDir(),
      downloadDir(),
    ]);
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
    const h = norm(home);
    cached = {
      home: h,
      desktop: norm(desktop),
      documents: norm(documents),
      downloads: norm(downloads),
      username: h.split("/").pop() ?? "",
    };
  } catch (e) {
    console.warn("[envInfo] ortam bilgisi alınamadı:", e);
  }
}

/**
 * Sistem prompt'una eklenecek ortam bloğu. init edilmemişse boş string —
 * prompt bozulmaz, model sadece bilgisiz kalır.
 */
export function envPromptBlock(): string {
  if (!cached) return "";
  return `# Çalışma Ortamı
İşletim sistemi: Windows. Dosya araçlarında HER ZAMAN bu gerçek yolları kullan — kullanıcının görünen adından yol TAHMİN ETME:
- Windows kullanıcı adı: ${cached.username}
- Ev dizini: ${cached.home}
- Masaüstü: ${cached.desktop}
- Belgeler: ${cached.documents}
- İndirilenler: ${cached.downloads}`;
}
