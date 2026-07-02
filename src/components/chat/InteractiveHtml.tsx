// İnteraktif HTML yanıt kartı — modelin ürettiği ```html blokları sandbox'lı
// iframe'de canlı render edilir (Claude artifact benzeri).
//
// GÜVENLİK: iframe'e `allow-same-origin` VERİLMEZ. Böylece snippet, uygulama
// origin'ine (dolayısıyla Tauri IPC köprüsüne, localStorage'a) erişemez;
// yalnızca kendi izole belgesinde script çalıştırabilir. Harici ağ istekleri
// CSP ile değil sandbox origin'sizliğiyle sınırlıdır — model zaten
// self-contained üretmeye yönlendirilir (sistem promptu).

import { useMemo, useState } from "react";
import { Check, Code2, Copy, Play, RefreshCw, Maximize2, Minimize2 } from "lucide-react";

export function InteractiveHtml({ code }: { code: string }) {
  const [view, setView] = useState<"preview" | "code">("preview");
  const [tall, setTall] = useState(false);
  const [copied, setCopied] = useState(false);
  const [runId, setRunId] = useState(0);

  // Koyu zemin varsayılanı: snippet kendi arkaplanını vermediyse uygulamanın
  // zeminiyle uyumlu dursun.
  const srcDoc = useMemo(
    () =>
      `<!doctype html><html><head><meta charset="utf-8"><style>
        :root{color-scheme:dark light}
        body{margin:0;font-family:Inter,system-ui,sans-serif;background:transparent;color:#e8e5dd}
      </style></head><body>${code}</body></html>`,
    [code],
  );

  function copy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="not-prose my-2 overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <span className="px-1.5 text-[0.7143rem] uppercase tracking-wider text-text-faint">
          İnteraktif içerik
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => setView(view === "preview" ? "code" : "preview")}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-text-faint transition-colors hover:bg-hover hover:text-text-secondary"
            title={view === "preview" ? "Kodu göster" : "Önizlemeyi göster"}
          >
            {view === "preview" ? <Code2 size={12} /> : <Play size={12} />}
            {view === "preview" ? "Kod" : "Önizle"}
          </button>
          {view === "preview" && (
            <button
              onClick={() => setRunId((n) => n + 1)}
              className="rounded-md p-1 text-text-faint transition-colors hover:bg-hover hover:text-text-secondary"
              title="Yeniden çalıştır"
            >
              <RefreshCw size={12} />
            </button>
          )}
          <button
            onClick={() => setTall((t) => !t)}
            className="rounded-md p-1 text-text-faint transition-colors hover:bg-hover hover:text-text-secondary"
            title={tall ? "Küçült" : "Büyüt"}
          >
            {tall ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <button
            onClick={copy}
            className="rounded-md p-1 text-text-faint transition-colors hover:bg-hover hover:text-text-secondary"
            title="Kodu kopyala"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
      </div>

      {view === "preview" ? (
        <iframe
          key={runId}
          sandbox="allow-scripts allow-forms allow-modals"
          srcDoc={srcDoc}
          title="İnteraktif yanıt"
          className="w-full border-0 bg-base"
          style={{ height: tall ? 560 : 340 }}
        />
      ) : (
        <pre
          className="m-0 overflow-x-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[0.7857rem] leading-relaxed text-text-secondary"
          style={{ maxHeight: tall ? 560 : 340, overflowY: "auto", userSelect: "text" }}
        >
          {code}
        </pre>
      )}
    </div>
  );
}

/** React düğüm ağacından düz metni toplar (rehype-highlight span'ları dahil). */
export function extractNodeText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractNodeText).join("");
  if (typeof node === "object" && "props" in (node as Record<string, unknown>)) {
    return extractNodeText((node as { props: { children?: unknown } }).props.children);
  }
  return "";
}
