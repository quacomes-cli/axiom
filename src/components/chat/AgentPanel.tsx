// Agent görevleri paneli — sağdan yumuşak kayarak gelen drawer.
// Tree mantığı: koşu ▸ adımlar ▸ araç satırları + not. Canlı koşular üstte,
// biten son koşular altta (geçmiş). Arka plan (zamanlanmış) koşular da burada.

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, X, ChevronRight, Loader2, Clock, Trash2, Square } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useAgentRunStore, type LiveAgentRun } from "../../stores/agentRunStore";
import { useChatStore } from "../../stores/chatStore";
import { StepRow, StepIcon } from "./AgentRunCard";
import { useT } from "../../i18n";

function elapsed(run: LiveAgentRun): string {
  const ms = (run.endedAt ?? Date.now()) - run.startedAt;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}dk ${s % 60}s`;
}

function RunNode({ run }: { run: LiveAgentRun }) {
  const t = useT();
  const [open, setOpen] = useState(!run.endedAt); // canlı koşu açık başlar
  const stopGeneration = useChatStore((s) => s.stopGeneration);
  const live = !run.endedAt;
  const doneSteps = run.steps.filter((s) => s.status === "done").length;

  const statusLabel =
    run.status === "planning"
      ? t("agent.planning")
      : run.status === "running"
        ? t("agent.running")
        : run.status === "synthesizing"
          ? t("agent.synthesizing")
          : run.status === "done"
            ? t("agent.done")
            : run.status === "stopped"
              ? t("agent.stopped")
              : t("agent.failed");

  return (
    <div className="rounded-lg border border-border bg-surface">
      {/* Koşu başlığı */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-hover"
      >
        <ChevronRight
          size={13}
          className={`mt-0.5 shrink-0 text-text-faint transition-transform ${open ? "rotate-90" : ""}`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.8214rem] leading-snug text-text" title={run.goal}>
            {run.goal}
          </p>
          <p
            className={`mt-0.5 flex items-center gap-1.5 text-[0.7143rem] ${run.status === "failed"
                ? "text-danger"
                : run.status === "done"
                  ? "text-success"
                  : "text-text-faint"
              }`}
          >
            {live && <Loader2 size={10} className="animate-spin" />}
            {statusLabel}
            {run.steps.length > 0 && (
              <span className="tabular-nums text-text-faint">
                · {doneSteps}/{run.steps.length}
              </span>
            )}
            <span className="flex items-center gap-0.5 text-text-faint">
              <Clock size={9} /> {elapsed(run)}
            </span>
            {run.source === "task" && (
              <span className="rounded bg-surface-3 px-1 text-text-faint">
                {t("agent.background")}
              </span>
            )}
          </p>
        </div>
        {live && run.source === "chat" && (
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              stopGeneration();
            }}
            title={t("agent.stop")}
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-faint hover:bg-danger/10 hover:text-danger"
          >
            <Square size={9} strokeWidth={2} fill="currentColor" />
          </span>
        )}
      </button>

      {/* Adım ağacı */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 border-t border-border px-2 py-1.5">
              {run.steps.length === 0 ? (
                <p className="flex items-center gap-1.5 px-1.5 py-1 text-[0.7857rem] text-text-faint">
                  <StepIcon status="running" /> {t("agent.planning")}
                </p>
              ) : (
                run.steps.map((step, i) => <StepRow key={i} step={step} index={i} />)
              )}
              {run.error && (
                <p className="px-1.5 pt-1 text-[0.75rem] text-danger">{run.error}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AgentPanel() {
  const t = useT();
  const open = useUiStore((s) => s.agentPanelOpen);
  const setOpen = useUiStore((s) => s.setAgentPanelOpen);
  const runs = useAgentRunStore((s) => s.runs);
  const clearFinished = useAgentRunStore((s) => s.clearFinished);

  const liveRuns = runs.filter((r) => !r.endedAt);
  const doneRuns = runs.filter((r) => r.endedAt);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Tıkla-kapat şeridi (karartmasız — sohbet görünür kalsın) */}
          <div className="fixed inset-0 z-[9990]" onClick={() => setOpen(false)} />

          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="fixed bottom-[10px] right-[10px] top-[50px] rounded-xl z-[9991] flex w-[320px] flex-col border border-border bg-surface-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Başlık */}
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <Bot size={15} strokeWidth={1.6} className="text-text-secondary" />
              <span className="text-[0.8571rem] font-medium text-text">
                {t("agent.panelTitle")}
              </span>
              {liveRuns.length > 0 && (
                <span className="flex items-center gap-1 rounded-full border border-border-hover px-1.5 py-0.5 text-[0.6875rem] text-text-secondary">
                  <Loader2 size={9} className="animate-spin" />
                  {liveRuns.length}
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                {doneRuns.length > 0 && (
                  <button
                    onClick={clearFinished}
                    title={t("agent.clearFinished")}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint hover:bg-surface-3 hover:text-text-secondary"
                  >
                    <Trash2 size={13} strokeWidth={1.6} />
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-text-faint hover:bg-surface-3 hover:text-text-secondary"
                >
                  <X size={14} strokeWidth={1.6} />
                </button>
              </div>
            </div>

            {/* Koşu listesi */}
            <div className="flex-1 space-y-2 overflow-y-auto p-2.5" style={{ scrollbarWidth: "thin" }}>
              {runs.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <Bot size={22} strokeWidth={1.4} className="text-text-faint" />
                  <p className="max-w-[220px] text-[0.7857rem] leading-relaxed text-text-faint">
                    {t("agent.noRuns")}
                  </p>
                </div>
              ) : (
                <>
                  {liveRuns.map((r) => (
                    <RunNode key={r.id} run={r} />
                  ))}
                  {doneRuns.length > 0 && liveRuns.length > 0 && (
                    <p className="px-1 pt-1 text-[0.6875rem] font-medium uppercase tracking-wider text-text-faint">
                      {t("agent.history")}
                    </p>
                  )}
                  {doneRuns.map((r) => (
                    <RunNode key={r.id} run={r} />
                  ))}
                </>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
