// Fiyat takibi arka plan kontrolcüsü.
//
// Her CHECK_INTERVAL_MS'de bir, lastChecked'i CHECK_AGE_MS'den eski olan bir
// item'ı seçer ve yeniden scrape eder. Aynı anda yalnızca bir item kontrol
// edilir — host'ları boğmamak için.
//
// Fiyat düşüşü tespit edilirse: OS bildirimi + (Telegram bağlıysa) bot mesajı.

import { useEffect, useRef } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { usePriceTrackStore, type PriceTrackItem } from "../stores/priceTrackStore";
import { useAppStore } from "../stores/appStore";
import { useNotificationStore } from "../stores/notificationStore";
import { scrapePrice } from "../lib/priceScraper";
import { ipc } from "../lib/ipc";

const CHECK_INTERVAL_MS = 60_000; // her dakika bir item kontrol et
const CHECK_AGE_MS = 60 * 60 * 1000; // bir item 1 saatten eski olduysa yeniden kontrol et

let notifReady: boolean | null = null;
async function ensureNotifPermission(): Promise<boolean> {
  if (notifReady === true) return true;
  let granted = await isPermissionGranted();
  if (!granted) {
    const r = await requestPermission();
    granted = r === "granted";
  }
  notifReady = granted;
  return granted;
}

function shouldNotify(item: PriceTrackItem, newPrice: number): { notify: boolean; reason: string } {
  if (item.currentPrice === null) return { notify: false, reason: "" };
  // Hedef altına düştüyse (ve daha önce bu fiyat seviyesinde bildirim atılmadıysa)
  if (item.targetPrice !== null && newPrice <= item.targetPrice) {
    if (item.lastNotifiedPrice === null || newPrice < item.lastNotifiedPrice) {
      return { notify: true, reason: `🎯 Hedef fiyatın (${item.targetPrice}) altına düştü!` };
    }
  }
  // Sadece düşüş ve >=%5 ise bildirim (gürültüyü azalt)
  if (newPrice < item.currentPrice) {
    const pct = ((item.currentPrice - newPrice) / item.currentPrice) * 100;
    if (pct >= 5) {
      return { notify: true, reason: `📉 %${pct.toFixed(1)} düştü` };
    }
  }
  return { notify: false, reason: "" };
}

async function notifyDrop(item: PriceTrackItem, newPrice: number, reason: string) {
  const title = `Axiom — Fiyat düştü: ${item.name}`;
  const body = `${reason}\n${item.currentPrice} → ${newPrice} ${item.currency}\n${item.url}`;

  // 1) OS bildirimi
  if (await ensureNotifPermission()) {
    sendNotification({ title, body });
  }

  // 2) Bildirim merkezi
  useNotificationStore.getState().add({
    taskId: `price-${item.id}-${Date.now()}`,
    title,
    content: body,
  });

  // 3) Telegram (bot bağlı ve chat_id varsa)
  const tg = useAppStore.getState().apps.find((a) => a.id === "telegram");
  const token = tg?.config["bot_token"];
  const chatId = tg?.config["chat_id"];
  if (tg?.enabled && token && chatId) {
    try {
      await ipc.httpFetch({
        url: `https://api.telegram.org/bot${token}/sendMessage`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: `${title}\n\n${body}`,
          parse_mode: "Markdown",
          disable_web_page_preview: false,
        }),
      });
    } catch (e) {
      console.warn("[price] Telegram bildirimi gönderilemedi:", e);
    }
  }
}

async function checkOneStaleItem() {
  const items = usePriceTrackStore.getState().items;
  if (items.length === 0) return;
  const now = Date.now();
  // En eski (veya hiç kontrol edilmemiş) item'ı seç
  const stale = items
    .filter((i) => i.lastChecked === null || now - i.lastChecked > CHECK_AGE_MS)
    .sort((a, b) => (a.lastChecked ?? 0) - (b.lastChecked ?? 0));
  if (stale.length === 0) return;
  const item = stale[0];

  try {
    const result = await scrapePrice(item.url);
    if (result.price === null) {
      usePriceTrackStore.getState().recordScrape(item.id, {
        price: null,
        error: `Fiyat çıkarılamadı (${result.source})`,
      });
      return;
    }

    const { notify, reason } = shouldNotify(item, result.price);
    usePriceTrackStore.getState().recordScrape(item.id, {
      price: result.price,
      currency: result.currency || item.currency,
    });

    if (notify) {
      await notifyDrop(item, result.price, reason);
      usePriceTrackStore.getState().markNotified(item.id, result.price);
    }
  } catch (e) {
    usePriceTrackStore.getState().recordScrape(item.id, {
      price: null,
      error: String(e),
    });
  }
}

export function usePriceTracker() {
  const enabled = useAppStore((s) => s.apps.find((a) => a.id === "price_tracker")?.enabled);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    // 30s sonra ilk çalıştır (uygulama açılır açılmaz patlamasın)
    const firstTimer = setTimeout(() => {
      void checkOneStaleItem();
      intervalRef.current = setInterval(() => {
        void checkOneStaleItem();
      }, CHECK_INTERVAL_MS);
    }, 30_000);

    return () => {
      clearTimeout(firstTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled]);
}
