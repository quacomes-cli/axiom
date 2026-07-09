import { useState, useRef, useEffect } from "react";
import {
  MessageCircle,
  Box,
  BookOpen,
  type LucideIcon,
  LayoutGrid,
  SquareCheckBig,
  Settings2,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Sparkles,
  Ellipsis,
  LogOut,
  LogIn,
  ChevronRight,
  Send,
  TrendingDown,
  Smartphone,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { useUiStore } from "../../stores/uiStore";
import { useChatStore } from "../../stores/chatStore";
import { useCodeStore } from "../../stores/codeStore";
import { useAuthStore } from "../../stores/authStore";
import { useTelegramStore } from "../../stores/telegramStore";
import { useAppStore } from "../../stores/appStore";
import { UpdateReadyButton } from "./UpdateReadyButton";
import { useT } from "../../i18n";
import type { ViewId } from "../../types";

// label = i18n anahtarı (nav.*); render sırasında t() ile çözülür.
const NAV: { id: ViewId; labelKey: string; icon: LucideIcon }[] = [
  { id: "chat", labelKey: "nav.chat", icon: MessageCircle },
  // { id: "code", labelKey: "nav.code", icon: Terminal },
  { id: "library", labelKey: "nav.library", icon: BookOpen },
  { id: "models", labelKey: "nav.models", icon: Box },
  { id: "apps", labelKey: "nav.apps", icon: LayoutGrid },
  { id: "skills", labelKey: "nav.skills", icon: Sparkles },
  { id: "telegram", labelKey: "nav.telegram", icon: Send },
  { id: "price-tracker", labelKey: "nav.priceTracker", icon: TrendingDown },
  { id: "tasks", labelKey: "nav.tasks", icon: SquareCheckBig },
];

const textVariants = {
  hidden: {
    clipPath: "inset(0 100% 0 0)",
    opacity: 0,
  },
  visible: {
    clipPath: "inset(0 0% 0 0)",
    opacity: 1,
  },
};

function FadingLabel({ text, delay = 0 }: { text: string; delay?: number }) {
  return (
    <motion.span
      variants={textVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
      transition={{
        clipPath: { duration: 0.25, ease: [0.32, 0.72, 0, 1], delay },
        opacity: { duration: 0.2, delay },
      }}
      className="whitespace-nowrap text-[0.9286rem] font-normal pr-2.5"
    >
      {text}
    </motion.span>
  );
}

function ChatContextMenu({
  chatId,
  onClose,
  anchorRect,
}: {
  chatId: string;
  onClose: () => void;
  anchorRect: DOMRect;
}) {
  const deleteChat = useChatStore((s) => s.deleteChat);
  const renameChat = useChatStore((s) => s.renameChat);
  const toggleRemoteAllowed = useChatStore((s) => s.toggleRemoteAllowed);
  const chat = useChatStore((s) => s.chats.find((c) => c.id === chatId));
  const menuRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(chat?.title ?? "");
  const t = useT();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  if (renaming) {
    return (
      <div
        ref={menuRef}
        className="fixed z-50 w-60 rounded-lg bg-surface-2 p-0 shadow-xl ring-1 ring-border"
        style={{ top: anchorRect.bottom + 4, left: anchorRect.left }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = renameValue.trim();
            if (v) renameChat(chatId, v);
            onClose();
          }}
          className="flex gap-1 p-1"
        >
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            className="flex-1 rounded-md bg-surface-3 px-1 py-1 text-[0.9286rem] text-text outline-none"
          />
        </form>
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-50 rounded-lg bg-surface-2 p-1 shadow-xl ring-1 ring-accent/15"
      style={{ top: anchorRect.bottom + 4, left: anchorRect.left }}
    >
      <button
        onClick={() => setRenaming(true)}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[0.9286rem] text-text-secondary hover:bg-hover hover:text-text"
      >
        <Pencil size={15} strokeWidth={1.4} />
        {t("sidebar.rename")}
      </button>
      <button
        onClick={() => {
          toggleRemoteAllowed(chatId);
          onClose();
        }}
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[0.9286rem] hover:bg-hover ${
          chat?.remoteAllowed ? "text-success" : "text-text-secondary hover:text-text"
        }`}
      >
        <Smartphone size={15} strokeWidth={1.4} />
        {t("phoneConnect.cmdLabel")}
        {chat?.remoteAllowed && <span className="ml-auto text-[0.7857rem]">✓</span>}
      </button>
      <button
        onClick={() => {
          deleteChat(chatId);
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[0.9286rem] text-red-400 hover:bg-hover hover:text-red-300"
      >
        <Trash2 size={15} strokeWidth={1.4} />
        {t("sidebar.delete")}
      </button>
    </div>
  );
}

function CodeSessionContextMenu({
  sessionId,
  onClose,
  anchorRect,
  onDelete,
  onRename,
  sessions,
}: {
  sessionId: string;
  onClose: () => void;
  anchorRect: DOMRect;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  sessions: { id: string; title: string }[];
}) {
  const session = sessions.find((s) => s.id === sessionId);
  const menuRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(session?.title ?? "");
  const t = useT();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  if (renaming) {
    return (
      <div
        ref={menuRef}
        className="fixed z-50 w-48 rounded-lg bg-surface-2 p-1 shadow-xl ring-1 ring-border"
        style={{ top: anchorRect.bottom + 4, left: anchorRect.left }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = renameValue.trim();
            if (v) onRename(sessionId, v);
            onClose();
          }}
          className="flex gap-1 p-1"
        >
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            className="flex-1 rounded bg-surface-3 px-2 py-1 text-xs text-text outline-none"
          />
        </form>
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-40 rounded-lg bg-surface-2 p-1 shadow-xl ring-1 ring-border"
      style={{ top: anchorRect.bottom + 4, left: anchorRect.left }}
    >
      <button
        onClick={() => setRenaming(true)}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-text-secondary hover:bg-hover hover:text-text"
      >
        <Pencil size={12} strokeWidth={1.4} />
        {t("sidebar.rename")}
      </button>
      <button
        onClick={() => {
          onDelete(sessionId);
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-red-400 hover:bg-hover hover:text-red-300"
      >
        <Trash2 size={12} strokeWidth={1.4} />
        {t("sidebar.delete")}
      </button>
    </div>
  );
}

function AccountButton({ open, onOpenAuth }: { open: boolean; onOpenAuth: () => void }) {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const setView = useUiStore((s) => s.setView);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ bottom: number; left: number } | null>(null);
  const t = useT();

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  if (!user) {
    return (
      <>
        <button
          onClick={() => setView("settings")}
          title={t("sidebar.settings")}
          className="flex items-center rounded-md text-text-faint transition-colors duration-200 hover:bg-hover hover:text-text-secondary"
          style={{ height: 36 }}
        >
          <span className="flex shrink-0 items-center justify-center" style={{ width: 40, height: 36 }}>
            <Settings2 size={17} strokeWidth={1.4} />
          </span>
          <AnimatePresence>
            {open && <FadingLabel text={t("sidebar.settings")} delay={0.02} />}
          </AnimatePresence>
        </button>
        <button
          onClick={onOpenAuth}
          title={t("sidebar.signIn")}
          className="flex items-center rounded-md text-text-faint transition-colors duration-200 hover:bg-hover hover:text-text-secondary"
          style={{ height: 36 }}
        >
          <span className="flex shrink-0 items-center justify-center" style={{ width: 40, height: 36 }}>
            <LogIn size={17} strokeWidth={1.4} />
          </span>
          <AnimatePresence>
            {open && <FadingLabel text={t("sidebar.signIn")} delay={0.03} />}
          </AnimatePresence>
        </button>
      </>
    );
  }

  const initial = (user.displayName?.[0] ?? user.email?.[0] ?? "U").toUpperCase();

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => {
          if (!menuOpen && btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect();
            setMenuPos({ bottom: window.innerHeight - rect.top + 4, left: rect.left });
          }
          setMenuOpen(!menuOpen);
        }}
        title={(user.displayName ?? user.email ?? t("sidebar.account")) + "\n" + (user?.email)}
        className="group flex w-full items-center rounded-md text-text-faint transition-colors duration-200 hover:bg-hover hover:text-text-secondary"
        style={{ height: 36 }}
      >
        <span className="flex shrink-0 items-center justify-center" style={{ width: 40, height: 36 }}>
          {user.photoURL ? (
            <img
              src={user.photoURL}
              className="rounded-full object-cover"
              style={{ width: 28, height: 28 }}
              referrerPolicy="no-referrer"
            />
          ) : (
            <span
              className="flex items-center justify-center rounded-full bg-primary font-bold text-white"
              style={{ width: 20, height: 20, fontSize: 10 }}
            >
              {initial}
            </span>
          )}
        </span>
        <AnimatePresence>
          {open && (
            <>
              <motion.span
                variants={textVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
                transition={{ clipPath: { duration: 0.25, ease: [0.32, 0.72, 0, 1] }, opacity: { duration: 0.2 } }}
                className="flex-1 truncate whitespace-nowrap text-[0.9286rem] font-normal"
              >
                {user.displayName ?? user.email}
              </motion.span>
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="mr-2 flex shrink-0 items-center text-text-faint opacity-0 transition-opacity group-hover:opacity-100"
              >
                <ChevronRight size={14} strokeWidth={1.6} className={`transition-transform duration-150 ${menuOpen ? "rotate-90" : ""}`} />
              </motion.span>
            </>
          )}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {menuOpen && menuPos && (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.1 }}
            className="fixed z-50 min-w-[170px] rounded-md border border-border bg-surface p-1 shadow-xl"
            style={{ bottom: menuPos.bottom, left: menuPos.left }}
          >
            <button
              onClick={() => { setMenuOpen(false); setView("settings"); }}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-[7px] text-left text-[0.9286rem] text-text-secondary transition-colors hover:bg-hover"
            >
              <Settings2 size={15} strokeWidth={1.4} /> {t("sidebar.settings")}
            </button>
            <button
              onClick={() => { setMenuOpen(false); signOut(); }}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-[7px] text-left text-[0.9286rem] text-red-400 transition-colors hover:bg-hover"
            >
              <LogOut size={15} strokeWidth={1.4} /> {t("sidebar.signOut")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Sidebar({ onOpenAuth }: { onOpenAuth: () => void }) {
  const t = useT();
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const open = useUiStore((s) => s.sidebarOpen);

  // Telegram unread sayısı — sidebar'da rozet olarak gösterilir
  const telegramChats = useTelegramStore((s) => s.chats);
  const telegramAvailable = useAppStore((s) => s.apps.find((a) => a.id === "telegram")?.enabled);
  const telegramUnread = Object.values(telegramChats).reduce((sum, c) => sum + c.unread, 0);
  const priceTrackerAvailable = useAppStore((s) => s.apps.find((a) => a.id === "price_tracker")?.enabled);

  const chats = useChatStore((s) => s.chats);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const newChat = useChatStore((s) => s.newChat);
  const switchChat = useChatStore((s) => s.switchChat);

  const codeSessions = useCodeStore((s) => s.sessions);
  const activeCodeSessionId = useCodeStore((s) => s.activeSessionId);
  const newCodeSession = useCodeStore((s) => s.newSession);
  const switchCodeSession = useCodeStore((s) => s.switchSession);
  const deleteCodeSession = useCodeStore((s) => s.deleteSession);
  const renameCodeSession = useCodeStore((s) => s.renameSession);

  const [menuChatId, setMenuChatId] = useState<string | null>(null);
  const [menuRect, setMenuRect] = useState<DOMRect | null>(null);
  const [menuType, setMenuType] = useState<"chat" | "code">("chat");

  function handleNewChat() {
    newChat();
    if (view !== "chat") setView("chat");
  }

  function handleChatClick(id: string) {
    switchChat(id);
    if (view !== "chat") setView("chat");
  }

  async function handleNewCodeSession() {
    const selected = await dialogOpen({
      directory: true,
      title: t("sidebar.pickProjectFolder"),
    });
    if (selected && typeof selected === "string") {
      await newCodeSession(selected);
      if (view !== "code") setView("code");
    }
  }

  function handleCodeSessionClick(id: string) {
    switchCodeSession(id);
    if (view !== "code") setView("code");
  }

  function handleContextMenu(itemId: string, type: "chat" | "code", e: React.MouseEvent) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuChatId(itemId);
    setMenuRect(rect);
    setMenuType(type);
  }

  const showChatList = open && view === "chat";
  const showCodeList = open && view === "code";

  return (
    <>
      <motion.nav
        animate={{ width: open ? 180 : 52 }}
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
        className="flex shrink-0 flex-col overflow-hidden bg-base pt-0 pb-2"
      >
        {/* Nav items */}
        <div className="flex flex-col gap-[2px] px-[6px]">
          {NAV.map(({ id, labelKey, icon: Icon }, i) => {
            // Telegram entegrasyonu kapalıyken sekmeyi tamamen gizle
            if (id === "telegram" && !telegramAvailable) return null;
            // Fiyat takibi app'i kapalıyken sekmeyi gizle
            if (id === "price-tracker" && !priceTrackerAvailable) return null;
            const label = t(labelKey);
            const active = view === id;
            const badge = id === "telegram" && telegramUnread > 0 ? telegramUnread : 0;
            return (
              <button
                key={id}
                onClick={() => setView(id)}
                title={open ? undefined : label}
                className={`relative flex items-center rounded-md ${
                  active
                    ? "bg-hover-strong text-text"
                    : "text-text-faint hover:bg-hover hover:text-text-secondary"
                }`}
                style={{ height: 36 }}
              >
                <span
                  className="relative flex shrink-0 items-center justify-center"
                  style={{ width: 40, height: 36 }}
                >
                  <Icon size={18} strokeWidth={1.4} />
                  {badge > 0 && !open && (
                    <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />
                  )}
                </span>
                <AnimatePresence>
                  {open && <FadingLabel text={label} delay={i * 0.03} />}
                </AnimatePresence>
                {badge > 0 && open && (
                  <span className="ml-auto mr-2 rounded-full bg-accent px-1.5 py-0.5 text-[0.7143rem] font-medium text-white">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Chat list */}
        <AnimatePresence>
          {showChatList && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden px-[6px]"
            >
              <div className="mb-1 flex items-center justify-between px-1">
                <span className="text-[0.7143rem] font-medium uppercase tracking-wider text-text-faint">
                  {t("sidebar.chats")}
                </span>
                <button
                  onClick={handleNewChat}
                  title={t("sidebar.newChat")}
                  className="flex h-5 w-5 items-center justify-center rounded text-text-faint transition-colors hover:bg-hover hover:text-text"
                >
                  <Plus size={12} strokeWidth={1.6} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-none">
                <div className="flex flex-col gap-[1px]">
                  {chats.map((chat) => {
                    const isActive = chat.id === activeChatId;
                    return (
                      <button
                        key={chat.id}
                        onClick={() => handleChatClick(chat.id)}
                        className={`group flex items-center rounded-md px-3 py-2 pr-2 text-left transition-colors duration-150 ${
                          isActive
                            ? "bg-hover text-text"
                            : "text-text-faint hover:bg-hover hover:text-text-secondary"
                        }`}
                      >
                        <span className="flex-1 truncate text-[0.8571rem] leading-tight">
                          {chat.title}
                        </span>
                        <span
                          onClick={(e) => handleContextMenu(chat.id, "chat", e)}
                          className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 hover:bg-hover-strong"
                        >
                          <Ellipsis size={13} strokeWidth={1.8} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Code session list */}
        <AnimatePresence>
          {(showCodeList && false) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden px-[6px]"
            >
              <div className="mb-1 flex items-center justify-between px-1">
                <span className="text-[0.7143rem] font-medium uppercase tracking-wider text-text-faint">
                  {t("sidebar.sessions")}
                </span>
                <button
                  onClick={handleNewCodeSession}
                  title={t("sidebar.newSession")}
                  className="flex h-5 w-5 items-center justify-center rounded text-text-faint transition-colors hover:bg-hover hover:text-text"
                >
                  <Plus size={12} strokeWidth={1.6} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-none">
                <div className="flex flex-col gap-[1px]">
                  {codeSessions.map((session) => {
                    const isActive = session.id === activeCodeSessionId;
                    return (
                      <button
                        key={session.id}
                        onClick={() => handleCodeSessionClick(session.id)}
                        className={`group flex items-center rounded-xl px-3 py-2 text-left transition-colors duration-150 ${
                          isActive
                            ? "bg-hover text-text"
                            : "text-text-faint hover:bg-hover hover:text-text-secondary"
                        }`}
                      >
                        <span className="flex-1 truncate text-[0.8571rem] leading-tight">
                          {session.title}
                        </span>
                        <span
                          onClick={(e) => handleContextMenu(session.id, "code", e)}
                          className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-hover-strong"
                        >
                          <MoreHorizontal size={11} strokeWidth={1.6} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom section: Update button + Account */}
        <div className="mt-auto flex flex-col gap-[2px] px-[6px]">
          <AnimatePresence>
            <UpdateReadyButton open={open} />
          </AnimatePresence>
          <AccountButton open={open} onOpenAuth={onOpenAuth} />
        </div>
      </motion.nav>

      {/* Context menu portal */}
      {menuChatId && menuRect && (
        menuType === "chat" ? (
          <ChatContextMenu
            chatId={menuChatId}
            anchorRect={menuRect}
            onClose={() => { setMenuChatId(null); setMenuRect(null); }}
          />
        ) : (
          <CodeSessionContextMenu
            sessionId={menuChatId}
            anchorRect={menuRect}
            onClose={() => { setMenuChatId(null); setMenuRect(null); }}
            onDelete={deleteCodeSession}
            onRename={renameCodeSession}
            sessions={codeSessions}
          />
        )
      )}
    </>
  );
}
