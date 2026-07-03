// Uygulamaya özel tooltip — native `title` yerine tema uyumlu, konumunu
// bulunduğu nesneye göre seçen (viewport'a sığmazsa karşı kenara atlayan)
// ve okunu hedefin merkezine hizalayan hafif bir balon.
//
// Kullanım: <Tooltip label="Kopyala"><button…/></Tooltip>
// Trigger'a ek DOM sarmalamamak için child'ın kendisi klonlanır; mouse ve
// focus olayları mevcut handler'ları ezmeden zincirlenir.

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

type Side = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  label: React.ReactNode;
  /** Tercih edilen kenar; sığmazsa otomatik karşıya atlar. */
  side?: Side;
  /** Gösterim gecikmesi (ms). */
  delay?: number;
  children: React.ReactElement;
}

const GAP = 7;
const ARROW = 7;

interface Pos {
  side: Side;
  x: number;
  y: number;
  /** Ok merkezinin balon içindeki konumu (px, ilgili eksende). */
  arrowOffset: number;
}

function computePos(trigger: DOMRect, tip: DOMRect, prefer: Side): Pos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const fits: Record<Side, boolean> = {
    top: trigger.top - tip.height - GAP - ARROW >= 4,
    bottom: trigger.bottom + tip.height + GAP + ARROW <= vh - 4,
    left: trigger.left - tip.width - GAP - ARROW >= 4,
    right: trigger.right + tip.width + GAP + ARROW <= vw - 4,
  };
  const opposite: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
  const side: Side = fits[prefer] ? prefer : fits[opposite[prefer]] ? opposite[prefer] : prefer;

  const cx = trigger.left + trigger.width / 2;
  const cy = trigger.top + trigger.height / 2;

  let x: number, y: number;
  if (side === "top" || side === "bottom") {
    x = Math.min(Math.max(4, cx - tip.width / 2), vw - tip.width - 4);
    y = side === "top" ? trigger.top - tip.height - GAP : trigger.bottom + GAP;
    return { side, x, y, arrowOffset: Math.min(Math.max(ARROW + 4, cx - x), tip.width - ARROW - 4) };
  }
  y = Math.min(Math.max(4, cy - tip.height / 2), vh - tip.height - 4);
  x = side === "left" ? trigger.left - tip.width - GAP : trigger.right + GAP;
  return { side, x, y, arrowOffset: Math.min(Math.max(ARROW + 4, cy - y), tip.height - ARROW - 4) };
}

export function Tooltip({ label, side = "top", delay = 350, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    timer.current = setTimeout(() => setOpen(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setOpen(false);
    setPos(null);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Balon DOM'a girince ölç ve konumlandır (ilk frame görünmez ölçüm).
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current?.getBoundingClientRect();
    const tip = tipRef.current?.getBoundingClientRect();
    if (trigger && tip) setPos(computePos(trigger, tip, side));
  }, [open, side]);

  if (!isValidElement(children)) return children;
  const childProps = children.props as Record<string, ((e: unknown) => void) | undefined>;

  const trigger = cloneElement(children as React.ReactElement<Record<string, unknown>>, {
    ref: (el: HTMLElement | null) => {
      triggerRef.current = el;
      const orig = (children as unknown as { ref?: unknown }).ref;
      if (typeof orig === "function") orig(el);
    },
    onMouseEnter: (e: unknown) => { childProps.onMouseEnter?.(e); show(); },
    onMouseLeave: (e: unknown) => { childProps.onMouseLeave?.(e); hide(); },
    onFocus: (e: unknown) => { childProps.onFocus?.(e); show(); },
    onBlur: (e: unknown) => { childProps.onBlur?.(e); hide(); },
    onClick: (e: unknown) => { childProps.onClick?.(e); hide(); },
  });

  const arrowStyle: React.CSSProperties = pos
    ? pos.side === "top"
      ? { left: pos.arrowOffset, bottom: -ARROW / 2 + 1 }
      : pos.side === "bottom"
        ? { left: pos.arrowOffset, top: -ARROW / 2 + 1 }
        : pos.side === "left"
          ? { top: pos.arrowOffset, right: -ARROW / 2 + 1 }
          : { top: pos.arrowOffset, left: -ARROW / 2 + 1 }
    : {};

  const enterOffset =
    pos?.side === "top" ? { y: 4 } : pos?.side === "bottom" ? { y: -4 } : pos?.side === "left" ? { x: 4 } : { x: -4 };

  return (
    <>
      {trigger}
      {open &&
        createPortal(
          <AnimatePresence>
            <motion.div
              ref={tipRef}
              initial={{ opacity: 0, ...enterOffset }}
              animate={{ opacity: pos ? 1 : 0, x: 0, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12, ease: "easeOut" }}
              className="pointer-events-none fixed z-[999] max-w-[280px] rounded-lg border border-border bg-surface-3 px-2.5 py-1.5 text-[0.75rem] leading-snug text-text shadow-xl"
              style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999 }}
            >
              {label}
              <span
                className="absolute h-[7px] w-[7px] rotate-45 border-border bg-surface-3"
                style={{
                  ...arrowStyle,
                  marginLeft: pos && (pos.side === "top" || pos.side === "bottom") ? -ARROW / 2 : undefined,
                  marginTop: pos && (pos.side === "left" || pos.side === "right") ? -ARROW / 2 : undefined,
                  borderRightWidth: pos?.side === "top" || pos?.side === "left" ? 1 : 0,
                  borderBottomWidth: pos?.side === "top" || pos?.side === "right" ? 1 : 0,
                  borderLeftWidth: pos?.side === "bottom" || pos?.side === "right" ? 1 : 0,
                  borderTopWidth: pos?.side === "bottom" || pos?.side === "left" ? 1 : 0,
                }}
              />
            </motion.div>
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
