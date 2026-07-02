// Ana pencere ↔ palet penceresi köprüsü.
//
// 1) Global kısayol (settings.shortcuts.palette) palet penceresini açar/kapar —
//    uygulama arka plandayken bile çalışır (tray'de yaşarken asıl değeri bu).
// 2) Paletten "Sohbette devam" ana pencereye `palette-handoff` event'i yollar;
//    burada ana pencere öne alınır ve soru, tam araç/izin altyapısıyla yeni
//    sohbette gönderilir.

import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  register,
  unregister,
  isRegistered,
} from "@tauri-apps/plugin-global-shortcut";
import { useSettingsStore } from "../stores/settingsStore";
import { useChatStore } from "../stores/chatStore";
import { useUiStore } from "../stores/uiStore";

async function togglePalette() {
  const palette = await WebviewWindow.getByLabel("palette");
  if (!palette) return;
  if (await palette.isVisible()) {
    await palette.hide();
  } else {
    await palette.center();
    await palette.show();
    await palette.setFocus();
  }
}

export function usePaletteBridge() {
  const shortcut = useSettingsStore((s) => s.settings?.shortcuts?.palette);

  // Global kısayol kaydı — ayar değişince yeniden kurulur.
  useEffect(() => {
    if (!shortcut) return;
    let active = true;

    (async () => {
      try {
        // StrictMode/HMR kalıntısı olabilir — temiz başla
        if (await isRegistered(shortcut)) await unregister(shortcut);
        if (!active) return;
        await register(shortcut, (event) => {
          if (event.state === "Pressed") void togglePalette();
        });
      } catch (e) {
        console.warn("[palette] global kısayol kaydedilemedi:", shortcut, e);
      }
    })();

    return () => {
      active = false;
      void unregister(shortcut).catch(() => {});
    };
  }, [shortcut]);

  // Paletten gelen "sohbette devam" isteği
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      unlisten = await listen<{ prompt: string }>("palette-handoff", async (e) => {
        const prompt = e.payload?.prompt?.trim();
        if (!prompt) return;
        const main = getCurrentWindow();
        await main.show();
        await main.unminimize();
        await main.setFocus();
        useUiStore.getState().setView("chat");
        useChatStore.getState().newChat();
        void useChatStore.getState().send(prompt);
      });
    })();
    return () => {
      unlisten?.();
    };
  }, []);
}
