// Hibrit fiyat scraping: önce JSON-LD / OpenGraph dene (jenerik, çoğu modern
// e-ticaret sitesi destekler), başarısızsa bilinen siteler için CSS adapter'a
// düş. Yine yoksa null döner.
//
// HTTP isteğini Tauri'nin ipc.httpFetch'i üzerinden yapıyoruz — tarayıcı
// CORS'undan etkilenmemek için.

import { ipc } from "./ipc";

export interface ScrapeResult {
  price: number | null;
  currency: string | null;
  /** Sayfa <title>'ından gelen ürün adı (yoksa null) */
  title: string | null;
  /** Hangi yöntem işe yaradı — debug için */
  source: "json-ld" | "open-graph" | "adapter" | "none";
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

export async function scrapePrice(url: string): Promise<ScrapeResult> {
  let html: string;
  try {
    const resp = await ipc.httpFetch({
      url,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.5",
      },
    });
    if (resp.status >= 400) {
      return { price: null, currency: null, title: null, source: "none" };
    }
    html = resp.body;
  } catch {
    return { price: null, currency: null, title: null, source: "none" };
  }

  const title = extractTitle(html);

  // 1) JSON-LD (en güvenilir)
  const jsonLd = tryJsonLd(html);
  if (jsonLd.price !== null) {
    return { ...jsonLd, title, source: "json-ld" };
  }

  // 2) OpenGraph meta tag'ları
  const og = tryOpenGraph(html);
  if (og.price !== null) {
    return { ...og, title, source: "open-graph" };
  }

  // 3) Site adapter'ları
  const adapter = tryAdapter(url, html);
  if (adapter.price !== null) {
    return { ...adapter, title, source: "adapter" };
  }

  return { price: null, currency: null, title, source: "none" };
}

// --------------------------------------------------------------------------
// Yardımcılar
// --------------------------------------------------------------------------

function extractTitle(html: string): string | null {
  // og:title önce; yoksa <title>
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return decodeEntities(og[1].trim());
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return t ? decodeEntities(t[1].trim()) : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * "1.299,90 TL" / "1,299.90" / "1299" gibi farklı format'ları parse eder.
 * TR locale: "." binlik, "," ondalık. EN locale: "," binlik, "." ondalık.
 */
function parsePrice(raw: string | number | undefined | null): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return isFinite(raw) ? raw : null;
  const s = String(raw).replace(/[^\d.,]/g, "").trim();
  if (!s) return null;

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  let normalized: string;
  if (hasComma && hasDot) {
    // Hangisi en sağda? O ondalık ayraç.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      normalized = s.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    // Sadece virgül — büyük olasılıkla TR ondalık ("1299,90")
    // Eğer virgülden sonra tam 3 hane varsa binlik olabilir ("1,299")
    const parts = s.split(",");
    if (parts.length === 2 && parts[1].length === 3) {
      normalized = s.replace(",", "");
    } else {
      normalized = s.replace(",", ".");
    }
  } else {
    normalized = s;
  }

  const num = parseFloat(normalized);
  return isFinite(num) ? num : null;
}

// --------------------------------------------------------------------------
// JSON-LD
// --------------------------------------------------------------------------

function tryJsonLd(html: string): { price: number | null; currency: string | null } {
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1].trim();
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const found = walkJsonLd(data);
    if (found.price !== null) return found;
  }
  return { price: null, currency: null };
}

function walkJsonLd(node: unknown): { price: number | null; currency: string | null } {
  if (!node || typeof node !== "object") return { price: null, currency: null };
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = walkJsonLd(item);
      if (r.price !== null) return r;
    }
    return { price: null, currency: null };
  }
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  const isProduct =
    type === "Product" ||
    (Array.isArray(type) && type.includes("Product"));

  if (isProduct || obj["offers"]) {
    const offers = obj["offers"];
    if (offers) {
      const list = Array.isArray(offers) ? offers : [offers];
      for (const offer of list) {
        if (offer && typeof offer === "object") {
          const o = offer as Record<string, unknown>;
          const price = parsePrice(o["price"] as string | number);
          const currency = (o["priceCurrency"] as string) || null;
          if (price !== null) return { price, currency };
          // Bazı siteler offer içine offer koyar
          const nested = walkJsonLd(o);
          if (nested.price !== null) return nested;
        }
      }
    }
    const directPrice = parsePrice(obj["price"] as string | number);
    if (directPrice !== null) {
      return { price: directPrice, currency: (obj["priceCurrency"] as string) || null };
    }
  }

  // Tüm alanlarda derinlemesine ara
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const r = walkJsonLd(value);
      if (r.price !== null) return r;
    }
  }
  return { price: null, currency: null };
}

// --------------------------------------------------------------------------
// OpenGraph
// --------------------------------------------------------------------------

function tryOpenGraph(html: string): { price: number | null; currency: string | null } {
  const priceMatch =
    html.match(/<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+property=["']og:price:amount["'][^>]+content=["']([^"']+)["']/i);
  const currencyMatch =
    html.match(/<meta[^>]+property=["']product:price:currency["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+property=["']og:price:currency["'][^>]+content=["']([^"']+)["']/i);
  const price = priceMatch ? parsePrice(priceMatch[1]) : null;
  const currency = currencyMatch ? currencyMatch[1] : null;
  return { price, currency };
}

// --------------------------------------------------------------------------
// Site adapter'ları (kısa, defansif)
// --------------------------------------------------------------------------

function tryAdapter(url: string, html: string): { price: number | null; currency: string | null } {
  const host = (() => {
    try { return new URL(url).hostname.replace(/^www\./, ""); }
    catch { return ""; }
  })();

  if (host.includes("hepsiburada.com")) {
    // Hepsiburada data-bind attribute kullanır
    const m = html.match(/data-price=["']([^"']+)["']/i)
      || html.match(/"price"\s*:\s*"?([\d.,]+)"?/i);
    if (m) {
      const price = parsePrice(m[1]);
      if (price !== null) return { price, currency: "TRY" };
    }
  }

  if (host.includes("trendyol.com")) {
    const m = html.match(/"sellingPrice"\s*:\s*\{?\s*"?value"?\s*:?\s*([\d.,]+)/i)
      || html.match(/"price"\s*:\s*\{?\s*"?value"?\s*:?\s*([\d.,]+)/i)
      || html.match(/"discountedPrice"\s*:\s*([\d.,]+)/i);
    if (m) {
      const price = parsePrice(m[1]);
      if (price !== null) return { price, currency: "TRY" };
    }
  }

  if (host.includes("amazon.")) {
    // Amazon birden çok yerde fiyat yayar; en güveniliri "a-offscreen"
    const m = html.match(/<span[^>]+class=["']a-offscreen["'][^>]*>\s*([^<]+)\s*<\/span>/i);
    if (m) {
      const price = parsePrice(m[1]);
      if (price !== null) {
        const currency = m[1].includes("$") ? "USD"
          : m[1].includes("£") ? "GBP"
          : m[1].includes("€") ? "EUR"
          : "TRY";
        return { price, currency };
      }
    }
  }

  if (host.includes("n11.com")) {
    const m = html.match(/class=["']newPrice["'][^>]*>\s*<ins[^>]*>([\s\S]*?)<\/ins>/i)
      || html.match(/"price"\s*:\s*"?([\d.,]+)"?/i);
    if (m) {
      const price = parsePrice(m[1].replace(/<[^>]+>/g, ""));
      if (price !== null) return { price, currency: "TRY" };
    }
  }

  return { price: null, currency: null };
}
