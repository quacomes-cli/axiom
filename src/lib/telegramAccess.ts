// Telegram bot erişim kontrolü — whitelist + eşleştirme isteği yardımcıları.
//
// Bot token'ını bilen HERKES bota yazabilir; auto mode açıkken bu, modele ve
// (dolaylı olarak) araçlara erişim demek. Bu yüzden yalnızca onaylanmış
// chat_id'lerle konuşulur. Yabancı bir chat'ten mesaj gelirse "pending" listesine
// düşer; kullanıcı Uygulamalar → Telegram'dan onaylayana kadar model devreye girmez.
//
// Config anahtarları (appStore.config, hepsi string):
//   allowed_chat_ids: "123,456"        — onaylı chat id'ler
//   pending_pairs:    "123|ad,456|ad"  — onay bekleyenler (id|görünen ad)

export interface PendingPair {
  chatId: string;
  name: string;
}

export function parseAllowedChatIds(config: Record<string, string>): Set<string> {
  return new Set(
    (config.allowed_chat_ids ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function formatAllowedChatIds(ids: Iterable<string>): string {
  return Array.from(new Set(Array.from(ids).map((s) => s.trim()).filter(Boolean))).join(",");
}

export function parsePendingPairs(config: Record<string, string>): PendingPair[] {
  return (config.pending_pairs ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const sep = entry.indexOf("|");
      if (sep === -1) return { chatId: entry, name: "" };
      return { chatId: entry.slice(0, sep), name: entry.slice(sep + 1) };
    });
}

export function formatPendingPairs(pairs: PendingPair[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of pairs) {
    const id = p.chatId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // Ayraç karakterleri ada sızmasın
    const name = p.name.replace(/[|,]/g, " ").trim();
    out.push(name ? `${id}|${name}` : id);
  }
  return out.join(",");
}
