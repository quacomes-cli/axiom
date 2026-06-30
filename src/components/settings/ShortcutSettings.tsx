import { useEffect, useState, useCallback } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Shortcuts } from "../../types";

const SHORTCUT_LABELS: { key: keyof Shortcuts; label: string; hint: string }[] =
  [
    {
      key: "toggleSidebar",
      label: "Kenar çubuğu",
      hint: "Kenar çubuğunu aç/kapat",
    },
    { key: "search", label: "Arama", hint: "Arama modalını aç" },
    {
      key: "toggleScreenVision",
      label: "Ekran görüntüsü",
      hint: "Screen Vision'ı aç/kapat",
    },
    { key: "newChat", label: "Yeni sohbet", hint: "Yeni bir sohbet başlat" },
  ];

function formatKeyCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  const key = e.key;
  if (!["Control", "Alt", "Shift", "Meta"].includes(key)) {
    parts.push(key.length === 1 ? key.toUpperCase() : key);
  }
  return parts.join("+");
}

function ShortcutRow({
  label,
  hint,
  value,
  onRecord,
}: {
  label: string;
  hint: string;
  value: string;
  onRecord: (combo: string) => void;
}) {
  const [recording, setRecording] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;

      const combo = formatKeyCombo(e);
      if (combo) {
        onRecord(combo);
        setRecording(false);
      }
    },
    [onRecord],
  );

  useEffect(() => {
    if (!recording) return;
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [recording, handleKeyDown]);

  useEffect(() => {
    if (!recording) return;
    function onBlur() {
      setRecording(false);
    }
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [recording]);

  return (
    <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-3">
      <div className="min-w-0">
        <div className="text-[0.9286rem] text-text-secondary">{label}</div>
        <div className="mt-0.5 text-xs text-text-faint">{hint}</div>
      </div>
      <button
        onClick={() => setRecording(true)}
        className={`rounded-lg border px-3 py-1.5 font-mono text-[0.8571rem] transition-colors duration-150 ${
          recording
            ? "border-accent text-accent"
            : "border-border text-text-faint hover:border-border-hover hover:text-text-secondary"
        }`}
      >
        {recording ? "Tuşa bas…" : value}
      </button>
    </div>
  );
}

export function ShortcutSettings() {
  const settings = useSettingsStore((s) => s.settings);
  const loaded = useSettingsStore((s) => s.loaded);
  const load = useSettingsStore((s) => s.load);
  const updateShortcut = useSettingsStore((s) => s.updateShortcut);

  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);

  if (!settings) return null;

  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="mb-3 text-[0.7857rem] uppercase tracking-widest text-text-faint">
        Klavye kısayolları
      </div>
      <div className="space-y-1">
        {SHORTCUT_LABELS.map((s) => (
          <ShortcutRow
            key={s.key}
            label={s.label}
            hint={s.hint}
            value={settings.shortcuts[s.key]}
            onRecord={(combo) => updateShortcut(s.key, combo)}
          />
        ))}
      </div>
    </div>
  );
}
