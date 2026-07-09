import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Loader2, Sparkles } from "lucide-react";
import { useSkillStore } from "../../stores/skillStore";
import { DiscoverCard, InstalledCard } from "./SkillCard";
import { useT } from "../../i18n";

const PAGE_SIZE = 20;

export function SkillsPanel() {
  const t = useT();
  const availableSkills = useSkillStore((s) => s.availableSkills);
  const installedSkills = useSkillStore((s) => s.installedSkills);
  const loading = useSkillStore((s) => s.loading);
  const activeTab = useSkillStore((s) => s.activeTab);
  const setActiveTab = useSkillStore((s) => s.setActiveTab);
  const fetchSkills = useSkillStore((s) => s.fetchSkills);
  const installSkill = useSkillStore((s) => s.installSkill);
  const uninstallSkill = useSkillStore((s) => s.uninstallSkill);
  const toggleSkill = useSkillStore((s) => s.toggleSkill);

  const [searchValue, setSearchValue] = useState("");
  const [installing, setInstalling] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    fetchSkills(undefined);
  }, [fetchSkills]);

  function handleSearch(val: string) {
    setSearchValue(val);
    setVisibleCount(PAGE_SIZE);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSkills(val || undefined);
    }, 400);
  }

  async function handleInstall(skill: (typeof availableSkills)[0]) {
    setInstalling(skill.id);
    try {
      await installSkill(skill);
    } catch {
      // silently fail
    }
    setInstalling(null);
  }

  const installedIds = new Set(installedSkills.map((s) => s.id));
  const visibleSkills = useMemo(
    () => availableSkills.slice(0, visibleCount),
    [availableSkills, visibleCount],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-6 pt-6 pb-4">
        <div className="flex items-center gap-2.5 mb-4">
          <Sparkles size={20} strokeWidth={1.4} className="text-text-faint" />
          <h1 className="text-lg font-semibold text-text">{t("skills.title")}</h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
            <Search size={14} strokeWidth={1.4} className="text-text-faint" />
            <input
              value={searchValue}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder={t("skills.search")}
              className="flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
            />
          </div>

          <div className="flex rounded-lg bg-surface-2 p-0.5">
            <button
              onClick={() => setActiveTab("discover")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "discover"
                  ? "bg-hover-strong text-text"
                  : "text-text-faint hover:text-text-secondary"
              }`}
            >
              {t("skills.explore")}
            </button>
            <button
              onClick={() => setActiveTab("installed")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "installed"
                  ? "bg-hover-strong text-text"
                  : "text-text-faint hover:text-text-secondary"
              }`}
            >
              {t("skills.installed", { count: installedSkills.length })}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {loading && availableSkills.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={20} className="animate-spin text-text-faint" />
          </div>
        ) : activeTab === "discover" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleSkills.map((skill) => (
                <div key={skill.id} className="relative">
                  <DiscoverCard
                    skill={skill}
                    installed={installedIds.has(skill.id)}
                    onInstall={() => handleInstall(skill)}
                  />
                  {installing === skill.id && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-base/60">
                      <Loader2 size={20} className="animate-spin text-text" />
                    </div>
                  )}
                </div>
              ))}
              {availableSkills.length === 0 && (
                <p className="col-span-full py-10 text-center text-sm text-text-faint">
                  Sonuç bulunamadı
                </p>
              )}
            </div>
            {visibleCount < availableSkills.length && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="rounded-xl bg-surface-2 px-5 py-2.5 text-[0.9286rem] text-text-secondary transition-colors hover:bg-surface-3 hover:text-text"
                >
                  Daha Fazla Göster ({availableSkills.length - visibleCount} yetenek kaldı)
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {installedSkills.map((skill) => (
              <InstalledCard
                key={skill.id}
                skill={skill}
                onToggle={() => toggleSkill(skill.id)}
                onUninstall={() => uninstallSkill(skill.id)}
              />
            ))}
            {installedSkills.length === 0 && (
              <p className="col-span-full py-10 text-center text-sm text-text-faint">
                Henüz yetenek yüklenmedi
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
