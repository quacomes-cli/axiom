// Tool onay kartları — approvalStore'daki bekleyen istekleri sağ altta,
// hangi sekmede olursa olsun gösterir. Onayla/Reddet kararı ilgili tool
// yürütmesinin promise'ini çözer.

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
            className="pointer-events-auto rounded-xl border border-warn/30 bg-surface p-3 shadow-2xl"
          >
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-warn/15 text-warn">
                <ShieldAlert size={14} strokeWidth={1.8} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[0.8571rem] font-medium text-text">{r.title}</div>
                <pre className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-surface-2 px-2 py-1.5 font-mono text-[0.75rem] leading-relaxed text-text-secondary">
                  {r.detail}
                </pre>
                <div className="mt-2 flex justify-end gap-1.5">
                  <button
                    onClick={() => decide(r.id, false)}
                    className="rounded-lg bg-surface-2 px-3 py-1 text-xs text-text-faint transition-colors hover:bg-surface-3 hover:text-text-secondary"
                  >
                    Reddet
                  </button>
                  <button
                    onClick={() => decide(r.id, true)}
                    className="rounded-lg bg-warn/15 px-3 py-1 text-xs font-medium text-warn transition-colors hover:bg-warn/25"
                  >
                    İzin ver
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
