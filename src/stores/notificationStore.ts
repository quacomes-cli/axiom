import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface AgentNotification {
  id: string;
  taskId: string;
  title: string;
  content: string;
  createdAt: number;
  read: boolean;
  /** Eğer çıktı bir hata ise true */
  isError?: boolean;
}

interface NotificationState {
  notifications: AgentNotification[];
  add: (n: Omit<AgentNotification, "id" | "createdAt" | "read">) => string;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
  unreadCount: () => number;
}

const MAX_NOTIFICATIONS = 50;

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      notifications: [],

      add: (n) => {
        const id = crypto.randomUUID();
        const notif: AgentNotification = {
          id,
          taskId: n.taskId,
          title: n.title,
          content: n.content,
          createdAt: Date.now(),
          read: false,
          isError: n.isError,
        };
        set((s) => ({
          notifications: [notif, ...s.notifications].slice(0, MAX_NOTIFICATIONS),
        }));
        return id;
      },

      markRead: (id) => {
        set((s) => ({
          notifications: s.notifications.map((x) => (x.id === id ? { ...x, read: true } : x)),
        }));
      },

      markAllRead: () => {
        set((s) => ({
          notifications: s.notifications.map((x) => ({ ...x, read: true })),
        }));
      },

      remove: (id) => {
        set((s) => ({ notifications: s.notifications.filter((x) => x.id !== id) }));
      },

      clear: () => set({ notifications: [] }),

      unreadCount: () => get().notifications.filter((n) => !n.read).length,
    }),
    {
      name: "axiom-notifications",
      version: 1,
      storage: createJSONStorage(() => localStorage),
    }
  )
);
