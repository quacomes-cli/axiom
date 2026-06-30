import { useEffect, useRef, useState } from "react";
import { Monitor as MonitorIcon, Loader2, ChevronDown } from "lucide-react";
import { ipc } from "../../lib/ipc";

export interface MonitorInfo {
  index: number;
  name: string;
  width: number;
  height: number;
  isPrimary: boolean;
  scaleFactor: number;
}

interface ScreenshotButtonProps {
  /** Called after capture with a synthetic File the parent can hand to addPastedFile / similar. */
  onCapture: (file: File) => void;
  disabled?: boolean;
}

async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  return new File([blob], name, { type: blob.type || "image/png" });
}

export function ScreenshotButton({ onCapture, disabled }: ScreenshotButtonProps) {
  const [busy, setBusy] = useState(false);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await ipc.screenListMonitors();
        if (!cancelled) setMonitors(list);
      } catch {
        if (!cancelled) setMonitors([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  async function capture(monitorIndex?: number) {
    setMenuOpen(false);
    setBusy(true);
    try {
      const res = await ipc.screenCapture(monitorIndex);
      const fname = `ekran-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      const file = await dataUrlToFile(res.dataUrl, fname);
      onCapture(file);
    } catch (e) {
      console.error("Ekran yakalama hatası:", e);
    } finally {
      setBusy(false);
    }
  }

  const multi = monitors.length > 1;
  const baseCls =
    "flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors";

  if (busy) {
    return (
      <button
        type="button"
        disabled
        className={`${baseCls} bg-zinc-700/50 text-text-faint cursor-wait`}
        title="Ekran yakalanıyor..."
      >
        <Loader2 size={14} className="animate-spin" />
      </button>
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (multi) {
            setMenuOpen((v) => !v);
          } else {
            void capture(undefined);
          }
        }}
        disabled={disabled}
        className={`${baseCls} text-text-faint hover:text-text hover:bg-zinc-800/60`}
        title={multi ? "Ekran seç ve yakala" : "Ekran görüntüsü al"}
      >
        <MonitorIcon size={14} />
        {multi && <ChevronDown size={11} className="opacity-60" />}
      </button>
      {menuOpen && multi && (
        <div className="absolute bottom-full left-0 mb-1.5 w-52 overflow-hidden rounded-xl border border-border bg-surface-2 shadow-lg z-20">
          {monitors.map((m) => (
            <button
              key={m.index}
              type="button"
              onClick={() => void capture(m.index)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:bg-hover-strong"
            >
              <span className="truncate">
                {m.name}
                {m.isPrimary && <span className="ml-1 text-text-faint">(birincil)</span>}
              </span>
              <span className="shrink-0 text-[0.7143rem] text-text-faint">
                {m.width}×{m.height}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
