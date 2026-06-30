// Fiyat takibi yönetim sayfası.
//
// Üstte: yeni ürün ekleme formu (URL + opsiyonel hedef fiyat).
// Altta: takip edilen ürünler, kart halinde. Her kart: isim, fiyat, en düşük,
// hedef, mini sparkline (history varsa), "şimdi kontrol et" + "sil".

import { useState } from "react";
import {
  Plus,
  Trash2,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Loader2,
  TrendingDown,
} from "lucide-react";
import { PageHeader } from "../shared/PageHeader";
import { usePriceTrackStore, type PriceTrackItem } from "../../stores/priceTrackStore";
import { scrapePrice } from "../../lib/priceScraper";

function formatPrice(p: number | null, cur: string): string {
  if (p === null) return "—";
  return `${p.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} ${cur}`;
}

function formatRelative(ts: number | null): string {
  if (!ts) return "henüz kontrol edilmedi";
  const sec = (Date.now() - ts) / 1000;
  if (sec < 60) return "şimdi";
  if (sec < 3600) return `${Math.floor(sec / 60)} dk önce`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} sa önce`;
  return `${Math.floor(sec / 86400)} gün önce`;
}

function Sparkline({ history }: { history: PriceTrackItem["history"] }) {
  if (history.length < 2) {
    return <div className="h-10 text-[0.7143rem] text-text-faint">Yeterli geçmiş yok</div>;
  }
  const prices = history.map((h) => h.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const w = 120;
  const h = 30;
  const points = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * w;
    const y = h - ((p - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = prices[prices.length - 1];
  const first = prices[0];
  const color = last < first ? "#22c55e" : last > first ? "#ef4444" : "#a1a1aa";
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        points={points.join(" ")}
      />
    </svg>
  );
}

function ItemCard({ item }: { item: PriceTrackItem }) {
  const remove = usePriceTrackStore((s) => s.remove);
  const recordScrape = usePriceTrackStore((s) => s.recordScrape);
  const updateMeta = usePriceTrackStore((s) => s.updateMeta);
  const [checking, setChecking] = useState(false);
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetValue, setTargetValue] = useState(
    item.targetPrice !== null ? String(item.targetPrice) : "",
  );

  async function checkNow() {
    setChecking(true);
    try {
      const result = await scrapePrice(item.url);
      if (result.price === null) {
        recordScrape(item.id, { price: null, error: `Fiyat çıkarılamadı (${result.source})` });
      } else {
        recordScrape(item.id, { price: result.price, currency: result.currency || item.currency });
      }
    } finally {
      setChecking(false);
    }
  }

  function saveTarget() {
    const v = targetValue.trim();
    if (!v) {
      updateMeta(item.id, { targetPrice: null });
    } else {
      const num = parseFloat(v.replace(",", "."));
      if (isFinite(num) && num > 0) {
        updateMeta(item.id, { targetPrice: num });
      }
    }
    setEditingTarget(false);
  }

  const delta =
    item.history.length >= 2
      ? item.currentPrice! - item.history[0].price
      : 0;
  const deltaPct =
    item.history.length >= 2
      ? (delta / item.history[0].price) * 100
      : 0;

  return (
    <div className="rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center gap-1.5 text-sm font-medium text-text hover:text-accent"
          >
            <span className="truncate">{item.name}</span>
            <ExternalLink size={12} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </a>
          <div className="mt-0.5 truncate text-[0.7143rem] text-text-faint">
            {new URL(item.url).hostname}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={checkNow}
            disabled={checking}
            className="rounded-md p-1.5 text-text-faint hover:bg-hover hover:text-text disabled:opacity-50"
            title="Şimdi kontrol et"
          >
            {checking ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} strokeWidth={1.6} />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`"${item.name}" takipten çıkarılsın mı?`)) remove(item.id);
            }}
            className="rounded-md p-1.5 text-text-faint hover:bg-hover hover:text-red-400"
            title="Takipten çıkar"
          >
            <Trash2 size={13} strokeWidth={1.6} />
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <div className="text-xl font-medium text-text">
            {formatPrice(item.currentPrice, item.currency)}
          </div>
          {item.lowestPrice !== null && item.lowestPrice !== item.currentPrice && (
            <div className="mt-0.5 text-[0.7857rem] text-text-faint">
              En düşük: {formatPrice(item.lowestPrice, item.currency)}
            </div>
          )}
        </div>
        <Sparkline history={item.history} />
      </div>

      {item.history.length >= 2 && (
        <div className={`mt-2 text-[0.7857rem] ${delta < 0 ? "text-green-400" : delta > 0 ? "text-red-400" : "text-text-faint"}`}>
          {delta < 0 ? "↓" : delta > 0 ? "↑" : "•"} {Math.abs(delta).toFixed(2)} {item.currency} ({deltaPct.toFixed(1)}%) — takibe alındığından beri
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-[0.7857rem] text-text-faint">
        <span>Hedef:</span>
        {editingTarget ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveTarget();
            }}
            className="flex items-center gap-1"
          >
            <input
              autoFocus
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              onBlur={saveTarget}
              onKeyDown={(e) => e.key === "Escape" && setEditingTarget(false)}
              placeholder="örn 1500"
              className="w-20 rounded bg-surface-2 px-1.5 py-0.5 text-[0.7857rem] text-text outline-none focus:ring-1 focus:ring-accent"
            />
            <span>{item.currency}</span>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setTargetValue(item.targetPrice !== null ? String(item.targetPrice) : "");
              setEditingTarget(true);
            }}
            className="text-text-secondary underline-offset-2 hover:underline"
          >
            {item.targetPrice !== null ? `${item.targetPrice} ${item.currency}` : "ayarla"}
          </button>
        )}
        <span className="ml-auto">{formatRelative(item.lastChecked)}</span>
      </div>

      {item.lastError && (
        <div className="mt-2 flex items-center gap-1.5 rounded-md bg-red-500/10 px-2 py-1 text-[0.7857rem] text-red-400">
          <AlertCircle size={11} />
          <span>{item.lastError}</span>
        </div>
      )}
    </div>
  );
}

function AddForm() {
  const add = usePriceTrackStore((s) => s.add);
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const cleanUrl = url.trim();
    if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
      setError("URL http:// veya https:// ile başlamalı");
      return;
    }
    setBusy(true);
    try {
      const result = await scrapePrice(cleanUrl);
      if (result.price === null) {
        setError(`Fiyat çıkarılamadı (yöntem: ${result.source}). Site dinamik yüklüyor olabilir.`);
        return;
      }
      const finalName = name.trim() || result.title || new URL(cleanUrl).hostname;
      const targetNum = target.trim() ? parseFloat(target.trim().replace(",", ".")) : null;
      add({
        name: finalName,
        url: cleanUrl,
        currentPrice: result.price,
        currency: result.currency || "TRY",
        targetPrice: targetNum && isFinite(targetNum) ? targetNum : null,
      });
      setUrl("");
      setTarget("");
      setName("");
      setSuccess(`✓ "${finalName}" — ${result.price} ${result.currency || "TRY"} takibe alındı`);
      setTimeout(() => setSuccess(null), 4000);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-border bg-surface-1 p-4">
      <div className="mb-3 text-[0.7857rem] uppercase tracking-wider text-text-faint">
        Yeni ürün ekle
      </div>
      <div className="flex flex-col gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://hepsiburada.com/... veya başka bir e-ticaret URL'si"
          disabled={busy}
          className="rounded-md bg-surface-2 px-3 py-2 text-[0.9286rem] text-text outline-none focus:bg-surface-3 transition-colors focus:ring-accent"
        />
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="İsim (opsiyonel — otomatik bulunur)"
            disabled={busy}
            className="flex-1 rounded-md bg-surface-2 px-3 py-2 text-[0.9286rem] text-text outline-none focus:bg-surface-3 transition-colors focus:ring-accent"
          />
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Hedef fiyat (opsiyonel)"
            disabled={busy}
            className="w-44 rounded-md bg-surface-2 px-3 py-2 text-[0.9286rem] text-text outline-none focus:bg-surface-3 transition-colors focus:ring-accent"
          />
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-[0.9286rem] font-medium text-black hover:bg-accent/90 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Plus size={13} strokeWidth={2} />
            )}
            Ekle
          </button>
        </div>
      </div>
      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-[0.7857rem] text-red-400">
          <AlertCircle size={11} /> {error}
        </div>
      )}
      {success && (
        <div className="mt-2 text-[0.7857rem] text-green-400">{success}</div>
      )}
    </form>
  );
}

export function PriceTrackerPage() {
  const items = usePriceTrackStore((s) => s.items);
  const sorted = [...items].sort((a, b) => b.addedAt - a.addedAt);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-base">
      <div className="mx-auto max-w-5xl px-8 py-8">
        <PageHeader
          title="Fiyat Takibi"
          subtitle="Ürünlerin fiyatlarını otomatik takip et. Düşüş olursa bildirim atılır."
        />

        <AddForm />

        <div className="mt-6 mb-3 flex items-baseline justify-between">
          <span className="text-[0.7857rem] uppercase tracking-wider text-text-faint">
            Takip edilen ({items.length})
          </span>
          {items.length > 0 && (
            <span className="text-[0.7143rem] text-text-faint">
              Her ürün saat başı otomatik kontrol edilir
            </span>
          )}
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-surface-1/40 px-6 py-12 text-center">
            <TrendingDown size={28} className="text-text-faint" strokeWidth={1.3} />
            <div className="text-sm text-text-secondary">Henüz takip edilen ürün yok</div>
            <div className="max-w-md text-[0.8571rem] text-text-faint">
              Yukarıdaki forma bir ürün URL'si yapıştır, ya da sohbette AI'a "şu linki takip et" diyerek de ekleyebilirsin.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {sorted.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
