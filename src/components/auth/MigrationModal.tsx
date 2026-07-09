import { useState } from "react";
import { motion } from "framer-motion";
import { CloudUpload, Loader2, CheckCircle, XCircle } from "lucide-react";
import { useChatStore } from "../../stores/chatStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUserProfileStore } from "../../stores/userProfileStore";
import { useAuthStore } from "../../stores/authStore";
import { migrateAllData } from "../../lib/syncService";
import { useT } from "../../i18n";

type MigrationStep = "ask" | "migrating" | "done" | "error";

export function MigrationModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [step, setStep] = useState<MigrationStep>("ask");
  const [progress, setProgress] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const user = useAuthStore((s) => s.user);

  const chatCount = useChatStore((s) => s.chats.filter((c) => c.messages.length > 0).length);

  async function handleMigrate() {
    if (!user) return;
    setStep("migrating");
    try {
      setProgress(t("migration.preparingChats"));
      const chats = useChatStore.getState().chats.filter((c) => c.messages.length > 0);

      setProgress(t("migration.collectingSettings"));
      const settings = useSettingsStore.getState().settings;

      setProgress(t("migration.gettingProfile"));
      const profile = useUserProfileStore.getState().profile;

      setProgress(t("migration.loadingChats", { count: chats.length }));
      await migrateAllData(user.uid, {
        chats,
        settings: settings as unknown as Record<string, unknown>,
        profile,
      });

      setStep("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl"
      >
        {step === "ask" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2.5">
                <CloudUpload size={24} className="text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text">{t("migration.title")}</h2>
                <p className="text-sm text-text-secondary">{t("migration.subtitle")}</p>
              </div>
            </div>

            <div className="rounded-xl bg-surface-2 p-4 text-sm text-text-secondary space-y-2">
              <p>{t("migration.willTransfer")}</p>
              <ul className="ml-4 list-disc space-y-1">
                <li><span className="text-text">{chatCount}</span> {t("migration.chatHistory")}</li>
                <li>{t("migration.appSettings")}</li>
                <li>{t("migration.profileData")}</li>
              </ul>
            </div>

            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm text-text-secondary transition-colors hover:bg-hover"
              >
                {t("migration.notNow")}
              </button>
              <button
                onClick={handleMigrate}
                className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/80"
              >
                {t("migration.startMigration")}
              </button>
            </div>
          </div>
        )}

        {step === "migrating" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <Loader2 size={32} className="animate-spin text-primary" />
            <div className="text-center">
              <p className="font-medium text-text">{t("migration.migrating")}</p>
              <p className="mt-1 text-sm text-text-secondary">{progress}</p>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <CheckCircle size={32} className="text-emerald-400" />
            <div className="text-center">
              <p className="font-medium text-text">{t("migration.done")}</p>
              <p className="mt-1 text-sm text-text-secondary">{t("migration.doneDesc")}</p>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl bg-primary px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/80"
            >
              {t("migration.ok")}
            </button>
          </div>
        )}

        {step === "error" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <XCircle size={32} className="text-red-400" />
            <div className="text-center">
              <p className="font-medium text-text">{t("migration.failed")}</p>
              <p className="mt-1 text-sm text-text-secondary">{errorMsg}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-sm text-text-secondary hover:bg-hover">{t("migration.close")}</button>
              <button onClick={handleMigrate} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/80">{t("migration.retry")}</button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
