import { useState, useRef, useEffect, useCallback } from "react";
import {
  Terminal,
  FolderOpen,
  ArrowUp,
  Loader2,
  Trash2,
  PanelRightOpen,
  PanelRightClose,
  ChevronRight,
  ChevronDown,
  Square,
  Check,
  X,
  ShieldQuestion,
  Plus,
  FileText,
  ImageIcon,
  Paperclip,
  Globe,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useCodeStore } from "../../stores/codeStore";
import { useDocumentStore } from "../../stores/documentStore";
import { useModelStore, modelSupportsVision } from "../../stores/modelStore";
import { useUiStore } from "../../stores/uiStore";
import { useFileDrop, isImagePath } from "../../hooks/useFileDrop";
import { ModeSelector, ModelSelector } from "../chat/ChatPanel";
import { MicButton } from "../shared/MicButton";
import { ScreenshotButton } from "../shared/ScreenshotButton";
import { AttachmentPreviews } from "../shared/AttachmentPreviews";
import { ipc } from "../../lib/ipc";
import { ToolBlock } from "./ToolMessage";
import type { FileEntry, DocumentAttachment } from "../../types";
import { FileIcon, FolderIcon } from "./FileIcons";
import 'highlight.js/styles/atom-one-dark.css';

const EMPTY_DOCS: DocumentAttachment[] = [];


