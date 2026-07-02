import { useState } from "react";
import { ChevronDown, ChevronUp, Wrench } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { ToolAction } from "../../types";
import hljs from "highlight.js";
import "highlight.js/styles/atom-one-dark.css";

function basename(path?: string): string {
  if (!path) return "";
  return path.replace(/\\/g, "/").split("/").pop() || path;
}

function lineStats(content?: string): { added: number; removed: number } | null {
  if (!content) return null;
  const lines = content.split("\n");
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.startsWith("+") && !l.startsWith("+++")) added++;
    else if (l.startsWith("-") && !l.startsWith("---")) removed++;
  }
  if (added === 0 && removed === 0) {
    return { added: lines.length, removed: 0 };
  }
  return { added, removed };
}

function getLanguage(kind: string, path?: string): string {
  if (kind === "run_command") return "bash";
  if (!path) return "plaintext";

  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "js" || ext === "jsx") return "javascript";
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "py") return "python";
  if (ext === "json") return "json";
  if (ext === "html") return "html";
  if (ext === "css") return "css";

  return "plaintext";
}

function toolLabel(action: ToolAction): { prefix: string; value: string } {
  switch (action.kind) {
    case "weather": return { prefix: "weather", value: action.command || "Istanbul" };
    case "currency": return { prefix: "currency", value: "TRY" };
    case "web_search": return { prefix: "search", value: action.command || "" };
    case "read_file": return { prefix: "read", value: basename(action.path) };
    case "write_file": return { prefix: "edit", value: basename(action.path) };
    case "list_dir": return { prefix: "ls", value: basename(action.path) };
    case "create_dir": return { prefix: "mkdir", value: basename(action.path) };
    case "run_command": return { prefix: "run", value: action.command || "" };
    case "app_tool": return { prefix: "app", value: action.command || "" };
    case "get_settings": return { prefix: "settings", value: "read" };
    case "change_setting": return { prefix: "settings", value: action.command || "" };
    case "edit_file": return { prefix: "edit", value: basename(action.path) };
    case "search": return { prefix: "search", value: action.command || "" };
    case "glob": return { prefix: "glob", value: action.command || "" };
    case "delete_file": return { prefix: "delete", value: basename(action.path) };
    case "rename_file": return { prefix: "rename", value: `${basename(action.path)} → ${basename(action.toPath)}` };
    case "create_task": return { prefix: "task", value: `+ ${(action.content?.match(/"(.+?)"/)?.[1]) || ""}` };
    case "list_tasks": return { prefix: "task", value: "liste" };
    case "update_task": return { prefix: "task", value: "güncelle" };
    case "complete_task": return { prefix: "task", value: "✓ tamamla" };
    case "delete_task": return { prefix: "task", value: "sil" };
    case "schedule_task": return { prefix: "timer", value: action.content?.match(/"(.+?)"/)?.[1] || "" };
    default: return { prefix: action.kind, value: "" };
  }
}

export function ToolBlock({
  action,
  onToggle,
}: {
  action: ToolAction;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const isError =
    action.content?.startsWith("Hata:") ||
    (action.exitCode !== undefined && action.exitCode !== 0);

  const isDiff = action.kind === "edit_file";
  const stats =
    action.kind === "edit_file"
      ? { added: action.added ?? 0, removed: action.removed ?? 0 }
      : action.kind === "write_file"
        ? lineStats(action.content)
        : null;

  const getHighlightedContent = () => {
    if (!action.content) return "";
    const lang = getLanguage(action.kind, action.path);
    try {
      return hljs.highlight(action.content, { language: lang }).value;
    } catch {
      return hljs.highlightAuto(action.content).value;
    }
  };

  function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  const renderDiff = (text: string) =>
    text
      .split("\n")
      .map((line) => {
        const cls = line.startsWith("+")
          ? "text-emerald-400"
          : line.startsWith("-")
            ? "text-red-400"
            : "text-text-faint";
        return `<span class="${cls}">${escapeHtml(line)}</span>`;
      })
      .join("\n");

  const { prefix, value } = toolLabel(action);

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => { setExpanded((v) => !v); onToggle(); }}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-text-faint transition-colors hover:bg-hover hover:text-text-secondary"
      >
        <Wrench size={12} strokeWidth={1.6} />
        <span style={{ height: "14.25px" }}>
          {prefix}: <span className="font-medium text-text-secondary">{value}</span>
        </span>

        {stats && (
          <>
            <span className="text-emerald-400 text-[0.7857rem]">+{stats.added}</span>
            {stats.removed > 0 && (
              <span className="text-red-400 text-[0.7857rem]">-{stats.removed}</span>
            )}
          </>
        )}

        {action.kind === "run_command" && action.exitCode !== undefined && (
          <span className={`text-[0.7857rem] ${action.exitCode === 0 ? "text-emerald-400" : "text-red-400"}`}>
            exit {action.exitCode}
          </span>
        )}

        {isError && <span className="text-red-400 text-[0.7857rem]">failed</span>}

        {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>

      <AnimatePresence>
        {expanded && action.content && (
          <motion.pre
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-1 overflow-hidden rounded-lg border border-border/30 bg-surface-2 text-xs leading-relaxed"
            style={{ maxHeight: 300, overflowY: "auto" }}
          >
            <code
              className="hljs p-3 block w-full font-mono !bg-surface-2"
              style={{
                userSelect: "text"
              }}
              dangerouslySetInnerHTML={{ __html: isDiff ? renderDiff(action.content) : getHighlightedContent() }}
            />
          </motion.pre>
        )}
      </AnimatePresence>
    </div>
  );
}
