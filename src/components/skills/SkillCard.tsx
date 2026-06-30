import { Star, Download, Trash2, ExternalLink } from "lucide-react";
import type { SkillInfo, InstalledSkill } from "../../types";

function formatStars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function DiscoverCard({
  skill,
  installed,
  onInstall,
}: {
  skill: SkillInfo;
  installed: boolean;
  onInstall: () => void;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-4 transition-colors hover:bg-surface-2">
      <div className="flex items-start gap-3">
        <img
          src={skill.avatarUrl}
          alt={skill.author}
          className="h-9 w-9 shrink-0 rounded-full bg-surface-3"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-text truncate">{skill.name}</h3>
          <p className="text-xs text-text-faint">{skill.author}</p>
        </div>
        {skill.stars > 0 && (
          <span className="flex items-center gap-1 text-xs text-text-faint">
            <Star size={11} strokeWidth={1.6} className="text-amber-400" />
            {formatStars(skill.stars)}
          </span>
        )}
      </div>

      <p className="mt-2 flex-1 text-xs leading-relaxed text-text-secondary line-clamp-2">
        {skill.description || "Açıklama yok"}
      </p>

      <div className="mt-3 flex items-center gap-2">
        {installed ? (
          <span className="text-xs text-text-faint">Yüklü</span>
        ) : (
          <button
            onClick={onInstall}
            className="flex items-center gap-1.5 rounded-lg bg-active px-3 py-1.5 text-xs font-medium text-text transition-colors hover:bg-border-hover"
          >
            <Download size={12} strokeWidth={1.6} />
            Yükle
          </button>
        )}
        <a
          href={skill.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-text-faint transition-colors hover:text-text-secondary"
        >
          <ExternalLink size={13} strokeWidth={1.4} />
        </a>
      </div>
    </div>
  );
}

export function InstalledCard({
  skill,
  onToggle,
  onUninstall,
}: {
  skill: InstalledSkill;
  onToggle: () => void;
  onUninstall: () => void;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-4 transition-colors hover:bg-surface-2">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-sm font-bold text-text-faint">
          {skill.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-text truncate">{skill.name}</h3>
          <p className="text-xs text-text-faint">{skill.author}</p>
        </div>
      </div>

      <p className="mt-2 flex-1 text-xs leading-relaxed text-text-secondary line-clamp-2">
        {skill.description || "Açıklama yok"}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onToggle}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            skill.enabled
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-surface-3 text-text-faint"
          }`}
        >
          {skill.enabled ? "Aktif" : "Pasif"}
        </button>
        <button
          onClick={onUninstall}
          className="ml-auto text-text-faint transition-colors hover:text-red-400"
        >
          <Trash2 size={14} strokeWidth={1.4} />
        </button>
      </div>
    </div>
  );
}
