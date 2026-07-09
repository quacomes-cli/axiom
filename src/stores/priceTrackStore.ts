// Fiyat takibi store'u.
//
// Kullanıcı (genelde sohbette AI'a) bir URL verir → AI `price_track_add` tool'u
// ile burada bir kayıt oluşturur. Arka plandaki periyodik kontrol (hook) her
// item'ı belirli aralıklarla scrape eder, fiyat düşüşlerini bildirim + Telegram
// üzerinden duyurur.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface PriceHistoryPoint {
  ts: number; // epoch ms
  price: number;
  currency: string;
}

export interface PriceTrackItem {
  id: string;
  name: string;
  url: string;
  /** Son scrape'te bulunan fiyat (yoksa null = henüz kontrol edilmedi) */
  currentPrice: number | null;
  currency: string;
  /** Kullanıcının istediği eşik fiyat — bunun altına düşerse alarm */
  targetPrice: number | null;
  /** En düşük tarihsel fiyat (bildirim "all-time low" karşılaştırması için) */
  lowestPrice: number | null;
  addedAt: number;
  lastChecked: number | null;
  lastError: string | null;
  /** Son N fiyat noktası — UI grafik ve "düştü mü" kontrolü için */
  history: PriceHistoryPoint[];
  /** Sıralı bildirimler için: en son bildirim atılan fiyat */
  lastNotifiedPrice: number | null;
}

interface PriceTrackState {
  items: PriceTrackItem[];
  add: (item: Omit<PriceTrackItem, "id" | "addedAt" | "history" | "lastChecked" | "lastError" | "lowestPrice" | "currentPrice" | "lastNotifiedPrice"> & {
    currentPrice?: number | null;
  }) => string;
  remove: (id: string) => void;
  /** Bir scrape sonucunu kaydet (fiyat değiştiyse history'e ekler) */
  recordScrape: (id: string, result: { price: number | null; currency?: string; error?: string }) => void;
  markNotified: (id: string, price: number) => void;
  updateMeta: (id: string, patch: Partial<Pick<PriceTrackItem, "name" | "targetPrice">>) => void;
}

const MAX_HISTORY = 200;

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const usePriceTrackStore = create<PriceTrackState>()(
  persist(
    (set) => ({
      items: [],

      add: (init) => {
        const id = genId();
        set((s) => ({
          items: [
            ...s.items,
            {
              id,
              name: init.name,
              url: init.url,
              currentPrice: init.currentPrice ?? null,
              currency: init.currency || "TRY",
              targetPrice: init.targetPrice ?? null,
              lowestPrice: init.currentPrice ?? null,
              addedAt: Date.now(),
              lastChecked: null,
              lastError: null,
              history: [],
              lastNotifiedPrice: null,
            },
          ],
        }));
        return id;
      },

      remove: (id) => {
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
      },

      recordScrape: (id, { price, currency, error }) => {
        set((s) => ({
          items: s.items.map((item) => {
            if (item.id !== id) return item;
            const now = Date.now();
            if (error) {
              return { ...item, lastChecked: now, lastError: error };
            }
            if (price === null) {
              return { ...item, lastChecked: now, lastError: "Fiyat bulunamadı" };
            }
            const cur = currency || item.currency;
            const changed = item.currentPrice !== price;
            const history = changed
              ? [...item.history, { ts: now, price, currency: cur }].slice(-MAX_HISTORY)
              : item.history;
            const lowest =
              item.lowestPrice === null || price < item.lowestPrice
                ? price
                : item.lowestPrice;
            return {
              ...item,
              currentPrice: price,
              currency: cur,
              lowestPrice: lowest,
              lastChecked: now,
              lastError: null,
              history,
            };
          }),
        }));
      },

      markNotified: (id, price) => {
        set((s) => ({
          items: s.items.map((i) =>
            i.id === id ? { ...i, lastNotifiedPrice: price } : i,
          ),
        }));
      },

      updateMeta: (id, patch) => {
        set((s) => ({
          items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
        }));
      },
    }),
    {
      name: "axiom-price-track",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
