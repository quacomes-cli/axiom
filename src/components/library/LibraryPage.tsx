// Belge kütüphanesi (RAG, Faz 8) — kullanıcı PDF/doküman ekler, yerel
// embedding'lerle indekslenir; sohbet otomatik ilgili pasajları görür ve
// model search_docs aracıyla derin arama yapabilir. Her şey yerelde.

import { useCallback, useEffect, useState } from "react";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  BookOpen,
  Plus,
  Trash2,
  FileText,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { ipc } from "../../lib/ipc";
import { useSettingsStore } from "../../stores/settingsStore";
import { PageHeader } from "../shared/PageHeader";
import { useT } from "../../i18n";
import type { DocMeta, DocsIndexEvent } from "../../types";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LibraryPage() {
  const t = useT();
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [indexing, setIndexing] = useState<DocsIndexEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDocs(await ipc.docsList());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // İndeksleme ilerlemesi.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    void listen<DocsIndexEvent>("docs-index-progress", (e) => {
      setIndexing(e.payload.done && e.payload.current >= e.payload.total ? null : e.payload);
      if (e.payload.error) setError(`${e.payload.title}: ${e.payload.error}`);
      if (e.payload.done) void refresh();
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [refresh]);

  const addFiles = useCallback(async () => {
    setError(null);
    const selected = await dialogOpen({
      multiple: true,
      filters: [
        {
          name: "Documents",
          extensions: ["pdf", "txt", "md", "docx", "html", "json", "csv", "log"],
        },
      ],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) return;

    const embeddingModel =
      useSettingsStore.getState().settings?.memory?.embeddingModel || "nomic-embed-text";
    setIndexing({ path: "", title: "…", current: 0, total: paths.length, done: false, error: null });
    try {
      await ipc.docsAdd(paths as string[], embeddingModel);
    } catch (e) {
      setError(String(e));
    } finally {
      setIndexing(null);
      void refresh();
    }
  }, [refresh]);

  const remove = useCallback(
    async (id: string) => {
      try {
        await ipc.docsRemove(id);
        void refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  return (
    <div className="h-full overflow-y-auto p-6" style={{ scrollbarWidth: "none" }}>
      <PageHeader title={t("library.title")} />
      <p className="mb-5 text-[0.8571rem] text-text-faint">{t("library.subtitle")}</p>

      {/* Ekle + indeksleme durumu */}
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={() => void addFiles()}
          disabled={!!indexing}
          className="flex items-center gap-2 rounded-lg border border-border-hover bg-surface-2 px-3.5 py-2 text-[0.8571rem] text-text transition-colors hover:bg-surface-3 disabled:opacity-50"
        >
          <Plus size={15} strokeWidth={1.8} />
          {t("library.addFiles")}
        </button>
        {indexing && (
          <span className="flex items-center gap-2 text-[0.8214rem] text-text-secondary">
            <Loader2 size={13} className="animate-spin" />
            {t("library.indexing", {
              title: indexing.title,
              current: indexing.current,
              total: indexing.total,
            })}
          </span>
        )}
      </div>

      {error && (
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[0.8214rem] text-danger">
          <AlertCircle size={14} className="shrink-0" /> {error}
        </p>
      )}

      {/* Belge listesi */}
      {docs.length === 0 && !indexing ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <BookOpen size={28} strokeWidth={1.3} className="text-text-faint" />
          <p className="max-w-[380px] text-[0.8571rem] leading-relaxed text-text-faint">
            {t("library.empty")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <div
              key={d.id}
              className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
            >
              <FileText size={18} strokeWidth={1.5} className="shrink-0 text-text-secondary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8571rem] text-text" title={d.path}>
                  {d.title}
                </p>
                <p className="text-[0.7143rem] text-text-faint">
                  {formatSize(d.sizeBytes)} · {t("library.chunks", { n: d.chunkCount })} ·{" "}
                  {new Date(d.addedAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => void remove(d.id)}
                title={t("library.remove")}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-faint opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
              >
                <Trash2 size={14} strokeWidth={1.6} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
