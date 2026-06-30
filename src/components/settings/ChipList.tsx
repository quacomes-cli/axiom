import { useState } from "react";
import { Plus, X } from "lucide-react";

export function ChipList({
  items,
  onChange,
  placeholder,
  mono = false,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  mono?: boolean;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v || items.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...items, v]);
    setDraft("");
  }

  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {items.map((item, i) => (
        <span
          key={`${item}-${i}`}
          className={`flex items-center gap-1.5 rounded-md bg-surface-3 py-1 pl-2.5 pr-1.5 text-xs text-text-secondary ${
            mono ? "font-mono" : ""
          }`}
        >
          {item}
          <button
            onClick={() => remove(i)}
            className="text-text-faint transition-colors hover:text-danger"
          >
            <X size={12} strokeWidth={1.6} />
          </button>
        </span>
      ))}

      <div className="flex items-center gap-1 rounded-md bg-surface-2 py-1 pl-2 pr-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder={placeholder}
          className={`w-36 bg-transparent text-xs text-text outline-none placeholder:text-text-faint ${
            mono ? "font-mono" : ""
          }`}
        />
        <button
          onClick={add}
          className="text-text-faint transition-colors hover:text-text-secondary"
        >
          <Plus size={13} strokeWidth={1.6} />
        </button>
      </div>
    </div>
  );
}
