// Tool onay kartları — approvalStore'daki bekleyen istekleri sağ altta,
// hangi sekmede olursa olsun gösterir. Üç karar: Reddet / Bu sefer izin ver /
// Her zaman izin ver (kalıcı kural — İzinler sayfasına işlenir).

import { ShieldAlert } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useApprovalStore } from "../../stores/approvalStore";

export function ApprovalPrompt() {
  const requests = useApprovalStore((s) => s.requests);
  const decide = useApprovalStore((s) => s.decide);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-full max-w-sm flex-col gap-2">
      <AnimatePresence>
        {requests.map((r) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-auto rounded-xl border border-text/7 bg-surface p-3 shadow-2xl"
          >
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-text">
                <ShieldAlert size={14} strokeWidth={1.8} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[0.8571rem] font-medium text-text">{r.title}</div>
                <pre className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-surface-2 px-2 py-1.5 font-mono text-[0.75rem] leading-relaxed text-text-secondary">
                  {r.detail}
                </pre>
                {r.alwaysHint && (
                  <div className="mt-1 text-[0.7143rem] leading-snug text-text-faint">
                    "Her zaman": {r.alwaysHint}
                  </div>
                )}
                <div className="mt-2 flex justify-end gap-1.5">
                  <button
                    onClick={() => decide(r.id, "deny")}
                    className="rounded-md bg-surface-2 px-2.5 py-1 text-xs text-text-faint transition-colors hover:bg-surface-3 hover:text-text-secondary"
                  >
                    Reddet
                  </button>
                  <button
                    onClick={() => decide(r.id, "once")}
                    className="rounded-md bg-accent/15 px-2.5 py-1 text-xs font-medium text-text transition-colors hover:bg-accent/25"
                  >
                    Bu sefer
                  </button>
                  <button
                    onClick={() => decide(r.id, "always")}
                    title={r.alwaysHint ?? "Bu izin türü kalıcı olarak açılır (İzinler sayfasından değiştirilebilir)"}
                    className="rounded-md bg-accent/25 px-2.5 py-1 text-xs font-medium text-text transition-colors hover:bg-accent/35"
                  >
                    Her zaman
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
