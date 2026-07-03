import { useState, useRef, useEffect } from "react";
import {
  Plus,
  Clock,
  Play,
  CheckCircle2,
  XCircle,
  Trash2,
  ChevronRight,
  ChevronLeft,
  Bot,
  Timer,
  Repeat,
  Sparkles,
  Zap,
  Loader2,
} from "lucide-react";
import { PageHeader } from "../shared/PageHeader";
import {
  useTaskStore,
  type Task,
  type TaskStatus,
  type TaskRecurring,
} from "../../stores/taskStore";
import { runAgentTaskNow } from "../../hooks/useTaskScheduler";
import { Tooltip } from "../shared/Tooltip";

const COLUMNS: {
  status: TaskStatus;
  label: string;
  icon: React.FC<{ size?: number; strokeWidth?: number; className?: string }>;
  color: string;
}[] = [
  { status: "pending", label: "Bekleyen", icon: Clock, color: "text-yellow-400" },
  { status: "running", label: "Çalışan", icon: Play, color: "text-blue-400" },
  { status: "completed", label: "Tamamlanan", icon: CheckCircle2, color: "text-green-400" },
  { status: "failed", label: "Başarısız", icon: XCircle, color: "text-red-400" },
];

const STATUS_ORDER: TaskStatus[] = ["pending", "running", "completed", "failed"];

function nextStatus(s: TaskStatus): TaskStatus | null {
  const i = STATUS_ORDER.indexOf(s);
  return i < STATUS_ORDER.length - 1 ? STATUS_ORDER[i + 1] : null;
}
function prevStatus(s: TaskStatus): TaskStatus | null {
  const i = STATUS_ORDER.indexOf(s);
  return i > 0 ? STATUS_ORDER[i - 1] : null;
}

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-red-400",
  medium: "bg-yellow-400",
  low: "bg-zinc-500",
};

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0s";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  if (h > 0) return `${h}sa ${m}dk`;
  if (m > 0) return `${m}dk ${s}s`;
  return `${s}s`;
}

