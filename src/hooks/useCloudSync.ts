import { useEffect, useRef } from "react";
import { useAuthStore } from "../stores/authStore";
import { useChatStore } from "../stores/chatStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUserProfileStore } from "../stores/userProfileStore";
import { uploadChat, uploadSettings, uploadProfile, deleteCloudChat } from "../lib/syncService";

const DEBOUNCE_MS = 3000;

export function useCloudSync() {
  const user = useAuthStore((s) => s.user);
  const chats = useChatStore((s) => s.chats);
  const settings = useSettingsStore((s) => s.settings);
  const profile = useUserProfileStore((s) => s.profile);
  const profileEnabled = useUserProfileStore((s) => s.enabled);

  const prevChatsRef = useRef(chats);
  const prevSettingsRef = useRef(settings);
  const prevProfileRef = useRef(profile);
  const prevProfileEnabledRef = useRef(profileEnabled);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync chats
  useEffect(() => {
    if (!user) return;
    const prev = prevChatsRef.current;
    prevChatsRef.current = chats;

    // Find changed chats
    const changed: typeof chats = [];
    for (const chat of chats) {
      const old = prev.find((c) => c.id === chat.id);
      if (!old || old.messages.length !== chat.messages.length || old.title !== chat.title) {
        if (chat.messages.length > 0) changed.push(chat);
      }
    }

    // Find deleted chats
    const deleted = prev.filter((p) => !chats.find((c) => c.id === p.id) && p.messages.length > 0);

    if (changed.length === 0 && deleted.length === 0) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      for (const chat of changed) {
        uploadChat(user.uid, chat).catch((e) => console.error("[Sync] Chat upload failed:", e));
      }
      for (const chat of deleted) {
        deleteCloudChat(user.uid, chat.id).catch((e) => console.error("[Sync] Chat delete failed:", e));
      }
    }, DEBOUNCE_MS);
  }, [user, chats]);

  // Sync settings
  useEffect(() => {
    if (!user || !settings) return;
    if (prevSettingsRef.current === settings) return;
    prevSettingsRef.current = settings;

    const timer = setTimeout(() => {
      uploadSettings(user.uid, settings as unknown as Record<string, unknown>)
        .catch((e) => console.error("[Sync] Settings upload failed:", e));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [user, settings]);

  // Sync profile
  useEffect(() => {
    if (!user) return;
    if (prevProfileRef.current === profile && prevProfileEnabledRef.current === profileEnabled) return;
    prevProfileRef.current = profile;
    prevProfileEnabledRef.current = profileEnabled;

    const timer = setTimeout(() => {
      uploadProfile(user.uid, profile, profileEnabled)
        .catch((e) => console.error("[Sync] Profile upload failed:", e));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [user, profile, profileEnabled]);
}
