// Onay kartındaki "Her zaman izin ver" kararını kalıcı izin kuralına çevirir.
//
// Tek doğruluk kaynağı Rust'taki PermissionConfig'tir (permissions.json):
// buradaki güncelleme permissions_set ile oraya yazılır, İzinler sayfası
// (PermissionGrid) her açılışta permissions_get ile aynı config'i okuduğu
// için modal kararları sayfada anında görünür — ve tersi: sayfada "izinli"
// yapılan şey için modal hiç tetiklenmez (engine allow döner).

import { ipc } from "./ipc";
import type { PermissionConfig } from "../types";

export interface PermissionQueryLike {
  action: string;
  path?: string;
  command?: string;
  host?: string;
}

/** Dosya yolundan kapsam dizini: dosyaysa üst dizin, dizinse kendisi. */
export function scopeDirOf(path: string, isDir: boolean): string {
  const norm = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (isDir) return norm;
  const idx = norm.lastIndexOf("/");
  return idx > 0 ? norm.slice(0, idx) : norm;
}

function addScopePath(paths: string[], dir: string) {
  const exists = paths.some((p) => p.replace(/\\/g, "/").toLowerCase() === dir.toLowerCase());
  if (!exists) paths.push(dir);
}

/**
 * "Her zaman izin ver" uygulaması. Dosya eylemlerinde ilgili dizin kapsama
 * eklenir ve seviye "allowed" yapılır (kapsam listesi sınır olarak kalır —
 * yalnızca listedeki dizinler sorulmadan geçer). Diğer eylemlerde ilgili
 * seviye "allowed" olur. Başarısızlık sessizce loglanır; tool yürütmesi
 * yine de devam eder (kullanıcı onayı zaten verildi).
 */
export async function applyAlwaysAllow(
  query: PermissionQueryLike,
  scopeDir?: string,
): Promise<void> {
  try {
    const cfg: PermissionConfig = await ipc.permissionsGet();
    switch (query.action) {
      case "fs_read":
        cfg.filesystem.read.level = "allowed";
        if (scopeDir) addScopePath(cfg.filesystem.read.paths, scopeDir);
        break;
      case "fs_write":
        cfg.filesystem.write.level = "allowed";
        if (scopeDir) addScopePath(cfg.filesystem.write.paths, scopeDir);
        break;
      case "fs_watch":
        cfg.filesystem.watch.level = "allowed";
        if (scopeDir) addScopePath(cfg.filesystem.watch.paths, scopeDir);
        break;
      case "shell_execute":
        cfg.shell.execute = "allowed";
        break;
      case "network_outbound":
        cfg.network.outbound = "allowed";
        break;
      case "screen_capture":
        cfg.screen.capture = "allowed";
        break;
      default:
        return;
    }
    await ipc.permissionsSet(cfg);
  } catch (e) {
    console.error("[permissions] kalıcı izin yazılamadı:", e);
  }
}

/** Modal'daki "Her zaman" butonunun ne yapacağını açıklayan ipucu metni. */
export function alwaysHintFor(query: PermissionQueryLike, scopeDir?: string): string {
  switch (query.action) {
    case "fs_read":
      return scopeDir ? `"${scopeDir}" dizini kalıcı okuma iznine eklenir` : "Dosya okuma kalıcı izinli olur";
    case "fs_write":
      return scopeDir ? `"${scopeDir}" dizini kalıcı yazma iznine eklenir` : "Dosya yazma kalıcı izinli olur";
    case "shell_execute":
      return "Komut çalıştırma kalıcı izinli olur (engelli komut kalıpları yine engellenir)";
    case "network_outbound":
      return "Dış ağ erişimi kalıcı izinli olur (engelli alan adları yine engellenir)";
    default:
      return "Bu izin türü kalıcı olarak açılır";
  }
}
