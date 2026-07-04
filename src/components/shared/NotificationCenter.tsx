import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, X, CheckCheck, MessageSquarePlus, AlertCircle } from "lucide-react";
import { useNotificationStore, type AgentNotification } from "../../stores/notificationStore";
import { useChatStore } from "../../stores/chatStore";
import { useUiStore } from "../../stores/uiStore";
import { useT, t as translate } from "../../i18n";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return translate("tasks.justNow");
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} ${translate("tasks.unitMin")}`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ${translate("tasks.unitHour")}`;
  return new Date(ts).toLocaleDateString();
}

function NotificationItem({
  n,
  onOpen,
  onDismiss,
}: {
  n: AgentNotification;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const markRead = useNotificationStore((s) => s.markRead);
  const remove = useNotificationStore((s) => s.remove);
  return (
    <div
      onClick={() => markRead(n.id)}
      className={`group relative rounded-md px-2 py-2 transition-colors hover:bg-hover-strong cursor-pointer ${
        n.read ? "" : "bg-hover/40"
      }`}
    >
      <div className="flex items-start gap-2">
        {n.isError ? (
          <AlertCircle size={14} className="shrink-0 text-red-400" />
        ) : (
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              n.read ? "bg-text-faint/40" : "bg-blue-400"
            }`}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-medium text-text-secondary">{n.title}</span>
            <span className="shrink-0 text-[0.7143rem] text-text-faint">{timeAgo(n.createdAt)}</span>
          </div>
          <div className="mt-0 line-clamp-3 text-[0.7857rem] leading-relaxed text-text-faint">
            {n.content}
          </div>
          {!n.isError && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                markRead(n.id);
                onOpen();
                onDismiss();
              }}
              className="mt-1.5 inline-flex items-center gap-1 text-[0.8571rem] text-blue-400 transition-colors hover:text-blue-300"
            >
              <MessageSquarePlus size={11} />
              {t("notif.openAsNewChat")}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            remove(n.id);
          }}
          className="opacity-0 transition-opacity group-hover:opacity-100"
          title={t("common.delete")}
        >
          <X size={12} className="text-text-faint hover:text-text-secondary" />
        </button>
      </div>
    </div>
  );
}

export function NotificationCenter() {
  const t = useT();
  const notifications = useNotificationStore((s) => s.notifications);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const clear = useNotificationStore((s) => s.clear);
  const newChat = useChatStore((s) => s.newChat);
  const injectAssistantMessage = useChatStore((s) => s.injectAssistantMessage);
  const setView = useUiStore((s) => s.setView);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  function openAsChat(n: AgentNotification) {
    newChat();
    setView("chat");
    // newChat senkron set ediyor — injekte etmeden önce bir mikrotask bekle.
    setTimeout(() => {
      injectAssistantMessage(n.content, n.title);
    }, 0);
  }

  return (
    <div ref={panelRef} className="relative" style={{ zIndex: 1001 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center gap-1.5 px-3 py-1 text-[1.0714rem] text-text-faint transition-all duration-200 hover:text-text-secondary"
        title="Bildirimler"
      >
        <Bell size={14} strokeWidth={1.4} />
        {unread > 0 && (
          <span className="absolute top-0 right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-blue-400 px-1 text-[0.6429rem] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-1 w-80 overflow-hidden rounded-xl border border-border bg-surface-2 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs font-semibold text-text-secondary">{t("settings.sections.notifications")}</span>
              <div className="flex items-center gap-2">
                {notifications.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={markAllRead}
                      title={t("notif.markAllRead")}
                      className="text-text-faint transition-colors hover:text-text-secondary"
                    >
                      <CheckCheck size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={clear}
                      title={t("notif.deleteAll")}
                      className="text-text-faint transition-colors hover:text-red-400"
                    >
                      <X size={13} />
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto p-1.5 scrollbar-thin">
              {notifications.length === 0 ? (
                <div className="px-3 py-8 text-center text-xs text-text-faint">
                  {t("notif.empty")}
                  <br />
                  {t("notif.emptyHint")}
                </div>
              ) : (
                <div className="space-y-1">
                  {notifications.map((n) => (
                    <NotificationItem
                      key={n.id}
                      n={n}
                      onOpen={() => void openAsChat(n)}
                      onDismiss={() => setOpen(false)}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
