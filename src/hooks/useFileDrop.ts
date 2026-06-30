import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * Tauri webview dosya sürükle-bırak desteği. OS'tan bırakılan dosyaların
 * gerçek yollarını verir (blob değil) — yol-tabanlı parse pipeline'ı kullanılabilir.
 * `enabled` yalnızca aktif görünümdeyken true olmalı ki birden fazla panel
 * aynı bırakmayı işlemesin.
 */
export function useFileDrop(
  onDropPaths: (paths: string[]) => void,
  enabled: boolean,
): boolean {
  const [isOver, setIsOver] = useState(false);
  const cbRef = useRef(onDropPaths);
  cbRef.current = onDropPaths;

  useEffect(() => {
    if (!enabled) {
      setIsOver(false);
      return;
    }
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload as { type: string; paths?: string[] };
        if (p.type === "enter" || p.type === "over") {
          setIsOver(true);
        } else if (p.type === "leave" || p.type === "cancel") {
          setIsOver(false);
        } else if (p.type === "drop") {
          setIsOver(false);
          if (p.paths && p.paths.length) cbRef.current(p.paths);
        }
      })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
      setIsOver(false);
    };
  }, [enabled]);

  return isOver;
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

export function isImagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTS.includes(ext);
}
