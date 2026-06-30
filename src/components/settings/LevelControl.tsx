import { useId } from "react";
import { motion } from "framer-motion";
import type { PermissionLevel } from "../../types";

const OPTIONS: { value: PermissionLevel; label: string; dot: string }[] = [
  { value: "allowed", label: "Serbest", dot: "bg-success" },
  { value: "confirm", label: "Onay", dot: "bg-warn" },
  { value: "blocked", label: "Engelli", dot: "bg-danger" },
];

export function LevelControl({
  value,
  onChange,
}: {
  value: PermissionLevel;
  onChange: (level: PermissionLevel) => void;
}) {
  const id = useId();

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
      {OPTIONS.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`relative flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[0.7857rem] transition-colors duration-150 ${
              active ? "text-text" : "text-text-faint hover:text-text-secondary"
            }`}
          >
            {active && (
              <motion.div
                layoutId={`level-${id}`}
                className="absolute inset-0 rounded-md bg-active"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span
              className={`relative h-1.5 w-1.5 rounded-full transition-opacity ${o.dot} ${
                active ? "opacity-100" : "opacity-30"
              }`}
            />
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
