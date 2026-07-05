import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useUiStore } from "../../stores/uiStore";
import { PageHeader } from "../shared/PageHeader";
import { GeneralSettings } from "./GeneralSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import { PermissionGrid } from "./PermissionGrid";
import { ProfileSettings } from "./ProfileSettings";
import { UpdaterSettings } from "./UpdaterSettings";
import { McpSettings } from "./McpSettings";
import { useT } from "../../i18n";

const TABS = [
  { id: "general", labelKey: "settings.tabs.general" },
  { id: "profile", labelKey: "settings.tabs.profile" },
  { id: "shortcuts", labelKey: "settings.tabs.shortcuts" },
  { id: "permissions", labelKey: "settings.tabs.permissions" },
  { id: "mcp", labelKey: "settings.tabs.mcp" },
  { id: "updater", labelKey: "settings.tabs.updater" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TAB_IDS = TABS.map((tt) => tt.id);

export function SettingsPage() {
  const t = useT();
  const settingsTab = useUiStore((s) => s.settingsTab);
  const [tab, setTab] = useState<TabId>(
    (TAB_IDS as string[]).includes(settingsTab) ? (settingsTab as TabId) : "general",
  );

  // Menüden derin bağlantıyla açılınca istenen sekmeye geç.
  useEffect(() => {
    if ((TAB_IDS as string[]).includes(settingsTab)) {
      setTab(settingsTab as TabId);
    }
  }, [settingsTab]);

  return (
    <div
      className="h-full overflow-y-auto p-6"
      style={{ scrollbarWidth: "none" }}
    >
      <PageHeader title={t("settings.title")} />

      <div className="mb-6 flex gap-1 rounded-lg bg-surface p-1">
        {TABS.map((tt) => {
          const active = tab === tt.id;
          return (
            <button
              key={tt.id}
              onClick={() => setTab(tt.id)}
              className={`relative flex-1 rounded-lg px-3 py-1.5 text-[0.9286rem] font-medium transition-colors duration-150 ${
                active
                  ? "text-text"
                  : "text-text-faint hover:text-text-secondary"
              }`}
            >
              {active && (
                <motion.div
                  layoutId="settings-tab"
                  className="absolute inset-0 rounded-lg bg-surface-3"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative">{t(tt.labelKey)}</span>
            </button>
          );
        })}
      </div>

      {tab === "general" && <GeneralSettings />}
      {tab === "profile" && <ProfileSettings />}
      {tab === "shortcuts" && <ShortcutSettings />}
      {tab === "permissions" && <PermissionGrid />}
      {tab === "mcp" && <McpSettings />}
      {tab === "updater" && <UpdaterSettings />}
    </div>
  );
}