function formatSize(bytes: number | null) {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileTreeNode({
  entry,
  projectRoot,
  depth,
}: {
  entry: FileEntry;
  projectRoot: string;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (!entry.isDir) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (!children) {
      setLoading(true);
      try {
        const items = await ipc.fsReadDir(entry.path, projectRoot, 1);
        const sorted = items.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setChildren(sorted);
      } catch {
        setChildren([]);
      }
      setLoading(false);
    }
    setExpanded(true);
  }

  return (
    <div>
      <button
        onClick={toggle}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-[3px] text-left text-[0.8571rem] hover:bg-hover"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {entry.isDir ? (
          <>
            {loading ? (
              <Loader2 size={12} className="shrink-0 animate-spin text-text-faint" />
            ) : expanded ? (
              <ChevronDown size={12} className="shrink-0 text-text-faint" />
            ) : (
              <ChevronRight size={12} className="shrink-0 text-text-faint" />
            )}
            <FolderIcon open={expanded} size={14} />
          </>
        ) : (
          <>
            <FileIcon name={entry.name} size={14} />
          </>
        )}
        <span className="min-w-0 truncate text-text-secondary">{entry.name}</span>
        {!entry.isDir && entry.sizeBytes !== null && (
          <span className="ml-auto shrink-0 text-[0.7143rem] text-text-faint">
            {formatSize(entry.sizeBytes)}
          </span>
        )}
      </button>
      {expanded && children && (
        <div>
          {children.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              projectRoot={projectRoot}
              depth={depth + 1}
            />
          ))}
          {children.length === 0 && (
            <div
              className="py-1 text-[0.7857rem] text-text-faint italic"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              (boş)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FileSidebar({
  projectPath,
}: {
  projectPath: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ipc
      .fsReadDir(projectPath, projectPath, 1)
      .then((items) => {
        if (cancelled) return;
        const sorted = items.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setEntries(sorted);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectPath]);

  return (
    <motion.div
      initial={{ width: 0, opacity: 0, marginRight: 0 }}
      animate={{ width: 260, opacity: 1, marginRight: 12 }}
      exit={{ width: 0, opacity: 0, marginRight: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="flex shrink-0 flex-col overflow-hidden border border-border/30 border-t-border/80 border-l-border/80 bg-surface mt-3 mb-3 rounded-2xl"
    >
      <div className="flex items-center justify-between border-b border-border/30 px-3 py-2">
        <span className="text-[0.7857rem] uppercase tracking-widest text-text-faint">
          Dosyalar
        </span>
      </div>
      <div className="flex-1 overflow-y-auto py-1 px-1 scrollbar-thin">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="animate-spin text-text-faint" />
          </div>
        ) : entries.length === 0 ? (
          <div className="px-3 py-4 text-xs text-text-faint italic">Dosya bulunamadı</div>
        ) : (
          entries.map((entry) => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              projectRoot={projectPath}
              depth={0}
            />
          ))
        )}
      </div>
    </motion.div>
  );
}

function removeToolBlocks(text: string): string {
  return text
    .replace(/```tool:[a-z_]+\n[\s\S]*?```/g, "")
    // kapanmamış (yarıda kalan) trailing tool bloğunu da gizle
    .replace(/```tool:[a-z_]+\n[\s\S]*$/g, "")
    .trim();
}

export function CodeToolPage() {
  const session = useCodeStore((s) => s.activeSession());
  const isProcessing = useCodeStore((s) => s.isProcessing);
  const setProject = useCodeStore((s) => s.setProject);
  const newSession = useCodeStore((s) => s.newSession);
  const sendMessage = useCodeStore((s) => s.sendMessage);
  const clearMessages = useCodeStore((s) => s.clearMessages);
  const toggleToolCollapse = useCodeStore((s) => s.toggleToolCollapse);
  const stopProcessing = useCodeStore((s) => s.stopProcessing);
  const pendingApproval = useCodeStore((s) => s.pendingApproval);
  const resolveApproval = useCodeStore((s) => s.resolveApproval);
  const webSearchEnabled = useCodeStore((s) => s.webSearchEnabled);
  const setWebSearchEnabled = useCodeStore((s) => s.setWebSearchEnabled);
  const codeMode = useCodeStore((s) => s.codeMode);
  const setCodeMode = useCodeStore((s) => s.setCodeMode);

  const activeModel = useModelStore((s) => s.models.find((m) => m.isActive));
  const sessionId = session?.id ?? null;
  const docs = useDocumentStore((s) => s.chatDocuments[sessionId ?? ""] ?? EMPTY_DOCS);
  const addDocument = useDocumentStore((s) => s.addDocument);
  const addPastedFile = useDocumentStore((s) => s.addPastedFile);
  const removeDocument = useDocumentStore((s) => s.removeDocument);

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const cd = e.clipboardData;
    if (!cd || !sessionId) return;
    const files: File[] = [];
    if (cd.files && cd.files.length) {
      for (const f of Array.from(cd.files)) files.push(f);
    } else {
      for (const it of Array.from(cd.items)) {
        if (it.kind === "file") { const f = it.getAsFile(); if (f) files.push(f); }
      }
    }
    if (files.length === 0) return;
    const accepted = files.filter((f) =>
      f.type.startsWith("image/")
        ? modelSupportsVision(activeModel)
        : f.type.startsWith("text/") || f.type === "application/json" || f.type === "application/xml" || f.type === ""
    );
    if (accepted.length === 0) return;
    e.preventDefault();
    for (const f of accepted) void addPastedFile(sessionId, f);
  }

  const view = useUiStore((s) => s.view);
  const onDropPaths = useCallback(
    (paths: string[]) => {
      if (!sessionId) return;
      for (const p of paths) {
        if (isImagePath(p) && !modelSupportsVision(activeModel)) continue;
        void addDocument(sessionId, p);
      }
    },
    [sessionId, addDocument, activeModel],
  );
  const dragOver = useFileDrop(onDropPaths, view === "code" && !!sessionId);

  const projectPath = session?.projectPath ?? null;
  const messages = session?.messages ?? [];
  // Kod aracının kullandığı bağlam = donanıma (VRAM) göre hesaplanan güvenli tavan
  const ctxLimit = useCodeStore((s) => s.ctxLimit);
  const recomputeCtxLimit = useCodeStore((s) => s.recomputeCtxLimit);
  const contextUsed = useCodeStore((s) => s.contextUsed);
  const contextUsage = { used: contextUsed, total: ctxLimit };

  useEffect(() => {
    void recomputeCtxLimit();
  }, [activeModel?.id, recomputeCtxLimit]);

  const [input, setInput] = useState("");
  const [showFiles, setShowFiles] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shouldScroll = useRef(true);
  const prevMsgCount = useRef(messages.length);

  useEffect(() => {
    if (!plusMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) setPlusMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [plusMenuOpen]);

  async function handleAttachFile() {
    if (!sessionId) return;
    const selected = await dialogOpen({ multiple: true, title: "Belge Ekle" });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const p of paths) await addDocument(sessionId, p);
  }

  async function handleAttachImage() {
    if (!sessionId) return;
    const selected = await dialogOpen({
      multiple: true,
      title: "Resim Ekle",
      filters: [{ name: "Resim", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const p of paths) await addDocument(sessionId, p);
  }

  useEffect(() => {
    if (messages.length !== prevMsgCount.current) {
      shouldScroll.current = true;
      prevMsgCount.current = messages.length;
    }
    if (shouldScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleToggle = useCallback(
    (msgId: string, idx: number) => {
      shouldScroll.current = false;
      toggleToolCollapse(msgId, idx);
    },
    [toggleToolCollapse]
  );

  async function handlePickFolder() {
    const selected = await dialogOpen({
      directory: true,
      title: "Proje Klasörü Seç",
    });
    if (selected && typeof selected === "string") {
      if (session) {
        await setProject(selected);
      } else {
        await newSession(selected);
      }
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || isProcessing) return;
    setInput("");
    shouldScroll.current = true;
    await sendMessage(text);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const status: string = "closed-beta";

  if (!session) {
    if (status === "closed-beta") {
      return (
        <div className="flex h-full flex-col items-center justify-center px-6 gap-3">
          <div className="flex items-center gap-2.5" style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            opacity: 0.6,
          }}>
            <img src="logo.svg" alt="Axiom Logo" className="h-10 w-10" />
            <h1 className="text-2xl h-10 font-semibold opacity-60 text-text">Axiom Code</h1>
          </div>
          <h1 className="flex items-center gap-2 rounded-xl bg-surface-2 px-5 py-2.5 text-sm font-medium text-text">Kapalı Beta</h1>
        </div>
      );
    } else {
      return (
        <div className="flex h-full flex-col items-center justify-center px-6 gap-3">
          <Terminal
            size={40}
            strokeWidth={1.2}
            className="mb-4 text-text-faint"
          />
          <h1 className="text-lg font-semibold text-text">Kod Aracı</h1>
          <p className="mt-2 mb-6 max-w-sm text-center text-sm text-text-faint">
            AI kod asistanı. Dosya okuma/yazma ve komut
            çalıştırma yapabilir.
          </p>
          <button
            onClick={handlePickFolder}
            className="flex items-center gap-2 rounded-xl bg-surface-2 px-5 py-2.5 text-sm font-medium text-text transition-colors hover:bg-hover-strong"
          >
            <FolderOpen size={16} strokeWidth={1.4} />
            Proje Klasörü Seç
          </button>
        </div>
      );
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border/30 px-4 py-2.5">
          <Terminal size={16} strokeWidth={1.4} className="text-text-faint" />
          <span className="truncate text-xs text-text-secondary font-mono">
            {projectPath}
          </span>
          <button
            onClick={handlePickFolder}
            className="ml-auto rounded-lg px-2.5 py-1 text-[0.8571rem] text-text-faint hover:bg-hover hover:text-text-secondary transition-colors"
          >
            Değiştir
          </button>
          <button
            onClick={() => setShowFiles((v) => !v)}
            title={showFiles ? "Dosya panelini kapat" : "Dosya panelini aç"}
            className={`rounded-lg p-1.5 transition-colors ${showFiles
              ? "bg-accent/15 text-accent"
              : "text-text-faint hover:bg-hover hover:text-text-secondary"
              }`}
          >
            {showFiles ? <PanelRightClose size={14} strokeWidth={1.6} /> : <PanelRightOpen size={14} strokeWidth={1.4} />}
          </button>
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              title="Geçmişi temizle"
              className="rounded-lg p-1.5 text-text-faint hover:bg-hover hover:text-red-400 transition-colors"
            >
              <Trash2 size={14} strokeWidth={1.4} />
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto w-full max-w-[1000px] px-5 py-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-text-faint">
                <Terminal size={28} strokeWidth={1.2} className="mb-3 opacity-40" />
                <p className="text-sm">Ne yapmamı istersin?</p>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className="mb-4">
                {msg.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-surface-2 px-4 py-2.5 text-sm text-text">
                      {msg.text}
                    </div>
                  </div>
                ) : (
                  <div className="max-w-full">
                    {removeToolBlocks(msg.text) && (
                      <div
                        className="max-w-none text-sm leading-relaxed text-text dark:prose-invert"
                        style={{ userSelect: "text" }}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
                          components={{
                            code({ className, children, ...props }) {
                              const isInline = !className;

                              if (isInline) {
                                return (
                                  <code
                                    className="rounded !bg-surface-2 px-1.5 py-0.5 text-[0.8571rem] font-mono text-[#8ab8c2]/90"
                                    {...props}
                                  >
                                    {children}
                                  </code>
                                );
                              }

                              return (
                                // pre etiketini tamamen çıplak bıraktık, sadece kaydırma ve boşluk işini yapıyor
                                <pre className="overflow-x-auto text-[0.9286rem] leading-relaxed mb-2 rounded-lg">
                                  {/* Rengi ve padding'i (p-3) direkt code etiketine verdik.
        !bg-surface-2 ile highlight.js temasının rengini acımadan ezdik.
        block w-full ile de kutunun içini tam doldurmasını sağladık.
      */}
                                  <code
                                    className={`${className} hljs p-3 block w-full rounded-lg !bg-surface-2 border border-zinc-800/50`}
                                    {...props}
                                  >
                                    {children}
                                  </code>
                                </pre>
                              );
                            },
                            h1({ children, ...props }) {
                              return (
                                <h1 className="mt-4 mb-2 text-base font-semibold text-text" {...props}>
                                  {children}
                                </h1>
                              );
                            },
                            h2({ children, ...props }) {
                              return (
                                <h2 className="mt-3 mb-1.5 text-sm font-semibold text-text" {...props}>
                                  {children}
                                </h2>
                              );
                            },
                            h3({ children, ...props }) {
                              return (
                                <h3 className="mt-2 mb-1 text-sm font-medium text-text" {...props}>
                                  {children}
                                </h3>
                              );
                            },
                            p({ children, ...props }) {
                              return (
                                <p className="mb-2 text-sm leading-relaxed text-text-secondary" {...props}>
                                  {children}
                                </p>
                              );
                            },
                            ul({ children, ...props }) {
                              return (
                                <ul className="mb-2 ml-4 list-disc space-y-0.5 text-sm text-text-secondary" {...props}>
                                  {children}
                                </ul>
                              );
                            },
                            ol({ children, ...props }) {
                              return (
                                <ol className="mb-2 ml-4 list-decimal space-y-0.5 text-sm text-text-secondary" {...props}>
                                  {children}
                                </ol>
                              );
                            },
                            li({ children, ...props }) {
                              return (
                                <li className="text-sm leading-relaxed" {...props}>
                                  {children}
                                </li>
                              );
                            },
                            strong({ children, ...props }) {
                              return (
                                <strong className="font-semibold text-text" {...props}>
                                  {children}
                                </strong>
                              );
                            },
                            a({ children, href, ...props }) {
                              return (
                                <a
                                  href={href}
                                  className="text-blue-400 underline decoration-blue-400/30 hover:decoration-blue-400"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  {...props}
                                >
                                  {children}
                                </a>
                              );
                            },
                            blockquote({ children, ...props }) {
                              return (
                                <blockquote
                                  className="my-2 border-l-2 border-border pl-3 text-sm italic text-text-faint"
                                  {...props}
                                >
                                  {children}
                                </blockquote>
                              );
                            },
                            hr() {
                              return <hr className="my-3 border-border/40" />;
                            },
                            table({ children, ...props }) {
                              return (
                                <div className="my-2 overflow-x-auto rounded-lg border border-border/30">
                                  <table className="w-full text-sm" {...props}>
                                    {children}
                                  </table>
                                </div>
                              );
                            },
                            th({ children, ...props }) {
                              return (
                                <th className="border-b border-border/30 bg-surface-2 px-3 py-1.5 text-left text-xs font-medium text-text-secondary" {...props}>
                                  {children}
                                </th>
                              );
                            },
                            td({ children, ...props }) {
                              return (
                                <td className="border-b border-border/10 px-3 py-1.5 text-xs text-text-secondary" {...props}>
                                  {children}
                                </td>
                              );
                            },
                          }}
                        >
                          {removeToolBlocks(msg.text)}
                        </ReactMarkdown>
                      </div>
                    )}
                    {msg.toolActions.map((action, idx) => (
                      <ToolBlock
                        key={idx}
                        action={action}
                        onToggle={() => handleToggle(msg.id, idx)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}

            {isProcessing &&
              messages.length > 0 &&
              messages[messages.length - 1].text === "" && (
                <div className="flex items-center gap-2 text-text-faint text-sm py-2">
                  <Loader2 size={14} className="animate-spin" />
                  <span>Model hazırlanıyor...</span>
                </div>
              )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* Onay kartı */}
        <AnimatePresence>
          {pendingApproval && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="shrink-0 border rounded border-border bg-surface-2 px-4 py-3 w-[950px] mx-auto"
            >
              <div className="mb-2 flex items-center gap-2">
                <ShieldQuestion size={15} strokeWidth={1.6} className="text-amber-400" />
                <span className="text-[0.9286rem] font-medium text-text">{pendingApproval.title}</span>
              </div>
              {pendingApproval.detail && (
                <pre
                  className="mb-2.5 max-h-40 overflow-auto rounded-lg border border-border/30 bg-surface-3 p-2.5 text-[0.7857rem] leading-relaxed font-mono scrollbar-thin"
                >
                  {pendingApproval.isDiff
                    ? pendingApproval.detail.split("\n").map((l, i) => (
                      <div key={i} className={l.startsWith("+") ? "text-emerald-400" : l.startsWith("-") ? "text-red-400" : "text-text-faint"}>
                        {l}
                      </div>
                    ))
                    : pendingApproval.detail}
                </pre>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => resolveApproval("approve")}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-[0.8571rem] text-emerald-400 transition-colors hover:bg-emerald-500/25"
                >
                  <Check size={13} strokeWidth={1.8} /> Onayla
                </button>
                <button
                  onClick={() => resolveApproval("approve", true)}
                  className="rounded-lg bg-surface-2 px-3 py-1.5 text-[0.8571rem] text-text-secondary transition-colors hover:bg-surface-3"
                >
                  Bu oturumda hep izin ver
                </button>
                <button
                  onClick={() => resolveApproval("reject")}
                  className="ml-auto flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-1.5 text-[0.8571rem] text-red-400 transition-colors hover:bg-red-500/20"
                >
                  <X size={13} strokeWidth={1.8} /> Reddet
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input */}
        <div className="relative shrink-0 px-5 py-3 w-full max-w-[1000px] mx-auto">
          <AnimatePresence>
            {dragOver && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute inset-x-5 bottom-3 top-[14px] z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent/50 bg-accent/[0.08] backdrop-blur-sm"
              >
                <span className="flex items-center gap-2 text-sm text-text-secondary">
                  <Paperclip size={14} strokeWidth={1.6} /> Dosyaları bırak — belge ve resimler eklenir
                </span>
              </motion.div>
            )}
          </AnimatePresence>
          {/* Belge/görsel önizlemeleri */}
          <AttachmentPreviews
            docs={docs}
            onRemove={(id) => sessionId && removeDocument(sessionId, id)}
          />

          <div className="flex flex-col gap-1 rounded-2xl bg-surface-2 px-1 py-1.5 pb-2 transition-colors duration-200 focus-within:bg-surface-3">
            <div className="flex w-full items-end gap-2 px-3 pr-2 pt-1">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={activeModel ? "Talimat yaz..." : "Model seçilmedi — bir model seç"}
                rows={1}
                disabled={isProcessing}
                className="flex-1 resize-none bg-transparent text-sm text-text outline-none placeholder:text-text-faint scrollbar-none disabled:opacity-60"
                style={{ maxHeight: 160 }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 160) + "px";
                }}
              />
              {isProcessing ? (
                <button
                  onClick={stopProcessing}
                  title="Durdur"
                  className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-active text-text-secondary transition-colors hover:bg-red-500/20 hover:text-red-400"
                >
                  <Square size={10} strokeWidth={2} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || !activeModel}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-active text-text-secondary transition-all duration-200 hover:bg-border-hover hover:text-text disabled:opacity-30"
                >
                  <ArrowUp size={14} strokeWidth={1.8} />
                </button>
              )}
            </div>

            {/* Footer toolbar */}
            <div className="mt-1.5 flex items-center gap-1 px-1">
              {/* Ekler (+) */}
              <div ref={plusMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setPlusMenuOpen((v) => !v)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-text-faint transition-all duration-200 hover:bg-hover hover:text-text-secondary"
                >
                  <Plus size={16} strokeWidth={1.8} />
                </button>
                <AnimatePresence>
                  {plusMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.15 }}
                      className="absolute bottom-full left-0 mb-1.5 w-44 overflow-hidden rounded-xl border border-border bg-surface-2 shadow-lg"
                    >
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); setPlusMenuOpen(false); handleAttachFile(); }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-hover-strong"
                      >
                        <FileText size={14} strokeWidth={1.6} className="text-text-faint" />
                        <span>Belge Ekle</span>
                      </button>
                      {modelSupportsVision(activeModel) && (
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); setPlusMenuOpen(false); handleAttachImage(); }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-hover-strong"
                        >
                          <ImageIcon size={14} strokeWidth={1.6} className="text-text-faint" />
                          <span>Resim Ekle</span>
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Web araması toggle (Araçlar yerine) */}
              <button
                type="button"
                onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[0.7857rem] transition-all duration-200 ${webSearchEnabled ? "bg-accent-muted text-text-secondary" : "text-text-faint hover:bg-hover hover:text-text-secondary"
                  }`}
                title={webSearchEnabled ? "Web araması açık — kapat" : "Web araması kapalı — aç"}
              >
                <Globe size={12} strokeWidth={1.6} />
                <span style={{ height: 20, fontSize: 13 }}>Web</span>
              </button>

              {/* Bağlam göstergesi */}
              {contextUsage.total > 0 && messages.length > 0 && (() => {
                const pct = Math.min(100, (contextUsage.used / contextUsage.total) * 100);
                const r = 7;
                const circ = 2 * Math.PI * r;
                const offset = circ - (pct / 100) * circ;
                return (
                  <div className="flex items-center gap-1 px-1" title={`Context: ${contextUsage.used} / ${contextUsage.total} token`}>
                    <svg width="18" height="18" viewBox="0 0 18 18" className="shrink-0">
                      <circle cx="9" cy="9" r={r} fill="none" className="stroke-surface-3" strokeWidth="2" />
                      <circle cx="9" cy="9" r={r} fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} transform="rotate(-90 9 9)" className="transition-all duration-500" />
                    </svg>
                    <span className="text-[0.7143rem] tabular-nums text-text-faint">{Math.round(pct)}%</span>
                  </div>
                );
              })()}

              <MicButton
                onTranscript={(text) =>
                  setInput((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text))
                }
                disabled={isProcessing}
              />
              {modelSupportsVision(activeModel) && sessionId && (
                <ScreenshotButton
                  onCapture={(file) => {
                    void addPastedFile(sessionId, file);
                  }}
                  disabled={isProcessing}
                />
              )}
              <ModeSelector mode={codeMode} onChange={setCodeMode} />
              <ModelSelector />
            </div>
          </div>
        </div>
      </div>

      {/* File Sidebar */}
      <AnimatePresence>
        {showFiles && projectPath && (
          <FileSidebar
            projectPath={projectPath}
            onClose={() => setShowFiles(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
