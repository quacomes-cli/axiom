// Canlı agent koşuları — AgentPanel (sağ drawer) buradan beslenir.
// Mesaja gömülü agentRun kalıcılık içindir; bu store ise "şu an ne çalışıyor"
// sorusunun tek canlı kaynağı: sohbet içi /agent koşuları + arka plan
// (zamanlanmış/TaskBoard) koşuları birlikte listelenir.

import { create } from "zustand";
import type { AgentRun } from "./chatStore";

export interface LiveAgentRun extends AgentRun {
  id: string;
  /** "chat" = /agent (bir mesaja bağlı), "task" = arka plan görevi. */
  source: "chat" | "task";
  /** Sohbet koşularında paneldan mesaja atlanabilsin diye. */
  chatId?: string;
  startedAt: number;
  endedAt?: number;
}

const MAX_KEPT = 20; // biten koşulardan panelde tutulan geçmiş

interface AgentRunState {
  runs: LiveAgentRun[];
  register: (run: LiveAgentRun) => void;
  patch: (id: string, patch: (run: LiveAgentRun) => LiveAgentRun) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
}

export const useAgentRunStore = create<AgentRunState>()((set) => ({
  runs: [],

  register: (run) =>
    set((s) => {
      const next = [run, ...s.runs.filter((r) => r.id !== run.id)];
      // Bitenlerden en eskileri düşür — canlılar her zaman kalır.
      const live = next.filter((r) => !r.endedAt);
      const done = next.filter((r) => r.endedAt).slice(0, MAX_KEPT);
      return { runs: [...live, ...done] };
    }),

  patch: (id, patch) =>
    set((s) => ({ runs: s.runs.map((r) => (r.id === id ? patch(r) : r)) })),

  remove: (id) => set((s) => ({ runs: s.runs.filter((r) => r.id !== id) })),

  clearFinished: () => set((s) => ({ runs: s.runs.filter((r) => !r.endedAt) })),
}));

/** Çalışan (bitmemiş) koşu sayısı — status rozetleri için. */
export function selectRunningCount(s: AgentRunState): number {
  return s.runs.filter((r) => !r.endedAt).length;
}
