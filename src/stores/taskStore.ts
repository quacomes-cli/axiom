import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type TaskStatus = "pending" | "running" | "completed" | "failed";
export type TaskActionType = "reminder" | "timer" | "alarm" | "agent";
export type TaskRecurring = "once" | "daily" | "weekly";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  source: "user" | "agent";
  chatId?: string;
  priority?: "low" | "medium" | "high";
  actionType?: TaskActionType;
  actionMessage?: string;
  scheduledAt?: number;
  executedAt?: number;
  /** "agent" görevleri için sistem promptu */
  agentPrompt?: string;
  /** "agent" tipi görevlerin tekrar düzeni; undefined => once */
  recurring?: TaskRecurring;
  /** Agent görevinin son üretilen çıktı bildirim ID'si */
  lastNotificationId?: string;
}

interface TaskState {
  tasks: Task[];
  addTask: (title: string, description?: string, source?: "user" | "agent", chatId?: string) => string;
  updateTask: (id: string, patch: Partial<Pick<Task, "title" | "description" | "status" | "priority">>) => void;
  deleteTask: (id: string) => void;
  moveTask: (id: string, status: TaskStatus) => void;
  scheduleTask: (opts: {
    title: string;
    description?: string;
    actionType: TaskActionType;
    actionMessage?: string;
    scheduledAt: number;
    source?: "user" | "agent";
    chatId?: string;
    priority?: "low" | "medium" | "high";
    agentPrompt?: string;
    recurring?: TaskRecurring;
  }) => string;
  markExecuted: (id: string) => void;
  /** Recurring agent görevini bir sonraki çalıştırma zamanına ileri sar */
  rescheduleNext: (id: string) => void;
  attachNotification: (id: string, notificationId: string) => void;
}

export const useTaskStore = create<TaskState>()(
  persist(
    (set) => ({
      tasks: [],

      addTask: (title, description = "", source = "user", chatId) => {
        const id = crypto.randomUUID();
        const task: Task = {
          id,
          title,
          description,
          status: "pending",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          source,
          chatId,
        };
        set((s) => ({ tasks: [task, ...s.tasks] }));
        return id;
      },

      updateTask: (id, patch) => {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t
          ),
        }));
      },

      deleteTask: (id) => {
        set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
      },

      moveTask: (id, status) => {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, status, updatedAt: Date.now() } : t
          ),
        }));
      },

      scheduleTask: (opts) => {
        const id = crypto.randomUUID();
        const task: Task = {
          id,
          title: opts.title,
          description: opts.description || "",
          status: "running",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          source: opts.source || "agent",
          chatId: opts.chatId,
          priority: opts.priority,
          actionType: opts.actionType,
          actionMessage: opts.actionMessage,
          scheduledAt: opts.scheduledAt,
          agentPrompt: opts.agentPrompt,
          recurring: opts.recurring,
        };
        set((s) => ({ tasks: [task, ...s.tasks] }));
        return id;
      },

      markExecuted: (id) => {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, status: "completed" as TaskStatus, executedAt: Date.now(), updatedAt: Date.now() } : t
          ),
        }));
      },

      rescheduleNext: (id) => {
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== id || !t.scheduledAt || !t.recurring || t.recurring === "once") {
              return t;
            }
            const dayMs = 24 * 60 * 60 * 1000;
            const step = t.recurring === "daily" ? dayMs : dayMs * 7;
            // Geçmişte kaldıysa bir sonraki gelecek zamana atla
            let next = t.scheduledAt + step;
            const now = Date.now();
            while (next <= now) next += step;
            return {
              ...t,
              scheduledAt: next,
              status: "running" as TaskStatus,
              executedAt: undefined,
              updatedAt: Date.now(),
            };
          }),
        }));
      },

      attachNotification: (id, notificationId) => {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, lastNotificationId: notificationId, updatedAt: Date.now() } : t
          ),
        }));
      },
    }),
    {
      name: "axiom-tasks",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as { tasks?: unknown[] };
        if (version < 1 && state.tasks) {
          state.tasks = state.tasks.map((t: any) => ({ ...t, source: t.source ?? "user" }));
        }
        return persisted as TaskState;
      },
    }
  )
);
