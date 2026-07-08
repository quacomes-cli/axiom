// Derin agent koşusu — Claude Code tarzı kompakt status block.
// Kapalı: tek satır (hedef + "N görev çalışıyor" rozeti + chevron).
// Satıra tıklayınca adımlar inline genişler; rozete tıklayınca sağdan
// AgentPanel kayar. Adımlar kendi içinde de genişleyebilir (tree).

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Check,
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
  Square,
  Circle,
  Wrench,
} from "lucide-react";
import type { AgentRun, AgentStep } from "../../stores/chatStore";
import type { ToolAction } from "../../types";
import { useChatStore } from "../../stores/chatStore";
import { useUiStore } from "../../stores/uiStore";
import { useAgentRunStore, selectRunningCount } from "../../stores/agentRunStore";
import { useT } from "../../i18n";

export function StepIcon({ status }: { status: AgentStep["status"] }) {
  switch (status) {
    case "running":
      return <Loader2 size={13} className="animate-spin text-text-secondary" />;
    case "done":
      return <Check size={13} strokeWidth={2} className="text-success" />;
    case "failed":
      return <X size={13} strokeWidth={2} className="text-danger" />;
    default:
      return <Circle size={8} strokeWidth={1.6} className="text-text-faint" />;
  }
}

function actionSummary(a: ToolAction): string {
  const target = a.path ?? a.command ?? "";
  return target ? `${a.kind}: ${target}` : a.kind;
}

/** Tek adım satırı — tıklayınca not + araç özetleri açılır (panelde de kullanılır). */
export function StepRow({ step, index }: { step: AgentStep; index: number }) {
  const [open, setOpen] = useState(false);
  const expandable = !!step.note || (step.actions?.length ?? 0) > 0;

  return (
    <div>
      <button
        onClick={() => expandable && setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left ${
          expandable ? "hover:bg-hover" : "cursor-default"
        }`}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          <StepIcon status={step.status} />
        </span>
        <span
          className={`flex-1 truncate text-[0.8214rem] leading-snug ${
            step.status === "pending"
              ? "text-text-faint"
              : step.status === "failed"
                ? "text-danger"
                : "text-text-secondary"
          }`}
          title={step.title}
        >
          {index + 1}. {step.title}
        </span>
        {expandable && (
          <ChevronDown
            size={12}
            className={`shrink-0 text-text-faint transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="ml-[7px] space-y-1 border-l border-border pb-1.5 pl-3.5 pr-1 pt-0.5">
              {step.actions?.map((a, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[0.75rem] text-text-faint">
                  <Wrench size={10} className="shrink-0" />
                  <span className="truncate font-mono">{actionSummary(a)}</span>
                </div>
              ))}
              {step.note && (
                <p className="whitespace-pre-wrap text-[0.7857rem] leading-relaxed text-text-secondary">
                  {step.note}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AgentRunCard({ run }: { run: AgentRun }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const stopGeneration = useChatStore((s) => s.stopGeneration);
  const setAgentPanelOpen = useUiStore((s) => s.setAgentPanelOpen);
  const runningCount = useAgentRunStore(selectRunningCount);
  const live = run.status === "planning" || run.status === "running" || run.status === "synthesizing";

  const doneSteps = run.steps.filter((s) => s.status === "done").length;

  const statusLabel = live
    ? runningCount > 0
      ? t("agent.tasksRunning", { n: runningCount })
      : t("agent.running")
    : run.status === "done"
      ? t("agent.done")
      : run.status === "stopped"
        ? t("agent.stopped")
        : t("agent.failed");

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-border bg-surface">
      {/* Kompakt satır */}
      <div
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 hover:bg-hover"
      >
        <Bot size={14} strokeWidth={1.6} className="shrink-0 text-text-secondary" />
        <span className="min-w-0 flex-1 truncate text-[0.8214rem] text-text" title={run.goal}>
          {run.goal}
        </span>

        {/* "N görev çalışıyor" rozeti → sağ panel */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setAgentPanelOpen(true);
          }}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.7143rem] transition-colors ${
            live
              ? "border-border-hover text-text-secondary hover:bg-surface-3 hover:text-text"
              : run.status === "done"
                ? "border-success/30 text-success hover:bg-success/10"
                : run.status === "failed"
                  ? "border-danger/30 text-danger hover:bg-danger/10"
                  : "border-border text-text-faint hover:bg-surface-3"
          }`}
        >
          {live && <Loader2 size={10} className="animate-spin" />}
          {!live && run.status === "done" && <Check size={10} strokeWidth={2.2} />}
          {!live && run.status !== "done" && <X size={10} strokeWidth={2.2} />}
          {statusLabel}
        </button>

        {run.steps.length > 0 && (
          <span className="shrink-0 text-[0.7143rem] tabular-nums text-text-faint">
            {doneSteps}/{run.steps.length}
          </span>
        )}

        {live && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              stopGeneration();
            }}
            title={t("agent.stop")}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-faint hover:bg-danger/10 hover:text-danger"
          >
            <Square size={9} strokeWidth={2} fill="currentColor" />
          </button>
        )}

        <ChevronRight
          size={13}
          className={`shrink-0 text-text-faint transition-transform ${open ? "rotate-90" : ""}`}
        />
      </div>

      {/* Inline adımlar */}
      <AnimatePresence initial={false}>
        {open && run.steps.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 border-t border-border px-1.5 py-1.5">
              {run.steps.map((step, i) => (
                <StepRow key={i} step={step} index={i} />
              ))}
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
