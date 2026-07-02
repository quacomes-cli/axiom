// Tool onay kuyruğu — permission engine "confirm" dediğinde tool yürütmesi
// burada bekletilir, kullanıcı ApprovalPrompt'tan karar verene kadar promise
// çözülmez. Cevapsız kalan istekler zaman aşımında otomatik REDDEDİLİR ki
// tool döngüsü sonsuza dek askıda kalmasın.
//
// Kararlar üç yönlü: "once" (sadece bu sefer), "always" (kalıcı — çağıran,
// izin config'ini günceller; İzinler sayfası aynı config'i okuduğu için
// otomatik senkron olur), "deny".

import { create } from "zustand";

export type ApprovalDecision = "once" | "always" | "deny";

export interface ApprovalRequest {
  id: string;
  /** Kısa başlık, örn. "Komut çalıştırma izni" */
  title: string;
  /** Onaylanacak şeyin kendisi: komut satırı, dosya yolu vb. */
  detail: string;
  /** "Her zaman izin ver" seçilirse kalıcı kuralın neyi kapsayacağı (örn. dizin). */
  alwaysHint?: string;
  createdAt: number;
}

interface ApprovalState {
  requests: ApprovalRequest[];
  /** Kullanıcıdan onay iste; karar (veya zaman aşımında "deny") ile çözülür. */
  request: (
    title: string,
    detail: string,
    opts?: { alwaysHint?: string; timeoutMs?: number },
  ) => Promise<ApprovalDecision>;
  decide: (id: string, decision: ApprovalDecision) => void;
  /** Bekleyen her şeyi reddet (örn. kullanıcı üretimi durdurduğunda). */
  denyAll: () => void;
}

const DEFAULT_TIMEOUT_MS = 120_000;

// Resolver'lar state dışında tutulur — zustand state'i serileştirilebilir kalsın.
const resolvers = new Map<string, (decision: ApprovalDecision) => void>();

export const useApprovalStore = create<ApprovalState>()((set, get) => ({
  requests: [],

  request: (title, detail, opts) =>
    new Promise<ApprovalDecision>((resolve) => {
      const id = crypto.randomUUID();
      resolvers.set(id, resolve);
      set((s) => ({
        requests: [
          ...s.requests,
          { id, title, detail, alwaysHint: opts?.alwaysHint, createdAt: Date.now() },
        ],
      }));
      setTimeout(() => {
        if (resolvers.has(id)) get().decide(id, "deny");
      }, opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    }),

  decide: (id, decision) => {
    const resolve = resolvers.get(id);
    resolvers.delete(id);
    set((s) => ({ requests: s.requests.filter((r) => r.id !== id) }));
    resolve?.(decision);
  },

  denyAll: () => {
    for (const id of Array.from(resolvers.keys())) get().decide(id, "deny");
  },
}));
