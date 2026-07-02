// Hızlı palet — Spotlight benzeri, global kısayolla açılan mini asistan.
//
// Ayrı bir Tauri penceresinde çalışır (main.tsx etiketle yönlendirir) ve
// bilinçli olarak hafiftir: chatStore/App hook'ları YÜKLENMEZ; model çağrısı
// doğrudan ipc.modelsChat (non-stream, araçsız). "Sohbette devam" ana
// pencereye event yollar; asıl konuşma orada, tüm araç/izin altyapısıyla
// sürer. Arka plan şeffaf — blur'u OS verir (lib.rs'te Acrylic).

import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { ArrowUpRight, CornerDownLeft, Loader2, Sparkles } from "lucide-react";
import { ipc } from "../../lib/ipc";
import type { ModelInfo } from "../../types";

const win = getCurrentWindow();

export function PalettePage() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const askedRef = useRef("");

  // Aktif modeli pencere her odaklandığında tazele (kullanıcı ana pencerede
  // model değiştirmiş olabilir) + input'a odaklan. Odak kaybında gizlen.
  useEffect(() => {
    const refresh = () => {
      void ipc.modelsList().then((models) => {
        setModel(models.find((m) => m.isActive) ?? null);
      }).catch(() => {});
      setTimeout(() => inputRef.current?.focus(), 30);
    };
    refresh();
    const unlistenPromise = win.onFocusChanged(({ payload: focused }) => {
      if (focused) refresh();
      else void win.hide();
    });
    return () => {
      void unlistenPromise.then((un) => un());
    };
  }, []);

  const hide = useCallback(() => {
    setQuery("");
    setAnswer("");
    setError(null);
    void win.hide();
  }, []);

  const ask = useCallback(async () => {
    const q = query.trim();
    if (!q || busy) return;
    if (!model) {
      setError("Aktif model yok — ana pencereden bir model seç.");
      return;
    }
    setBusy(true);
    setError(null);
    setAnswer("");
    askedRef.current = q;
    try {
      const resp = await ipc.modelsChat({
        modelId: model.id,
        provider: model.provider,
        messages: [
          {
            role: "system",
            content:
              "Hızlı yardımcı panelindesin: kısa, doğrudan ve Türkçe cevap ver. Uzun açıklama ve madde listelerinden kaçın.",
          },
          { role: "user", content: q },
        ],
        temperature: 0.5,
        maxTokens: 512,
      });
      setAnswer(resp.content.trim());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [query, busy, model]);

  /** Soruyu ana penceredeki sohbete taşı — tam araç/izin altyapısıyla. */
  const handoff = useCallback(async () => {
    const q = query.trim() || askedRef.current;
    if (!q) return;
    await emit("palette-handoff", { prompt: q });
    hide();
  }, [query, hide]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      hide();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handoff();
    } else if (e.key === "Enter") {
      e.preventDefault();
      void ask();
    }
  }

  return (
    <div className="flex h-screen w-screen items-start justify-center bg-transparent p-2">
      <div className="flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-white/10">
        {/* Giriş satırı */}
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Sparkles size={16} className="shrink-0 text-text-secondary" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={model ? `${model.displayName || model.id}'e sor...` : "Axiom'a sor..."}
            className="w-full bg-transparent text-[0.9857rem] text-text outline-none placeholder:text-text-faint"
            spellCheck={false}
          />
          {busy && <Loader2 size={15} className="shrink-0 animate-spin text-text-faint" />}
        </div>

        {/* Cevap */}
        {(answer || error) && (
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/8 px-4 py-3">
            {error ? (
              <div className="text-[0.8571rem] leading-relaxed text-danger">{error}</div>
            ) : (
              <div className="whitespace-pre-wrap text-[0.8929rem] leading-relaxed text-text-secondary">
                {answer}
              </div>
            )}
          </div>
        )}

        {/* Alt bilgi */}
        <div className="flex items-center gap-4 border-t border-white/8 px-4 py-2 text-[0.7143rem] text-text-faint">
          <span className="flex items-center gap-1">
            <CornerDownLeft size={11} /> Sor
          </span>
          <button
            onClick={() => void handoff()}
            className="flex items-center gap-1 transition-colors hover:text-text-secondary"
          >
            <ArrowUpRight size={11} /> Ctrl+Enter: Sohbette devam
          </button>
          <span className="ml-auto">Esc: Kapat</span>
        </div>
      </div>
    </div>
  );
}
