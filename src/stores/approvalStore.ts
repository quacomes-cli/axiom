// Tool onay kuyruğu — permission engine "confirm" dediğinde tool yürütmesi
// burada bekletilir, kullanıcı ApprovalPrompt'tan karar verene kadar promise
// çözülmez. Cevapsız kalan istekler zaman aşımında otomatik REDDEDİLİR ki
// tool döngüsü sonsuza dek askıda kalmasın.

import { create } from "zustand";

export interface ApprovalRequest {
  id: string;
  /** Kısa başlık, örn. "Komut çalıştırma izni" */
  title: string;
  /** Onaylanacak şeyin kendisi: komut satırı, dosya yolu vb. */
  detail: string;
  createdAt: number;
}

interface ApprovalState {
  requests: ApprovalRequest[];
  /** Kullanıcıdan onay iste; karar (veya zaman aşımı) ile çözülür. */
  request: (title: string, detail: string, timeoutMs?: number) => Promise<boolean>;
  decide: (id: string, approved: boolean) => void;
  /** Bekleyen her şeyi reddet (örn. kullanıcı üretimi durdurduğunda). */
  denyAll: () => void;
}

const DEFAULT_TIMEOUT_MS = 120_000;

// Resolver'lar state dışında tutulur — zustand state'i serileştirilebilir kalsın.
const resolvers = new Map<string, (approved: boolean) => void>();

export const useApprovalStore = create<ApprovalState>()((set, get) => ({
  requests: [],

  request: (title, detail, timeoutMs = DEFAULT_TIMEOUT_MS) =>
    new Promise<boolean>((resolve) => {
      const id = crypto.randomUUID();
      resolvers.set(id, resolve);
      set((s) => ({
        requests: [...s.requests, { id, title, detail, createdAt: Date.now() }],
      }));
      setTimeout(() => {
        if (resolvers.has(id)) get().decide(id, false);
      }, timeoutMs);
    }),

  decide: (id, approved) => {
    const resolve = resolvers.get(id);
    resolvers.delete(id);
    set((s) => ({ requests: s.requests.filter((r) => r.id !== id) }));
    resolve?.(approved);
  },

  denyAll: () => {
    for (const id of Array.from(resolvers.keys())) get().decide(id, false);
  },
}));
