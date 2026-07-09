import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Paperclip, X } from "lucide-react";
import type { DocumentAttachment } from "../../types";

function imageSrc(doc: DocumentAttachment): string | null {
  if (!doc.base64Data) return null;
  const mime = doc.mimeType || "image/png";
  return `data:${mime};base64,${doc.base64Data}`;
}

export function AttachmentPreviews({
  docs,
  onRemove,
  className,
}: {
  docs: DocumentAttachment[];
  onRemove: (id: string) => void;
  className?: string;
}) {
  const [lightbox, setLightbox] = useState<{ src: string; name: string } | null>(null);

  useEffect(() => {
    if (!lightbox) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightbox(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  if (docs.length === 0) return null;

  return (
    <>
      <div className={`mb-1.5 flex flex-wrap gap-1.5 px-1 ${className ?? ""}`}>
        {docs.map((doc) => {
          const src = imageSrc(doc);
          if (src) {
            return (
              <div
                key={doc.id}
                className="group/att relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-2"
                title={doc.filename}
              >
                <img
                  src={src}
                  alt={doc.filename}
                  className="h-full w-full cursor-zoom-in object-cover"
                  onClick={() => setLightbox({ src, name: doc.filename })}
                />
                <button
                  type="button"
                  onClick={() => onRemove(doc.id)}
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover/att:opacity-100"
                >
                  <X size={10} strokeWidth={2.2} />
                </button>
              </div>
            );
          }
          return (
            <span
              key={doc.id}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2 py-1 text-[0.7857rem] text-text-secondary"
            >
              <Paperclip size={10} strokeWidth={1.6} className="text-text-faint" />
              <span className="max-w-[120px] truncate">{doc.filename}</span>
              <button
                type="button"
                onClick={() => onRemove(doc.id)}
                className="text-text-faint transition-colors hover:text-red-400"
              >
                <X size={10} strokeWidth={2} />
              </button>
            </span>
          );
        })}
      </div>

      {createPortal(
        <AnimatePresence>
          {lightbox && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setLightbox(null)}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-20 backdrop-blur-sm"
            >
              <motion.img
                initial={{ scale: 0.92 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.92 }}
                transition={{ type: "spring", stiffness: 320, damping: 30 }}
                src={lightbox.src}
                alt={lightbox.name}
                onClick={(e) => e.stopPropagation()}
                className="max-h--[75vh] max-w-[75vw] rounded-xl object-contain shadow-2xl"
              />
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="absolute right-15 top-15 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
              >
                <X size={18} strokeWidth={2} />
              </button>
              <span className="absolute bottom-5 left-1/2 -translate-x-1/2 truncate rounded-lg bg-black/50 px-3 py-1 text-xs text-white/80">
                {lightbox.name}
              </span>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