function TaskCard({ task }: { task: Task }) {
  const moveTask = useTaskStore((s) => s.moveTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [running, setRunning] = useState(false);

  const isScheduled = !!task.scheduledAt && task.status === "running" && !task.executedAt;
  const isAgentTask = task.actionType === "agent";
  // Full agentable: yalnız zamanlanmış agent görevleri değil, panodaki her
  // görev agent'a devredilebilir (başlık+açıklama talimat olur, sonuç
  // bildirim merkezine düşer, başarıda görev tamamlananlara taşınır).
  const canRun = !running && task.status !== "completed";

  async function runNow() {
    if (!canRun) return;
    setRunning(true);
    try {
      await runAgentTaskNow(task.id);
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    if (!isScheduled) { setRemaining(null); return; }
    const tick = () => setRemaining(Math.max(0, task.scheduledAt! - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isScheduled, task.scheduledAt]);

  const next = nextStatus(task.status);
  const prev = prevStatus(task.status);

  const age = Date.now() - task.createdAt;
  const ageLabel =
    age < 60_000
      ? "az önce"
      : age < 3_600_000
        ? `${Math.floor(age / 60_000)}dk`
        : age < 86_400_000
          ? `${Math.floor(age / 3_600_000)}sa`
          : `${Math.floor(age / 86_400_000)}g`;

  const isAgent = task.source === "agent";

  return (
    <div className={`group rounded-xl bg-surface-2 p-3 transition-colors duration-150 hover:bg-surface-3 ${isAgent ? "border-1 border-white/20" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {isAgent && (
            <Bot size={12} strokeWidth={1.4} className="shrink-0 text-purple-400" />
          )}
          {isScheduled && (
            <Timer size={12} strokeWidth={1.4} className="shrink-0 text-blue-400" />
          )}
          <h3 className="truncate text-sm leading-snug text-text">{task.title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {task.status !== "completed" && (
            <Tooltip label={isAgentTask ? "Şimdi çalıştır" : "Agent'a yaptır"}>
              <button
                onClick={runNow}
                disabled={!canRun}
                className="rounded p-0.5 text-text-faint transition-colors hover:text-purple-300 disabled:opacity-50"
              >
                {running ? (
                  <Loader2 size={12} strokeWidth={1.6} className="animate-spin" />
                ) : isAgentTask ? (
                  <Zap size={12} strokeWidth={1.6} />
                ) : (
                  <Bot size={12} strokeWidth={1.6} />
                )}
              </button>
            </Tooltip>
          )}
          <Tooltip label="Sil">
            <button
              onClick={() => deleteTask(task.id)}
              className="rounded p-0.5 text-text-faint transition-colors hover:text-red-400"
            >
              <Trash2 size={12} strokeWidth={1.4} />
            </button>
          </Tooltip>
        </div>
      </div>
      {task.description && (
        <p className="mt-1 text-xs leading-relaxed text-text-faint">
          {task.description}
        </p>
      )}
      {isScheduled && remaining !== null && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="h-1 flex-1 rounded-full bg-surface-3 overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-400/60 transition-all duration-1000"
              style={{ width: `${Math.max(0, 100 - (remaining / (task.scheduledAt! - task.createdAt)) * 100)}%` }}
            />
          </div>
          <span className="text-[0.7143rem] font-mono text-blue-400">{formatCountdown(remaining)}</span>
        </div>
      )}
      <div className="mt-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {task.priority && (
            <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[task.priority]}`} title={task.priority} />
          )}
          <span className="text-[0.7143rem] text-text-faint">{ageLabel}</span>
        </div>
        <div className="flex gap-1">
          {prev && (
            <button
              onClick={() => moveTask(task.id, prev)}
              title={COLUMNS.find((c) => c.status === prev)?.label}
              className="flex h-5 w-5 items-center justify-center rounded text-text-faint transition-colors hover:bg-hover hover:text-text"
            >
              <ChevronLeft size={12} strokeWidth={1.6} />
            </button>
          )}
          {next && (
            <button
              onClick={() => moveTask(task.id, next)}
              title={COLUMNS.find((c) => c.status === next)?.label}
              className="flex h-5 w-5 items-center justify-center rounded text-text-faint transition-colors hover:bg-hover hover:text-text"
            >
              <ChevronRight size={12} strokeWidth={1.6} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const PRIORITIES = [
  { value: undefined as "low" | "medium" | "high" | undefined, label: "Yok" },
  { value: "low" as const, label: "Düşük" },
  { value: "medium" as const, label: "Normal" },
  { value: "high" as const, label: "Yüksek" },
];

function AddTaskForm({ onClose }: { onClose: () => void }) {
  const addTask = useTaskStore((s) => s.addTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    addTask(t, desc.trim());
    if (priority) {
      const tasks = useTaskStore.getState().tasks;
      if (tasks[0]) updateTask(tasks[0].id, { priority });
    }
    onClose();
  }

  return (
    <form onSubmit={submit} className="rounded-xl bg-surface-2 p-3">
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        placeholder="Görev başlığı..."
        className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
      />
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="Açıklama (opsiyonel)"
        rows={2}
        className="mt-2 w-full resize-none bg-transparent text-xs text-text-secondary outline-none placeholder:text-text-faint"
      />
      <div className="mt-2 flex items-center gap-1.5">
        {PRIORITIES.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setPriority(p.value)}
            className={`rounded-md px-2 py-0.5 text-[0.7143rem] transition-colors ${
              priority === p.value
                ? "bg-active text-text"
                : "text-text-faint hover:bg-hover hover:text-text-secondary"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2.5 py-1 text-xs text-text-faint transition-colors hover:bg-hover hover:text-text"
        >
          İptal
        </button>
        <button
          type="submit"
          disabled={!title.trim()}
          className="rounded-lg bg-active px-2.5 py-1 text-xs text-text transition-colors hover:bg-border-hover disabled:opacity-30"
        >
          Ekle
        </button>
      </div>
    </form>
  );
}

function AgentTaskForm({ onClose }: { onClose: () => void }) {
  const scheduleTask = useTaskStore((s) => s.scheduleTask);
  const [title, setTitle] = useState("");
  const [userMsg, setUserMsg] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [whenIso, setWhenIso] = useState<string>(() => {
    const d = new Date(Date.now() + 60_000);
    d.setSeconds(0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [recurring, setRecurring] = useState<TaskRecurring>("once");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    const m = userMsg.trim();
    if (!t || !m) return;
    const scheduledAt = new Date(whenIso).getTime();
    if (!Number.isFinite(scheduledAt)) return;
    scheduleTask({
      title: t,
      description: m.slice(0, 120),
      actionType: "agent",
      actionMessage: m,
      agentPrompt: systemPrompt.trim() || undefined,
      scheduledAt,
      recurring,
      source: "user",
    });
    onClose();
  }

  return (
    <form onSubmit={submit} className="rounded-xl bg-surface-2 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[0.7857rem] text-purple-400">
        <Sparkles size={12} strokeWidth={1.6} />
        <span className="uppercase tracking-wider">Agent Görevi</span>
      </div>
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        placeholder="Görev adı (örn. Sabah haber özeti)..."
        className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
      />
      <textarea
        value={userMsg}
        onChange={(e) => setUserMsg(e.target.value)}
        placeholder="Ne yapmasını istiyorsun? (örn. 'Bugün hava nasıl olacak istanbul için kısaca özetle')"
        rows={2}
        className="mt-2 w-full resize-none bg-transparent text-xs text-text-secondary outline-none placeholder:text-text-faint"
      />
      <textarea
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        placeholder="Sistem promptu (opsiyonel — agent'ın kişiliği ve kuralları)"
        rows={2}
        className="mt-2 w-full resize-none bg-transparent text-[0.7857rem] text-text-faint outline-none placeholder:text-text-faint/60"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-[0.7857rem] text-text-faint">
          <Timer size={11} strokeWidth={1.6} />
          <input
            type="datetime-local"
            value={whenIso}
            onChange={(e) => setWhenIso(e.target.value)}
            className="rounded-md bg-surface px-1.5 py-0.5 text-[0.7857rem] text-text-secondary outline-none"
          />
        </label>
        <label className="flex items-center gap-1 text-[0.7857rem] text-text-faint">
          <Repeat size={11} strokeWidth={1.6} />
          <select
            value={recurring}
            onChange={(e) => setRecurring(e.target.value as TaskRecurring)}
            className="rounded-md bg-surface px-1.5 py-0.5 text-[0.7857rem] text-text-secondary outline-none"
          >
            <option value="once">Tek sefer</option>
            <option value="daily">Her gün</option>
            <option value="weekly">Her hafta</option>
          </select>
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2.5 py-1 text-xs text-text-faint transition-colors hover:bg-hover hover:text-text"
        >
          İptal
        </button>
        <button
          type="submit"
          disabled={!title.trim() || !userMsg.trim()}
          className="rounded-lg bg-purple-500/30 px-2.5 py-1 text-xs text-purple-200 transition-colors hover:bg-purple-500/50 disabled:opacity-30"
        >
          Zamanla
        </button>
      </div>
    </form>
  );
}

export function TaskBoard() {
  const tasks = useTaskStore((s) => s.tasks);
  const [adding, setAdding] = useState(false);
  const [addingAgent, setAddingAgent] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-hidden p-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Görevler"
          subtitle="Aktif, zamanlanmış ve tamamlanmış görevler."
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setAddingAgent(true); setAdding(false); }}
            className="flex items-center gap-1.5 rounded-lg bg-purple-500/15 px-3 py-1.5 text-xs text-purple-300 transition-colors hover:bg-purple-500/25"
          >
            <Sparkles size={13} strokeWidth={1.6} />
            Agent Zamanla
          </button>
          <button
            onClick={() => { setAdding(true); setAddingAgent(false); }}
            className="flex items-center gap-1.5 rounded-lg bg-surface px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-2 hover:text-text"
          >
            <Plus size={13} strokeWidth={1.6} />
            Yeni Görev
          </button>
        </div>
      </div>

      <div className="mt-2 grid min-h-0 flex-1 grid-cols-4 gap-3 overflow-hidden">
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.status);
          const Icon = col.icon;
          return (
            <div
              key={col.status}
              className="flex flex-col overflow-hidden rounded-2xl bg-surface"
            >
              <div className="flex items-center gap-2 px-4 pt-4 pb-3">
                <Icon size={14} strokeWidth={1.4} className={col.color} />
                <span className="text-sm text-text-secondary">{col.label}</span>
                <span className="ml-auto rounded-md bg-surface-2 px-1.5 py-0.5 text-[0.7143rem] text-text-faint">
                  {colTasks.length}
                </span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
                {col.status === "pending" && adding && (
                  <AddTaskForm onClose={() => setAdding(false)} />
                )}
                {col.status === "running" && addingAgent && (
                  <AgentTaskForm onClose={() => setAddingAgent(false)} />
                )}
                {colTasks.length === 0 && !(col.status === "pending" && adding) && !(col.status === "running" && addingAgent) && (
                  <div className="rounded-xl bg-surface-2 py-8 text-center text-xs text-text-faint">
                    Görev yok
                  </div>
                )}
                {colTasks.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
