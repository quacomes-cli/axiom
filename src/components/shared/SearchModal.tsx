import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  MessageCircle,
  Box,
  LayoutGrid,
  Settings2,
  SquareCheckBig,
  Sparkles,
  Loader2,
  LucideIcon,
} from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useChatStore } from "../../stores/chatStore";
import { ipc } from "../../lib/ipc";
import type { ChatSearchHit, ViewId } from "../../types";

interface PageResult {
  kind: "page";
  id: ViewId;
  label: string;
  icon: LucideIcon;
}

interface MessageResult {
  kind: "message";
  hit: ChatSearchHit;
}

type Result = PageResult | MessageResult;

const PAGES: PageResult[] = [
  { kind: "page", id: "chat", label: "Sohbet", icon: MessageCircle },
  { kind: "page", id: "models", label: "Modeller", icon: Box },
  { kind: "page", id: "apps", label: "Uygulamalar", icon: LayoutGrid },
  { kind: "page", id: "skills", label: "Yetenekler", icon: Sparkles },
  { kind: "page", id: "tasks", label: "Görevler", icon: SquareCheckBig },
  { kind: "page", id: "settings", label: "Ayarlar", icon: Settings2 },
];

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "az önce";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} dk`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} sa`;
  return new Date(ts).toLocaleDateString("tr-TR");
}

/** <mark>...</mark> içeren snippet'ı React node'larına çevir. */
function renderSnippet(snippet: string): React.ReactNode {
  const parts = snippet.split(/(<mark>.*?<\/mark>)/g);
  return parts.map((p, i) => {
    const m = p.match(/^<mark>(.*?)<\/mark>$/);
    if (m) {
      return (
        <mark key={i} className="rounded bg-blue-400/30 px-0.5 text-text">
          {m[1]}
        </mark>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

export function SearchModal() {
  const open = useUiStore((s) => s.searchOpen);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const setView = useUiStore((s) => s.setView);
  const requestScrollToMessage = useUiStore((s) => s.requestScrollToMessage);
  const switchChat = useChatStore((s) => s.switchChat);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ChatSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSearchOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setSearchOpen]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHits([]);
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced FTS search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await ipc.chatHistorySearch(q, 30);
        setHits(res);
      } catch (e) {
        console.warn("chat history search failed:", e);
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Build combined result list: matching pages first, then message hits.
  const q = query.toLowerCase().trim();
  const matchedPages: Result[] =
    q.length > 0
      ? PAGES.filter((p) => p.label.toLowerCase().includes(q) || p.id.includes(q))
      : [];
  const messageResults: Result[] = hits.map((hit) => ({ kind: "message" as const, hit }));
  const results: Result[] = [...matchedPages, ...messageResults];

  const clampedIdx = Math.min(selectedIdx, results.length - 1);

  function activate(r: Result) {
    if (r.kind === "page") {
      setView(r.id);
    } else {
      switchChat(r.hit.chatId);
      setView("chat");
      requestScrollToMessage(r.hit.messageId);
    }
    setSearchOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[clampedIdx]) {
      activate(results[clampedIdx]);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/60"
            style={{ backdropFilter: "blur(2.5px)", zIndex: 0 }}
            onClick={() => setSearchOpen(false)}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            className="fixed inset-x-0 top-[12%] z-50 mx-auto w-full max-w-xl"
          >
            <div className="overflow-hidden rounded-2xl bg-surface shadow-2xl shadow-black/40">
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                {loading ? (
                  <Loader2 size={16} className="animate-spin text-text-faint" />
                ) : (
                  <Search size={16} strokeWidth={1.4} className="text-text-faint" />
                )}
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelectedIdx(0);
                  }}
                  onKeyDown={onKeyDown}
                  placeholder="Sohbet geçmişinde ara..."
                  className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
                />
                <kbd className="rounded bg-kbd px-1.5 py-0.5 text-[0.7143rem] text-text-faint">ESC</kbd>
              </div>

              <div className="max-h-[400px] overflow-y-auto p-1.5">
                {q.length < 2 && (
                  <div className="px-3 py-6 text-center text-xs text-text-faint">
                    En az 2 karakter yaz. Sayfaları ve sohbet geçmişini ara.
                  </div>
                )}

                {q.length >= 2 && results.length === 0 && !loading && (
                  <div className="px-3 py-6 text-center text-sm text-text-faint">
                    Sonuç bulunamadı
                  </div>
                )}

                {results.map((r, i) => {
                  const active = i === clampedIdx;
                  if (r.kind === "page") {
                    const Icon = r.icon;
                    return (
                      <button
                        key={`page-${r.id}`}
                        onClick={() => activate(r)}
                        onMouseEnter={() => setSelectedIdx(i)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-100 ${
                          active ? "bg-hover-strong text-text" : "text-text-secondary hover:bg-hover"
                        }`}
                      >
                        <Icon size={15} strokeWidth={1.3} />
                        <span className="flex-1 text-sm">{r.label}</span>
                        <span className="text-[0.7143rem] text-text-faint">Sayfa</span>
                      </button>
                    );
                  }
                  const hit = r.hit;
                  return (
                    <button
                      key={`msg-${hit.messageId}`}
                      onClick={() => activate(r)}
                      onMouseEnter={() => setSelectedIdx(i)}
                      className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-100 ${
                        active ? "bg-hover-strong text-text" : "text-text-secondary hover:bg-hover"
                      }`}
                    >
                      <MessageCircle size={15} strokeWidth={1.3} className="mt-0.5 shrink-0 text-text-faint" />
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-sm leading-snug">
                          {renderSnippet(hit.snippet)}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[0.7143rem] text-text-faint">
                          <span className="truncate max-w-[180px]">
                            {hit.chatTitle || "Sohbet"}
                          </span>
                          <span>·</span>
                          <span>{hit.role === "user" ? "Sen" : "Asistan"}</span>
                          <span>·</span>
                          <span>{timeAgo(hit.createdAt)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
